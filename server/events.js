/**
 * Courses, read out of Odoo and reshaped into what a person actually asks.
 *
 * Odoo's own kanban answers "what records exist". The three questions people
 * ask about training are different: what is running right now, what is on
 * today, and what starts next. Everything here exists to answer those without
 * the reader having to know that a course is an `event.event`, a lecture is an
 * `event.track`, and "In Progress" is a stage with a boolean on it.
 *
 * Two things are load-bearing and easy to get wrong:
 *
 * **Time.** Odoo stores and returns naive UTC strings (`2026-08-06 06:00:00`)
 * with no zone marker at all. Handing one of those to `new Date()` in a browser
 * makes it local time, which in Cairo puts every lecture two hours early. They
 * are stamped as UTC here, once, so nothing downstream has to remember.
 *
 * **Size.** There are over a thousand courses. Every query is scoped by stage
 * or date and capped, and the whole answer is cached briefly — a board that
 * asks Odoo for a thousand records each time somebody opens a tab is a board
 * that gets the workspace throttled.
 */

import { OdooError, odooConfigured, readGroup, searchRead } from './odoo.js';

import { makeCache } from './cache.js';
import { analyticsPeriod, publicPeriod } from './analyticsPeriod.js';
import {
  clearInsightsRevenueCache,
  eventsRevenueForPeriod,
} from './insightsRevenue.js';
import { buildEventCourseComparison } from './trainingComparison.js';

const cache = makeCache(60_000);
/** Aggregates change by the day, not the minute, and cost far more to fetch. */
const slowCache = makeCache(10 * 60_000);

const cached = (key, load) => cache.get(key, load);

/** Odoo hands back naive UTC; anything downstream deserves a real instant. */
const asInstant = (value) =>
  typeof value === 'string' && value.length >= 19 ? `${value.replace(' ', 'T')}Z` : null;

/** `[id, "Name"]` is Odoo's many2one shape, and `false` is its null. */
const nameOf = (pair) => (Array.isArray(pair) ? pair[1] : null);
const idOf = (pair) => (Array.isArray(pair) ? pair[0] : null);
const text = (value) => (typeof value === 'string' && value ? value : null);
const IN_PERSON_DOMAIN = [['attendance_method', '=', 'offline']];

const EVENT_FIELDS = [
  'name',
  'code',
  'date_begin',
  'date_end',
  'stage_id',
  'event_type',
  'attendance_method',
  'if_offline',
  'headquarter',
  'instructor_id',
  'total_lectures_number',
  'session_duration',
  // `seats_taken` is deliberately absent. It is a *computed, non-stored* field:
  // reading it makes Odoo count registrations per course in Python, which
  // measured 18 seconds for fifteen courses against this database. The same
  // number comes out of `registrationCounts` below in about one second, because
  // counting rows in a real table is what Postgres is for. `seats_max` is an
  // ordinary stored column and stays.
  'seats_max',
  'address_id',
];

/** Enough to place a lecture on a calendar. Cheap: all stored columns. */
const TRACK_FIELDS = ['name', 'date', 'duration', 'event_id'];

/** Today's rows only — everything above plus the computed joining link. */
const TODAY_FIELDS = [
  ...TRACK_FIELDS,
  // The Zoom integration spreads the joining link over several fields and then
  // names the winner in `join_live_url_source`. All of them are read because
  // the resolved one is empty more often than the raw ones are.
  'active_join_live_url',
  'zoom_join_link',
  'meeting_url',
  'zoom_link',
  'zoom_status',
];

/**
 * The link somebody actually clicks to get into the lecture.
 *
 * `active_join_live_url` is Odoo's own answer and is preferred, but it resolves
 * through `join_live_url_source` to a field that is frequently blank — a track
 * can carry a perfectly good `zoom_join_link` while the source points at an
 * empty `meeting_url`. So the raw fields are the fallback, in the order the
 * integration fills them.
 *
 * The protocol is checked because this ends up in an `href`: a `javascript:`
 * value arriving from an upstream system is the same stored XSS as one typed by
 * a user, and "it came from Odoo" is not a security boundary.
 */
function joinUrl(row) {
  const candidates = [
    row.active_join_live_url,
    row.zoom_join_link,
    row.meeting_url,
    row.zoom_link,
  ];
  for (const value of candidates) {
    if (typeof value !== 'string' || !value.trim()) continue;
    try {
      const url = new URL(value.trim());
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
    } catch {
      // Not a URL at all — try the next field.
    }
  }
  return null;
}

/**
 * The stage table, which is small, static and the only way to know which stage
 * means "running" without hard-coding an id that differs per database.
 */
async function stages() {
  return cached('stages', async () => {
    const rows = await searchRead(
      'event.stage',
      [],
      ['name', 'sequence', 'pipe_end', 'inprogress'],
      { order: 'sequence' }
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      running: Boolean(row.inprogress),
      finished: Boolean(row.pipe_end),
    }));
  });
}

function shapeEvent(row) {
  return {
    id: row.id,
    code: text(row.code),
    name: text(row.name) ?? 'بدون اسم',
    startsAt: asInstant(row.date_begin),
    endsAt: asInstant(row.date_end),
    stageId: idOf(row.stage_id),
    stage: nameOf(row.stage_id),
    kind: text(row.event_type),
    // `online` / `offline`, and when offline whether it is a branch or the
    // client's own premises. The page turns this into one readable phrase.
    mode: text(row.attendance_method),
    offlineKind: text(row.if_offline),
    branch: text(row.headquarter),
    venue: nameOf(row.address_id),
    instructor: nameOf(row.instructor_id),
    plannedSessions: row.total_lectures_number || 0,
    sessionHours: row.session_duration || 0,
    // Filled in by the caller from `registrationCounts` — see EVENT_FIELDS.
    attendees: 0,
    seats: row.seats_max || 0,
  };
}

/**
 * How many people are registered on each of these courses.
 *
 * One grouped count over `event.registration` rather than reading the computed
 * `seats_taken` off every course. Cancelled registrations are excluded, which is
 * what "taken" is supposed to mean.
 */
async function registrationCounts(eventIds) {
  if (eventIds.length === 0) return new Map();
  const rows = await readGroup(
    'event.registration',
    [
      ['event_id', 'in', eventIds],
      ['state', 'in', ['open', 'done']],
    ],
    ['event_id']
  );
  return new Map(rows.map((row) => [idOf(row.event_id), row.__count ?? 0]));
}

function shapeTrack(row) {
  return {
    id: row.id,
    // Sessions are generated as "<course> / Session 3"; the course name is
    // already on the card, so only the tail is worth showing.
    name: text(row.name)?.split(' / ').pop() ?? null,
    at: asInstant(row.date),
    hours: row.duration || 0,
    eventId: idOf(row.event_id),
    eventName: nameOf(row.event_id),
    joinUrl: joinUrl(row),
    // `not_created` means the meeting does not exist in Zoom yet, which is a
    // coordinator's job rather than a bug — the page says so instead of showing
    // a dead button.
    meetingReady: row.zoom_status === 'created',
  };
}

const odooDate = (date) => date.toISOString().slice(0, 19).replace('T', ' ');

/**
 * Odoo groups dates into English labels ("February 2026") regardless of the
 * caller's language, because the grouping happens in SQL rather than through a
 * translated field. The column chart has room for a short month and nothing
 * else, so the year is dropped too.
 */
const MONTHS_AR = {
  january: 'يناير',
  february: 'فبراير',
  march: 'مارس',
  april: 'أبريل',
  may: 'مايو',
  june: 'يونيو',
  july: 'يوليو',
  august: 'أغسطس',
  september: 'سبتمبر',
  october: 'أكتوبر',
  november: 'نوفمبر',
  december: 'ديسمبر',
};

function arabicMonth(label) {
  const [month] = label.split(' ');
  return MONTHS_AR[month?.toLowerCase()] ?? label ?? '—';
}

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

/**
 * Everything the courses page needs, in one answer.
 *
 * One call rather than three because the three lists share the same sessions
 * lookup: "what is on today" and "when is the next lecture of this course" are
 * the same query read two ways, and asking Odoo twice for it would be the
 * slowest part of the page.
 */
export async function coursesOverview({ days = 14 } = {}) {
  if (!odooConfigured()) throw new OdooError('odoo_not_configured', 503);

  return cached(`overview:${days}`, async () => {
    const stageList = await stages();
    const runningIds = stageList.filter((stage) => stage.running).map((stage) => stage.id);
    const finishedIds = stageList.filter((stage) => stage.finished).map((stage) => stage.id);
    const now = new Date();
    const horizon = new Date(now.getTime() + days * 86_400_000);

    // Deliberately by stage id rather than `stage_id.inprogress`: the dotted
    // form makes Odoo join across a thousand rows and it times out.
    const running = runningIds.length
      ? await searchRead('event.event', [...IN_PERSON_DOMAIN, ['stage_id', 'in', runningIds]], EVENT_FIELDS, {
          limit: 60,
          order: 'date_begin',
        })
      : [];

    const upcoming = await searchRead(
      'event.event',
      [
        ...IN_PERSON_DOMAIN,
        ['date_begin', '>', odooDate(now)],
        ['date_begin', '<=', odooDate(horizon)],
        ['stage_id', 'not in', [...runningIds, ...finishedIds]],
      ],
      EVENT_FIELDS,
      { limit: 40, order: 'date_begin' }
    );

    /*
     * Two narrow queries rather than one broad one, and the reason is cost.
     *
     * The join link lives in computed fields — reading `active_join_live_url`
     * makes Odoo resolve it per row, measured at 2.5s per 300 tracks — so it is
     * asked for only over today, which is a couple of dozen rows. Progress on a
     * running course needs dates and nothing else, and an upcoming course needs
     * no sessions at all: its `total_lectures_number` already says how many are
     * planned, and none of them have happened.
     *
     * The single wide query these replace pulled every session of all 55
     * courses with the computed fields attached, and did not return inside 45
     * seconds.
     */
    const runningCourseIds = running.map((row) => row.id);
    const [scheduleRows, todayRows] = await Promise.all([
      runningCourseIds.length
        ? searchRead('event.track', [['event_id', 'in', runningCourseIds]], TRACK_FIELDS, {
            limit: 600,
            order: 'date',
          })
        : [],
      searchRead(
        'event.track',
        [
          ['event_id.attendance_method', '=', 'offline'],
          ['date', '>=', odooDate(now)],
          ['date', '<=', odooDate(new Date(endOfToday(now)))],
        ],
        TODAY_FIELDS,
        { limit: 60, order: 'date' }
      ),
    ]);

    const sessions = scheduleRows.map(shapeTrack).filter((track) => track.at);
    const byCourse = new Map();
    for (const session of sessions) {
      if (!byCourse.has(session.eventId)) byCourse.set(session.eventId, []);
      byCourse.get(session.eventId).push(session);
    }

    const registrations = await registrationCounts([...new Set([...running, ...upcoming].map((r) => r.id))]);

    const withProgress = (row) => {
      const course = { ...shapeEvent(row), attendees: registrations.get(row.id) ?? 0 };
      const all = byCourse.get(course.id) ?? [];
      const remaining = all.filter((session) => new Date(session.at) >= now);
      return {
        ...course,
        // Counted from the schedule rather than a stored number, so a course
        // whose lectures were rescheduled still reports honestly.
        sessionsTotal: all.length || course.plannedSessions,
        sessionsLeft: remaining.length,
        nextSession: remaining[0] ?? null,
      };
    };

    return {
      running: running.map(withProgress),
      upcoming: upcoming.map(withProgress),
      // Every lecture between now and midnight tonight, whichever course it
      // belongs to — this is the "who is on next" list, and the only one that
      // carries a joining link.
      today: todayRows.map(shapeTrack).filter((session) => session.at),
      stages: stageList,
      fetchedAt: new Date().toISOString(),
    };
  });
}

/**
 * Midnight tonight in Cairo, expressed as a UTC instant.
 *
 * The workspace is one company in one city, so the day boundary that matters is
 * Cairo's rather than the server's — a lecture at 11pm Cairo is still today to
 * everyone reading this, whatever zone Railway happens to run in.
 */
function endOfToday(now) {
  const cairo = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
  const drift = now.getTime() - cairo.getTime();
  cairo.setHours(23, 59, 59, 999);
  return cairo.getTime() + drift;
}

/** One course, with its whole schedule — what the detail panel opens on. */
export async function courseDetail(id) {
  if (!odooConfigured()) throw new OdooError('odoo_not_configured', 503);
  const courseId = Number(id);
  if (!Number.isInteger(courseId)) throw new OdooError('invalid_course', 400);

  return cached(`course:${courseId}`, async () => {
    const [row] = await searchRead('event.event', [...IN_PERSON_DOMAIN, ['id', '=', courseId]], EVENT_FIELDS, {
      limit: 1,
    });
    if (!row) throw new OdooError('course_not_found', 404);

    const [tracks, attendeeCounts] = await Promise.all([
      searchRead('event.track', [['event_id', '=', courseId]], TRACK_FIELDS, {
        limit: 300,
        order: 'date',
      }),
      registrationCounts([courseId]),
    ]);
    const sessions = tracks.map(shapeTrack);
    const now = Date.now();

    return {
      ...shapeEvent(row),
      attendees: attendeeCounts.get(courseId) ?? 0,
      sessions,
      sessionsTotal: sessions.length,
      sessionsLeft: sessions.filter((session) => session.at && new Date(session.at) >= now).length,
      nextSession: sessions.find((session) => session.at && new Date(session.at) >= now) ?? null,
    };
  });
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

/** Dropped whenever the shape of the answer changes, and by the refresh button. */
export function clearEventsCache() {
  cache.clear();
  slowCache.clear();
  clearInsightsRevenueCache();
}
