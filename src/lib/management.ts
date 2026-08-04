/**
 * The management desk's client half — row shapes, the shared vocabulary, and
 * the handful of questions the board asks about an item.
 *
 * The vocabulary lives here rather than next to each component so a card, a
 * filter chip and the form can never disagree about what `appointment` is
 * called in Arabic.
 */

import { api } from './api';

export type MgmtKind = 'task' | 'meeting' | 'appointment' | 'reminder' | 'decision';
export type MgmtPriority = 'urgent' | 'high' | 'normal' | 'low';
export type MgmtStatus = 'todo' | 'doing' | 'done' | 'cancelled';
export type MgmtSource = 'dashboard' | 'telegram' | 'api';

/** One task / meeting / appointment / reminder / decision. */
export interface MgmtItem {
  id: string;
  kind: MgmtKind;
  title: string;
  details: string | null;
  /** The workspace user the owner resolved to, when a name matched one. */
  ownerId: string | null;
  /** What was actually written — kept even when nobody matched it. */
  ownerName: string | null;
  department: string | null;
  /** A department typed from chat that is not one of ours. */
  departmentLabel: string | null;
  priority: MgmtPriority;
  status: MgmtStatus;
  /** Absolute instant — the server already resolved «بكرة الساعة ٢» in Cairo. */
  dueAt: string | null;
  durationMin: number | null;
  location: string | null;
  attendees: string[];
  tags: string[];
  source: MgmtSource;
  reporter: string | null;
  rawText: string | null;
  aiConfidence: number | null;
  /** The model was not sure — shown in its own lane until a human confirms. */
  needsReview: boolean;
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
}

/** Editable subset — what the form sends on create and on edit. */
export interface MgmtDraft {
  kind: MgmtKind;
  title: string;
  details: string;
  ownerName: string;
  department: string;
  priority: MgmtPriority;
  status: MgmtStatus;
  /** `datetime-local` value (`2026-08-05T14:00`) or '' — converted on send. */
  dueAt: string;
  durationMin: string;
  location: string;
  attendees: string;
}

/** One inbound message, kept whether or not the extraction succeeded. */
export interface MgmtIngestEntry {
  id: string;
  source: MgmtSource;
  sender: string | null;
  rawText: string;
  itemCount: number;
  status: 'ok' | 'failed' | 'ignored';
  error: string | null;
  createdAt: string;
}

export interface MgmtMeta {
  canManage: boolean;
  aiEnabled: boolean;
  telegramEnabled: boolean;
}

export interface MgmtAgenda {
  day: string;
  due: MgmtItem[];
  overdue: MgmtItem[];
}

/* ── the API ─────────────────────────────────────────────────────── */

export const fetchMeta = () => api.get<MgmtMeta>('/management/meta');

export const fetchItems = (query = '') =>
  api.get<{ items: MgmtItem[] }>(`/management/items${query ? `?${query}` : ''}`).then((r) => r.items);

export const fetchAgenda = (day = 0) => api.get<MgmtAgenda>(`/management/agenda?day=${day}`);

export const fetchInbox = () =>
  api.get<{ entries: MgmtIngestEntry[] }>('/management/inbox').then((r) => r.entries);

export const createItem = (draft: MgmtDraft) =>
  api.post<{ item: MgmtItem }>('/management/items', toPayload(draft)).then((r) => r.item);

export const patchItem = (id: string, patch: Partial<MgmtDraft> | Record<string, unknown>) =>
  api.patch<{ item: MgmtItem }>(`/management/items/${id}`, patch).then((r) => r.item);

export const removeItem = (id: string) => api.delete(`/management/items/${id}`);

/**
 * A `datetime-local` value is what the person picked in their own clock, so it
 * is turned into an absolute instant here rather than sent as a bare string the
 * server would have to guess a zone for.
 */
function toPayload(draft: MgmtDraft) {
  return {
    kind: draft.kind,
    title: draft.title.trim(),
    details: draft.details.trim(),
    ownerName: draft.ownerName.trim(),
    department: draft.department,
    priority: draft.priority,
    status: draft.status,
    dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : null,
    durationMin: draft.durationMin ? Number(draft.durationMin) : null,
    location: draft.location.trim(),
    // People separate names with an Arabic comma as readily as a Latin one.
    attendees: draft.attendees
      .split(/[,،]/)
      .map((name) => name.trim())
      .filter(Boolean),
  };
}

/* ── vocabulary ──────────────────────────────────────────────────── */

export const KIND_ORDER: MgmtKind[] = ['task', 'meeting', 'appointment', 'reminder', 'decision'];
export const PRIORITY_ORDER: MgmtPriority[] = ['urgent', 'high', 'normal', 'low'];
export const STATUS_ORDER: MgmtStatus[] = ['todo', 'doing', 'done', 'cancelled'];

export const KIND_LABEL: Record<MgmtKind, { ar: string; en: string; hint: string }> = {
  task: { ar: 'مهمة', en: 'Task', hint: 'شغل مطلوب من حد' },
  meeting: { ar: 'اجتماع', en: 'Meeting', hint: 'قعدة بأكتر من شخص' },
  appointment: { ar: 'موعد', en: 'Appointment', hint: 'زيارة أو موعد خارجي' },
  reminder: { ar: 'تذكير', en: 'Reminder', hint: 'حاجة متتنسيش' },
  decision: { ar: 'قرار', en: 'Decision', hint: 'قرار اتاخد ولازم يتسجّل' },
};

export const PRIORITY_LABEL: Record<MgmtPriority, { ar: string; en: string; tone: string }> = {
  urgent: { ar: 'عاجل', en: 'Urgent', tone: 'bg-rose-50 text-rose-700' },
  high: { ar: 'مهم', en: 'High', tone: 'bg-amber-50 text-amber-700' },
  normal: { ar: 'عادي', en: 'Normal', tone: 'bg-surface-sunken text-ink-muted' },
  low: { ar: 'مؤجّل', en: 'Low', tone: 'bg-surface-sunken text-ink-muted' },
};

export const STATUS_LABEL: Record<MgmtStatus, { ar: string; en: string }> = {
  todo: { ar: 'لسه', en: 'To do' },
  doing: { ar: 'شغّال', en: 'Doing' },
  done: { ar: 'خلص', en: 'Done' },
  cancelled: { ar: 'ملغي', en: 'Cancelled' },
};

/* ── questions the board asks ────────────────────────────────────── */

export const isOpen = (item: MgmtItem) => item.status === 'todo' || item.status === 'doing';

export const isOverdue = (item: MgmtItem) =>
  isOpen(item) && Boolean(item.dueAt) && new Date(item.dueAt as string).getTime() < Date.now();

/** Is `iso` inside today's local calendar day? */
export function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const date = new Date(iso);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

const PRIORITY_RANK: Record<MgmtPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/** Open before closed, then soonest deadline, then urgency, then newest. */
export function sortItems(items: MgmtItem[]): MgmtItem[] {
  return [...items].sort((a, b) => {
    const open = (item: MgmtItem) => (isOpen(item) ? 0 : 1);
    if (open(a) !== open(b)) return open(a) - open(b);

    // Anything with a deadline outranks anything without one.
    if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
    if (a.dueAt) return -1;
    if (b.dueAt) return 1;

    if (PRIORITY_RANK[a.priority] !== PRIORITY_RANK[b.priority]) {
      return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    }
    return b.createdAt.localeCompare(a.createdAt);
  });
}

/** ISO timestamp → the `datetime-local` string an input can display. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function draftFrom(item: MgmtItem): MgmtDraft {
  return {
    kind: item.kind,
    title: item.title,
    details: item.details ?? '',
    ownerName: item.ownerName ?? '',
    department: item.department ?? '',
    priority: item.priority,
    status: item.status,
    dueAt: toLocalInput(item.dueAt),
    durationMin: item.durationMin ? String(item.durationMin) : '',
    location: item.location ?? '',
    attendees: item.attendees.join('، '),
  };
}

export function emptyDraft(kind: MgmtKind = 'task'): MgmtDraft {
  return {
    kind,
    title: '',
    details: '',
    ownerName: '',
    department: '',
    priority: 'normal',
    status: 'todo',
    dueAt: '',
    // A meeting with no length is the usual cause of a double-booked hour.
    durationMin: kind === 'meeting' ? '60' : '',
    location: '',
    attendees: '',
  };
}
