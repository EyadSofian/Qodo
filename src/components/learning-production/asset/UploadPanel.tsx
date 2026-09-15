/**
 * Adding a version: drag a file in or browse, say what changed, watch it go
 * up, cancel if it was the wrong one. A version is never replaced — the panel
 * says which number this one will be.
 */

import { useRef, useState } from 'react';
import { FileUp, Link2, UploadCloud, X } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { cx } from '../../../lib/utils';
import { lp, uploads, type UploadHandle } from '../../../lib/learningProduction/api';
import { formatSize, lpErrorKey } from '../../../lib/learningProduction/format';
import type { AssetDetail } from '../../../lib/learningProduction/types';
import { useToast } from '../../ui';
import { useAsset } from './AssetContext';

const EXTENSIONS: Record<string, string[]> = {
  PPTX: ['pptx'],
  PPT: ['ppt'],
  PDF: ['pdf'],
  MP3: ['mp3'],
  WAV: ['wav'],
  M4A: ['m4a'],
  OGG: ['ogg', 'oga'],
  WEBM: ['webm', 'weba'],
  MP4: ['mp4', 'm4v'],
  MOV: ['mov'],
};

/** Read a media file's length before uploading it, so the version records it. */
function probeDuration(file: File): Promise<number | null> {
  if (!file.type.startsWith('audio/') && !file.type.startsWith('video/')) return Promise.resolve(null);
  return new Promise((resolve) => {
    const element = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio');
    const url = URL.createObjectURL(file);
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    element.preload = 'metadata';
    element.onloadedmetadata = () => done(Number.isFinite(element.duration) ? Math.round(element.duration * 1000) / 1000 : null);
    element.onerror = () => done(null);
    setTimeout(() => done(null), 4000);
    element.src = url;
  });
}

export function UploadPanel({ onClose }: { onClose?: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { assetId, detail, refresh } = useAsset();
  const upload = detail.upload!;
  const [mode, setMode] = useState<'file' | 'link'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState('');
  const [notes, setNotes] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const handle = useRef<UploadHandle<AssetDetail> | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const nextVersion = (detail.versions[0]?.versionNumber ?? 0) + 1;
  const accept = upload.accepted.flatMap((label) => EXTENSIONS[label] ?? []).map((extension) => `.${extension}`).join(',');

  const choose = (candidate: File | undefined) => {
    setProblem(null);
    if (!candidate) return;
    const extension = candidate.name.split('.').pop()?.toLowerCase() ?? '';
    const allowed = upload.accepted.flatMap((label) => EXTENSIONS[label] ?? []);
    if (!allowed.includes(extension)) {
      setProblem(t('lp.upload.wrongType', { types: upload.accepted.join(', ') }));
      return;
    }
    if (candidate.size > upload.maxBytes) {
      setProblem(t('lp.upload.tooLarge', { max: formatSize(upload.maxBytes) }));
      return;
    }
    setFile(candidate);
  };

  const send = async () => {
    setProblem(null);
    try {
      if (mode === 'link') {
        refresh(await lp.addLink(assetId, link.trim(), notes));
      } else if (file) {
        setProgress(0);
        const duration = await probeDuration(file);
        handle.current = uploads.version(assetId, file, notes, duration, setProgress);
        refresh(await handle.current.promise);
      } else return;
      toast.push(t('lp.toast.versionUploaded', { n: nextVersion }));
      setFile(null);
      setLink('');
      setNotes('');
      onClose?.();
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') setProblem(t('lp.upload.cancelled'));
      else setProblem(t(lpErrorKey(error)));
    } finally {
      setProgress(null);
      handle.current = null;
    }
  };

  const approved = detail.asset.status === 'APPROVED';

  return (
    <section className="mb-4 rounded-2xl border border-surface-line bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-ink">{t('lp.upload.title', { n: nextVersion })}</h2>
        <div className="flex items-center gap-1">
          {upload.allowsLink && (
            <div className="flex rounded-lg border border-surface-line p-0.5 text-[12px]">
              <button type="button" className={cx('rounded-md px-2 py-1 font-semibold', mode === 'file' ? 'bg-navy text-white' : 'text-ink-muted')} onClick={() => setMode('file')}>
                <FileUp size={12} className="me-1 inline" />
                {t('lp.upload.file')}
              </button>
              <button type="button" className={cx('rounded-md px-2 py-1 font-semibold', mode === 'link' ? 'bg-navy text-white' : 'text-ink-muted')} onClick={() => setMode('link')}>
                <Link2 size={12} className="me-1 inline" />
                {t('lp.upload.link')}
              </button>
            </div>
          )}
          {onClose && (
            <button type="button" className="btn-quiet !min-h-8 rounded-lg px-1.5" onClick={onClose} aria-label={t('common.close')} disabled={progress !== null}>
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {approved && <p className="mb-3 rounded-xl bg-status-warnBg px-3 py-2 text-[12.5px] text-accent-700">{t('lp.upload.afterApproval')}</p>}

      {mode === 'file' ? (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            choose(event.dataTransfer.files?.[0]);
          }}
          className={cx('rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors', dragging ? 'border-brand-400 bg-brand-50' : 'border-surface-line')}
        >
          {file ? (
            <div className="flex items-center justify-center gap-3 text-[13px]">
              <FileUp size={18} className="text-brand-500" />
              <span className="min-w-0 truncate font-semibold text-ink">{file.name}</span>
              <span className="shrink-0 text-ink-faint">
                {formatSize(file.size)} · {file.name.split('.').pop()?.toUpperCase()}
              </span>
              {progress === null && (
                <button type="button" className="btn-quiet !min-h-7 rounded-lg px-1.5" onClick={() => setFile(null)} aria-label={t('lp.upload.remove')}>
                  <X size={14} />
                </button>
              )}
            </div>
          ) : (
            <>
              <UploadCloud size={26} className="mx-auto text-ink-faint" />
              <p className="mt-2 text-[13px] text-ink">
                {t('lp.upload.drop')}{' '}
                <button type="button" className="font-semibold text-brand-600 hover:underline" onClick={() => input.current?.click()}>
                  {t('lp.upload.browse')}
                </button>
              </p>
              <p className="mt-1 text-[12px] text-ink-faint">{t('lp.upload.accepted', { types: upload.accepted.join(', '), max: formatSize(upload.maxBytes) })}</p>
            </>
          )}
          <input ref={input} type="file" accept={accept} className="sr-only" onChange={(event) => choose(event.target.files?.[0])} />
        </div>
      ) : (
        <label className="block">
          <span className="label">{t('lp.upload.linkLabel')}</span>
          <input className="field ltr" value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://" />
          <span className="mt-1 block text-[12px] text-ink-faint">{detail.asset.assetType === 'PPT' ? t('lp.upload.linkHintPpt') : t('lp.upload.linkHintVideo')}</span>
        </label>
      )}

      <label className="mt-3 block">
        <span className="label">{t('lp.upload.notes')}</span>
        <textarea className="field min-h-[60px] text-[13px]" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={t('lp.upload.notesPlaceholder')} />
      </label>

      {problem && <p className="mt-2 text-[12.5px] font-semibold text-status-bad" role="alert">{problem}</p>}

      {progress !== null && (
        <div className="mt-3 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <span className="block h-full bg-brand-500 transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <span className="w-10 text-end text-[12px] tabular-nums text-ink-muted">{Math.round(progress * 100)}%</span>
          <button type="button" className="btn-quiet btn-sm" onClick={() => handle.current?.abort()}>
            {t('common.cancel')}
          </button>
        </div>
      )}

      <div className="mt-3 flex justify-end">
        <button type="button" className="btn-primary btn-sm" onClick={() => void send()} disabled={progress !== null || (mode === 'file' ? !file : !link.trim())}>
          {t('lp.upload.submit', { n: nextVersion })}
        </button>
      </div>
    </section>
  );
}
