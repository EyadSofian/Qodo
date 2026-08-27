/**
 * How a file looks once it is attached to something, wherever that something
 * lives.
 *
 * Qodo Mail, the management desk and Qodo Calendar all hang files off a record
 * and all had — or were about to have — their own answer to "is this a picture,
 * and what does a picture look like in a list". One answer is better than
 * three: a photograph of a signed page is the commonest attachment in this
 * workspace and it should be legible without a download in every one of them.
 *
 * The component knows nothing about routes. Each caller passes `urlOf`, because
 * a mail attachment, a desk attachment and a calendar attachment are read from
 * three different endpoints with three different access rules — which is the
 * one part that must not be shared.
 */

import { useCallback, useEffect, useState, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Trash2, X } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { cx, formatBytes } from '../lib/utils';

export interface AttachmentLike {
  id: string;
  name: string;
  size: number;
  type: string;
}

export const isImage = (file: AttachmentLike) => file.type.startsWith('image/');

export function AttachmentTiles({
  files,
  urlOf,
  onRemove,
  dark = false,
  className,
}: {
  files: AttachmentLike[];
  urlOf: (file: AttachmentLike) => string;
  onRemove?: (file: AttachmentLike) => void;
  dark?: boolean;
  className?: string;
}) {
  const [preview, setPreview] = useState<AttachmentLike | null>(null);
  if (!files?.length) return null;

  const images = files.filter(isImage);
  const documents = files.filter((file) => !isImage(file));

  return (
    <div className={cx('grid gap-2', className)}>
      {images.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {images.map((file) => (
            <li key={file.id} className="group relative">
              <button
                type="button"
                onClick={() => setPreview(file)}
                title={file.name}
                className={cx(
                  'block overflow-hidden rounded-xl border',
                  dark ? 'border-white/20' : 'border-surface-line'
                )}
              >
                <img
                  src={urlOf(file)}
                  alt={file.name}
                  loading="lazy"
                  className="h-24 w-24 object-cover transition-transform group-hover:scale-105"
                />
              </button>
              {onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(file)}
                  aria-label={`حذف ${file.name}`}
                  className="absolute -top-1.5 -end-1.5 grid h-6 w-6 place-items-center rounded-full bg-white text-ink-faint shadow-card transition-colors hover:bg-rose-50 hover:text-rose-600"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {documents.length > 0 && (
        <ul className="grid gap-1.5">
          {documents.map((file) => (
            <li key={file.id} className="flex items-center gap-2">
              <a
                href={urlOf(file)}
                target="_blank"
                rel="noreferrer"
                className={cx(
                  'flex min-w-0 flex-1 items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-semibold transition',
                  dark
                    ? 'border-white/15 bg-white/10 text-white hover:bg-white/15'
                    : 'border-surface-line bg-surface-sunken text-ink-muted hover:border-brand-300 hover:text-brand-600'
                )}
              >
                <FileText size={14} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <span className="ltr opacity-60">{formatBytes(file.size)}</span>
              </a>
              {onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(file)}
                  aria-label={`حذف ${file.name}`}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-rose-50 hover:text-rose-600"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {preview && (
        <Lightbox file={preview} src={urlOf(preview)} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}

function Lightbox({
  file,
  src,
  onClose,
}: {
  file: AttachmentLike;
  src: string;
  onClose: () => void;
}) {
  const { lang } = useI18n();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-navy/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <figure className="max-h-full max-w-3xl" onClick={(event) => event.stopPropagation()}>
        <img src={src} alt={file.name} className="max-h-[80dvh] rounded-2xl object-contain shadow-panel" />
        <figcaption className="mt-2 flex items-center justify-between gap-3 text-[12px] font-semibold text-white/90">
          <span className="min-w-0 truncate">{file.name}</span>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg p-1 hover:bg-white/15" aria-label={lang === 'en' ? 'Close' : 'إغلاق'}>
            <X size={16} />
          </button>
        </figcaption>
      </figure>
    </div>,
    document.body
  );
}

/**
 * Dropping a file on the thing it belongs to, and pasting a screenshot into it.
 *
 * Both are the same gesture as far as this workspace is concerned — "here is a
 * file, take it" — and both were missing everywhere, which is why a screenshot
 * of an error currently takes a round trip through the desktop.
 */
export function useFileDrop({
  onFiles,
  disabled = false,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}) {
  const [dragging, setDragging] = useState(false);

  const onDragOver = useCallback(
    (event: DragEvent) => {
      if (disabled || !event.dataTransfer?.types?.includes('Files')) return;
      event.preventDefault();
      setDragging(true);
    },
    [disabled]
  );

  const onDragLeave = useCallback((event: DragEvent) => {
    // `relatedTarget` inside the same zone is a child hand-off, not a leave.
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    setDragging(false);
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      if (disabled) return;
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length === 0) return;
      event.preventDefault();
      setDragging(false);
      onFiles(files);
    },
    [disabled, onFiles]
  );

  return { dragging, dropProps: { onDragOver, onDragLeave, onDrop } };
}

/** Files carried by a paste event — a screenshot, usually. */
export function filesFromPaste(event: React.ClipboardEvent): File[] {
  return [...(event.clipboardData?.items ?? [])]
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
}
