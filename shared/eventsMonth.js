/**
 * "This month" — which courses run in a calendar month, and in what order.
 *
 * A course belongs to a month when its dates *overlap* it:
 *
 *     startsAt ≤ end of month  AND  endsAt ≥ start of month
 *
 * so a course that began last month and is still running is here, and so is
 * one that finishes on the 3rd. Months are Riyadh calendar months (fixed
 * UTC+3): a lecture at 01:00 KSA on the 1st belongs to the new month even
 * though it is still the 31st in UTC. Rows come from Odoo; the layout only
 * adds package / group labels.
 */

import { ksaDay } from './eventsSchedule.js';

const KSA_OFFSET_MS = 3 * 3_600_000;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "2026-09" — the month `now` falls in, on Riyadh's calendar. */
export function monthOf(now = new Date()) {
  return new Date(now.getTime() + KSA_OFFSET_MS).toISOString().slice(0, 7);
}

export function isMonth(value) {
  return MONTH.test(String(value ?? ''));
}

export function shiftMonth(month, delta) {
  const [year, index] = month.split('-').map(Number);
  const moved = new Date(Date.UTC(year, index - 1 + delta, 1));
  return moved.toISOString().slice(0, 7);
}

/** First and last KSA day of a month, as `YYYY-MM-DD` — what the schedule API takes. */
export function monthBounds(month) {
  const [year, index] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, index, 0)).toISOString().slice(0, 10);
  return { from: `${month}-01`, to: last };
}

/** First/last day a course runs on, falling back to its lectures when a date is missing. */
function span(row) {
  const sessions = (row.sessions ?? []).map((session) => ksaDay(session.startsAt)).filter(Boolean).sort();
  const start = ksaDay(row.startsAt) ?? sessions[0] ?? null;
  const end = ksaDay(row.endsAt) ?? sessions[sessions.length - 1] ?? start;
  return { start, end };
}

export function overlapsMonth(row, month) {
  const { from, to } = monthBounds(month);
  const { start, end } = span(row);
  if (!start || !end) return false;
  return start <= to && end >= from;
}

const hasSessionOn = (row, day) => (row.sessions ?? []).some((session) => session.startsAt && ksaDay(session.startsAt) === day);

/**
 * What is happening with a course this month, in the order the table lists
 * them: a lecture today, running, upcoming, finished. Hold and cancelled
 * courses still show (they are real Odoo courses overlapping the month) but
 * sink below the rest.
 */
export const MONTH_BUCKETS = ['today', 'running', 'upcoming', 'finished', 'hold', 'canceled'];

export function monthBucket(row, now = new Date()) {
  const status = row.statusCanonical;
  if (status === 'canceled' || status === 'refused') return 'canceled';
  if (status === 'hold') return 'hold';
  const today = ksaDay(now.toISOString());
  if (hasSessionOn(row, today) && status !== 'finished') return 'today';
  const { start, end } = span(row);
  if (status === 'finished' || (end && end < today)) return 'finished';
  if (status === 'in_progress' || (start && start <= today)) return 'running';
  return 'upcoming';
}

/** The instant a row is sorted by inside its bucket. */
function sortInstant(row, bucket, now) {
  const at = (iso) => (iso ? new Date(iso).getTime() : Number.MAX_SAFE_INTEGER);
  if (bucket === 'today') {
    const today = ksaDay(now.toISOString());
    const session = (row.sessions ?? []).find((entry) => entry.startsAt && ksaDay(entry.startsAt) === today);
    return at(session?.startsAt);
  }
  if (bucket === 'running') return at(row.nextSession?.startsAt ?? row.endsAt);
  if (bucket === 'finished') return at(row.endsAt ?? row.lastSessionAt);
  return at(row.startsAt ?? row.firstSessionAt);
}

/**
 * The month's rows, overlap rule applied and ordered: lecture today, running,
 * upcoming, finished this month (then hold, cancelled) — each by its next
 * relevant moment, never by Odoo id.
 */
export function monthRows(rows, month, now = new Date()) {
  return rows
    .filter((row) => overlapsMonth(row, month))
    .map((row) => {
      const bucket = monthBucket(row, now);
      return { row, bucket, rank: MONTH_BUCKETS.indexOf(bucket), at: sortInstant(row, bucket, now) };
    })
    .sort((a, b) => a.rank - b.rank || a.at - b.at || String(a.row.courseName).localeCompare(String(b.row.courseName)) || a.row.id - b.row.id)
    .map(({ row, bucket }) => ({ ...row, monthBucket: bucket }));
}

/** The small strip above the table: counts, not KPI cards. */
export function monthSummary(rows, month, now = new Date()) {
  const { from, to } = monthBounds(month);
  let running = 0;
  let starting = 0;
  let finishing = 0;
  let trainees = 0;
  for (const row of rows) {
    const bucket = row.monthBucket ?? monthBucket(row, now);
    if (bucket === 'today' || bucket === 'running') running += 1;
    const { start, end } = span(row);
    if (start && start >= from && start <= to) starting += 1;
    if (end && end >= from && end <= to) finishing += 1;
    // A cancelled course's registrations are nobody in a classroom.
    if (bucket !== 'canceled') trainees += row.traineeCount ?? 0;
  }
  return { courses: rows.length, running, starting, finishing, trainees };
}

/** Whether a row started before the month (the Schedule cell then says "Started …"). */
export function startedBefore(row, month) {
  const { start } = span(row);
  return Boolean(start && start < monthBounds(month).from);
}
