/**
 * Qodo Calendar — the workspace's meetings and appointments.
 *
 * Three things already in this repo look like a calendar and none of them is
 * one. `server/events.js` is Odoo's training courses, read-only and external.
 * The task board has a due date, which is a deadline rather than an hour of
 * somebody's day. The management desk keeps meetings, but as a private diary
 * for the people who run the company: its attendees are typed names, so nobody
 * is invited, nobody answers, and nobody is told. This module is the missing
 * piece — an hour, real invitees, and an answer from each of them.
 *
 * Two decisions are load-bearing:
 *
 * **Instants, not wall clocks.** The browser turns what somebody picked in
 * their own clock into an ISO instant before sending it, exactly as the
 * management desk does. Egypt moves its offset twice a year, so a stored
 * `14:00` would silently become a different hour after the change; a stored
 * instant never does.
 *
 * **Busy is not the same as visible.** Scheduling needs to know that an hour is
 * taken. It does not need to know by whom or for what, so `busyForUsers`
 * returns intervals with no title attached, which is what lets it answer for a
 * private appointment without leaking it.
 *
 * Recurring entries are deliberately not here. A repeat rule is a second, much
 * larger design (exceptions, "this and following", a moved single occurrence)
 * and adding a half of one now is how a calendar ends up with entries nobody
 * can correct.
 */

import { create, find, findOne, getStore } from './store.js';
import { DEPARTMENT_IDS } from '../shared/departments.js';
import { organizationOf } from '../shared/organization.js';
import { publishNotification } from './notificationStream.js';
import { notifyUser } from './push.js';
import {
  CALENDAR_KINDS,
  CALENDAR_VISIBILITIES,
  INVITE_RESPONSES,
  canAccessEvent,
  canManageEvent,
  ensureInvite,
  invitesForEvent,
  isCancelled,
  participantIds,
} from './calendarAccess.js';

export const MAX_TITLE_LENGTH = 200;
export const MAX_DETAILS_LENGTH = 4_000;
export const MAX_LOCATION_LENGTH = 200;
export const MAX_INVITEES = 60;
/** A window wider than two months is a report, not a calendar screen. */
export const MAX_RANGE_DAYS = 62;
export const MAX_RANGE_EVENTS = 500;
/** Long enough for a multi-day trip, short enough that a typo cannot hide it. */
export const MAX_DURATION_DAYS = 30;

export const REMINDER_CHOICES = [0, 5, 10, 15, 30, 60, 120, 1_440];

export class CalendarError extends Error {
  constructor(code, status = 400, extra = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/* ── input ───────────────────────────────────────────────────────── */

const text = (value, limit) => String(value ?? '').trim().slice(0, limit);

function instant(value, code) {
  const parsed = new Date(String(value ?? ''));
  if (Number.isNaN(parsed.getTime())) throw new CalendarError(code, 400);
  return parsed.toISOString();
}

/**
 * A joining link ends up in an `href`, so the protocol is checked rather than
 * assumed — the same reasoning as `joinUrl` in server/events.js, and the same
 * answer: anything that is not http(s) is not a link this app will offer.
 */
export function cleanMeetingUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.href.slice(0, 500);
  } catch {
    return null;
  }
}

/**
 * Validates the editable half of an entry.
 *
 * `current` is the row being patched, so a PATCH that sends only a new end time
 * is still checked against the start it is keeping rather than against nothing.
 */
export function normaliseEventInput(body, { actor, usersById, current = null }) {
  const kind = body?.kind ?? current?.kind ?? 'meeting';
  if (!CALENDAR_KINDS.includes(kind)) throw new CalendarError('invalid_event_kind');

  const title = body?.title === undefined ? current?.title : text(body.title, MAX_TITLE_LENGTH);
  if (!title) throw new CalendarError('event_title_required');

  const startAt =
    body?.startAt === undefined ? current?.startAt : instant(body.startAt, 'invalid_event_start');
  const endAt = body?.endAt === undefined ? current?.endAt : instant(body.endAt, 'invalid_event_end');
  if (!startAt || !endAt) throw new CalendarError('event_time_required');
  if (new Date(endAt).getTime() <= new Date(startAt).getTime()) {
    throw new CalendarError('event_end_before_start');
  }
  if (new Date(endAt).getTime() - new Date(startAt).getTime() > MAX_DURATION_DAYS * DAY) {
    throw new CalendarError('event_too_long', 400, { limit: MAX_DURATION_DAYS });
  }

  const visibility =
    body?.visibility === undefined ? (current?.visibility ?? 'invitees') : String(body.visibility);
  if (!CALENDAR_VISIBILITIES.includes(visibility)) throw new CalendarError('invalid_visibility');

  // A department entry with no department is invisible to everyone including
  // its own department, which is the one failure the form cannot show you.
  let department = current?.department ?? null;
  if (visibility === 'department') {
    department =
      body?.department === undefined
        ? (current?.department ?? actor.department ?? null)
        : String(body.department || '');
    if (!DEPARTMENT_IDS.includes(department)) throw new CalendarError('invalid_department');
  } else {
    department = null;
  }

  let inviteeIds = current?.inviteeIds ?? [];
  if (body?.inviteeIds !== undefined) {
    inviteeIds = [
      ...new Set(
        (Array.isArray(body.inviteeIds) ? body.inviteeIds : [])
          .map(String)
          .filter(Boolean)
          .filter((id) => id !== actor.id)
      ),
    ];
    if (inviteeIds.length > MAX_INVITEES) {
      throw new CalendarError('too_many_invitees', 400, { limit: MAX_INVITEES });
    }
    for (const id of inviteeIds) if (!usersById.has(id)) throw new CalendarError('unknown_invitee');
  }
  if (kind === 'meeting' && inviteeIds.length === 0 && !current) {
    throw new CalendarError('meeting_invitee_required');
  }

  const reminderMinutes =
    body?.reminderMinutes === undefined
      ? (current?.reminderMinutes ?? 15)
      : Number(body.reminderMinutes);
  if (!REMINDER_CHOICES.includes(reminderMinutes)) throw new CalendarError('invalid_reminder');

  return {
    kind,
    title,
    details:
      body?.details === undefined ? (current?.details ?? '') : text(body.details, MAX_DETAILS_LENGTH),
    location:
      body?.location === undefined
        ? (current?.location ?? '')
        : text(body.location, MAX_LOCATION_LENGTH),
    onlineUrl:
      body?.onlineUrl === undefined ? (current?.onlineUrl ?? null) : cleanMeetingUrl(body.onlineUrl),
    startAt,
    endAt,
    allDay: body?.allDay === undefined ? Boolean(current?.allDay) : Boolean(body.allDay),
    visibility,
    department,
    inviteeIds,
    reminderMinutes,
  };
}

/* ── reads ───────────────────────────────────────────────────────── */

/** Half-open overlap: an entry ending exactly at `from` is not in the window. */
export const overlaps = (event, from, to) => event.startAt < to && event.endAt > from;

export function normaliseRange(fromValue, toValue) {
  const from = instant(fromValue || new Date().toISOString(), 'invalid_range');
  const to = instant(toValue || new Date(Date.now() + 30 * DAY).toISOString(), 'invalid_range');
  if (new Date(to).getTime() <= new Date(from).getTime()) throw new CalendarError('invalid_range');
  if (new Date(to).getTime() - new Date(from).getTime() > MAX_RANGE_DAYS * DAY) {
    throw new CalendarError('range_too_wide', 400, { limit: MAX_RANGE_DAYS });
  }
  return { from, to };
}

/** Everything in the window this person is allowed to see, soonest first. */
export async function eventsInRange(user, { from, to }) {
  const rows = await find(
    'calendarEvents',
    (event) =>
      organizationOf(event) === organizationOf(user) &&
      overlaps(event, from, to) &&
      canAccessEvent(user, event)
  );
  return rows
    .sort((left, right) => left.startAt.localeCompare(right.startAt))
    .slice(0, MAX_RANGE_EVENTS);
}

/**
 * Taken hours for a set of people, with nothing said about what fills them.
 *
 * This is the one place that reads entries the caller cannot open, and it is
 * why the return value carries no title, no location and no organizer — only
 * that the hour is spoken for. A declined invite is not busy: saying no is how
 * you give the hour back.
 */
export async function busyForUsers(organizationId, userIds, { from, to }) {
  const wanted = new Set(userIds);
  if (wanted.size === 0) return [];
  const rows = await find(
    'calendarEvents',
    (event) =>
      organizationOf(event) === organizationOf({ organizationId }) &&
      !isCancelled(event) &&
      overlaps(event, from, to) &&
      participantIds(event).some((id) => wanted.has(id))
  );

  const declined = new Set();
  for (const event of rows) {
    for (const invite of await invitesForEvent(event.id)) {
      if (invite.response === 'declined') declined.add(`${event.id}:${invite.userId}`);
    }
  }

  const busy = [];
  for (const event of rows) {
    for (const id of participantIds(event)) {
      if (!wanted.has(id) || declined.has(`${event.id}:${id}`)) continue;
      // `eventId` is for callers inside the server — an edit has to be able to
      // ignore the entry it is editing. The route strips it before answering,
      // because the point of this function is to say "taken", not "which".
      busy.push({ eventId: event.id, userId: id, startAt: event.startAt, endAt: event.endAt });
    }
  }
  return busy.sort((left, right) => left.startAt.localeCompare(right.startAt));
}

export async function loadEvent(id) {
  return findOne('calendarEvents', (row) => row.id === id);
}

/* ── shapes ──────────────────────────────────────────────────────── */

export function publicEvent(event, { invites = [], user, attachmentCount = 0 } = {}) {
  const mine = invites.find((row) => row.userId === user?.id) ?? null;
  return {
    id: event.id,
    kind: event.kind,
    title: event.title,
    details: event.details ?? '',
    location: event.location ?? '',
    onlineUrl: event.onlineUrl ?? null,
    startAt: event.startAt,
    endAt: event.endAt,
    allDay: Boolean(event.allDay),
    visibility: event.visibility,
    department: event.department ?? null,
    organizerId: event.organizerId,
    inviteeIds: event.inviteeIds ?? [],
    conversationId: event.conversationId ?? null,
    status: event.status ?? 'confirmed',
    reminderMinutes: event.reminderMinutes ?? 15,
    attachmentCount,
    responses: invites.map((row) => ({
      userId: row.userId,
      response: row.response,
      respondedAt: row.respondedAt ?? null,
    })),
    myResponse: mine?.response ?? (event.organizerId === user?.id ? 'accepted' : null),
    canManage: canManageEvent(user, event),
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

/* ── notifications ───────────────────────────────────────────────── */

const CAIRO = process.env.MANAGEMENT_TIMEZONE || process.env.DIGEST_TIMEZONE || 'Africa/Cairo';

/** «الأحد ١٧ أغسطس · ١٠:٠٠» — enough to know whether you can be there. */
export function whenLabel(event, locale = 'ar-EG') {
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: CAIRO,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(event.startAt));
  } catch {
    return event.startAt;
  }
}

export async function notifyCalendar(userId, actorId, { type, title, body, link }) {
  if (!userId || userId === actorId) return;
  const user = await findOne('users', (row) => row.id === userId);
  if (!user) return;
  const notification = await create('notifications', {
    organizationId: organizationOf(user),
    userId,
    actorId: actorId ?? null,
    type,
    title,
    body,
    link,
    read: false,
  });
  publishNotification(userId, notification.id);
  await notifyUser(userId, { title, body, link });
}

const linkTo = (event) => `/calendar?event=${encodeURIComponent(event.id)}`;

export async function announceEvent(event, actor, kind) {
  const label = event.kind === 'meeting' ? 'اجتماع' : 'موعد';
  const heading = {
    invited: { ar: `دعوة ${label}: ${event.title}`, en: `Invitation: ${event.title}` },
    updated: { ar: `تعديل ${label}: ${event.title}`, en: `Updated: ${event.title}` },
    cancelled: { ar: `إلغاء ${label}: ${event.title}`, en: `Cancelled: ${event.title}` },
  }[kind];
  const body = `${whenLabel(event)}${event.location ? ` · ${event.location}` : ''}`;

  for (const id of event.inviteeIds ?? []) {
    await notifyCalendar(id, actor?.id ?? null, {
      type: `calendar.${kind}`,
      title: heading,
      body,
      link: linkTo(event),
    });
  }
}

export async function announceResponse(event, responder, response) {
  const word = { accepted: 'وافق', declined: 'اعتذر', tentative: 'مبدئياً' }[response];
  if (!word) return;
  await notifyCalendar(event.organizerId, responder.id, {
    type: 'calendar.response',
    title: {
      ar: `${responder.name} ${word} — ${event.title}`,
      en: `${responder.name} ${response} — ${event.title}`,
    },
    body: whenLabel(event),
    link: linkTo(event),
  });
}

/**
 * The reminder before the entry starts.
 *
 * Runs on the scheduler's ordinary minute tick and marks the row once it has
 * fired, so a redeploy at the wrong minute cannot send it twice — the same
 * guarantee the management desk's reminder gives, for the same reason.
 */
export async function remindUpcomingEvents(organizationId) {
  const now = Date.now();
  const rows = await find(
    'calendarEvents',
    (event) =>
      organizationOf(event) === organizationOf({ organizationId }) &&
      !isCancelled(event) &&
      !event.remindedAt &&
      (event.reminderMinutes ?? 0) > 0 &&
      new Date(event.startAt).getTime() > now &&
      new Date(event.startAt).getTime() - now <= (event.reminderMinutes ?? 0) * MINUTE
  );
  if (!rows.length) return 0;

  const store = await getStore();
  for (const event of rows) {
    const declined = new Set(
      (await invitesForEvent(event.id))
        .filter((invite) => invite.response === 'declined')
        .map((invite) => invite.userId)
    );
    for (const id of participantIds(event)) {
      if (declined.has(id)) continue;
      await notifyCalendar(id, null, {
        type: 'calendar.reminder',
        title: {
          ar: `${event.kind === 'meeting' ? 'اجتماع' : 'موعد'} قرّب: ${event.title}`,
          en: `Starting soon: ${event.title}`,
        },
        body: `${whenLabel(event)}${event.location ? ` · ${event.location}` : ''}`,
        link: linkTo(event),
      });
    }
    await store.update('calendarEvents', event.id, { remindedAt: new Date().toISOString() });
  }
  return rows.length;
}

export { INVITE_RESPONSES };
