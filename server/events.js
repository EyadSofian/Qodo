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

import { OdooError, odooConfigured, searchRead } from './odoo.js';

const CACHE_MS = 60_000;
const cache = new Map();

async function cached(key, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

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
  'seats_taken',
  'seats_max',
  'address_id',
];

const TRACK_FIELDS = ['name', 'date', 'duration', 'event_id'];

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
    attendees: row.seats_taken || 0,
    seats: row.seats_max || 0,
  };
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
  };
}

const odooDate = (date) => date.toISOString().slice(0, 19).replace('T', ' ');

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

    // Sessions for the running courses, plus anything scheduled inside the
    // window — a course can have a lecture today while its stage still says
    // planned, and the person waiting for it does not care which.
    const courseIds = [...new Set([...running, ...upcoming].map((row) => row.id))];
    const tracks = courseIds.length
      ? await searchRead(
          'event.track',
          [
            '|',
            ['event_id', 'in', courseIds],
            '&',
            ['date', '>=', odooDate(now)],
            ['date', '<=', odooDate(horizon)],
          ],
          TRACK_FIELDS,
          { limit: 800, order: 'date' }
        )
      : [];

    const sessions = tracks.map(shapeTrack).filter((track) => track.at);
    const byCourse = new Map();
    for (const session of sessions) {
      if (!byCourse.has(session.eventId)) byCourse.set(session.eventId, []);
      byCourse.get(session.eventId).push(session);
    }

    const withProgress = (row) => {
      const course = shapeEvent(row);
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

    const nowMs = now.getTime();
    return {
      running: running.map(withProgress),
      upcoming: upcoming.map(withProgress),
      // Every lecture between now and midnight tonight, whichever course it
      // belongs to — this is the "who is on next" list.
      today: sessions
        .filter((session) => {
          const at = new Date(session.at).getTime();
          return at >= nowMs && at <= endOfToday(now);
        })
        .slice(0, 25),
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

/** Dropped whenever the shape of the answer changes, and by the refresh button. */
export function clearEventsCache() {
  cache.clear();
}
