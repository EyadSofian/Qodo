/**
 * Qodo Calendar's client half — row shapes, the API, and the small pile of date
 * arithmetic a month grid needs.
 *
 * The vocabulary lives here rather than beside each component for the same
 * reason the management desk keeps its own in one file: a chip, a form and a
 * card must never disagree about what «موعد» means.
 *
 * Every time crossing this boundary is an absolute instant. What the person
 * picked in a `datetime-local` input is their own wall clock, so it is
 * converted on the way out and back on the way in — never sent as a bare
 * string the server would have to guess a zone for.
 */

import { api } from './api';

export type EventKind = 'meeting' | 'appointment';
export type EventVisibility = 'invitees' | 'department' | 'organization';
export type InviteResponse = 'needs_action' | 'accepted' | 'tentative' | 'declined';
export type EventStatus = 'confirmed' | 'cancelled';

export interface CalendarPerson {
  id: string;
  name: string;
  email: string;
  title: string | null;
  department: string;
  avatarColor: string;
  role: string;
}

export interface CalendarEvent {
  id: string;
  kind: EventKind;
  title: string;
  details: string;
  location: string;
  onlineUrl: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
  visibility: EventVisibility;
  department: string | null;
  organizerId: string;
  inviteeIds: string[];
  /** The mail thread this was arranged from, when it was. */
  conversationId: string | null;
  status: EventStatus;
  reminderMinutes: number;
  attachmentCount: number;
  responses: Array<{ userId: string; response: InviteResponse; respondedAt: string | null }>;
  /** Null for somebody who can see the entry but was never invited to it. */
  myResponse: InviteResponse | null;
  canManage: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarFile {
  id: string;
  eventId: string;
  userId: string;
  name: string;
  size: number;
  type: string;
  createdAt: string;
}

/** An hour somebody has already spoken for. Deliberately says nothing else. */
export interface BusyBlock {
  userId: string;
  startAt: string;
  endAt: string;
}

export interface CalendarBootstrap {
  people: CalendarPerson[];
  kinds: EventKind[];
  visibilities: EventVisibility[];
  reminderChoices: number[];
  limits: { invitees: number; files: number };
}

/** What the form holds — `datetime-local` strings, converted on send. */
export interface EventDraft {
  kind: EventKind;
  title: string;
  details: string;
  location: string;
  onlineUrl: string;
  startAt: string;
  endAt: string;
  visibility: EventVisibility;
  department: string;
  inviteeIds: string[];
  reminderMinutes: number;
  conversationId?: string | null;
}

/* ── the API ─────────────────────────────────────────────────────── */

export const fetchBootstrap = () => api.get<CalendarBootstrap>('/calendar/bootstrap');

export const fetchEvents = (from: Date, to: Date) =>
  api
    .get<{ events: CalendarEvent[] }>(
      `/calendar/events?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`
    )
    .then((response) => response.events);

export const fetchEvent = (id: string) =>
  api.get<{ event: CalendarEvent }>(`/calendar/events/${encodeURIComponent(id)}`).then((r) => r.event);

/**
 * `ignoreEventId` is the entry being edited: without it the form would warn
 * that everybody is busy, with the very meeting the organizer is moving.
 */
export const fetchBusy = (
  from: Date,
  to: Date,
  userIds: string[],
  ignoreEventId?: string | null
) =>
  api
    .get<{ busy: BusyBlock[] }>(
      `/calendar/busy?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(
        to.toISOString()
      )}&userIds=${encodeURIComponent(userIds.join(','))}${
        ignoreEventId ? `&ignoreEventId=${encodeURIComponent(ignoreEventId)}` : ''
      }`
    )
    .then((response) => response.busy);

export const createEvent = (draft: EventDraft) =>
  api.post<{ event: CalendarEvent }>('/calendar/events', toPayload(draft)).then((r) => r.event);

export const patchEvent = (id: string, draft: Partial<EventDraft>) =>
  api
    .patch<{ event: CalendarEvent }>(`/calendar/events/${encodeURIComponent(id)}`, toPayload(draft))
    .then((r) => r.event);

export const cancelEvent = (id: string) =>
  api.delete<{ event: CalendarEvent }>(`/calendar/events/${encodeURIComponent(id)}`).then((r) => r.event);

export const respondToEvent = (id: string, response: Exclude<InviteResponse, 'needs_action'>) =>
  api
    .post<{ event: CalendarEvent }>(`/calendar/events/${encodeURIComponent(id)}/respond`, { response })
    .then((r) => r.event);

/* ── files ───────────────────────────────────────────────────────── */

const filesPath = (eventId: string) => `/calendar/events/${encodeURIComponent(eventId)}/files`;

export const fetchEventFiles = (eventId: string) =>
  api.get<{ attachments: CalendarFile[] }>(filesPath(eventId)).then((r) => r.attachments);

export const uploadEventFile = (eventId: string, file: File) =>
  api.upload<{ attachment: CalendarFile; attachmentCount: number }>(filesPath(eventId), file);

export const removeEventFile = (eventId: string, fileId: string) =>
  api.delete<{ attachmentCount: number }>(`${filesPath(eventId)}/${encodeURIComponent(fileId)}`);

export const eventFileUrl = (eventId: string, fileId: string) =>
  `/api${filesPath(eventId)}/${encodeURIComponent(fileId)}`;

function toPayload(draft: Partial<EventDraft>) {
  const payload: Record<string, unknown> = {};
  const copy = <K extends keyof EventDraft>(key: K) => {
    if (draft[key] !== undefined) payload[key] = draft[key];
  };
  copy('kind');
  copy('inviteeIds');
  copy('visibility');
  copy('reminderMinutes');
  copy('conversationId');
  if (draft.title !== undefined) payload.title = draft.title.trim();
  if (draft.details !== undefined) payload.details = draft.details.trim();
  if (draft.location !== undefined) payload.location = draft.location.trim();
  if (draft.onlineUrl !== undefined) payload.onlineUrl = draft.onlineUrl.trim();
  if (draft.department !== undefined) payload.department = draft.department;
  if (draft.startAt !== undefined) payload.startAt = new Date(draft.startAt).toISOString();
  if (draft.endAt !== undefined) payload.endAt = new Date(draft.endAt).toISOString();
  return payload;
}

/* ── vocabulary ──────────────────────────────────────────────────── */

export const KIND_LABEL: Record<EventKind, { ar: string; en: string; hint: string }> = {
  meeting: { ar: 'اجتماع', en: 'Meeting', hint: 'قعدة مع ناس، كل واحد يرد بالحضور' },
  appointment: { ar: 'موعد', en: 'Appointment', hint: 'وقت محجوز في يومك' },
};

export const VISIBILITY_LABEL: Record<EventVisibility, { ar: string; en: string; hint: string }> = {
  invitees: { ar: 'المدعوين فقط', en: 'Invitees only', hint: 'محدش غيرهم يشوفه، ولا حتى مدير النظام' },
  department: { ar: 'القسم', en: 'Department', hint: 'كل موظفي القسم يشوفوه في تقويمهم' },
  organization: { ar: 'كل الشركة', en: 'Everyone', hint: 'ظاهر لكل موظفي المؤسسة' },
};

export const RESPONSE_LABEL: Record<InviteResponse, { ar: string; en: string; tone: string }> = {
  needs_action: { ar: 'لسه', en: 'No answer', tone: 'bg-surface-sunken text-ink-muted' },
  accepted: { ar: 'حاضر', en: 'Going', tone: 'bg-emerald-50 text-emerald-700' },
  tentative: { ar: 'مبدئي', en: 'Maybe', tone: 'bg-amber-50 text-amber-700' },
  declined: { ar: 'معتذر', en: 'Not going', tone: 'bg-rose-50 text-rose-700' },
};

export const REMINDER_LABEL = (minutes: number): string => {
  if (minutes === 0) return 'بدون تذكير';
  if (minutes < 60) return `قبلها بـ${minutes} دقيقة`;
  if (minutes === 1_440) return 'قبلها بيوم';
  return `قبلها بـ${minutes / 60} ساعة`;
};

/* ── dates ───────────────────────────────────────────────────────── */

export const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

export const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

export const addMonths = (date: Date, months: number) => {
  const next = new Date(date.getFullYear(), date.getMonth() + months, 1);
  return next;
};

export const sameDay = (left: Date, right: Date) =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

/**
 * The six-week grid a month view draws.
 *
 * The week starts on Saturday because that is where the Egyptian working week
 * starts — the same assumption `workingDays: [0,1,2,3,4]` already encodes in
 * the organization record.
 */
export const WEEK_START = 6;

export function monthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() - WEEK_START + 7) % 7;
  const start = addDays(first, -lead);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

export function weekGrid(day: Date): Date[] {
  const lead = (day.getDay() - WEEK_START + 7) % 7;
  const start = startOfDay(addDays(day, -lead));
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

/** Entries touching this day, in the order they happen. */
export function eventsOnDay(events: CalendarEvent[], day: Date): CalendarEvent[] {
  const from = startOfDay(day).getTime();
  const to = addDays(startOfDay(day), 1).getTime();
  return events
    .filter((event) => {
      const start = new Date(event.startAt).getTime();
      const end = new Date(event.endAt).getTime();
      return start < to && end > from;
    })
    .sort((left, right) => left.startAt.localeCompare(right.startAt));
}

const timeFormat = new Intl.DateTimeFormat('ar-EG', { hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' });

export const clockOf = (iso: string) => timeFormat.format(new Date(iso));
export const dayOf = (iso: string | Date) =>
  dayFormat.format(typeof iso === 'string' ? new Date(iso) : iso);

export const spanOf = (event: CalendarEvent) =>
  event.allDay ? 'طول اليوم' : `${clockOf(event.startAt)} – ${clockOf(event.endAt)}`;

export const isPast = (event: CalendarEvent) => new Date(event.endAt).getTime() < Date.now();

/** ISO instant → the `datetime-local` value an input can show. */
export function toLocalInput(iso: string | Date | null): string {
  if (!iso) return '';
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The next round half-hour — what a person means by "now" when booking. */
export function nextSlot(from = new Date()): Date {
  const slot = new Date(from);
  slot.setSeconds(0, 0);
  slot.setMinutes(slot.getMinutes() + (30 - (slot.getMinutes() % 30)));
  return slot;
}

export function emptyDraft(kind: EventKind = 'meeting', at?: Date): EventDraft {
  const start = at ? new Date(at) : nextSlot();
  if (at) start.setHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60_000);
  return {
    kind,
    title: '',
    details: '',
    location: '',
    onlineUrl: '',
    startAt: toLocalInput(start),
    endAt: toLocalInput(end),
    visibility: 'invitees',
    department: '',
    inviteeIds: [],
    reminderMinutes: 15,
  };
}

export function draftFrom(event: CalendarEvent): EventDraft {
  return {
    kind: event.kind,
    title: event.title,
    details: event.details,
    location: event.location,
    onlineUrl: event.onlineUrl ?? '',
    startAt: toLocalInput(event.startAt),
    endAt: toLocalInput(event.endAt),
    visibility: event.visibility,
    department: event.department ?? '',
    inviteeIds: [...event.inviteeIds],
    reminderMinutes: event.reminderMinutes,
  };
}

/**
 * Which of `userIds` already have that hour taken, from a busy list.
 *
 * The caller says who it is asking about, because the server always answers for
 * the person asking as well as for the people they named — an organizer needs to
 * know they are double-booking themselves, but that is a different sentence from
 * "two of your guests are busy", and counting it as a guest makes the number
 * disagree with the list the form is highlighting.
 */
export function clashingWith(
  busy: BusyBlock[],
  startAt: string,
  endAt: string,
  userIds: string[]
): string[] {
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return [];
  const wanted = new Set(userIds);
  return [
    ...new Set(
      busy
        .filter((block) => wanted.has(block.userId))
        .filter((block) => new Date(block.startAt).getTime() < end && new Date(block.endAt).getTime() > start)
        .map((block) => block.userId)
    ),
  ];
}
