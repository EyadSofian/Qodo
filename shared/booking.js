/**
 * The arithmetic behind a client booking page — turning "I work Sunday to
 * Thursday, nine to five" into actual instants somebody can pick.
 *
 * This file is deliberately pure: no store, no request, no clock of its own.
 * Everything it needs arrives as an argument, which is what lets the awkward
 * half — daylight saving — be tested directly instead of through a booking.
 *
 * ## Why wall clock and instants are both here
 *
 * `server/calendar.js` stores an entry as an instant, and says why: Egypt moves
 * its offset twice a year, so a stored `14:00` silently becomes a different
 * hour after the change. That is right for one meeting on one day.
 *
 * Availability is the opposite kind of fact. "I take clients from nine" does
 * not mean "from 07:00 UTC" — it means nine in the morning, in Cairo, forever,
 * including on the far side of a clock change. Storing that as an instant would
 * be wrong in exactly the way storing a meeting as wall clock is wrong. So the
 * rule is: **availability is wall clock plus a zone, and every slot it produces
 * is an instant.** The conversion happens here, once, per day generated.
 */

/** Sunday first, matching both `Date#getDay` and the Egyptian working week. */
export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export const WEEKDAY_LABEL = {
  sun: { ar: 'الأحد', en: 'Sunday' },
  mon: { ar: 'الاثنين', en: 'Monday' },
  tue: { ar: 'الثلاثاء', en: 'Tuesday' },
  wed: { ar: 'الأربعاء', en: 'Wednesday' },
  thu: { ar: 'الخميس', en: 'Thursday' },
  fri: { ar: 'الجمعة', en: 'Friday' },
  sat: { ar: 'السبت', en: 'Saturday' },
};

export const SLOT_DURATIONS = [15, 20, 30, 45, 60, 90, 120];
export const BUFFER_CHOICES = [0, 5, 10, 15, 30];
/** How much warning the owner gets before a stranger can take an hour. */
export const NOTICE_CHOICES = [0, 60, 120, 240, 720, 1_440, 2_880];
export const HORIZON_CHOICES = [7, 14, 30, 60];

export const MAX_HORIZON_DAYS = 60;
/** A booking page answers for a fortnight at a time; more is a report. */
export const MAX_SLOT_RANGE_DAYS = 31;
export const MAX_SLOTS = 500;

export const DEFAULT_TIMEZONE = 'Africa/Cairo';

/** Sunday to Thursday, nine to five — the Engosoft week, editable after. */
export const DEFAULT_AVAILABILITY = {
  sun: [{ start: '09:00', end: '17:00' }],
  mon: [{ start: '09:00', end: '17:00' }],
  tue: [{ start: '09:00', end: '17:00' }],
  wed: [{ start: '09:00', end: '17:00' }],
  thu: [{ start: '09:00', end: '17:00' }],
  fri: [],
  sat: [],
};

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/* ── wall clock ↔ instant ────────────────────────────────────────── */

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** `"09:30"` → 570. Returns null for anything that is not a real time of day. */
export function minutesOfDay(value) {
  const match = TIME_RE.exec(String(value ?? '').trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export const asClock = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * How far the zone is from UTC at a given instant, in milliseconds.
 *
 * Read out of `Intl` rather than kept in a table, so a government moving its
 * clocks is a Node upgrade rather than a patch to this file — which matters
 * here, because Egypt reintroduced summer time in 2023 after nine years without
 * it and any hard-coded offset written before that is now wrong.
 */
export function zoneOffset(instant, timeZone) {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = {};
  for (const part of format.formatToParts(new Date(instant))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  // `hour` comes back as 24 at midnight under hour12:false in some versions.
  const hour = parts.hour === 24 ? 0 : parts.hour;
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, hour, parts.minute, parts.second);
  return asUtc - instant;
}

/**
 * The instant at which a given wall-clock moment occurs in a given zone.
 *
 * Two passes, because the offset we need is the one in force *at the answer*,
 * not the one at the guess: near a clock change the first guess can land on the
 * wrong side of it. The second pass re-reads the offset at the corrected
 * instant and, if it disagrees, uses that instead. On a spring-forward night
 * this maps a time that does not exist onto the moment the clocks jump, which
 * is the behaviour a booking wants — no slot is silently invented.
 */
export function wallClockToInstant({ year, month, day, minutes }, timeZone) {
  const guess = Date.UTC(year, month - 1, day, 0, minutes);
  const first = zoneOffset(guess, timeZone);
  const corrected = guess - first;
  const second = zoneOffset(corrected, timeZone);
  return second === first ? corrected : guess - second;
}

/** The calendar date, in the page's own zone, that an instant falls on. */
export function zonedDateParts(instant, timeZone) {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts = {};
  for (const part of format.formatToParts(new Date(instant))) parts[part.type] = part.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: String(parts.weekday).toLowerCase().slice(0, 3),
  };
}

/* ── slots ───────────────────────────────────────────────────────── */

/** Half-open, so a slot ending exactly when a meeting starts is still free. */
const clashes = (startAt, endAt, busy) =>
  busy.some((block) => block.startAt < endAt && block.endAt > startAt);

/**
 * Every bookable slot in `[from, to)` that nothing else already occupies.
 *
 * `busy` is whatever `busyForUsers` returned for the page's owner: intervals
 * with no title on them, which is the whole reason a stranger can be told an
 * hour is unavailable without being told that it holds a doctor's appointment.
 *
 * The walk is by calendar day in the owner's zone rather than by fixed 24-hour
 * steps, because on a clock-change day those two are not the same length.
 */
export function availableSlots(page, { from, to, busy = [], now = Date.now() }) {
  const timeZone = page.timeZone || DEFAULT_TIMEZONE;
  const duration = Number(page.durationMinutes) || 30;
  const step = duration + (Number(page.bufferMinutes) || 0);
  const earliest = now + (Number(page.noticeMinutes) || 0) * MINUTE;
  const latest = now + (Number(page.horizonDays) || 14) * DAY;

  const windowStart = Math.max(new Date(from).getTime(), earliest);
  const windowEnd = Math.min(new Date(to).getTime(), latest);
  if (!(windowEnd > windowStart)) return [];

  const slots = [];
  // Start a day early: a window that opens late in the owner's zone can still
  // belong to the previous UTC day.
  let cursor = new Date(from).getTime() - DAY;
  const guard = new Date(to).getTime() + DAY;

  while (cursor < guard && slots.length < MAX_SLOTS) {
    const { year, month, day, weekday } = zonedDateParts(cursor, timeZone);
    for (const window of page.availability?.[weekday] ?? []) {
      const open = minutesOfDay(window.start);
      const close = minutesOfDay(window.end);
      if (open === null || close === null || close <= open) continue;

      for (let at = open; at + duration <= close; at += step) {
        const startAt = wallClockToInstant({ year, month, day, minutes: at }, timeZone);
        const endAt = startAt + duration * MINUTE;
        if (startAt < windowStart || startAt >= windowEnd) continue;
        const iso = { startAt: new Date(startAt).toISOString(), endAt: new Date(endAt).toISOString() };
        if (clashes(iso.startAt, iso.endAt, busy)) continue;
        slots.push(iso);
        if (slots.length >= MAX_SLOTS) break;
      }
      if (slots.length >= MAX_SLOTS) break;
    }
    cursor += DAY;
  }

  // A day walked twice around a clock change would otherwise offer the same
  // hour under two cursors.
  const seen = new Set();
  return slots
    .filter((slot) => (seen.has(slot.startAt) ? false : seen.add(slot.startAt)))
    .sort((left, right) => left.startAt.localeCompare(right.startAt));
}

/* ── validation ──────────────────────────────────────────────────── */

/**
 * Cleans a submitted week, or says which day was wrong.
 *
 * Overlapping windows on one day are merged rather than rejected: somebody
 * typing 9–12 and 11–15 meant to be free from 9 to 15, and refusing the form
 * over it teaches nothing.
 */
export function normaliseAvailability(input) {
  const week = {};
  for (const day of WEEKDAYS) {
    const raw = Array.isArray(input?.[day]) ? input[day] : [];
    const ranges = [];
    for (const window of raw.slice(0, 6)) {
      const open = minutesOfDay(window?.start);
      const close = minutesOfDay(window?.end);
      if (open === null || close === null) return { error: 'invalid_hours', day };
      if (close <= open) return { error: 'end_before_start', day };
      ranges.push([open, close]);
    }
    ranges.sort((left, right) => left[0] - right[0]);

    const merged = [];
    for (const [open, close] of ranges) {
      const last = merged[merged.length - 1];
      if (last && open <= last[1]) last[1] = Math.max(last[1], close);
      else merged.push([open, close]);
    }
    week[day] = merged.map(([open, close]) => ({ start: asClock(open), end: asClock(close) }));
  }
  return { availability: week };
}

/** Does this week offer any time at all? A page with none can never be booked. */
export const hasAnyAvailability = (availability) =>
  WEEKDAYS.some((day) => (availability?.[day] ?? []).length > 0);
