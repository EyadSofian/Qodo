/**
 * Client booking, browser side.
 *
 * Two audiences share this file and they have nothing else in common: the
 * employee configuring a page from inside the workspace, and a customer who
 * has never heard of it. The public calls deliberately go through plain
 * `fetch` rather than the shared `api` helper — that helper is built around a
 * session, and a booking page must work with no cookie, no auth header and no
 * redirect-to-login behaviour anywhere in its path.
 */

import { api } from './api';
import { WEEKDAYS, WEEKDAY_LABEL } from '@shared/booking';

export { WEEKDAYS, WEEKDAY_LABEL };

export type Weekday = (typeof WEEKDAYS)[number];
export interface TimeWindow {
  start: string;
  end: string;
}
export type Availability = Record<string, TimeWindow[]>;

export interface BookingPage {
  id: string;
  slug: string;
  title: string;
  description: string;
  location: string;
  onlineUrl: string | null;
  durationMinutes: number;
  bufferMinutes: number;
  noticeMinutes: number;
  horizonDays: number;
  timeZone: string;
  availability: Availability;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BookingOptions {
  durations: number[];
  buffers: number[];
  notices: number[];
  horizons: number[];
  weekdays: string[];
  slug: { min: number; max: number };
}

export interface PublicPage {
  slug: string;
  title: string;
  description: string;
  location: string;
  onlineUrl: string | null;
  durationMinutes: number;
  timeZone: string;
  horizonDays: number;
  owner: { name: string; title: string | null; avatarColor: string };
}

export interface Slot {
  startAt: string;
  endAt: string;
}

export interface Booking {
  id: string;
  startAt: string;
  endAt: string;
  status: 'confirmed' | 'cancelled';
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  clientCompany: string;
  clientNote: string;
  eventId: string | null;
  cancelledBy: 'owner' | 'client' | null;
  cancelledAt: string | null;
  createdAt: string;
}

export interface ClientDetails {
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  clientCompany: string;
  clientNote: string;
}

/* ── owner side ──────────────────────────────────────────────────── */

export const fetchMyBookingPage = () =>
  api.get<{ page: BookingPage | null; origin: string; options: BookingOptions }>('/booking');

export const saveBookingPage = (input: Partial<BookingPage>) =>
  api.put<{ page: BookingPage; origin: string }>('/booking', input);

export const fetchMyBookings = () =>
  api.get<{ bookings: Booking[] }>('/booking/bookings').then((response) => response.bookings);

export const cancelClientBooking = (id: string) =>
  api
    .post<{ booking: Booking }>(`/booking/bookings/${encodeURIComponent(id)}/cancel`, {})
    .then((response) => response.booking);

/* ── public side ─────────────────────────────────────────────────── */

/**
 * The visitor has no session, so an error here is a message on a page rather
 * than a redirect. The code is surfaced so the page can tell "this link is
 * dead" apart from "somebody just took that hour".
 */
export class PublicBookingError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

async function publicCall<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/book${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const code = (data as { error?: string })?.error ?? 'failed';
    throw new PublicBookingError(code, response.status);
  }
  return data as T;
}

export const fetchPublicPage = (slug: string) =>
  publicCall<{ page: PublicPage }>(`/${encodeURIComponent(slug)}`).then((r) => r.page);

export const fetchPublicSlots = (slug: string, from: Date, to: Date) =>
  publicCall<{ slots: Slot[] }>(
    `/${encodeURIComponent(slug)}/slots?from=${encodeURIComponent(
      from.toISOString()
    )}&to=${encodeURIComponent(to.toISOString())}`
  ).then((r) => r.slots);

export const bookSlot = (slug: string, slot: Slot, client: ClientDetails) =>
  publicCall<{ booking: { startAt: string; endAt: string; clientName: string; manageToken: string } }>(
    `/${encodeURIComponent(slug)}/book`,
    { method: 'POST', body: JSON.stringify({ ...slot, ...client }) }
  ).then((r) => r.booking);

export const fetchManagedBooking = (token: string) =>
  publicCall<{
    booking: {
      startAt: string;
      endAt: string;
      status: 'confirmed' | 'cancelled';
      clientName: string;
      cancelledBy: 'owner' | 'client' | null;
    };
    page: PublicPage | null;
  }>(`/manage/${encodeURIComponent(token)}`);

export const cancelManagedBooking = (token: string) =>
  publicCall<{ booking: { startAt: string; status: string } }>(
    `/manage/${encodeURIComponent(token)}/cancel`,
    { method: 'POST' }
  ).then((r) => r.booking);

/* ── formatting ──────────────────────────────────────────────────── */

/**
 * Times are shown in the page's zone, not the visitor's.
 *
 * A customer in Cairo and one in Dubai must be able to read the same
 * confirmation out loud and mean the same hour, and the hour that matters is
 * the one where the appointment happens.
 */
export const inZone = (
  value: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
  lang: 'ar' | 'en' = 'ar'
) =>
  new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-GB', { timeZone, ...options }).format(
    new Date(value)
  );

export const slotTime = (value: string, timeZone: string, lang: 'ar' | 'en' = 'ar') =>
  inZone(value, timeZone, { hour: 'numeric', minute: '2-digit' }, lang);

export const slotDay = (value: string, timeZone: string, lang: 'ar' | 'en' = 'ar') =>
  inZone(value, timeZone, { weekday: 'long', day: 'numeric', month: 'long' }, lang);

/** The date key a slot belongs to *in the page's zone*, for grouping by day. */
export const zonedDayKey = (value: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));

export function groupByDay(slots: Slot[], timeZone: string): [string, Slot[]][] {
  const days = new Map<string, Slot[]>();
  for (const slot of slots) {
    const key = zonedDayKey(slot.startAt, timeZone);
    if (!days.has(key)) days.set(key, []);
    days.get(key)!.push(slot);
  }
  return [...days.entries()].sort(([left], [right]) => left.localeCompare(right));
}

export const DURATION_LABEL = (minutes: number) =>
  minutes >= 60
    ? minutes % 60 === 0
      ? `${minutes / 60} ساعة`
      : `${Math.floor(minutes / 60)} ساعة و${minutes % 60} دقيقة`
    : `${minutes} دقيقة`;

export const NOTICE_LABEL = (minutes: number) =>
  minutes === 0
    ? 'بلا مهلة'
    : minutes < 60
      ? `${minutes} دقيقة`
      : minutes < 1_440
        ? `${minutes / 60} ساعة`
        : `${minutes / 1_440} يوم`;
