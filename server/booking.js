/**
 * Client booking — the one part of this workspace a stranger can reach.
 *
 * Everything else in Qodo answers only to a session. A booking page answers to
 * the open internet, so the rules here are written from the outside in: what
 * may a person with nothing but a URL learn, and what may they cause?
 *
 * **Learn:** the owner's display name, job title and the hours they are free.
 * Not their email, not their user id, not what fills the hours they are not
 * free — the free/busy read goes through `busyForUsers`, which returns
 * intervals with no title attached, so a page can say "not that hour" without
 * saying "because of a doctor's appointment".
 *
 * **Cause:** exactly one confirmed appointment in the owner's calendar, inside
 * a window the owner published, throttled per address, and cancellable by
 * either side. Nothing else — a booking creates no account, joins no thread and
 * touches no other record.
 *
 * The page is opt-in twice over: an administrator grants `calendar.booking` to
 * a named person, and that person then has to publish. Neither alone puts
 * anybody's name on the internet.
 */

import crypto from 'node:crypto';
import { create, find, findOne, getStore } from './store.js';
import { organizationOf } from '../shared/organization.js';
import { isActiveUser } from '../shared/permissions.js';
import { publishNotification } from './notificationStream.js';
import { notifyUser } from './push.js';
import { sendMail, mailConfigured } from './mail.js';
import { busyForUsers, whenLabel } from './calendar.js';
import {
  DEFAULT_AVAILABILITY,
  DEFAULT_TIMEZONE,
  HORIZON_CHOICES,
  MAX_SLOT_RANGE_DAYS,
  NOTICE_CHOICES,
  BUFFER_CHOICES,
  SLOT_DURATIONS,
  availableSlots,
  hasAnyAvailability,
  normaliseAvailability,
} from '../shared/booking.js';

export class BookingError extends Error {
  constructor(code, status = 400, extra = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

export const MAX_TITLE = 120;
export const MAX_DESCRIPTION = 1_000;
export const MAX_NAME = 120;
export const MAX_NOTE = 1_000;
export const MAX_PHONE = 40;
export const MAX_COMPANY = 120;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY = 24 * 60 * 60_000;

const text = (value, limit) => String(value ?? '').trim().slice(0, limit);

/* ── the page ────────────────────────────────────────────────────── */

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MIN_SLUG = 3;
export const MAX_SLUG = 48;

/**
 * A readable slug, because this URL gets typed into a phone and read out loud.
 *
 * The random tail is not a secret — the page is meant to be handed out — but it
 * stops `/book/ahmed` from being a working guess, which would turn the feature
 * into a way to ask whether a given first name works here.
 */
export function slugFrom(name) {
  const base = String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    // Arabic names transliterate to nothing useful, so a name with no Latin
    // letters falls back to the generic stem rather than to an empty slug.
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 32)
    .replace(/^-+|-+$/g, '');
  const tail = crypto.randomBytes(4).toString('hex').slice(0, 6);
  return `${base || 'booking'}-${tail}`;
}

export function validateSlug(value) {
  const slug = String(value ?? '').trim().toLowerCase();
  if (slug.length < MIN_SLUG || slug.length > MAX_SLUG) return null;
  if (!SLUG_RE.test(slug)) return null;
  // Reserved so a booking page can never shadow a route of the app itself.
  if (['manage', 'api', 'new', 'admin'].includes(slug)) return null;
  return slug;
}

export function normalisePageInput(body, { current = null, owner }) {
  const title = body?.title === undefined ? current?.title : text(body.title, MAX_TITLE);
  const durationMinutes =
    body?.durationMinutes === undefined
      ? (current?.durationMinutes ?? 30)
      : Number(body.durationMinutes);
  if (!SLOT_DURATIONS.includes(durationMinutes)) throw new BookingError('invalid_duration');

  const bufferMinutes =
    body?.bufferMinutes === undefined ? (current?.bufferMinutes ?? 0) : Number(body.bufferMinutes);
  if (!BUFFER_CHOICES.includes(bufferMinutes)) throw new BookingError('invalid_buffer');

  const noticeMinutes =
    body?.noticeMinutes === undefined
      ? (current?.noticeMinutes ?? 240)
      : Number(body.noticeMinutes);
  if (!NOTICE_CHOICES.includes(noticeMinutes)) throw new BookingError('invalid_notice');

  const horizonDays =
    body?.horizonDays === undefined ? (current?.horizonDays ?? 14) : Number(body.horizonDays);
  if (!HORIZON_CHOICES.includes(horizonDays)) throw new BookingError('invalid_horizon');

  let availability = current?.availability ?? DEFAULT_AVAILABILITY;
  if (body?.availability !== undefined) {
    const result = normaliseAvailability(body.availability);
    if (result.error) throw new BookingError(result.error, 400, { day: result.day });
    availability = result.availability;
  }

  const active = body?.active === undefined ? (current?.active ?? false) : Boolean(body.active);
  // Publishing a page that can never offer an hour is a dead link with somebody's
  // name on it, so it is refused at the moment it would go live.
  if (active && !hasAnyAvailability(availability)) throw new BookingError('no_availability');

  return {
    title: title || `ميعاد مع ${owner.name}`,
    description:
      body?.description === undefined
        ? (current?.description ?? '')
        : text(body.description, MAX_DESCRIPTION),
    location:
      body?.location === undefined ? (current?.location ?? '') : text(body.location, MAX_TITLE),
    onlineUrl: body?.onlineUrl === undefined ? (current?.onlineUrl ?? null) : cleanUrl(body.onlineUrl),
    durationMinutes,
    bufferMinutes,
    noticeMinutes,
    horizonDays,
    timeZone: current?.timeZone ?? DEFAULT_TIMEZONE,
    availability,
    active,
  };
}

function cleanUrl(value) {
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

export const pageForUser = (userId) => findOne('bookingPages', (row) => row.userId === userId);
export const pageBySlug = (slug) => findOne('bookingPages', (row) => row.slug === slug);

/**
 * What the public page is allowed to know about the person behind it.
 *
 * Deliberately not the stored document and deliberately not `publicPerson` from
 * the calendar routes: that one carries an email address and a user id, which
 * are exactly the two fields a page on the internet has no business printing.
 */
export function publicBookingPage(page, owner) {
  return {
    slug: page.slug,
    title: page.title,
    description: page.description ?? '',
    location: page.location ?? '',
    onlineUrl: page.onlineUrl ?? null,
    durationMinutes: page.durationMinutes,
    timeZone: page.timeZone || DEFAULT_TIMEZONE,
    horizonDays: page.horizonDays,
    owner: {
      name: owner.name,
      title: owner.title ?? null,
      avatarColor: owner.avatarColor ?? '#1D6FB8',
    },
  };
}

/** The owner's own view: everything, including the parts a client never sees. */
export function ownerBookingPage(page) {
  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    description: page.description ?? '',
    location: page.location ?? '',
    onlineUrl: page.onlineUrl ?? null,
    durationMinutes: page.durationMinutes,
    bufferMinutes: page.bufferMinutes ?? 0,
    noticeMinutes: page.noticeMinutes ?? 240,
    horizonDays: page.horizonDays ?? 14,
    timeZone: page.timeZone || DEFAULT_TIMEZONE,
    availability: page.availability ?? DEFAULT_AVAILABILITY,
    active: Boolean(page.active),
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
  };
}

export function publicBooking(booking) {
  return {
    id: booking.id,
    startAt: booking.startAt,
    endAt: booking.endAt,
    status: booking.status,
    clientName: booking.clientName,
    clientEmail: booking.clientEmail,
    clientPhone: booking.clientPhone ?? '',
    clientCompany: booking.clientCompany ?? '',
    clientNote: booking.clientNote ?? '',
    eventId: booking.eventId ?? null,
    cancelledBy: booking.cancelledBy ?? null,
    cancelledAt: booking.cancelledAt ?? null,
    createdAt: booking.createdAt,
  };
}

/* ── free time ───────────────────────────────────────────────────── */

export function normaliseSlotRange(fromValue, toValue, page) {
  const now = Date.now();
  const from = fromValue ? new Date(String(fromValue)) : new Date(now);
  const to = toValue ? new Date(String(toValue)) : new Date(now + 14 * DAY);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new BookingError('invalid_range');
  }
  if (to.getTime() <= from.getTime()) throw new BookingError('invalid_range');
  if (to.getTime() - from.getTime() > MAX_SLOT_RANGE_DAYS * DAY) {
    throw new BookingError('range_too_wide', 400, { limit: MAX_SLOT_RANGE_DAYS });
  }
  // Never look further ahead than the owner agreed to be booked.
  const horizon = now + (page.horizonDays ?? 14) * DAY;
  return {
    from: new Date(Math.max(from.getTime(), now)).toISOString(),
    to: new Date(Math.min(to.getTime(), horizon)).toISOString(),
  };
}

/** Free slots for a page, with the owner's existing commitments removed. */
export async function slotsForPage(page, range) {
  if (!page.active) return [];
  const busy = await busyForUsers(page.organizationId, [page.userId], range);
  return availableSlots(page, {
    from: range.from,
    to: range.to,
    busy: busy.map(({ startAt, endAt }) => ({ startAt, endAt })),
  });
}

/* ── booking ─────────────────────────────────────────────────────── */

export function normaliseClientInput(body) {
  const clientName = text(body?.clientName, MAX_NAME);
  if (!clientName) throw new BookingError('client_name_required');

  const clientEmail = text(body?.clientEmail, 200).toLowerCase();
  if (!EMAIL_RE.test(clientEmail)) throw new BookingError('invalid_client_email');

  return {
    clientName,
    clientEmail,
    clientPhone: text(body?.clientPhone, MAX_PHONE),
    clientCompany: text(body?.clientCompany, MAX_COMPANY),
    clientNote: text(body?.clientNote, MAX_NOTE),
  };
}

/**
 * Two clients pressing "book" on the same slot in the same second would both
 * pass an availability check written the obvious way, because the document
 * store has no unique index to lose the race against. Serialising the whole
 * book path is the same answer `routes/invites.js` reached for the same reason,
 * and for the same scale: one API process, and a short section.
 */
let bookQueue = Promise.resolve();
export function serialiseBooking(work) {
  const run = bookQueue.then(work, work);
  bookQueue = run.then(
    () => {},
    () => {}
  );
  return run;
}

const clientSummary = (input) =>
  [
    `حجز من العميل: ${input.clientName}`,
    `الإيميل: ${input.clientEmail}`,
    input.clientPhone ? `التليفون: ${input.clientPhone}` : '',
    input.clientCompany ? `الشركة: ${input.clientCompany}` : '',
    input.clientNote ? `\n${input.clientNote}` : '',
  ]
    .filter(Boolean)
    .join('\n');

/**
 * Books a slot: one calendar entry, one booking record, one notification.
 *
 * The entry is an `appointment` rather than a `meeting` because the other party
 * is not a user of this workspace — there is nobody to invite and nobody to
 * collect an answer from. It is private to the owner for the same reason a
 * meeting's default is: who a person is seeing is theirs to publish, and a
 * client's name and phone number are not the department's business.
 *
 * Must be called inside `serialiseBooking`.
 */
export async function bookSlot(page, owner, { startAt, endAt, client }) {
  const slots = await slotsForPage(page, {
    from: new Date(Date.parse(startAt) - 1_000).toISOString(),
    to: new Date(Date.parse(endAt) + 1_000).toISOString(),
  });
  const slot = slots.find((row) => row.startAt === startAt && row.endAt === endAt);
  if (!slot) throw new BookingError('slot_unavailable', 409);

  const event = await create('calendarEvents', {
    organizationId: page.organizationId,
    kind: 'appointment',
    title: `${page.title} — ${client.clientName}`,
    details: clientSummary(client),
    location: page.location ?? '',
    onlineUrl: page.onlineUrl ?? null,
    startAt,
    endAt,
    allDay: false,
    visibility: 'invitees',
    department: null,
    organizerId: owner.id,
    inviteeIds: [],
    conversationId: null,
    status: 'confirmed',
    reminderMinutes: 30,
    remindedAt: null,
    cancelledAt: null,
    createdBy: owner.id,
  });

  const booking = await create('bookings', {
    organizationId: page.organizationId,
    pageId: page.id,
    userId: owner.id,
    eventId: event.id,
    // The client has no account, so this token is the only thing that proves a
    // later "cancel my appointment" comes from the person who made it.
    manageToken: crypto.randomBytes(32).toString('base64url'),
    ...client,
    startAt,
    endAt,
    status: 'confirmed',
    cancelledBy: null,
    cancelledAt: null,
  });

  await notifyOwner(owner, {
    type: 'booking.created',
    title: {
      ar: `حجز جديد: ${client.clientName}`,
      en: `New booking: ${client.clientName}`,
    },
    body: whenLabel(event),
    link: `/calendar?event=${encodeURIComponent(event.id)}`,
  });
  await emailClient(booking, page, owner, 'confirmed');

  return { booking, event };
}

/**
 * Cancels from either side.
 *
 * The calendar entry is cancelled rather than deleted, exactly as a cancelled
 * meeting is, so the hour reads as "this came off" instead of vanishing — and
 * so the owner is not left wondering whether they imagined it.
 */
export async function cancelBooking(booking, { by, owner, page }) {
  if (booking.status === 'cancelled') return booking;
  const store = await getStore();

  const updated = await store.update('bookings', booking.id, {
    status: 'cancelled',
    cancelledBy: by,
    cancelledAt: new Date().toISOString(),
  });

  if (booking.eventId) {
    const event = await findOne('calendarEvents', (row) => row.id === booking.eventId);
    if (event && event.status !== 'cancelled') {
      await store.update('calendarEvents', event.id, {
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
      });
    }
  }

  if (by === 'client' && owner) {
    await notifyOwner(owner, {
      type: 'booking.cancelled',
      title: {
        ar: `إلغاء حجز: ${booking.clientName}`,
        en: `Booking cancelled: ${booking.clientName}`,
      },
      body: whenLabel(booking),
      link: '/calendar',
    });
  }
  if (by === 'owner' && page && owner) {
    await emailClient(updated, page, owner, 'cancelled');
  }
  return updated;
}

async function notifyOwner(owner, { type, title, body, link }) {
  if (!owner || !isActiveUser(owner)) return;
  const notification = await create('notifications', {
    organizationId: organizationOf(owner),
    userId: owner.id,
    actorId: null,
    type,
    title,
    body,
    link,
    read: false,
  });
  publishNotification(owner.id, notification.id);
  await notifyUser(owner.id, { title, body, link });
}

/**
 * The client's only channel.
 *
 * They have no account, no bell and no push subscription, so if SMTP is not
 * configured this is simply not sent — the booking still stands and the page
 * still shows the confirmation and the manage link on screen. A deployment
 * without email is one fewer channel, not a broken booking, which is the same
 * contract `server/mail.js` states for every other caller.
 */
async function emailClient(booking, page, owner, kind) {
  if (!mailConfigured()) return;
  const when = whenLabel(booking);
  const manageUrl = `${publicOrigin()}/book/manage/${booking.manageToken}`;
  const subject =
    kind === 'confirmed'
      ? `تأكيد الميعاد — ${page.title}`
      : `إلغاء الميعاد — ${page.title}`;
  const lines =
    kind === 'confirmed'
      ? [
          `أهلاً ${booking.clientName},`,
          '',
          `اتأكد ميعادك مع ${owner.name}.`,
          `الوقت: ${when}`,
          page.location ? `المكان: ${page.location}` : '',
          page.onlineUrl ? `الرابط: ${page.onlineUrl}` : '',
          '',
          `لو حصل ظرف، تقدر تلغي من هنا: ${manageUrl}`,
        ]
      : [
          `أهلاً ${booking.clientName},`,
          '',
          `للأسف اتلغى ميعادك مع ${owner.name} (${when}).`,
          'لو تحب تحجز ميعاد تاني، افتح صفحة الحجز من نفس اللينك.',
        ];

  await sendMail({
    to: booking.clientEmail,
    subject,
    text: lines.filter((line) => line !== '').join('\n'),
  });
}

/** Where the client's links point. Railway sets no origin, so it is configured. */
export const publicOrigin = () =>
  (process.env.PUBLIC_ORIGIN || process.env.APP_ORIGIN || '').replace(/\/+$/, '');

export async function ownerOf(page) {
  return findOne('users', (row) => row.id === page.userId);
}

export async function bookingsForUser(userId, { from, to } = {}) {
  return (await find('bookings', (row) => row.userId === userId))
    .filter((row) => (!from || row.endAt >= from) && (!to || row.startAt <= to))
    .sort((left, right) => left.startAt.localeCompare(right.startAt));
}
