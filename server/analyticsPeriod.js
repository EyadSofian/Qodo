/**
 * A date-only reporting window and the equally-sized window immediately before it.
 *
 * The UI sends YYYY-MM-DD values. Odoo stores naive UTC datetimes, so the
 * domain uses an inclusive start and an exclusive next-day boundary. Keeping
 * that rule here stops the Events and eLearning reports disagreeing about the
 * last day of the same filter.
 */

const DAY_MS = 86_400_000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 3660;

export class AnalyticsPeriodError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AnalyticsPeriodError';
    this.status = 400;
  }
}

const isoDay = (date) => date.toISOString().slice(0, 10);

function parseDay(value) {
  if (!DATE_ONLY.test(String(value || ''))) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || isoDay(date) !== value ? null : date;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

export function analyticsPeriod({ from, to, defaultDays = 90 } = {}) {
  const today = new Date();
  const defaultTo = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const toDate = to ? parseDay(to) : defaultTo;
  const fromDate = from ? parseDay(from) : addDays(toDate, -(defaultDays - 1));

  if (!fromDate || !toDate) throw new AnalyticsPeriodError('invalid_analytics_period');
  if (fromDate > toDate) throw new AnalyticsPeriodError('invalid_analytics_period');

  const days = Math.round((toDate - fromDate) / DAY_MS) + 1;
  if (days > MAX_DAYS) throw new AnalyticsPeriodError('analytics_period_too_long');

  const endExclusive = addDays(toDate, 1);
  const previousTo = addDays(fromDate, -1);
  const previousFrom = addDays(fromDate, -days);

  return {
    from: isoDay(fromDate),
    to: isoDay(toDate),
    previousFrom: isoDay(previousFrom),
    previousTo: isoDay(previousTo),
    days,
    fromOdoo: `${isoDay(fromDate)} 00:00:00`,
    toOdooExclusive: `${isoDay(endExclusive)} 00:00:00`,
    previousFromOdoo: `${isoDay(previousFrom)} 00:00:00`,
    previousToOdooExclusive: `${isoDay(fromDate)} 00:00:00`,
  };
}

export function publicPeriod(period) {
  const { from, to, previousFrom, previousTo, days } = period;
  return { from, to, previousFrom, previousTo, days };
}
