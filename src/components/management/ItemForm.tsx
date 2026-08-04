/**
 * Filing or editing one item.
 *
 * The form asks the type first and then shows only the fields that type
 * actually has: a decision has no room and no duration, a reminder has no
 * attendees. A single form carrying every field for every kind is how people
 * end up leaving half of it blank and the other half wrong.
 */

import { useState } from 'react';
import {
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
import { DEPARTMENTS } from '@shared/departments';
import { useI18n } from '../../lib/i18n';
import { useWorkspace } from '../../lib/workspace';
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
  busy,
  onCancel,
  onSubmit,
}: {
  initial?: MgmtDraft;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (draft: MgmtDraft) => void;
}) {
  const { t, lang } = useI18n();
  const { directory } = useWorkspace();
  const [draft, setDraft] = useState<MgmtDraft>(initial ?? emptyDraft());
  const [error, setError] = useState('');

  const set = <K extends keyof MgmtDraft>(key: K, value: MgmtDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.title.trim()) return setError('العنوان مطلوب.');
    setError('');
    onSubmit(draft);
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
