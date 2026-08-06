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
      ? await searchRead('event.event', [['stage_id', 'in', runningIds]], EVENT_FIELDS, {
          limit: 60,
          order: 'date_begin',
        })
      : [];

    const upcoming = await searchRead(
      'event.event',
      [
        ['date_begin', '>', odooDate(now)],
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
    const [row] = await searchRead('event.event', [['id', '=', courseId]], EVENT_FIELDS, {
      limit: 1,
    });
    if (!row) throw new OdooError('course_not_found', 404);

    const tracks = await searchRead('event.track', [['event_id', '=', courseId]], TRACK_FIELDS, {
      limit: 300,
      order: 'date',
    });
    const sessions = tracks.map(shapeTrack);
    const now = Date.now();

    return {
      ...shapeEvent(row),
      sessions,
      sessionsTotal: sessions.length,
      sessionsLeft: sessions.filter((session) => session.at && new Date(session.at) >= now).length,
      nextSession: sessions.find((session) => session.at && new Date(session.at) >= now) ?? null,
    };
  });
}

/**
 * The numbers behind the analysis tab.
 *
 * Counted with `read_group`, which is Odoo doing the aggregation in Postgres
 * rather than us pulling a thousand rows across the wire to count them here.
 * That is the difference between a tab that opens and one that times out.
 */
export async function eventsAnalytics({ months = 6 } = {}) {
  if (!odooConfigured()) throw new OdooError('odoo_not_configured', 503);

  return slowCache.get(`analytics:${months}`, async () => {
    const stageList = await stages();
    const since = new Date();
    since.setMonth(since.getMonth() - months);

    const [byStage, byMode, byInstructor, byMonth] = await Promise.all([
      readGroup('event.event', [], ['stage_id']),
      readGroup('event.event', [['date_begin', '>=', odooDate(since)]], ['attendance_method']),
      readGroup('event.event', [
          ['date_begin', '>=', odooDate(since)],
          ['instructor_id', '!=', false],
        ], ['instructor_id']),
      readGroup('event.event', [['date_begin', '>=', odooDate(since)]], ['date_begin:month']),
    ]);

    const runningIds = stageList.filter((stage) => stage.running).map((stage) => stage.id);
    // Seats only mean something for courses that are actually selling, so the
    // fill rate is measured over the running ones rather than all 1,100.
    const running = runningIds.length
      ? await searchRead('event.event', [['stage_id', 'in', runningIds]], ['seats_max'], {
          limit: 200,
        })
      : [];

    const registrations = await registrationCounts(running.map((row) => row.id));
    const seatsTaken = [...registrations.values()].reduce((sum, count) => sum + count, 0);
    const seatsMax = running.reduce((sum, row) => sum + (row.seats_max || 0), 0);

    return {
      months,
      byStage: byStage
        .map((row) => ({ label: nameOf(row.stage_id) ?? 'بدون مرحلة', value: row.__count ?? 0 }))
        .sort((a, b) => b.value - a.value),
      byMode: byMode.map((row) => ({
        label: row.attendance_method === 'online' ? 'أونلاين' : row.attendance_method === 'offline' ? 'حضوري' : 'مش محدد',
        value: row.__count ?? 0,
      })),
      byInstructor: byInstructor
        .map((row) => ({ label: nameOf(row.instructor_id) ?? '—', value: row.__count ?? 0 }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 8),
      byMonth: byMonth.map((row) => ({
        label: arabicMonth(String(row['date_begin:month'] ?? '')),
        value: row.__count ?? 0,
      })),
      students: seatsTaken,
      seats: seatsMax,
      runningCount: running.length,
    };
  });
}

/** Dropped whenever the shape of the answer changes, and by the refresh button. */
export function clearEventsCache() {
  cache.clear();
  slowCache.clear();
}
