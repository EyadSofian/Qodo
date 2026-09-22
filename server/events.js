/**
 * Events analytics — demand, capacity and the paid-revenue cross-check.
 *
 * The operational schedule (what runs when, sessions, registrations per course)
 * lives in `server/events/`; this file is the analysis tab. Its definitions are
 * deliberately unchanged by the schedule redesign:
 *
 * - An event belongs to a period when its `date_begin` falls inside it — not by
 *   when a registration was made.
 * - It counts **in-person** events only (`attendance_method = offline`). The
 *   schedule now shows online courses too, but "how did classroom demand do
 *   this month" is a different question and the paid-revenue comparison it sits
 *   beside is classroom-only as well.
 * - Registrations are counted with one `read_group` by (event, state), never by
 *   reading the computed `seats_taken`.
 *
 * Revenue comes from Insights Hub (paid invoices) and is kept separate from
 * Odoo's operational records on purpose: a booking is not a payment.
 */

import { OdooError, odooConfigured, readGroup, searchRead } from './odoo.js';

import { makeCache } from './cache.js';
import { analyticsPeriod, publicPeriod } from './analyticsPeriod.js';
import {
  clearInsightsRevenueCache,
  eventsRevenueForPeriod,
} from './insightsRevenue.js';
import { buildEventCourseComparison } from './trainingComparison.js';
import { asInstant, idOf, nameOf, text } from './events/normalize.js';
import { expireScheduleCaches } from './events/schedule.js';

/** Aggregates change by the day, not the minute, and cost far more to fetch. */
const slowCache = makeCache(10 * 60_000);

/** The analysis tab's definition of "in-person" — see the note above. */
const IN_PERSON_DOMAIN = [['attendance_method', '=', 'offline']];

function monthLabel(iso) {
  if (!iso) return 'بدون تاريخ';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'بدون تاريخ';
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(date);
}

const ANALYTICS_EVENT_FIELDS = [
  'name',
  'date_begin',
  'stage_id',
  'event_type',
  'attendance_method',
  'instructor_id',
  'seats_max',
];

const CONFIRMED_STATES = new Set(['open', 'done']);

async function registrationBreakdown(eventIds) {
  if (eventIds.length === 0) return [];
  return readGroup(
    'event.registration',
    [['event_id', 'in', eventIds]],
    ['event_id', 'state']
  );
}

function groupedCounts(rows) {
  const counts = new Map();
  for (const row of rows) {
    const eventId = idOf(row.event_id);
    if (!eventId) continue;
    const count = row.__count ?? 0;
    const current = counts.get(eventId) ?? {
      bookings: 0,
      interested: 0,
      attended: 0,
      cancelled: 0,
    };
    if (CONFIRMED_STATES.has(row.state)) current.bookings += count;
    if (row.state === 'draft') current.interested += count;
    if (row.state === 'done') current.attended += count;
    if (row.state === 'cancel') current.cancelled += count;
    counts.set(eventId, current);
  }
  return counts;
}

function tally(rows, label) {
  const counts = new Map();
  for (const row of rows) {
    const key = label(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, value]) => ({ label: name, value }))
    .sort((a, b) => b.value - a.value);
}

function eventKind(kind) {
  if (kind === 'individual') return 'أفراد';
  if (kind === 'company') return 'شركات';
  if (kind === 'private') return 'خاص';
  return 'مش محدد';
}

function eventMode(mode) {
  if (mode === 'online') return 'أونلاين';
  if (mode === 'offline') return 'حضوري';
  return 'مش محدد';
}

/** Pure shaping kept separate so the business counts can be verified without Odoo. */
export function buildEventsSnapshot(eventRows, registrationRows) {
  const registrations = groupedCounts(registrationRows);
  const events = eventRows.filter((row) => row.attendance_method === 'offline').map((row) => {
    const demand = registrations.get(row.id) ?? {
      bookings: 0,
      interested: 0,
      attended: 0,
      cancelled: 0,
    };
    const seats = row.seats_max || 0;
    return {
      id: row.id,
      name: text(row.name) ?? 'بدون اسم',
      startsAt: asInstant(row.date_begin),
      stage: nameOf(row.stage_id),
      kind: text(row.event_type),
      mode: text(row.attendance_method),
      instructor: nameOf(row.instructor_id),
      seats,
      ...demand,
      demand: demand.bookings + demand.interested,
      fillRate: seats > 0 ? Math.round((demand.bookings / seats) * 100) : null,
    };
  });

  const totals = events.reduce(
    (sum, event) => ({
      events: sum.events + 1,
      bookings: sum.bookings + event.bookings,
      interested: sum.interested + event.interested,
      attended: sum.attended + event.attended,
      cancelled: sum.cancelled + event.cancelled,
      seats: sum.seats + event.seats,
      // Occupancy is only meaningful where a capacity was actually entered.
      // Bookings on an event with no capacity must not inflate the numerator.
      capacityBookings: sum.capacityBookings + (event.seats > 0 ? event.bookings : 0),
      noBookings: sum.noBookings + (event.bookings === 0 ? 1 : 0),
      noDemand: sum.noDemand + (event.demand === 0 ? 1 : 0),
      withDemand: sum.withDemand + (event.demand > 0 ? 1 : 0),
    }),
    {
      events: 0,
      bookings: 0,
      interested: 0,
      attended: 0,
      cancelled: 0,
      seats: 0,
      capacityBookings: 0,
      noBookings: 0,
      noDemand: 0,
      withDemand: 0,
    }
  );

  const trend = new Map();
  for (const event of events) {
    const key = event.startsAt?.slice(0, 7) ?? 'unknown';
    const point = trend.get(key) ?? {
      key,
      label: monthLabel(event.startsAt),
      events: 0,
      bookings: 0,
      interested: 0,
    };
    point.events += 1;
    point.bookings += event.bookings;
    point.interested += event.interested;
    trend.set(key, point);
  }

  const demandOrder = (a, b) =>
    b.demand - a.demand || b.bookings - a.bookings || a.name.localeCompare(b.name, 'ar');
  const lowOrder = (a, b) =>
    a.demand - b.demand || a.bookings - b.bookings || a.name.localeCompare(b.name, 'ar');

  return {
    totals: {
      ...totals,
      fillRate: totals.seats > 0 ? Math.round((totals.capacityBookings / totals.seats) * 100) : null,
      demandRate: totals.events > 0 ? Math.round((totals.withDemand / totals.events) * 100) : null,
      confirmationRate:
        totals.bookings + totals.interested > 0
          ? Math.round((totals.bookings / (totals.bookings + totals.interested)) * 100)
          : null,
    },
    topDemand: [...events]
      .filter((event) => event.demand > 0)
      .sort((a, b) => b.bookings - a.bookings || b.interested - a.interested || demandOrder(a, b))
      .slice(0, 10),
    lowDemand: [...events].sort(lowOrder).slice(0, 10),
    allDemand: [...events].sort(demandOrder),
    byStage: tally(events, (event) => event.stage ?? 'بدون مرحلة'),
    byMode: tally(events, (event) => eventMode(event.mode)),
    byKind: tally(events, (event) => eventKind(event.kind)),
    byInstructor: tally(events, (event) => event.instructor ?? 'بدون مدرّب').slice(0, 10),
    trend: [...trend.values()].sort((a, b) => a.key.localeCompare(b.key)),
  };
}

/**
 * Demand and capacity over the exact event-start window chosen by the manager.
 * All fields pulled from event.event are stored; registrations are aggregated
 * in Postgres by event and state, so even a long window does not download every
 * attendee record into the workspace.
 */
export async function eventsAnalytics({ from, to } = {}) {
  if (!odooConfigured()) throw new OdooError('odoo_not_configured', 503);
  const period = analyticsPeriod({ from, to });

  return slowCache.get(`analytics:${period.from}:${period.to}`, async () => {
    const currentDomain = [
      ...IN_PERSON_DOMAIN,
      ['date_begin', '>=', period.fromOdoo],
      ['date_begin', '<', period.toOdooExclusive],
    ];
    const previousDomain = [
      ...IN_PERSON_DOMAIN,
      ['date_begin', '>=', period.previousFromOdoo],
      ['date_begin', '<', period.previousToOdooExclusive],
    ];

    // 2,500 comfortably covers the live catalogue while still protecting Odoo
    // from an accidental decade-wide unbounded read.
    const [currentEvents, previousEvents] = await Promise.all([
      searchRead('event.event', currentDomain, ANALYTICS_EVENT_FIELDS, {
        limit: 2500,
        order: 'date_begin',
      }),
      searchRead('event.event', previousDomain, ANALYTICS_EVENT_FIELDS, {
        limit: 2500,
        order: 'date_begin',
      }),
    ]);

    const [currentRegistrations, previousRegistrations] = await Promise.all([
      registrationBreakdown(currentEvents.map((event) => event.id)),
      registrationBreakdown(previousEvents.map((event) => event.id)),
    ]);
    const current = buildEventsSnapshot(currentEvents, currentRegistrations);
    const previous = buildEventsSnapshot(previousEvents, previousRegistrations);
    let revenue = null;
    let revenueError = null;
    try {
      revenue = await eventsRevenueForPeriod(period);
    } catch (error) {
      revenueError = error instanceof Error ? error.message : 'insights_unavailable';
    }

    return {
      period: { ...publicPeriod(period), basis: 'event_start' },
      current: current.totals,
      previous: previous.totals,
      topDemand: current.topDemand,
      lowDemand: current.lowDemand,
      comparison: revenue?.current
        ? buildEventCourseComparison(revenue.current.products, current.allDemand)
        : [],
      byStage: current.byStage,
      byMode: current.byMode,
      byKind: current.byKind,
      byInstructor: current.byInstructor,
      trend: current.trend,
      revenueAvailable: Boolean(revenue?.current && revenue?.previous),
      revenueError,
      currency: revenue?.currency ?? null,
      collectedCurrent: revenue?.current ?? null,
      collectedPrevious: revenue?.previous ?? null,
      revenueSource: revenue?.source ?? null,
      revenueStale: Boolean(revenue?.stale),
      fetchedAt: new Date().toISOString(),
    };
  });
}

/**
 * The Sync button. Expired rather than cleared: the next read goes to Odoo, but
 * if Odoo fails the last good answer is still there to fall back on.
 */
export function clearEventsCache() {
  slowCache.expire();
  expireScheduleCaches();
  clearInsightsRevenueCache();
}
