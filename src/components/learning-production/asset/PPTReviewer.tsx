/**
 * Slide review. The PDF — uploaded as-is, or attached as a PowerPoint's
 * export — is drawn page by page with pdf.js, and reviewers pin, box, circle,
 * point at and highlight what needs changing. Every mark is its own comment,
 * listed by slide in the sidebar; clicking one comes back to its slide.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileUp, MessageSquarePlus, Minus, Monitor, Plus } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { cx } from '../../../lib/utils';
import { paths, uploads } from '../../../lib/learningProduction/api';
import { lpErrorKey } from '../../../lib/learningProduction/format';
import type { Shape } from '../../../lib/learningProduction/types';
import { Spinner, useToast } from '../../ui';
import { EmptyPanel } from '../kit';
import { useAsset, useViewedVersion } from './AssetContext';
import { CommentComposer } from './CommentComposer';
import { COLORS, DrawingSurface, DrawingToolbar, useDrafts, type PlacedShape, type Tool } from './DrawingSurface';

type PdfDocument = import('pdfjs-dist').PDFDocumentProxy;

let pdfjsReady: Promise<typeof import('pdfjs-dist')> | null = null;

function loadPdfjs() {
  if (!pdfjsReady) {
    pdfjsReady = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
  }
  return pdfjsReady;
}

function slidesEmbed(url: string) {
  const match = /docs\.google\.com\/presentation\/d\/([^/]+)/.exec(url);
  return match ? `https://docs.google.com/presentation/d/${match[1]}/embed?start=false&loop=false` : null;
}

export function PPTReviewer() {
  const { t } = useI18n();
  const toast = useToast();
  const { detail, comments, addComment, focus, focusComment, refresh } = useAsset();
  const version = useViewedVersion();
  const [attaching, setAttaching] = useState(false);

  if (!version) {
    return (
      <EmptyPanel
        icon={<FileUp size={26} />}
        title={t('lp.ppt.emptyTitle')}
        body={detail.evaluation.actions.START.allowed ? t('lp.ppt.emptyStart') : detail.evaluation.blocked ? t('lp.ppt.emptyBlocked') : t('lp.ppt.emptyBody')}
      />
    );
  }

  if (version.sourceKind === 'LINK') {
    const embed = slidesEmbed(version.externalUrl ?? '');
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-surface-line bg-white px-4 py-2.5 text-[13px]">
          <span className="truncate text-ink-muted">{version.externalUrl}</span>
          <a href={version.externalUrl ?? '#'} target="_blank" rel="noreferrer" className="btn-ghost btn-sm shrink-0">
            <ExternalLink size={14} />
            {t('lp.versions.openLink')}
          </a>
        </div>
        {embed ? (
          <div className="overflow-hidden rounded-2xl border border-surface-line bg-navy" style={{ aspectRatio: '16 / 9' }}>
            <iframe src={embed} title={t('lp.stage.PPT')} className="h-full w-full" allowFullScreen />
          </div>
        ) : (
          <EmptyPanel title={t('lp.ppt.linkOnly')} />
        )}
        {comments?.canComment && <SlideNumberComment onSubmit={(page, body) => addComment({ body, commentType: 'SLIDE', anchor: { pageNumber: page } })} />}
      </div>
    );
  }

  const pdfUrl = version.mimeType === 'application/pdf' ? paths.file(version.id) : version.hasPreview ? paths.file(version.id, { preview: true }) : null;

  if (!pdfUrl) {
    const canAttach = detail.evaluation.isAssignee || detail.evaluation.actions.UPLOAD_VERSION.allowed;
    return (
      <EmptyPanel
        icon={<Monitor size={26} />}
        title={t('lp.ppt.needsPdfTitle')}
        body={t('lp.ppt.needsPdfBody')}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <a className="btn-ghost btn-sm" href={paths.file(version.id, { download: true })}>
              <Download size={14} />
              {t('lp.ppt.downloadOriginal')}
            </a>
            {canAttach && detail.asset.status !== 'LOCKED' && (
              <label className="btn-primary btn-sm cursor-pointer">
                {attaching ? <Spinner size={14} /> : <FileUp size={14} />}
                {t('lp.ppt.attachPdf')}
                <input
                  type="file"
                  accept=".pdf,application/pdf"
                  className="sr-only"
                  disabled={attaching}
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setAttaching(true);
                    try {
                      refresh(await uploads.preview(version.id, file).promise);
                      toast.push(t('lp.toast.previewAttached'));
                    } catch (error) {
                      toast.push(t(lpErrorKey(error)), 'bad');
                    } finally {
                      setAttaching(false);
                    }
                  }}
                />
              </label>
            )}
          </div>
        }
      />
    );
  }

  return <PdfSlides key={pdfUrl} url={pdfUrl} versionId={version.id} fileVersionId={version.id} focusNonce={focus?.nonce} focusComment={focusComment} />;
}

function PdfSlides({ url, versionId, fileVersionId, focusNonce, focusComment }: { url: string; versionId: string; fileVersionId: string; focusNonce?: number; focusComment: ReturnType<typeof useAsset>['focusComment'] }) {
  const { t, dir } = useI18n();
  const { detail, comments, addComment, focus } = useAsset();
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState<Tool>('POINTER');
  const [color, setColor] = useState(COLORS[0]);
  const [showResolved, setShowResolved] = useState(false);
  const [slideComment, setSlideComment] = useState(false);
  const draft = useDrafts(1);
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const narrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
  const canDraw = Boolean(comments?.canComment) && !narrow;

  useEffect(() => {
    let alive = true;
    let loaded: PdfDocument | null = null;
    setFailed(false);
    loadPdfjs()
      .then((pdfjs) => pdfjs.getDocument({ url, withCredentials: true }).promise)
      .then((document) => {
        loaded = document;
        if (alive) setDoc(document);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      void loaded?.destroy();
    };
  }, [url]);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setFrameWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!doc || !canvas.current || frameWidth === 0) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    void doc.getPage(page).then((pdfPage) => {
      if (cancelled || !canvas.current) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const scale = (frameWidth / base.width) * zoom;
      const viewport = pdfPage.getViewport({ scale });
      const ratio = window.devicePixelRatio || 1;
      const element = canvas.current;
      element.width = Math.floor(viewport.width * ratio);
      element.height = Math.floor(viewport.height * ratio);
      element.style.width = `${viewport.width}px`;
      element.style.height = `${viewport.height}px`;
      setPageSize({ width: viewport.width, height: viewport.height });
      const context = element.getContext('2d');
      if (!context) return;
      task = pdfPage.render({ canvasContext: context, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
      task.promise.catch(() => undefined);
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page, zoom, frameWidth]);

  // A comment clicked in the sidebar brings its slide back.
  useEffect(() => {
    const comment = focus?.comment;
    if (!comment) return;
    const target = comment.annotation?.pageNumber ?? (comment.anchor?.pageNumber ? Number(comment.anchor.pageNumber) : null);
    if (target && doc) setPage(Math.min(doc.numPages, target));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable]')) return;
      const forward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
      const back = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
      if (event.key === forward) setPage((value) => Math.min(doc?.numPages ?? value, value + 1));
      if (event.key === back) setPage((value) => Math.max(1, value - 1));
      if (event.key === 'Escape') {
        draft.clear();
        setTool('POINTER');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [doc, dir, draft]);

  const onVersion = (comments?.comments ?? []).filter((comment) => comment.versionId === versionId);
  const perPage = useMemo(() => {
    const counts = new Map<number, number>();
    for (const comment of onVersion) {
      if (comment.status !== 'OPEN') continue;
      const number = comment.annotation?.pageNumber ?? (comment.anchor?.pageNumber ? Number(comment.anchor.pageNumber) : null);
      if (number) counts.set(number, (counts.get(number) ?? 0) + 1);
    }
    return counts;
  }, [onVersion]);

  const placed: PlacedShape[] = onVersion
    .filter((comment) => comment.annotation && comment.annotation.pageNumber === page && (showResolved || comment.status === 'OPEN'))
    .map((comment, index) => ({
      id: comment.id,
      shape: {
        annotationType: comment.annotation!.annotationType,
        geometry: { x: comment.annotation!.x, y: comment.annotation!.y, width: comment.annotation!.width ?? undefined, height: comment.annotation!.height ?? undefined, points: comment.annotation!.metadata.points ?? undefined },
        color: comment.annotation!.metadata.color ?? COLORS[0],
      },
      label: index + 1,
      resolved: comment.status === 'RESOLVED',
      active: focus?.comment.id === comment.id,
      onClick: () => focusComment(comment),
    }));

  const pending: Shape | null = draft.drafts[0] ?? null;
  const Prev = dir === 'rtl' ? ChevronRight : ChevronLeft;
  const Next = dir === 'rtl' ? ChevronLeft : ChevronRight;

  if (failed) return <EmptyPanel title={t('lp.ppt.loadFailed')} action={<a className="btn-ghost btn-sm" href={url}>{t('lp.versions.download')}</a>} />;

  return (
    <div className="rounded-2xl border border-surface-line bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-surface-line px-3 py-2">
        <div className="flex items-center gap-1">
          <button type="button" className="btn-quiet !min-h-8 rounded-lg px-1.5" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1} aria-label={t('lp.ppt.previous')}>
            <Prev size={16} />
          </button>
          <select className="field !min-h-8 !w-auto !py-0.5 text-[13px]" value={page} onChange={(event) => setPage(Number(event.target.value))} aria-label={t('lp.ppt.slide')}>
            {Array.from({ length: doc?.numPages ?? 1 }, (_, index) => index + 1).map((number) => (
              <option key={number} value={number}>
                {t('lp.comment.slide', { n: number })}
                {perPage.get(number) ? ` · ${perPage.get(number)}` : ''}
              </option>
            ))}
          </select>
          <span className="text-[12px] text-ink-faint">/ {doc?.numPages ?? '…'}</span>
          <button type="button" className="btn-quiet !min-h-8 rounded-lg px-1.5" onClick={() => setPage((value) => Math.min(doc?.numPages ?? value, value + 1))} disabled={!doc || page >= doc.numPages} aria-label={t('lp.ppt.next')}>
            <Next size={16} />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className="btn-quiet !min-h-8 rounded-lg px-1.5" onClick={() => setZoom((value) => Math.max(0.5, Math.round((value - 0.25) * 100) / 100))} aria-label={t('lp.ppt.zoomOut')}>
            <Minus size={14} />
          </button>
          <span className="w-11 text-center text-[12px] tabular-nums text-ink-muted">{Math.round(zoom * 100)}%</span>
          <button type="button" className="btn-quiet !min-h-8 rounded-lg px-1.5" onClick={() => setZoom((value) => Math.min(3, value + 0.25))} aria-label={t('lp.ppt.zoomIn')}>
            <Plus size={14} />
          </button>
        </div>
        {canDraw && (
          <DrawingToolbar
            tool={tool}
            onTool={(next) => {
              setTool(next);
              if (next === 'POINTER') draft.clear();
            }}
            color={color}
            onColor={setColor}
            canUndo={draft.drafts.length > 0}
            canRedo={draft.canRedo}
            onUndo={draft.undo}
            onRedo={draft.redo}
          />
        )}
        <div className="ms-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[12px] text-ink-muted">
            <input type="checkbox" className="h-3.5 w-3.5 accent-brand-500" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)} />
            {t('lp.ppt.showResolved')}
          </label>
          {comments?.canComment && (
            <button type="button" className="btn-ghost btn-sm" onClick={() => setSlideComment((value) => !value)}>
              <MessageSquarePlus size={14} />
              {t('lp.ppt.commentSlide')}
            </button>
          )}
          <a className="btn-quiet btn-sm !px-2" href={paths.file(fileVersionId, { download: true })} aria-label={t('lp.versions.download')}>
            <Download size={14} />
          </a>
        </div>
      </div>
      {comments?.canComment && narrow && <p className="border-b border-surface-line px-3 py-2 text-[12px] text-ink-faint">{t('lp.ppt.desktopHint')}</p>}

      {(pending || slideComment) && (
        <div className="border-b border-surface-line bg-brand-50/40 p-3">
          <CommentComposer
            compact
            autoFocus
            context={pending ? t('lp.ppt.markOn', { n: page, shape: t(`lp.draw.${pending.annotationType}` as never) }) : t('lp.ppt.commentOn', { n: page })}
            onCancel={() => {
              draft.clear();
              setSlideComment(false);
            }}
            onSubmit={async (body) => {
              const created = pending
                ? await addComment({ body, commentType: 'ANNOTATION', annotation: { pageNumber: page, annotationType: pending.annotationType, geometry: pending.geometry, color: pending.color } })
                : await addComment({ body, commentType: 'SLIDE', anchor: { pageNumber: page } });
              if (created) {
                draft.clear();
                setSlideComment(false);
                if (tool === 'PIN') setTool('PIN');
              }
              return Boolean(created);
            }}
          />
        </div>
      )}

      <div ref={frame} className="overflow-auto bg-surface-sunken p-3" style={{ maxHeight: 'calc(100dvh - 240px)' }}>
        {!doc && (
          <div className="grid aspect-video place-items-center">
            <Spinner size={22} className="text-ink-faint" />
          </div>
        )}
        <div className={cx('relative mx-auto shadow-card', !doc && 'hidden')} style={{ width: pageSize.width || undefined, height: pageSize.height || undefined }}>
          <canvas ref={canvas} className="block bg-white" />
          <DrawingSurface
            placed={placed}
            drafts={pending ? [pending] : []}
            tool={canDraw && !pending ? tool : 'POINTER'}
            color={color}
            onDraw={(shape) => {
              draft.clear();
              draft.add(shape);
            }}
          />
        </div>
      </div>
      {detail.asset.status === 'LOCKED' && <p className="border-t border-surface-line px-3 py-2 text-[12px] text-ink-faint">{t('lp.lockedBanner')}</p>}
    </div>
  );
}

function SlideNumberComment({ onSubmit }: { onSubmit: (page: number, body: string) => Promise<unknown> }) {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  return (
    <div className="rounded-2xl border border-surface-line bg-white p-3">
      <label className="mb-2 flex items-center gap-2 text-[13px] text-ink-muted">
        {t('lp.ppt.slide')}
        <input type="number" min={1} className="field !w-20 !min-h-8 !py-1" value={page} onChange={(event) => setPage(Math.max(1, Number(event.target.value) || 1))} />
      </label>
      <CommentComposer compact onSubmit={async (body) => Boolean(await onSubmit(page, body))} />
    </div>
  );
}
