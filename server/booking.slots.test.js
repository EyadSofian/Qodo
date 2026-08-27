/**
 * The slot arithmetic, on its own.
 *
 * Everything here is a pure function over an availability week, so the cases
 * worth writing are the ones a booking would only reveal in production: the
 * night Egypt moves its clocks, a slot that must not be offered because the
 * owner is busy, and a working day that does not exist.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_AVAILABILITY,
  availableSlots,
  minutesOfDay,
  normaliseAvailability,
  wallClockToInstant,
  zonedDateParts,
  zoneOffset,
} from '../shared/booking.js';

const CAIRO = 'Africa/Cairo';
const page = (overrides = {}) => ({
  timeZone: CAIRO,
  durationMinutes: 60,
  bufferMinutes: 0,
  noticeMinutes: 0,
  horizonDays: 60,
  availability: DEFAULT_AVAILABILITY,
  ...overrides,
});

/** The wall clock the owner typed is the wall clock the client is offered. */
test('nine in the morning stays nine in the morning on both sides of a clock change', () => {
  // Egypt runs summer time again since 2023: +03 in July, +02 in January.
  const summer = wallClockToInstant({ year: 2026, month: 7, day: 5, minutes: 9 * 60 }, CAIRO);
  const winter = wallClockToInstant({ year: 2026, month: 1, day: 4, minutes: 9 * 60 }, CAIRO);

  const shown = (instant) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: CAIRO,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(instant));

  assert.equal(shown(summer), '09:00');
  assert.equal(shown(winter), '09:00');
  // And they are genuinely different offsets, or the test proves nothing.
  assert.notEqual(zoneOffset(summer, CAIRO), zoneOffset(winter, CAIRO));
});

test('a day is walked by its own calendar date, not by fixed 24-hour steps', () => {
  const parts = zonedDateParts(Date.UTC(2026, 6, 5, 21, 30), CAIRO);
  // 21:30 UTC on the 5th is already past midnight in Cairo (+03).
  assert.deepEqual(
    { year: parts.year, month: parts.month, day: parts.day, weekday: parts.weekday },
    { year: 2026, month: 7, day: 6, weekday: 'mon' }
  );
});

test('slots cover the working week and stop at the closing hour', () => {
  // Sunday 2026-08-16 through Saturday 2026-08-22.
  const from = '2026-08-16T00:00:00.000Z';
  const to = '2026-08-23T00:00:00.000Z';
  const slots = availableSlots(page(), { from, to, now: Date.parse('2026-08-01T00:00:00Z') });

  const byDay = new Map();
  for (const slot of slots) {
    const { weekday } = zonedDateParts(Date.parse(slot.startAt), CAIRO);
    byDay.set(weekday, (byDay.get(weekday) ?? 0) + 1);
  }
  // Sunday–Thursday, 09:00–17:00, one hour each: eight slots a day.
  assert.deepEqual([...byDay.keys()].sort(), ['mon', 'sun', 'thu', 'tue', 'wed']);
  assert.equal(byDay.get('sun'), 8);
  assert.equal(byDay.get('fri'), undefined, 'Friday is not a working day here');

  // The last slot starts at 16:00 and ends at 17:00 — never past closing.
  const hours = slots.map((slot) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: CAIRO, hour: '2-digit', hour12: false }).format(
      new Date(slot.startAt)
    )
  );
  assert.equal(Math.max(...hours.map(Number)), 16);
  assert.equal(Math.min(...hours.map(Number)), 9);
});

test('an hour the owner already owes somebody is never offered', () => {
  const from = '2026-08-16T00:00:00.000Z';
  const to = '2026-08-17T00:00:00.000Z';
  const now = Date.parse('2026-08-01T00:00:00Z');
  const open = availableSlots(page(), { from, to, now });
  const taken = open[3];

  const guarded = availableSlots(page(), {
    from,
    to,
    now,
    busy: [{ startAt: taken.startAt, endAt: taken.endAt }],
  });
  assert.equal(guarded.length, open.length - 1);
  assert.equal(
    guarded.some((slot) => slot.startAt === taken.startAt),
    false
  );

  // Touching but not overlapping is still free: a slot ending exactly when a
  // meeting starts costs nobody anything.
  const abutting = availableSlots(page(), {
    from,
    to,
    now,
    busy: [{ startAt: taken.endAt, endAt: new Date(Date.parse(taken.endAt) + 3_600_000).toISOString() }],
  });
  assert.equal(
    abutting.some((slot) => slot.startAt === taken.startAt),
    true
  );
});

test('notice and horizon cut the ends off, and a buffer thins the middle', () => {
  const from = '2026-08-16T00:00:00.000Z';
  const to = '2026-08-30T00:00:00.000Z';
  const now = Date.parse('2026-08-16T06:00:00Z'); // 09:00 in Cairo

  const immediate = availableSlots(page(), { from, to, now });
  const withNotice = availableSlots(page({ noticeMinutes: 1_440 }), { from, to, now });
  assert.ok(withNotice.length < immediate.length, 'a day of notice removes today');
  assert.ok(
    Date.parse(withNotice[0].startAt) >= now + 1_440 * 60_000,
    'and nothing inside the notice window survives'
  );

  const short = availableSlots(page({ horizonDays: 2 }), { from, to, now });
  assert.ok(Date.parse(short[short.length - 1].startAt) <= now + 2 * 86_400_000);

  // 60-minute slots with a 30-minute buffer fit five times into 09:00–17:00,
  // not eight: 9, 10:30, 12, 13:30, 15 — 16:30 would end past closing.
  const buffered = availableSlots(page({ bufferMinutes: 30 }), {
    from: '2026-08-16T00:00:00.000Z',
    to: '2026-08-17T00:00:00.000Z',
    now: Date.parse('2026-08-01T00:00:00Z'),
  });
  assert.equal(buffered.length, 5);
});

test('a week with no hours in it can never be booked', () => {
  const empty = availableSlots(page({ availability: { sun: [], mon: [] } }), {
    from: '2026-08-16T00:00:00.000Z',
    to: '2026-08-23T00:00:00.000Z',
    now: Date.parse('2026-08-01T00:00:00Z'),
  });
  assert.deepEqual(empty, []);
});

test('submitted hours are checked, and an overlap is merged rather than refused', () => {
  assert.equal(minutesOfDay('09:30'), 570);
  assert.equal(minutesOfDay('24:00'), null);
  assert.equal(minutesOfDay('9:30'), null, 'a half-typed time is not a time');

  const bad = normaliseAvailability({ sun: [{ start: '17:00', end: '09:00' }] });
  assert.equal(bad.error, 'end_before_start');
  assert.equal(bad.day, 'sun');

  // 09:00–12:00 and 11:00–15:00 was one intention typed twice.
  const merged = normaliseAvailability({
    sun: [
      { start: '09:00', end: '12:00' },
      { start: '11:00', end: '15:00' },
    ],
  });
  assert.deepEqual(merged.availability.sun, [{ start: '09:00', end: '15:00' }]);
  assert.deepEqual(merged.availability.fri, [], 'an unmentioned day is closed, not absent');
});
