/**
 * The Training Schedule — Odoo's courses as the operations sheet lays them out.
 *
 * The workbook this replaces has a tab per department, an archive per
 * department, an English round and a webinar list. Here they are one model and
 * one query per date range; the tabs are presets the browser applies to rows it
 * already has. Odoo remains the only source of truth and nothing here writes to
 * it.
 *
 * Sizes are bounded everywhere. The schedule accepts at most ~6 months per
 * request, the archive one year per request and pages of it at that, and every
 * read carries a hard limit — there are over a thousand courses and an
 * unscoped `event.event` read is how this workspace gets throttled.
 */

import { OdooError, fieldsOf, odooConfigured, odooRecordUrl, readGroup, searchRead } from '../odoo.js';
import { makeCache } from '../cache.js';
import { ARCHIVE_STATUSES, asInstant, idOf, joinUrl, nameOf } from './normalize.js';
import { clearSchemaCache, eventSchema } from './schema.js';
import { loadScheduleRows, readStages } from './reader.js';

/** The real Odoo. Tests pass their own `{ searchRead, readGroup, fieldsOf }`. */
const odooClient = { searchRead, readGroup, fieldsOf };

const fastCache = makeCache(60_000);
/** History changes by the day and costs more to assemble. */
const archiveCache = makeCache(10 * 60_000);

const DAY_MS = 86_400_000;
/** Riyadh has no daylight saving: its day boundaries are a fixed UTC+3. */
const KSA_OFFSET_MS = 3 * 3_600_000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const SCHEDULE_DEFAULT_DAYS = 90;
export const SCHEDULE_MAX_DAYS = 186;
export const ARCHIVE_MAX_DAYS = 366;
export const ARCHIVE_PAGE_SIZE = 200;
const SCHEDULE_EVENT_LIMIT = 1500;
const SCHEDULE_TRACK_LIMIT = 15_000;
const ARCHIVE_TRACK_LIMIT = 8000;

export class ScheduleRangeError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const odooStamp = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

function parseDay(value) {
  if (!DATE_ONLY.test(String(value ?? ''))) return null;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isNaN(ms) || isoDay(ms) !== value ? null : ms;
}

/** Today's date as the operations team reads it — on Riyadh's calendar. */
export function ksaToday(now = new Date()) {
  return isoDay(now.getTime() + KSA_OFFSET_MS);
}

/**
 * A date-only window, read as whole KSA days, turned into the naive-UTC bounds
 * Odoo compares against. Rejected rather than clamped when it is too long: a
 * silently shortened range is a schedule that quietly leaves courses out.
 */
export function resolveRange({ from, to } = {}, { now = new Date(), defaultDays = SCHEDULE_DEFAULT_DAYS, maxDays = SCHEDULE_MAX_DAYS } = {}) {
  const today = parseDay(ksaToday(now));
  const fromMs = from ? parseDay(from) : today;
  const toMs = to ? parseDay(to) : (fromMs ?? today) + (defaultDays - 1) * DAY_MS;
  if (fromMs === null || toMs === null || fromMs > toMs) throw new ScheduleRangeError('invalid_schedule_range');
  const days = Math.round((toMs - fromMs) / DAY_MS) + 1;
  if (days > maxDays) throw new ScheduleRangeError('schedule_range_too_long');
  return {
    from: isoDay(fromMs),
    to: isoDay(toMs),
    days,
    maxDays,
    fromOdoo: odooStamp(fromMs - KSA_OFFSET_MS),
    toOdooExclusive: odooStamp(toMs + DAY_MS - KSA_OFFSET_MS),
  };
}

/** Midnight-to-midnight today on a named zone's clock, as UTC instants. */
export function zonedDayBounds(now, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  const wallAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  const offset = Math.round((wallAsUtc - now.getTime()) / 60_000) * 60_000;
  const start = Date.UTC(+parts.year, +parts.month - 1, +parts.day) - offset;
  return { start, end: start + DAY_MS, date: `${parts.year}-${parts.month}-${parts.day}` };
}

function requireOdoo(client) {
  if (client === odooClient && !odooConfigured()) throw new OdooError('odoo_not_configured', 503);
}

/**
 * A field this reader asked for that Odoo no longer has fails the whole query.
 * That means the schema cache is out of date — a module was upgraded under us —
 * so it is dropped and the caller gets an honest error, and the next request
 * rediscovers the fields rather than failing the same way forever.
 */
async function guarded(load) {
  try {
    return await load();
  } catch (error) {
    if (error instanceof OdooError && /invalid field|does not exist|unknown field|keyerror/i.test(error.message)) {
      clearSchemaCache();
      throw new OdooError('odoo_schema_changed', 502);
    }
    throw error;
  }
}

async function context(client) {
  const [schema, stages] = await Promise.all([eventSchema(client), fastCache.get('stages', () => readStages(client))]);
  return { schema, stages };
}

const distinct = (values) =>
  [...new Set(values.filter((value) => typeof value === 'string' && value))].sort((a, b) => a.localeCompare(b));

function discoveredFields(schema) {
  return Object.fromEntries(
    Object.entries(schema.concepts).map(([concept, found]) => [
      concept,
      found ? (found.type === 'boolean_set' ? found.fields.map((f) => f.field).join(',') : found.field) : null,
    ])
  );
}

/** Facets for the filter menus, from exactly the rows returned. */
function metaFor(rows, schema, extra) {
  return {
    ...extra,
    availableDepartments: distinct(rows.map((row) => row.department)),
    availableSections: distinct(rows.map((row) => row.section)),
    availablePackages: distinct(rows.map((row) => row.package)),
    availableStatuses: distinct(rows.map((row) => row.statusCanonical)),
    availableStages: distinct(rows.map((row) => row.status)),
    availableTypes: distinct(rows.map((row) => row.trainingType)),
    availableInstructors: distinct(rows.map((row) => row.instructor)),
    availableCoordinators: distinct(rows.map((row) => row.coordinator)),
    discoveredFields: discoveredFields(schema),
    missingFields: schema.coreMissing,
    capacityRuleSource: schema.concepts.minimumCapacity ? 'odoo' : null,
  };
}

/**
 * Every course whose dates overlap the window, online and offline alike — the
 * operations sheet mixes Group Online, Group Offline, Private and Company on
 * one tab, so the old offline-only filter would hide most of it. Finished and
 * cancelled courses inside the window are included and the page hides them by
 * default; the Archive is where history is browsed.
 */
export async function trainingSchedule(query = {}, { now = new Date(), client = odooClient } = {}) {
  const range = resolveRange(query, { now });
  requireOdoo(client);
  return fastCache.get(`schedule:${range.from}:${range.to}`, () =>
    guarded(async () => {
      const { schema, stages } = await context(client);
      const { rows, eventsTruncated, sessionsTruncated } = await loadScheduleRows(client, {
        schema,
        stages,
        domain: [
          ['date_begin', '<', range.toOdooExclusive],
          ['date_end', '>=', range.fromOdoo],
        ],
        limit: SCHEDULE_EVENT_LIMIT,
        trackLimit: SCHEDULE_TRACK_LIMIT,
        now,
      });
      const warnings = [...schema.warnings];
      if (eventsTruncated) warnings.push('events_truncated');
      if (sessionsTruncated) warnings.push('sessions_truncated');
      return {
        rows,
        meta: metaFor(rows, schema, {
          from: range.from,
          to: range.to,
          days: range.days,
          maxDays: range.maxDays,
          warnings,
        }),
        fetchedAt: new Date().toISOString(),
      };
    })
  );
}

/**
 * History: courses that started inside one year (or a custom ≤ 366-day range)
 * and are closed — a finished, cancelled, refused or on-hold stage — or have
 * simply ended. The second half catches the courses nobody moved out of
 * "Planned" in Odoo, which are history all the same.
 *
 * Paged, because a year is several hundred courses with a dozen lectures
 * each. The optional `q` narrows by name or code in Odoo before paging, so a
 * search reaches courses beyond the first page.
 */
export async function trainingArchive(query = {}, { now = new Date(), client = odooClient } = {}) {
  const year = query.year ? Number(query.year) : null;
  const currentYear = new Date(now.getTime() + KSA_OFFSET_MS).getUTCFullYear();
  if (year !== null && (!Number.isInteger(year) || year < 2015 || year > currentYear + 1)) {
    throw new ScheduleRangeError('invalid_archive_year');
  }
  const range =
    year !== null
      ? resolveRange({ from: `${year}-01-01`, to: `${year}-12-31` }, { now, maxDays: ARCHIVE_MAX_DAYS })
      : resolveRange(
          query.from || query.to
            ? query
            : { from: `${currentYear}-01-01`, to: ksaToday(now) },
          { now, maxDays: ARCHIVE_MAX_DAYS }
        );
  const page = Math.max(0, Math.min(Number.parseInt(query.page, 10) || 0, 50));
  const search = typeof query.q === 'string' ? query.q.trim().slice(0, 80) : '';
  requireOdoo(client);

  return archiveCache.get(`archive:${range.from}:${range.to}:${page}:${search}`, () =>
    guarded(async () => {
      const { schema, stages } = await context(client);
      const closedIds = stages.filter((stage) => ARCHIVE_STATUSES.has(stage.canonical)).map((stage) => stage.id);
      const nowOdoo = odooStamp(now.getTime());
      const domain = [
        ['date_begin', '>=', range.fromOdoo],
        ['date_begin', '<', range.toOdooExclusive],
        ...(closedIds.length ? ['|', ['stage_id', 'in', closedIds], ['date_end', '<', nowOdoo]] : [['date_end', '<', nowOdoo]]),
        ...(search ? ['|', ['name', 'ilike', search], ['code', 'ilike', search]] : []),
      ];
      const { rows, eventsTruncated, sessionsTruncated } = await loadScheduleRows(client, {
        schema,
        stages,
        domain,
        limit: ARCHIVE_PAGE_SIZE,
        offset: page * ARCHIVE_PAGE_SIZE,
        order: 'date_begin desc',
        trackLimit: ARCHIVE_TRACK_LIMIT,
        now,
      });
      const warnings = [...schema.warnings];
      if (sessionsTruncated) warnings.push('sessions_truncated');
      return {
        rows,
        meta: metaFor(rows, schema, {
          from: range.from,
          to: range.to,
          days: range.days,
          maxDays: range.maxDays,
          year,
          page,
          pageSize: ARCHIVE_PAGE_SIZE,
          hasMore: eventsTruncated,
          search: search || null,
          warnings,
        }),
        fetchedAt: new Date().toISOString(),
      };
    })
  );
}

/**
 * Every lecture on today's calendar, online and in person.
 *
 * Today is Cairo's day, the same boundary the workspace has always used — the
 * company is in Cairo, and a lecture at 11pm Cairo is still today to everyone
 * reading this whatever zone the server runs in. The join-link fields are
 * computed in Odoo (2.5s per 300 rows), which is fine for a day's couple of
 * dozen lectures and why they are read here and in the detail panel only.
 */
export async function todaySessions({ now = new Date(), client = odooClient } = {}) {
  requireOdoo(client);
  const day = zonedDayBounds(now, 'Africa/Cairo');
  return fastCache.get(`today:${day.date}`, () =>
    guarded(async () => {
      const { schema, stages } = await context(client);
      const todayTracks = await client.searchRead(
        'event.track',
        [
          ['date', '>=', odooStamp(day.start)],
          ['date', '<', odooStamp(day.end)],
        ],
        [...schema.trackReadFields, ...schema.zoomFields],
        { limit: 200, order: 'date, id' }
      );
      const eventIds = [...new Set(todayTracks.map((track) => idOf(track.event_id)).filter(Boolean))];
      // The course rows, with all of their lectures, so "Session 8 of 12" is
      // counted the same way the schedule counts it — one query, not one per course.
      const { rows } = eventIds.length
        ? await loadScheduleRows(client, {
            schema,
            stages,
            domain: [['id', 'in', eventIds]],
            limit: eventIds.length,
            trackLimit: 4000,
            now,
          })
        : { rows: [] };
      const byId = new Map(rows.map((row) => [row.id, row]));

      const sessions = todayTracks
        .map((track) => {
          const row = byId.get(idOf(track.event_id));
          const startsAt = asInstant(track.date);
          if (!startsAt) return null;
          const numbered = row?.sessions.find((session) => session.id === track.id);
          const link = joinUrl(track);
          const online = row?.deliveryMode === 'online';
          return {
            id: track.id,
            number: numbered?.number ?? null,
            totalSessions: row?.sessionsTotal ?? null,
            lectureCount: row?.lectureCount ?? null,
            name: numbered?.name ?? null,
            startsAt,
            endsAt: numbered?.endsAt ?? null,
            durationHours: numbered?.durationHours ?? 0,
            joinUrl: link,
            // Unknown, not false, when this Odoo has no Zoom status field.
            meetingReady: schema.zoomFields.includes('zoom_status') ? track.zoom_status === 'created' : null,
            zoomExpected: online,
            event: {
              id: idOf(track.event_id),
              courseName: row?.courseName ?? nameOf(track.event_id),
              courseCode: row?.courseCode ?? null,
              instructor: row?.instructor ?? null,
              trainingType: row?.trainingType ?? null,
              deliveryMode: row?.deliveryMode ?? null,
              location: row?.location ?? null,
              department: row?.department ?? null,
              statusCanonical: row?.statusCanonical ?? null,
            },
          };
        })
        .filter(Boolean);

      return { date: day.date, sessions, fetchedAt: new Date().toISOString() };
    })
  );
}

/**
 * One course with everything the drawer shows: the canonical row, the full
 * registration breakdown, and each lecture with its joining link. Not limited
 * to in-person courses any more — the schedule lists online ones, so a click on
 * one has to open.
 */
export async function eventDetail(id, { now = new Date(), client = odooClient } = {}) {
  const eventId = Number(id);
  if (!Number.isInteger(eventId) || eventId <= 0) throw new OdooError('invalid_course', 400);
  requireOdoo(client);

  return fastCache.get(`detail:${eventId}`, () =>
    guarded(async () => {
      const { schema, stages } = await context(client);
      const { rows, tracksByEvent } = await loadScheduleRows(client, {
        schema,
        stages,
        domain: [['id', '=', eventId]],
        limit: 1,
        trackLimit: 400,
        trackFields: [...schema.trackReadFields, ...schema.zoomFields],
        now,
      });
      const [row] = rows;
      if (!row) throw new OdooError('course_not_found', 404);

      const raw = new Map((tracksByEvent.get(eventId) ?? []).map((track) => [track.id, track]));
      const zoomStatusKnown = schema.zoomFields.includes('zoom_status');
      const sessions = row.sessions.map((session) => {
        const track = raw.get(session.id) ?? {};
        return {
          ...session,
          joinUrl: joinUrl(track),
          meetingReady: zoomStatusKnown ? track.zoom_status === 'created' : null,
        };
      });
      const soon = sessions.find(
        (session) =>
          session.startsAt &&
          new Date(session.startsAt).getTime() >= now.getTime() &&
          new Date(session.startsAt).getTime() < now.getTime() + 2 * DAY_MS
      );
      const qualityFlags = [...row.qualityFlags];
      if (row.deliveryMode === 'online' && soon && !soon.joinUrl && schema.zoomFields.length) qualityFlags.push('zoom_missing');

      return {
        course: { ...row, sessions, qualityFlags },
        odooUrl: odooRecordUrl('event.event', eventId),
        fetchedAt: new Date().toISOString(),
      };
    })
  );
}

/**
 * What the schema discovery found, for whoever maintains the integration.
 * Field names and labels only — no records, no credentials, no URL.
 */
export async function scheduleDiagnostics({ client = odooClient } = {}) {
  requireOdoo(client);
  const { schema, stages } = await context(client);
  return {
    coreFields: { requested: schema.eventReadFields, missing: schema.coreMissing },
    trackFields: { read: schema.trackReadFields, zoom: schema.zoomFields, missing: schema.trackMissing },
    concepts: schema.concepts,
    candidates: schema.candidates,
    selections: schema.selections,
    stages: stages.map(({ id, name, running, finished, canonical }) => ({ id, name, running, finished, canonical })),
    warnings: schema.warnings,
    overrideVariable: 'ODOO_EVENT_FIELD_MAP',
  };
}

/** Sync: fetch fresh next time, but keep the last good answer for a failure. */
export function expireScheduleCaches() {
  fastCache.expire();
  archiveCache.expire();
  clearSchemaCache();
}


/** Forget everything, including the fallback. For tests and schema resets only. */
export function clearScheduleCaches() {
  fastCache.clear();
  archiveCache.clear();
  clearSchemaCache();
}
