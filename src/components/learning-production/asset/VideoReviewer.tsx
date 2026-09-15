/**
 * Final video review. Pause, draw on the frame, say what to change; comment at
 * a moment or over a range; keep the approved slides, script and voice-over one
 * click away; and work through the QA checklist before approving.
 */

import { useEffect, useRef, useState } from 'react';
import { BookOpen, ClipboardCheck, ExternalLink, MessageSquarePlus, PenLine, X } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { cx } from '../../../lib/utils';
import { lp, paths } from '../../../lib/learningProduction/api';
import { invalidate, useLpQuery } from '../../../lib/learningProduction/hooks';
import { lpErrorKey, stageKey } from '../../../lib/learningProduction/format';
import { formatTimecode, normalizeContent } from '@shared/learningProduction/review';
import type { ChecklistItem, ChecklistStatus, ScriptContent, Shape } from '../../../lib/learningProduction/types';
import { useToast } from '../../ui';
import { Chip, EmptyPanel, Section, StageLabel } from '../kit';
import { useAsset, useViewedVersion } from './AssetContext';
import { CommentComposer } from './CommentComposer';
import { COLORS, DrawingSurface, DrawingToolbar, useDrafts, type PlacedShape, type Tool } from './DrawingSurface';
import { MarkerTrack, PlayerControls, useMediaState, useRange } from './MediaTools';

const PLAYABLE = /\.(mp4|m4v|webm|mov)(\?|#|$)/i;

export function VideoReviewer() {
  const { t } = useI18n();
  const { detail, comments, addComment, focus, focusComment } = useAsset();
  const version = useViewedVersion();
  const video = useRef<HTMLVideoElement>(null);
  const media = useMediaState(video);
  const range = useRange(media);
  const drafts = useDrafts(50);
  const [drawing, setDrawing] = useState(false);
  const [tool, setTool] = useState<Tool>('RECTANGLE');
  const [color, setColor] = useState(COLORS[0]);
  const [composing, setComposing] = useState(false);
  const [shown, setShown] = useState<{ id: string; shapes: Shape[] } | null>(null);
  const [aspect, setAspect] = useState(16 / 9);
  const [panel, setPanel] = useState<'references' | 'checklist' | null>(null);
  const narrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;

  const src = version?.sourceKind === 'FILE' ? paths.file(version.id) : version?.externalUrl && PLAYABLE.test(version.externalUrl) ? version.externalUrl : null;

  // Clicking a comment: go to its moment, stop there, and show what was drawn.
  useEffect(() => {
    const marker = focus?.comment.videoMarker;
    if (!marker) return;
    media.seek(marker.frameTimestamp ?? marker.startSeconds, true);
    setShown(marker.drawing?.length ? { id: focus!.comment.id, shapes: marker.drawing } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  useEffect(() => {
    if (media.playing) setShown(null);
  }, [media.playing]);

  if (!version) {
    return (
      <EmptyPanel
        title={t('lp.video.emptyTitle')}
        body={detail.evaluation.actions.START.allowed ? t('lp.video.emptyStart') : detail.evaluation.blocked ? t('lp.video.emptyBlocked') : t('lp.video.emptyBody')}
      />
    );
  }

  const markers = (comments?.comments ?? []).filter((comment) => comment.versionId === version.id && comment.videoMarker);
  const canComment = Boolean(comments?.canComment);

  const startDrawing = () => {
    media.seek(media.time, true);
    range.beginAt(media.time);
    setShown(null);
    setDrawing(true);
    setComposing(true);
  };

  const reset = () => {
    setComposing(false);
    setDrawing(false);
    drafts.clear();
    range.clear();
  };

  const placed: PlacedShape[] = shown ? shown.shapes.map((shape, index) => ({ id: `${shown.id}-${index}`, shape, active: true })) : [];

  return (
    <div className="space-y-3">
      <Section bodyClassName="!p-3">
        {src ? (
          // A full-width dark stage, so a portrait or square cut sits centred on
          // the canvas instead of shrinking to a strip inside a white card.
          <div className="flex justify-center rounded-xl bg-navy p-2">
            <div className="relative overflow-hidden rounded-lg bg-black" style={{ aspectRatio: `${aspect}`, maxHeight: 'calc(100dvh - 280px)', maxWidth: '100%' }}>
              <video
                ref={video}
                src={src}
                preload="metadata"
                className="h-full w-full"
                onLoadedMetadata={(event) => {
                  const element = event.currentTarget;
                  if (element.videoWidth && element.videoHeight) setAspect(element.videoWidth / element.videoHeight);
                }}
                onClick={() => !drawing && media.toggle()}
                playsInline
              />
              {(drawing || shown) && (
                <DrawingSurface placed={placed} drafts={drafts.drafts} tool={drawing ? tool : 'POINTER'} color={color} onDraw={drafts.add} />
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-bg px-4 py-6 text-[13px]">
            <span className="text-ink-muted">{t('lp.video.linkNotPlayable')}</span>
            <a className="btn-ghost btn-sm" href={version.externalUrl ?? '#'} target="_blank" rel="noreferrer">
              <ExternalLink size={14} />
              {t('lp.versions.openLink')}
            </a>
          </div>
        )}

        {src && (
          <>
            <div
              className="relative mt-3 h-3 cursor-pointer rounded-full bg-surface-sunken"
              dir="ltr"
              role="slider"
              tabIndex={0}
              aria-label={t('lp.media.seek')}
              aria-valuemin={0}
              aria-valuemax={Math.round(media.duration)}
              aria-valuenow={Math.round(media.time)}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                media.seek(((event.clientX - rect.left) / rect.width) * media.duration);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight') media.seek(media.time + 5);
                if (event.key === 'ArrowLeft') media.seek(media.time - 5);
              }}
            >
              <span className="absolute inset-y-0 start-0 rounded-full bg-brand-200" style={{ width: `${media.duration ? (media.time / media.duration) * 100 : 0}%` }} />
              <MarkerTrack comments={markers} duration={media.duration} kind="video" activeId={focus?.comment.id} onPick={focusComment} />
            </div>
            <div className="mt-3">
              <PlayerControls media={media}>
                {canComment && !composing && (
                  <>
                    {!narrow && (
                      <button type="button" className="btn-ghost btn-sm" onClick={startDrawing}>
                        <PenLine size={14} />
                        {t('lp.video.drawOnFrame')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      onClick={() => {
                        media.seek(media.time, true);
                        range.beginAt(media.time);
                        setComposing(true);
                      }}
                    >
                      <MessageSquarePlus size={14} />
                      {t('lp.media.commentAt', { time: formatTimecode(media.time) })}
                    </button>
                  </>
                )}
              </PlayerControls>
            </div>
          </>
        )}

        {composing && range.start !== null && (
          <div className="mt-3 rounded-xl border border-brand-200 bg-brand-50/40 p-3">
            {drawing && (
              <div className="mb-2">
                <DrawingToolbar
                  tool={tool}
                  onTool={setTool}
                  color={color}
                  onColor={setColor}
                  tools={['PIN', 'RECTANGLE', 'CIRCLE', 'ARROW', 'FREEHAND']}
                  canUndo={drafts.drafts.length > 0}
                  canRedo={drafts.canRedo}
                  onUndo={drafts.undo}
                  onRedo={drafts.redo}
                />
              </div>
            )}
            <CommentComposer
              compact
              autoFocus
              context={
                <span className="flex flex-wrap items-center gap-2">
                  <span className="ltr">{range.end ? `${formatTimecode(range.start)} → ${formatTimecode(range.end)}` : formatTimecode(range.start)}</span>
                  {drawing && <span className="font-normal text-ink-faint">{t('lp.video.drawHint', { n: drafts.drafts.length })}</span>}
                  {range.end === null && (
                    <button type="button" className="font-semibold text-brand-600 hover:underline" onClick={range.endAt}>
                      {t('lp.media.endRange', { time: formatTimecode(media.time) })}
                    </button>
                  )}
                </span>
              }
              onCancel={reset}
              onSubmit={async (body) => {
                const created = await addComment({
                  body,
                  commentType: 'VIDEO_TIMESTAMP',
                  marker: {
                    startSeconds: range.start!,
                    endSeconds: range.end,
                    ...(drafts.drafts.length ? { frameTimestamp: range.start!, drawing: drafts.drafts } : {}),
                  },
                });
                if (created) reset();
                return Boolean(created);
              }}
            />
          </div>
        )}
      </Section>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={cx('btn-sm', panel === 'references' ? 'btn-navy' : 'btn-ghost')} onClick={() => setPanel(panel === 'references' ? null : 'references')} aria-expanded={panel === 'references'}>
          <BookOpen size={14} />
          {t('lp.video.references')}
        </button>
        <button type="button" className={cx('btn-sm', panel === 'checklist' ? 'btn-navy' : 'btn-ghost')} onClick={() => setPanel(panel === 'checklist' ? null : 'checklist')} aria-expanded={panel === 'checklist'}>
          <ClipboardCheck size={14} />
          {t('lp.video.checklist')}
        </button>
      </div>

      {panel === 'references' && <References onClose={() => setPanel(null)} />}
      {panel === 'checklist' && <Checklist versionId={version.id} onClose={() => setPanel(null)} />}
    </div>
  );
}

function References({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { detail } = useAsset();
  const [tab, setTab] = useState(detail.references[0]?.assetType ?? 'PPT');
  const current = detail.references.find((reference) => reference.assetType === tab);

  return (
    <Section
      title={t('lp.video.references')}
      actions={
        <button type="button" className="btn-quiet !min-h-8 rounded-lg px-1.5" onClick={onClose} aria-label={t('common.close')}>
          <X size={15} />
        </button>
      }
    >
      {detail.references.length === 0 ? (
        <p className="text-[13px] text-ink-faint">{t('lp.video.noReferences')}</p>
      ) : (
        <>
          <div className="mb-3 flex gap-1">
            {detail.references.map((reference) => (
              <button key={reference.assetType} type="button" aria-pressed={tab === reference.assetType} onClick={() => setTab(reference.assetType)} className={cx('rounded-lg px-2.5 py-1 text-[12.5px] font-semibold', tab === reference.assetType ? 'bg-navy text-white' : 'text-ink-muted hover:bg-surface-sunken')}>
                {t(stageKey(reference.assetType))}
              </button>
            ))}
          </div>
          {current && (
            <div>
              <p className="mb-2 flex items-center gap-2 text-[12.5px] text-ink-muted">
                <StageLabel type={current.assetType} /> v{current.version.versionNumber}
                {current.approved ? <Chip tone="ok">{t('lp.status.APPROVED')}</Chip> : <Chip tone="warn">{t('lp.video.notApprovedYet')}</Chip>}
              </p>
              {current.assetType === 'VOICE_OVER' && current.version.hasFile && <audio controls src={paths.file(current.version.id)} className="w-full" />}
              {current.assetType === 'PPT' && (
                <a
                  className="btn-ghost btn-sm"
                  href={
                    current.version.externalUrl ??
                    paths.file(current.version.id, { preview: current.version.mimeType !== 'application/pdf' && current.version.hasPreview, download: current.version.mimeType !== 'application/pdf' && !current.version.hasPreview })
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={14} />
                  {t('lp.video.openSlides')}
                </a>
              )}
              {current.assetType === 'SCRIPT' && (
                <ol className="max-h-80 space-y-2 overflow-y-auto">
                  {(normalizeContent('SCRIPT', current.version.content) as ScriptContent).blocks.map((block, index) => (
                    <li key={block.id} className="rounded-lg bg-surface-bg px-3 py-2 text-[13px]">
                      <p className="text-[11.5px] font-bold text-ink-muted">
                        {t('lp.script.block', { n: index + 1 })}
                        {block.title ? ` · ${block.title}` : ''}
                      </p>
                      <p className="whitespace-pre-line leading-relaxed text-ink">{block.narration}</p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </>
      )}
    </Section>
  );
}

const STATES: ChecklistStatus[] = ['PENDING', 'PASSED', 'ISSUE'];

function Checklist({ versionId, onClose }: { versionId: string; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const path = `/learning-production/versions/${versionId}/checklist`;
  const { data, setData } = useLpQuery<{ items: ChecklistItem[]; canEdit: boolean }>(path);

  if (!data) return null;
  const passed = data.items.filter((item) => item.status === 'PASSED').length;
  const issues = data.items.filter((item) => item.status === 'ISSUE').length;

  const update = async (item: ChecklistItem, patch: Partial<ChecklistItem>) => {
    const previous = data;
    setData({ ...data, items: data.items.map((entry) => (entry.id === item.id ? { ...entry, ...patch } : entry)) });
    try {
      await lp.updateChecklistItem(item.id, patch);
      invalidate(`/learning-production/assets`);
    } catch (error) {
      setData(previous);
      toast.push(t(lpErrorKey(error)), 'bad');
    }
  };

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          {t('lp.video.checklist')}
          <span className="text-[12px] font-normal text-ink-muted">{t('lp.video.checklistSummary', { passed, total: data.items.length, issues })}</span>
        </span>
      }
      actions={
        <button type="button" className="btn-quiet !min-h-8 rounded-lg px-1.5" onClick={onClose} aria-label={t('common.close')}>
          <X size={15} />
        </button>
      }
    >
      {!data.canEdit && <p className="mb-2 text-[12px] text-ink-faint">{t('lp.video.checklistReadOnly')}</p>}
      <ul className="divide-y divide-surface-line">
        {data.items.map((item) => (
          <li key={item.id} className="py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[13.5px] text-ink">
                {item.category ? t(`lp.check.${item.category}` as never) : item.label}
                {item.required && <span className="text-status-bad"> *</span>}
              </span>
              <div className="flex rounded-lg border border-surface-line p-0.5" role="radiogroup" aria-label={item.label}>
                {STATES.map((state) => (
                  <button
                    key={state}
                    type="button"
                    role="radio"
                    aria-checked={item.status === state}
                    disabled={!data.canEdit}
                    onClick={() => void update(item, { status: state })}
                    className={cx(
                      'rounded-md px-2 py-0.5 text-[12px] font-semibold disabled:cursor-default',
                      item.status === state
                        ? state === 'PASSED'
                          ? 'bg-status-ok text-white'
                          : state === 'ISSUE'
                            ? 'bg-status-bad text-white'
                            : 'bg-navy text-white'
                        : 'text-ink-muted'
                    )}
                  >
                    {t(`lp.checkState.${state}` as never)}
                  </button>
                ))}
              </div>
            </div>
            {(item.status === 'ISSUE' || item.notes) && (
              <input
                className="field mt-1.5 !min-h-8 !py-1 text-[13px]"
                defaultValue={item.notes}
                readOnly={!data.canEdit}
                placeholder={t('lp.video.issueNotes')}
                onBlur={(event) => event.target.value !== item.notes && void update(item, { notes: event.target.value })}
              />
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}
