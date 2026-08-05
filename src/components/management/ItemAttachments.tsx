/**
 * The pictures on a management item.
 *
 * Images are shown, not listed. The whole reason to attach a photo of a signed
 * page or a whiteboard is that looking at it is faster than reading about it,
 * and a row saying "IMG_4821.jpg" throws exactly that away. Anything that is
 * not an image falls back to a named row, because a PDF has nothing to show
 * until it is opened.
 */

import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Paperclip, Trash2, X } from 'lucide-react';
import {
  MAX_FILES_PER_ITEM,
  MAX_FILE_BYTES,
  fetchFiles,
  fileUrl,
  isImage,
  removeFile,
  uploadFile,
  type MgmtFile,
} from '../../lib/management';
import { formatBytes, cx } from '../../lib/utils';
import { Spinner, useToast } from '../ui';

export function ItemAttachments({
  itemId,
  canManage,
  onCountChange,
}: {
  itemId: string;
  canManage: boolean;
  /** Lets the card's badge stay right without refetching the whole board. */
  onCountChange?: (count: number) => void;
}) {
  const { push } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<MgmtFile[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<MgmtFile | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchFiles(itemId)
      .then((rows) => !cancelled && setFiles(rows))
      .catch(() => !cancelled && setFiles([]));
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  const add = async (picked: FileList | null) => {
    if (!picked?.length) return;
    const room = MAX_FILES_PER_ITEM - (files?.length ?? 0);
    if (room <= 0) return push(`الحد ${MAX_FILES_PER_ITEM} ملفات للبند الواحد.`, 'bad');

    setBusy(true);
    try {
      // Sequential rather than parallel: the per-item cap is checked on the
      // server per request, so firing eight at once could slip past it.
      for (const file of [...picked].slice(0, room)) {
        if (file.size > MAX_FILE_BYTES) {
          push(`«${file.name}» أكبر من ${formatBytes(MAX_FILE_BYTES)}.`, 'bad');
          continue;
        }
        const { attachment, attachmentCount } = await uploadFile(itemId, file);
        setFiles((current) => [...(current ?? []), attachment]);
        onCountChange?.(attachmentCount);
      }
    } catch {
      push('تعذّر رفع الملف.', 'bad');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const drop = async (file: MgmtFile) => {
    if (!window.confirm(`حذف «${file.name}»؟`)) return;
    try {
      const { attachmentCount } = await removeFile(itemId, file.id);
      setFiles((current) => (current ?? []).filter((row) => row.id !== file.id));
      onCountChange?.(attachmentCount);
    } catch {
      push('تعذّر الحذف.', 'bad');
    }
  };

  if (files === null) {
    return (
      <div className="flex items-center gap-2 py-2 text-[12px] text-ink-faint">
        <Spinner size={14} />
        جارٍ التحميل…
      </div>
    );
  }

  const full = files.length >= MAX_FILES_PER_ITEM;

  return (
    <div className="grid gap-2">
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.map((file) =>
            isImage(file) ? (
              <li key={file.id} className="group relative">
                <button
                  type="button"
                  onClick={() => setPreview(file)}
                  className="block overflow-hidden rounded-xl border border-surface-line"
                  title={file.name}
                >
                  <img
                    src={fileUrl(itemId, file.id)}
                    alt={file.name}
                    loading="lazy"
                    className="h-20 w-20 object-cover transition-transform group-hover:scale-105"
                  />
                </button>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => drop(file)}
                    aria-label={`حذف ${file.name}`}
                    className="absolute -top-1.5 -end-1.5 grid h-6 w-6 place-items-center rounded-full bg-white text-ink-faint shadow-card transition-colors hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </li>
            ) : (
              <li key={file.id} className="flex items-center gap-2 rounded-xl border border-surface-line px-2.5 py-2">
                <Paperclip size={13} className="shrink-0 text-ink-faint" />
                <a
                  href={fileUrl(itemId, file.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="max-w-[10rem] truncate text-[12px] font-semibold text-ink hover:text-brand-600"
                >
                  {file.name}
                </a>
                <span className="text-[11px] tabular-nums text-ink-faint">{formatBytes(file.size)}</span>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => drop(file)}
                    aria-label={`حذف ${file.name}`}
                    className="text-ink-faint transition-colors hover:text-rose-600"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </li>
            )
          )}
        </ul>
      )}

      {canManage && (
        <div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="hidden"
            onChange={(event) => add(event.target.files)}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy || full}
            className={cx(
              'btn-ghost btn-sm gap-1.5',
              (busy || full) && 'cursor-not-allowed opacity-60'
            )}
          >
            {busy ? <Spinner size={14} /> : <ImagePlus size={15} />}
            {full ? `الحد ${MAX_FILES_PER_ITEM} ملفات` : 'إضافة صورة'}
          </button>
        </div>
      )}

      {preview && (
        <div
          className="fixed inset-0 z-[80] grid place-items-center bg-navy/80 p-4"
          onClick={() => setPreview(null)}
          role="dialog"
          aria-modal="true"
          aria-label={preview.name}
        >
          <button
            type="button"
            onClick={() => setPreview(null)}
            aria-label="إغلاق"
            className="absolute end-4 top-4 grid h-10 w-10 place-items-center rounded-xl text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X size={20} />
          </button>
          <img
            src={fileUrl(itemId, preview.id)}
            alt={preview.name}
            className="max-h-[85dvh] max-w-full rounded-xl object-contain shadow-panel"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
