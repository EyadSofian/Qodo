/**
 * Working days and the recruitment SLA — the one place a date becomes
 * "Day 11 / 15".
 *
 * Plain calendar arithmetic (`dateDifference`) is wrong here twice over:
 * Engosoft does not work Fridays or Saturdays, and a hiring deadline promised
 * in working days that silently counts weekends lands two to four days early
 * for every job. So every SLA number in HR — the server's alerts, the KPI, the
 * rewards and the browser's progress bar — comes from these functions and
 * nothing else.
 *
 * Dates are ISO `YYYY-MM-DD` strings in the organization's own day (Cairo),
 * never `Date` objects: a timestamp near midnight is a different day in Cairo
 * and in UTC, and an SLA that flips with the server's timezone is not an SLA.
 *
 * The clock uses the `T + N` convention. The day a job is approved is day 0;
 * the due date is the N-th working day after it. "Within 15 working days of
 * approval" therefore means a job approved on a Thursday afternoon is not
 * charged for Thursday.
 */

const DAY_MS = 86_400_000;

/** Friday and Saturday, as `Date#getUTCDay` numbers them. */
export const DEFAULT_WEEKEND = [5, 6];

export const SLA_STATES = ['on_track', 'due_soon', 'due_today', 'overdue', 'paused', 'met', 'missed', 'not_started'];

export function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return false;
  const time = Date.parse(`${value}T12:00:00Z`);
  // Date.parse rolls 2026-02-30 into March; round-tripping catches it.
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function toTime(date) {
  return Date.parse(`${date}T12:00:00Z`);
}

function fromTime(time) {
  return new Date(time).toISOString().slice(0, 10);
}

function weekday(date) {
  return new Date(toTime(date)).getUTCDay();
}

export function addCalendarDays(date, days) {
  return fromTime(toTime(date) + days * DAY_MS);
}

/** Today in the organization's timezone, as the rest of HR counts days. */
export function localDay(date = new Date(), timeZone = 'Africa/Cairo') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * A calendar with the weekend as a Set and holidays as a Set of ISO days.
 * Accepts an already-normalised calendar, so the hot functions below can take
 * either without paying for it twice.
 */
export function normaliseCalendar(calendar = {}) {
  if (calendar?.weekend instanceof Set && calendar?.holidays instanceof Set) return calendar;
  const weekend = Array.isArray(calendar?.weekend)
    ? [...new Set(calendar.weekend.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    : DEFAULT_WEEKEND;
  if (weekend.length >= 7) throw new RangeError('calendar_has_no_working_days');
  const holidays = new Set((calendar?.holidays ?? []).filter(isIsoDate));
  return { weekend: new Set(weekend), holidays };
}

export function isWorkingDay(date, calendar) {
  if (!isIsoDate(date)) return false;
  const normalised = normaliseCalendar(calendar);
  return !normalised.weekend.has(weekday(date)) && !normalised.holidays.has(date);
}

/**
 * Working days `d` with `from < d <= to`.
 *
 * Negative when `to` is before `from`, so "how late" and "how long" are the
 * same function. Whole weeks are counted arithmetically — a year-long legacy
 * job must not cost 365 loop iterations on every list render.
 */
export function workingDaysBetween(from, to, calendar) {
  if (!isIsoDate(from) || !isIsoDate(to)) return null;
  if (from === to) return 0;
  const normalised = normaliseCalendar(calendar);
  const sign = to > from ? 1 : -1;
  const [start, end] = sign > 0 ? [from, to] : [to, from];
  const totalDays = Math.round((toTime(end) - toTime(start)) / DAY_MS);
  const weeks = Math.floor(totalDays / 7);
  let count = weeks * (7 - normalised.weekend.size);
  let cursor = addCalendarDays(start, weeks * 7);
  for (let index = weeks * 7; index < totalDays; index += 1) {
    cursor = addCalendarDays(cursor, 1);
    if (!normalised.weekend.has(weekday(cursor))) count += 1;
  }
  for (const holiday of normalised.holidays) {
    if (holiday > start && holiday <= end && !normalised.weekend.has(weekday(holiday))) count -= 1;
  }
  return sign * count;
}

/** The N-th working day after `from`; `from` itself is never counted. */
export function addWorkingDays(from, count, calendar) {
  if (!isIsoDate(from)) return null;
  const days = Number(count);
  if (!Number.isInteger(days) || days < 0) throw new RangeError('working_days_invalid');
  const normalised = normaliseCalendar(calendar);
  let cursor = from;
  let left = days;
  while (left > 0) {
    cursor = addCalendarDays(cursor, 1);
    if (!normalised.weekend.has(weekday(cursor)) && !normalised.holidays.has(cursor)) left -= 1;
  }
  return cursor;
}

/** The first working day on or after `date` — where a clock started on a Friday really starts. */
export function nextWorkingDayOnOrAfter(date, calendar) {
  if (!isIsoDate(date)) return null;
  const normalised = normaliseCalendar(calendar);
  let cursor = date;
  while (normalised.weekend.has(weekday(cursor)) || normalised.holidays.has(cursor)) {
    cursor = addCalendarDays(cursor, 1);
  }
  return cursor;
}

/* ── Priority bands ─────────────────────────────────────────────── */

export const RECRUITMENT_PRIORITIES = ['critical', 'required', 'planned'];

/**
 * The approved targets: Critical at most 15 working days, Required 15–30,
 * Planned 45–60. `default` is what a new request is offered, the lenient end
 * of each band — the approver can tighten it, never stretch it past the band.
 */
export const DEFAULT_SLA_BANDS = {
  critical: { min: 1, max: 15, default: 15 },
  required: { min: 15, max: 30, default: 30 },
  planned: { min: 45, max: 60, default: 60 },
};

export function slaBand(priority, bands = DEFAULT_SLA_BANDS) {
  return bands?.[priority] ?? null;
}

/** `null` when valid, otherwise the error code the API answers with. */
export function validateTarget(priority, targetWorkingDays, bands = DEFAULT_SLA_BANDS) {
  if (!RECRUITMENT_PRIORITIES.includes(priority)) return 'recruitment_priority_invalid';
  const band = slaBand(priority, bands);
  const days = Number(targetWorkingDays);
  if (!Number.isInteger(days)) return 'recruitment_target_invalid';
  if (!band || days < band.min || days > band.max) return 'recruitment_target_out_of_band';
  return null;
}

/** The band a legacy "hiring period" of N days falls in, or null when it names none. */
export function priorityForHiringPeriod(days) {
  const value = Number(days);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value <= 15) return 'critical';
  if (value <= 30) return 'required';
  if (value <= 60) return 'planned';
  return null;
}

/* ── The SLA of one job ─────────────────────────────────────────── */

function wholeDays(value) {
  const number = Math.trunc(Number(value ?? 0));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/**
 * Everything the screens and the rules need to know about one job's clock.
 *
 * `sla` is what the request stores: `startDate`, `targetWorkingDays` (the
 * original target), `extendedWorkingDays` (the sum of the immutable extension
 * rows), `pausedWorkingDays` (closed holds), `pausedSince` (an open hold) and
 * `completedAt`. Elapsed, remaining and overdue are derived — storing them
 * would make every one of them wrong by tomorrow.
 */
export function slaSnapshot(sla, { today, calendar, dueSoonWorkingDays = 3 } = {}) {
  if (!sla || !isIsoDate(sla.startDate)) {
    return { state: 'not_started', started: false };
  }
  const normalised = normaliseCalendar(calendar);
  const completedAt = isIsoDate(sla.completedAt) ? sla.completedAt : null;
  const end = completedAt ?? (isIsoDate(today) ? today : localDay());

  const target = wholeDays(sla.targetWorkingDays);
  const extended = wholeDays(sla.extendedWorkingDays);
  const closedPause = wholeDays(sla.pausedWorkingDays);
  const runningPause = isIsoDate(sla.pausedSince) && !completedAt
    ? Math.max(0, workingDaysBetween(sla.pausedSince, end, normalised) ?? 0)
    : 0;
  const paused = closedPause + runningPause;
  const allowed = target + extended;

  const originalDueDate = addWorkingDays(sla.startDate, target, normalised);
  const dueDate = addWorkingDays(sla.startDate, allowed + paused, normalised);
  const elapsed = Math.max(0, (workingDaysBetween(sla.startDate, end, normalised) ?? 0) - paused);
  const remaining = allowed - elapsed;

  let state;
  if (completedAt) state = elapsed <= allowed ? 'met' : 'missed';
  else if (isIsoDate(sla.pausedSince)) state = 'paused';
  else if (remaining < 0) state = 'overdue';
  else if (remaining === 0) state = 'due_today';
  else if (remaining <= dueSoonWorkingDays) state = 'due_soon';
  else state = 'on_track';

  return {
    started: true,
    state,
    startDate: sla.startDate,
    originalTargetWorkingDays: target,
    extendedWorkingDays: extended,
    pausedWorkingDays: paused,
    targetWorkingDays: allowed,
    originalDueDate,
    dueDate,
    elapsedWorkingDays: elapsed,
    remainingWorkingDays: Math.max(0, remaining),
    overdueWorkingDays: Math.max(0, -remaining),
    progress: allowed > 0 ? elapsed / allowed : 1,
    completedAt,
    actualWorkingDays: completedAt ? elapsed : null,
    slaMet: completedAt ? elapsed <= allowed : null,
  };
}

/** The stored fields a completion writes, from the same arithmetic as the snapshot. */
export function completionFields(sla, completedAt, calendar) {
  const snapshot = slaSnapshot({ ...sla, pausedSince: null, completedAt }, { calendar });
  if (!snapshot.started) return { completedAt, actualWorkingDays: null, slaMet: null };
  // A hold still open at completion is closed at the completion date.
  const openPause = isIsoDate(sla?.pausedSince)
    ? Math.max(0, workingDaysBetween(sla.pausedSince, completedAt, calendar) ?? 0)
    : 0;
  const paused = wholeDays(sla?.pausedWorkingDays) + openPause;
  const elapsed = Math.max(0, (workingDaysBetween(sla.startDate, completedAt, calendar) ?? 0) - paused);
  const allowed = wholeDays(sla.targetWorkingDays) + wholeDays(sla.extendedWorkingDays);
  return {
    completedAt,
    pausedWorkingDays: paused,
    pausedSince: null,
    actualWorkingDays: elapsed,
    slaMet: elapsed <= allowed,
  };
}

/** Due date after `startDate + target + extensions + paused` — what the request stores for querying. */
export function currentDueDate(sla, calendar) {
  if (!sla || !isIsoDate(sla.startDate)) return null;
  const days = wholeDays(sla.targetWorkingDays) + wholeDays(sla.extendedWorkingDays) + wholeDays(sla.pausedWorkingDays);
  return addWorkingDays(sla.startDate, days, calendar);
}
