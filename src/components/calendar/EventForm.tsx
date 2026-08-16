/**
 * The form that books an hour.
 *
 * Two things here are not decoration. Choosing the type first, because a
 * meeting and an appointment want different questions — one has people to
 * invite and answers to collect, the other is a block in your own day. And the
 * clash warning, because the single most common way a meeting fails is that
 * half the room was already busy; the calendar knows that, so it says so before
 * the invitation goes out rather than after.
 */

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, Search, Users, X } from 'lucide-react';
import { DEPARTMENTS } from '@shared/departments';
import {
  KIND_LABEL,
  REMINDER_LABEL,
  VISIBILITY_LABEL,
  clashingWith,
  fetchBusy,
  type CalendarPerson,
  type EventDraft,
  type EventKind,
  type EventVisibility,
} from '../../lib/calendar';
import { Avatar, Field } from '../ui';
import { cx } from '../../lib/utils';

const KINDS: EventKind[] = ['meeting', 'appointment'];
const KIND_ICON = { meeting: Users, appointment: CalendarDays } as const;

export function EventForm({
  draft,
  onChange,
  people,
  currentUserId,
  reminderChoices,
  maxInvitees,
  lockKind = false,
  editingId = null,
}: {
  draft: EventDraft;
  onChange: (draft: EventDraft) => void;
  people: CalendarPerson[];
  currentUserId: string;
  reminderChoices: number[];
  maxInvitees: number;
  lockKind?: boolean;
  /** The entry being edited, so it is not counted as a clash with itself. */
  editingId?: string | null;
}) {
  const [query, setQuery] = useState('');
  const [clashes, setClashes] = useState<string[]>([]);
  /** The organizer's own double-booking — real, but not a guest's problem. */
  const [selfClash, setSelfClash] = useState(false);
  const set = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) =>
    onChange({ ...draft, [key]: value });

  const candidates = useMemo(() => {
    const term = query.trim().toLowerCase();
    return people
      .filter((person) => person.id !== currentUserId)
      .filter(
        (person) =>
          !term ||
          person.name.toLowerCase().includes(term) ||
          person.email.toLowerCase().includes(term)
      )
      .slice(0, 40);
  }, [people, query, currentUserId]);

  const selected = useMemo(
    () => draft.inviteeIds.map((id) => people.find((person) => person.id === id)).filter(Boolean) as CalendarPerson[],
    [draft.inviteeIds, people]
  );

  /**
   * The busy window is asked for once the hour and the guest list are both real.
   * It answers "taken", never "by what", so an invitee's private appointment
   * shows here as a clash without being exposed.
   */
  useEffect(() => {
    const clear = () => {
      setClashes([]);
      setSelfClash(false);
    };
    if (!draft.startAt || !draft.endAt) {
      clear();
      return;
    }
    const start = new Date(draft.startAt);
    const end = new Date(draft.endAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      clear();
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      fetchBusy(start, end, draft.inviteeIds, editingId)
        .then((busy) => {
          if (!active) return;
          const from = start.toISOString();
          const to = end.toISOString();
          setClashes(clashingWith(busy, from, to, draft.inviteeIds));
          setSelfClash(clashingWith(busy, from, to, [currentUserId]).length > 0);
        })
        .catch(() => active && clear());
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [draft.inviteeIds, draft.startAt, draft.endAt, editingId, currentUserId]);

  const toggle = (id: string) => {
    const next = draft.inviteeIds.includes(id)
      ? draft.inviteeIds.filter((current) => current !== id)
      : [...draft.inviteeIds, id].slice(0, maxInvitees);
    set('inviteeIds', next);
  };

  return (
    <div className="grid gap-4">
      {!lockKind && (
        <div className="grid grid-cols-2 gap-2">
          {KINDS.map((kind) => {
            const Icon = KIND_ICON[kind];
            const active = draft.kind === kind;
            return (
              <button
                key={kind}
                type="button"
                onClick={() => onChange({ ...draft, kind, inviteeIds: kind === 'appointment' ? [] : draft.inviteeIds })}
                className={cx(
                  'flex items-start gap-3 rounded-2xl border p-3 text-start transition',
                  active
                    ? 'border-brand-400 bg-brand-50 ring-2 ring-brand-100'
                    : 'border-surface-line bg-white hover:border-brand-200'
                )}
              >
                <span
                  className={cx(
                    'grid h-9 w-9 shrink-0 place-items-center rounded-xl',
                    active ? 'bg-brand-500 text-white' : 'bg-surface-sunken text-ink-muted'
                  )}
                >
                  <Icon size={17} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-bold text-ink">{KIND_LABEL[kind].ar}</span>
                  <span className="block text-[11.5px] leading-snug text-ink-faint">
                    {KIND_LABEL[kind].hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <Field label="العنوان" required>
        <input
          className="field"
          value={draft.title}
          onChange={(event) => set('title', event.target.value)}
          placeholder={draft.kind === 'meeting' ? 'اجتماع مراجعة…' : 'موعد…'}
          maxLength={200}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="من" required>
          <input
            type="datetime-local"
            className="field ltr"
            value={draft.startAt}
            onChange={(event) => {
              const startAt = event.target.value;
              // Dragging the start past the end is a slip, not an instruction —
              // the length the person already chose is kept.
              const previous = new Date(draft.startAt).getTime();
              const next = new Date(startAt).getTime();
              const end = new Date(draft.endAt).getTime();
              if (!Number.isNaN(previous) && !Number.isNaN(next) && !Number.isNaN(end)) {
                const shifted = new Date(end + (next - previous));
                onChange({ ...draft, startAt, endAt: toInput(shifted) });
                return;
              }
              set('startAt', startAt);
            }}
          />
        </Field>
        <Field label="إلى" required>
          <input
            type="datetime-local"
            className="field ltr"
            value={draft.endAt}
            onChange={(event) => set('endAt', event.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="المكان" hint="قاعة، مكتب، أو عنوان">
          <input
            className="field"
            value={draft.location}
            onChange={(event) => set('location', event.target.value)}
            maxLength={200}
          />
        </Field>
        <Field label="رابط أونلاين" hint="Zoom / Meet — http أو https فقط">
          <input
            className="field ltr"
            value={draft.onlineUrl}
            onChange={(event) => set('onlineUrl', event.target.value)}
            placeholder="https://…"
            dir="ltr"
          />
        </Field>
      </div>

      {/* Your own double-booking, said once and for both kinds — an appointment
          laid over a meeting you already accepted is the same mistake. */}
      {selfClash && (
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[11.5px] font-semibold text-amber-800">
          <AlertTriangle size={14} className="mt-px shrink-0" />
          <span>عندك حاجة تانية في نفس الوقت.</span>
        </p>
      )}

      {draft.kind === 'meeting' && (
        <div>
          <span className="label">
            المدعوون
            <span className="ms-1 font-normal text-ink-faint">
              ({draft.inviteeIds.length}/{maxInvitees})
            </span>
          </span>

          {selected.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {selected.map((person) => (
                <span
                  key={person.id}
                  className={cx(
                    'chip',
                    clashes.includes(person.id)
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-surface-sunken text-ink-muted'
                  )}
                >
                  <Avatar name={person.name} color={person.avatarColor} size={18} />
                  {person.name}
                  <button type="button" onClick={() => toggle(person.id)} aria-label="إزالة">
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {clashes.length > 0 && (
            <p className="mb-2 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[11.5px] font-semibold text-amber-800">
              <AlertTriangle size={14} className="mt-px shrink-0" />
              <span>
                {clashes.length === 1
                  ? 'واحد من المدعوين عنده'
                  : `${clashes.length} من المدعوين عندهم`}{' '}
                حاجة في نفس الوقت. تقدر تكمل، بس يفضل تغيّر الميعاد.
              </span>
            </p>
          )}

          <div className="rounded-xl border border-surface-line">
            <div className="flex items-center gap-2 border-b border-surface-line px-3 py-2">
              <Search size={14} className="text-ink-faint" />
              <input
                className="flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-ink-faint"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="دوّر على زميل…"
              />
            </div>
            <div className="max-h-44 overflow-y-auto p-1">
              {candidates.length === 0 ? (
                <p className="px-3 py-4 text-center text-[11.5px] text-ink-faint">مفيش نتائج.</p>
              ) : (
                candidates.map((person) => {
                  const picked = draft.inviteeIds.includes(person.id);
                  return (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() => toggle(person.id)}
                      className={cx(
                        'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start transition',
                        picked ? 'bg-brand-50' : 'hover:bg-surface-sunken'
                      )}
                    >
                      <Avatar name={person.name} color={person.avatarColor} size={26} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-semibold text-ink">
                          {person.name}
                        </span>
                        <span className="ltr block truncate text-[10.5px] text-ink-faint">
                          {person.email}
                        </span>
                      </span>
                      {clashes.includes(person.id) && (
                        <AlertTriangle size={13} className="shrink-0 text-amber-500" />
                      )}
                      <input type="checkbox" readOnly checked={picked} className="pointer-events-none" />
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      <Field label="التفاصيل">
        <textarea
          className="field min-h-20"
          value={draft.details}
          onChange={(event) => set('details', event.target.value)}
          maxLength={4_000}
          placeholder="أجندة، نقاط للنقاش، أي تحضير مطلوب…"
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="مين يشوفه" hint={VISIBILITY_LABEL[draft.visibility].hint}>
          <select
            className="field"
            value={draft.visibility}
            onChange={(event) => set('visibility', event.target.value as EventVisibility)}
          >
            {(Object.keys(VISIBILITY_LABEL) as EventVisibility[]).map((value) => (
              <option key={value} value={value}>
                {VISIBILITY_LABEL[value].ar}
              </option>
            ))}
          </select>
        </Field>
        <Field label="تذكير">
          <select
            className="field"
            value={draft.reminderMinutes}
            onChange={(event) => set('reminderMinutes', Number(event.target.value))}
          >
            {reminderChoices.map((minutes) => (
              <option key={minutes} value={minutes}>
                {REMINDER_LABEL(minutes)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {draft.visibility === 'department' && (
        <Field label="القسم" required>
          <select
            className="field"
            value={draft.department}
            onChange={(event) => set('department', event.target.value)}
          >
            <option value="">اختر القسم…</option>
            {DEPARTMENTS.map((department) => (
              <option key={department.id} value={department.id}>
                {department.ar}
              </option>
            ))}
          </select>
        </Field>
      )}
    </div>
  );
}

function toInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
