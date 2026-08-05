/**
 * Filing or editing one item.
 *
 * The form asks the type first and then shows only the fields that type
 * actually has: a decision has no room and no duration, a reminder has no
 * attendees. A single form carrying every field for every kind is how people
 * end up leaving half of it blank and the other half wrong.
 */

import { useEffect, useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import {
  MAX_FILES_PER_ITEM,
  MAX_FILE_BYTES,
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  STATUS_LABEL,
  STATUS_ORDER,
  type MgmtDraft,
  type MgmtKind,
  type MgmtPriority,
  type MgmtStatus,
  emptyDraft,
} from '../../lib/management';
import { KindCards } from './KindCards';
import { ItemAttachments } from './ItemAttachments';
import { DEPARTMENTS } from '@shared/departments';
import { useI18n } from '../../lib/i18n';
import { useWorkspace } from '../../lib/workspace';
import { cx } from '../../lib/utils';
import { Field, Spinner } from '../ui';

/** Which extra fields each kind is actually asking about. */
const SHOWS = {
  when: (kind: MgmtKind) => kind !== 'decision',
  duration: (kind: MgmtKind) => kind === 'meeting' || kind === 'appointment',
  location: (kind: MgmtKind) => kind === 'meeting' || kind === 'appointment',
  attendees: (kind: MgmtKind) => kind === 'meeting',
};

export function ItemForm({
  initial,
  itemId,
  canManage,
  busy,
  onCancel,
  onSubmit,
}: {
  initial?: MgmtDraft;
  /** Set when editing something that exists — files can only hang off a record. */
  itemId?: string;
  canManage: boolean;
  busy: boolean;
  onCancel: () => void;
  /**
   * On a new item the pictures cannot be uploaded until it has an id, so they
   * are handed back with the draft and the caller uploads them once it does.
   */
  onSubmit: (draft: MgmtDraft, files: File[]) => void;
}) {
  const { t, lang } = useI18n();
  const { directory } = useWorkspace();
  const [draft, setDraft] = useState<MgmtDraft>(initial ?? emptyDraft());
  const [staged, setStaged] = useState<File[]>([]);
  const [error, setError] = useState('');

  const set = <K extends keyof MgmtDraft>(key: K, value: MgmtDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.title.trim()) return setError('العنوان مطلوب.');
    setError('');
    onSubmit(draft, staged);
  };

  return (
    <form onSubmit={submit} className="grid gap-3.5">
      <KindCards value={draft.kind} onSelect={(kind) => set('kind', kind)} compact />

      <Field label="العنوان" required>
        <input
          className="field"
          value={draft.title}
          onChange={(event) => set('title', event.target.value)}
          placeholder="اجتماع مع…"
          autoFocus
          required
        />
      </Field>

      <Field label="التفاصيل">
        <textarea
          className="field min-h-[72px] resize-y"
          value={draft.details}
          onChange={(event) => set('details', event.target.value)}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="المسؤول">
          {/* A free-text list rather than a picker: an owner is often somebody
              outside the workspace, and the server resolves the ones who are in
              it to a real account. */}
          <input
            className="field"
            list="mgmt-people"
            value={draft.ownerName}
            onChange={(event) => set('ownerName', event.target.value)}
          />
          <datalist id="mgmt-people">
            {directory.map((person) => (
              <option key={person.id} value={person.name} />
            ))}
          </datalist>
        </Field>

        <Field label="القسم">
          <select
            className="field"
            value={draft.department}
            onChange={(event) => set('department', event.target.value)}
          >
            <option value="">— بدون —</option>
            {DEPARTMENTS.map((department: { id: string; ar: string; en: string }) => (
              <option key={department.id} value={department.id}>
                {lang === 'en' ? department.en : department.ar}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {SHOWS.when(draft.kind) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="الميعاد">
            <input
              type="datetime-local"
              className="field ltr text-start"
              value={draft.dueAt}
              onChange={(event) => set('dueAt', event.target.value)}
            />
          </Field>
          {SHOWS.duration(draft.kind) && (
            <Field label="المدة (دقيقة)">
              <input
                type="number"
                min={5}
                max={1440}
                step={5}
                className="field ltr text-start"
                value={draft.durationMin}
                onChange={(event) => set('durationMin', event.target.value)}
              />
            </Field>
          )}
        </div>
      )}

      {SHOWS.location(draft.kind) && (
        <Field label="المكان">
          <input
            className="field"
            value={draft.location}
            onChange={(event) => set('location', event.target.value)}
          />
        </Field>
      )}

      {SHOWS.attendees(draft.kind) && (
        <Field label="الحاضرين" hint="افصل بينهم بفاصلة">
          <input
            className="field"
            value={draft.attendees}
            onChange={(event) => set('attendees', event.target.value)}
          />
        </Field>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="الأولوية">
          <select
            className="field"
            value={draft.priority}
            onChange={(event) => set('priority', event.target.value as MgmtPriority)}
          >
            {PRIORITY_ORDER.map((priority) => (
              <option key={priority} value={priority}>
                {lang === 'en' ? PRIORITY_LABEL[priority].en : PRIORITY_LABEL[priority].ar}
              </option>
            ))}
          </select>
        </Field>
        <Field label="الحالة">
          <select
            className="field"
            value={draft.status}
            onChange={(event) => set('status', event.target.value as MgmtStatus)}
          >
            {STATUS_ORDER.map((status) => (
              <option key={status} value={status}>
                {lang === 'en' ? STATUS_LABEL[status].en : STATUS_LABEL[status].ar}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {canManage && (
        <Field label="صور ومرفقات" hint="صورة الورقة الموقّعة، السبورة بعد الاجتماع، عرض السعر…">
          {itemId ? (
            <ItemAttachments itemId={itemId} canManage={canManage} />
          ) : (
            <StagedFiles files={staged} onChange={setStaged} />
          )}
        </Field>
      )}

      {error && (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-[12.5px] font-semibold text-rose-700">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn-ghost btn-sm">
          {t('common.cancel')}
        </button>
        <button type="submit" disabled={busy} className="btn-primary btn-sm gap-1.5">
          {busy && <Spinner size={15} />}
          {t('common.save')}
        </button>
      </div>
    </form>
  );
}

/**
 * Pictures picked before the item exists.
 *
 * They are held as `File` objects and previewed from object URLs, which have to
 * be revoked by hand — a modal opened and closed a dozen times while filing a
 * morning's meetings would otherwise leak every image it ever previewed.
 */
function StagedFiles({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<string[]>([]);

  useEffect(() => {
    const urls = files.map((file) => (file.type.startsWith('image/') ? URL.createObjectURL(file) : ''));
    setPreviews(urls);
    return () => urls.forEach((url) => url && URL.revokeObjectURL(url));
  }, [files]);

  const add = (picked: FileList | null) => {
    if (!picked?.length) return;
    const room = MAX_FILES_PER_ITEM - files.length;
    const accepted = [...picked].slice(0, room).filter((file) => file.size <= MAX_FILE_BYTES);
    onChange([...files, ...accepted]);
    if (inputRef.current) inputRef.current.value = '';
  };

  const full = files.length >= MAX_FILES_PER_ITEM;

  return (
    <div className="grid gap-2">
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="group relative">
              {previews[index] ? (
                <img
                  src={previews[index]}
                  alt={file.name}
                  className="h-20 w-20 rounded-xl border border-surface-line object-cover"
                />
              ) : (
                <span className="grid h-20 w-20 place-items-center rounded-xl border border-surface-line px-1 text-center text-[10px] font-semibold text-ink-muted">
                  {file.name.slice(0, 24)}
                </span>
              )}
              <button
                type="button"
                onClick={() => onChange(files.filter((_, at) => at !== index))}
                aria-label={`إزالة ${file.name}`}
                className="absolute -top-1.5 -end-1.5 grid h-6 w-6 place-items-center rounded-full bg-white text-ink-faint shadow-card transition-colors hover:bg-rose-50 hover:text-rose-600"
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

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
        disabled={full}
        className={cx('btn-ghost btn-sm w-fit gap-1.5', full && 'cursor-not-allowed opacity-60')}
      >
        <ImagePlus size={15} />
        {full ? `الحد ${MAX_FILES_PER_ITEM} ملفات` : 'إضافة صورة'}
      </button>
      {files.length > 0 && (
        <p className="text-[11.5px] text-ink-faint">هتترفع بعد الحفظ.</p>
      )}
    </div>
  );
}
