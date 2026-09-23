import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEventsSnapshot } from './events.js';
import { OdooError } from './odoo.js';
import {
  asInstant,
  buildScheduleRow,
  canonicalStatus,
  classifyDepartment,
  dayPartOf,
  joinUrl,
  normalizeType,
  orderSessions,
  parseWeekdayText,
  registrationCounts,
} from './events/normalize.js';
import { CORE_EVENT_FIELDS, parseFieldOverride, resolveEventSchema } from './events/schema.js';
import { loadScheduleRows, readStages } from './events/reader.js';
import {
  clearScheduleCaches,
  eventDetail,
  expireScheduleCaches,
  resolveRange,
  todaySessions,
  trainingArchive,
  trainingSchedule,
  zonedDayBounds,
} from './events/schedule.js';
import { failureFor } from './routes/events.js';
import { buildDefaultLayout, isHiddenInSchedule, updatePackage } from '../shared/eventsLayout.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ── a fake Odoo that counts what it is asked ────────────────────── */

const NOW = new Date('2026-09-22T12:00:00Z');

const coreFieldsMeta = Object.fromEntries(
  CORE_EVENT_FIELDS.map((name) => [name, { string: name, type: 'char', store: true }])
);
coreFieldsMeta.event_type = {
  string: 'Event Type',
  type: 'selection',
  store: true,
  selection: [
    ['individual', 'Individual'],
    ['company', 'Company'],
    ['private', 'Private'],
  ],
};
const trackFieldsMeta = {
  name: { type: 'char' },
  date: { type: 'datetime' },
  duration: { type: 'float' },
  event_id: { type: 'many2one' },
  zoom_join_link: { type: 'char', store: false },
  zoom_status: { type: 'selection', store: false },
};

const STAGES = [
  { id: 1, name: 'Planned', sequence: 1, inprogress: false, pipe_end: false },
  { id: 2, name: 'In Progress', sequence: 2, inprogress: true, pipe_end: false },
  { id: 3, name: 'Finished', sequence: 3, inprogress: false, pipe_end: true },
  { id: 4, name: 'Cancelled', sequence: 4, inprogress: false, pipe_end: true },
];

function evaluate(domain, row) {
  const stack = [];
  for (let i = domain.length - 1; i >= 0; i -= 1) {
    const term = domain[i];
    if (term === '|' || term === '&') {
      const a = stack.pop();
      const b = stack.pop();
      stack.push(term === '|' ? a || b : a && b);
      continue;
    }
    const [field, op, value] = term;
    const raw = row[field];
    const actual = Array.isArray(raw) ? raw[0] : raw;
    let result;
    if (op === '=') result = actual === value;
    else if (op === 'in') result = value.includes(actual);
    else if (op === 'not in') result = !value.includes(actual);
    else if (op === '<') result = actual < value;
    else if (op === '>=') result = actual >= value;
    else if (op === '>') result = actual > value;
    else if (op === 'ilike') result = String(actual ?? '').toLowerCase().includes(String(value).toLowerCase());
    else throw new Error(`unsupported op ${op}`);
    stack.push(result);
  }
  return stack.every(Boolean);
}

function fakeOdoo({ events = [], tracks = [], registrations = [], groups = [], eventFields = coreFieldsMeta, fail = false } = {}) {
  const calls = [];
  const guard = () => {
    if (client.fail) throw new OdooError('odoo_timeout');
  };
  const client = {
    calls,
    fail,
    async fieldsOf(model) {
      calls.push({ kind: 'fields_get', model });
      guard();
      return model === 'event.event' ? eventFields : trackFieldsMeta;
    },
    async searchRead(model, domain, fields, options = {}) {
      calls.push({ kind: 'search_read', model, domain, fields, options });
      guard();
      const source =
        { 'event.stage': STAGES, 'event.event': events, 'event.track': tracks, 'training.package.group': groups }[
          model
        ] ?? [];
      const matched = source.filter((row) => evaluate(domain, row));
      const [orderField, direction] = String(options.order ?? '').split(/[ ,]+/);
      if (orderField) {
        matched.sort((a, b) => String(a[orderField]).localeCompare(String(b[orderField])) * (direction === 'desc' ? -1 : 1));
      }
      const offset = options.offset ?? 0;
      return matched.slice(offset, options.limit ? offset + options.limit : undefined);
    },
    async readGroup(model, domain) {
      calls.push({ kind: 'read_group', model, domain });
      guard();
      const ids = domain[0][2];
      return registrations.filter((group) => ids.includes(group.event_id[0]));
    },
  };
  return client;
}

const event = (id, overrides = {}) => ({
  id,
  name: `Course ${id}`,
  code: String(5500 + id),
  date_begin: '2026-09-14 16:00:00',
  date_end: '2026-10-05 19:00:00',
  stage_id: [2, 'In Progress'],
  event_type: 'individual',
  attendance_method: 'online',
  if_offline: false,
  headquarter: false,
  instructor_id: [9, 'Micheal Adel'],
  total_lectures_number: 3,
  session_duration: 3,
  seats_max: 50,
  address_id: false,
  ...overrides,
});

const track = (id, eventId, date, overrides = {}) => ({
  id,
  name: `Course ${eventId} / Session ${overrides.n ?? id}`,
  date,
  duration: 3,
  event_id: [eventId, `Course ${eventId}`],
  ...overrides,
});

/* ── time ────────────────────────────────────────────────────────── */

test('naive Odoo UTC becomes a real instant, and garbage becomes null', () => {
  assert.equal(asInstant('2026-08-06 06:00:00'), '2026-08-06T06:00:00Z');
  assert.equal(asInstant('2026-08-06 06:00:00.123'), '2026-08-06T06:00:00Z');
  assert.equal(asInstant(false), null);
  assert.equal(asInstant('06:00'), null);
});

test('schedule ranges are whole KSA days, bounded, and rejected rather than clamped', () => {
  const range = resolveRange({ from: '2026-09-01', to: '2026-09-30' }, { now: NOW });
  assert.equal(range.fromOdoo, '2026-08-31 21:00:00');
  assert.equal(range.toOdooExclusive, '2026-09-30 21:00:00');
  assert.equal(range.days, 30);

  const fallback = resolveRange({}, { now: NOW });
  assert.equal(fallback.from, '2026-09-22');
  assert.equal(fallback.days, 90);

  assert.throws(() => resolveRange({ from: '2026-13-01', to: '2026-12-31' }), /invalid_schedule_range/);
  assert.throws(() => resolveRange({ from: '2026-10-01', to: '2026-09-01' }), /invalid_schedule_range/);
  assert.throws(() => resolveRange({ from: '2026-01-01', to: '2026-12-31' }), /schedule_range_too_long/);
});

test('today is Cairo midnight to midnight, across daylight saving', () => {
  const summer = zonedDayBounds(new Date('2026-07-10T22:30:00Z'), 'Africa/Cairo');
  assert.equal(summer.date, '2026-07-11');
  assert.equal(new Date(summer.start).toISOString(), '2026-07-10T21:00:00.000Z');
  const winter = zonedDayBounds(new Date('2026-01-10T10:00:00Z'), 'Africa/Cairo');
  assert.equal(new Date(winter.start).toISOString(), '2026-01-09T22:00:00.000Z');
});

/* ── sessions, weekdays, day part ────────────────────────────────── */

test('sessions are numbered by when they happen, not by their names', () => {
  const { sessions, numberingConsistent } = orderSessions([
    track(12, 1, '2026-09-21 16:00:00', { name: 'HVAC / Session 3' }),
    track(10, 1, '2026-09-14 16:00:00', { name: 'HVAC / Session 1' }),
    track(13, 1, false, { name: 'HVAC / Session 4' }),
    track(11, 1, '2026-09-16 16:00:00', { name: 'HVAC / Session 2' }),
  ]);
  assert.deepEqual(sessions.map((s) => [s.id, s.number]), [[10, 1], [11, 2], [12, 3], [13, 4]]);
  assert.equal(sessions[0].name, 'Session 1');
  assert.equal(sessions[0].startsAt, '2026-09-14T16:00:00Z');
  assert.equal(sessions[0].endsAt, '2026-09-14T19:00:00.000Z');
  assert.equal(sessions[3].startsAt, null);
  assert.equal(numberingConsistent, true);
});

test('a rescheduled lecture keeps its place in time and is reported as a numbering mismatch', () => {
  const { sessions, numberingConsistent } = orderSessions([
    track(1, 1, '2026-09-14 16:00:00', { name: 'X / Session 1' }),
    track(2, 1, '2026-09-30 16:00:00', { name: 'X / Session 2' }),
    track(3, 1, '2026-09-16 16:00:00', { name: 'X / Session 3' }),
  ]);
  assert.deepEqual(sessions.map((s) => s.id), [1, 3, 2]);
  assert.equal(numberingConsistent, false);
});

test('work-day text from every sheet spelling normalises to one vocabulary', () => {
  assert.deepEqual(parseWeekdayText('SAT - MON - WED'), ['SAT', 'MON', 'WED']);
  assert.deepEqual(parseWeekdayText('sun/ tus/ wed'), ['SUN', 'TUE', 'WED']);
  assert.deepEqual(parseWeekdayText('Sun -Teus-Thurs'), ['SUN', 'TUE', 'THU']);
  assert.deepEqual(parseWeekdayText('Sat-Wed-Mon'), ['SAT', 'MON', 'WED']);
  assert.deepEqual(parseWeekdayText('SAT - TUE'), ['SAT', 'TUE']);
  assert.deepEqual(parseWeekdayText('from SUN To WED'), ['SUN', 'MON', 'TUE', 'WED']);
  assert.deepEqual(parseWeekdayText('Sun / Mon / Web'), ['SUN', 'MON', 'WED']);
  assert.deepEqual(parseWeekdayText('Last TUE In Every Month'), ['TUE']);
  assert.deepEqual(parseWeekdayText(''), []);
});

test('work days are derived from lecture dates on the KSA calendar', () => {
  const schema = resolveEventSchema(coreFieldsMeta, trackFieldsMeta);
  const row = buildScheduleRow({
    event: event(1),
    tracks: [
      // 21:30 UTC Saturday is 00:30 Sunday in Riyadh.
      track(1, 1, '2026-09-19 21:30:00'),
      track(2, 1, '2026-09-14 16:00:00'),
      track(3, 1, '2026-09-16 16:00:00'),
    ],
    stages: new Map(),
    schema,
    now: NOW,
  });
  assert.deepEqual(row.workDays, ['SUN', 'MON', 'WED']);
  assert.equal(row.workDaysSource, 'sessions');
  assert.equal(row.startTimeKsa, '19:00');
  assert.equal(row.endTimeKsa, '22:00');
  assert.equal(row.dayPart, 'evening');
  assert.ok(row.qualityFlags.includes('inconsistent_session_times'));
});

test('day part has one fixed definition', () => {
  assert.equal(dayPartOf(9 * 60), 'morning');
  assert.equal(dayPartOf(15 * 60), 'afternoon');
  assert.equal(dayPartOf(19 * 60), 'evening');
  assert.equal(dayPartOf(21 * 60), 'night');
  assert.equal(dayPartOf(2 * 60), 'night');
  assert.equal(dayPartOf(null), null);
});

/* ── status, type, department ────────────────────────────────────── */

test('canonical status follows the Odoo stage, flags first, cancellation by name', () => {
  assert.equal(canonicalStatus({ name: 'In Progress', running: true }), 'in_progress');
  assert.equal(canonicalStatus({ name: 'Anything', running: true }), 'in_progress');
  assert.equal(canonicalStatus({ name: 'Cancelled', finished: true }), 'canceled');
  assert.equal(canonicalStatus({ name: 'Canceled' }), 'canceled');
  assert.equal(canonicalStatus({ name: 'Finished', finished: true }), 'finished');
  assert.equal(canonicalStatus({ name: 'Done' }), 'finished');
  assert.equal(canonicalStatus({ name: 'Delayed' }), 'hold');
  assert.equal(canonicalStatus({ name: 'Hold' }), 'hold');
  assert.equal(canonicalStatus({ name: 'Refused' }), 'refused');
  assert.equal(canonicalStatus({ name: 'Planned' }), 'planned');
  assert.equal(canonicalStatus({ name: 'Mystery' }), null);
  assert.equal(canonicalStatus(null), null);
});

test('training type is normalised from event_type and attendance_method', () => {
  assert.deepEqual(normalizeType('individual', 'online'), { category: 'group', deliveryMode: 'online', displayLabel: 'جروب أونلاين' });
  assert.deepEqual(normalizeType('individual', 'offline'), { category: 'group', deliveryMode: 'offline', displayLabel: 'جروب حضوري' });
  assert.equal(normalizeType('private', 'online').displayLabel, 'خاص أونلاين');
  assert.equal(normalizeType('company', 'offline').displayLabel, 'شركة حضوري');
  assert.deepEqual(normalizeType(false, 'online'), { category: null, deliveryMode: 'online', displayLabel: 'أونلاين' });
  // An unanticipated value keeps Odoo's own label rather than a guess.
  assert.deepEqual(normalizeType('vip', false, { vip: 'VIP Track' }), { category: null, deliveryMode: null, displayLabel: 'VIP Track' });
  assert.deepEqual(normalizeType(false, false), { category: null, deliveryMode: null, displayLabel: null });
});

test('department prefers an Odoo field, then a category label, then an unambiguous course name', () => {
  assert.deepEqual(classifyDepartment({ field: 'Mechanical Dept', courseName: 'PMP' }), { department: 'Mechanical', source: 'odoo' });
  assert.deepEqual(classifyDepartment({ field: 'Operations', courseName: 'PMP' }), { department: 'Operations', source: 'odoo' });
  assert.deepEqual(classifyDepartment({ categories: ['Interior Design Package'], courseName: 'Photoshop' }), { department: 'Arch & Decor', source: 'category' });
  assert.deepEqual(classifyDepartment({ courseName: 'HVAC' }), { department: 'Mechanical', source: 'course_name' });
  assert.deepEqual(classifyDepartment({ courseName: 'PMP Webinar' }), { department: 'Webinar', source: 'course_name' });
  assert.deepEqual(classifyDepartment({ courseName: 'Pre-intermediate 4 - Faisal' }), { department: 'English', source: 'course_name' });
  // Taught in several departments: left unclassified rather than guessed.
  assert.deepEqual(classifyDepartment({ courseName: 'Revit' }), { department: null, source: null });
  assert.deepEqual(classifyDepartment({ courseName: 'AutoCAD' }), { department: null, source: null });
});

/* ── registrations and quality ───────────────────────────────────── */

test('trainees are confirmed registrations; the rest is broken down, never merged', () => {
  const counts = registrationCounts([
    { event_id: [1, 'A'], state: 'open', __count: 4 },
    { event_id: [1, 'A'], state: 'done', __count: 2 },
    { event_id: [1, 'A'], state: 'draft', __count: 3 },
    { event_id: [1, 'A'], state: 'cancel', __count: 1 },
    { event_id: false, state: 'open', __count: 9 },
  ]);
  assert.deepEqual(counts.get(1), { confirmed: 6, interested: 3, attended: 2, cancelled: 1 });
  assert.equal(counts.size, 1);
});

test('missing custom fields stay null, and no flag is raised for a field Odoo never had', () => {
  const schema = resolveEventSchema(coreFieldsMeta, trackFieldsMeta);
  const row = buildScheduleRow({
    event: event(1, { name: 'Revit', seats_max: 0, instructor_id: false, code: false }),
    tracks: [],
    stages: new Map([[2, { id: 2, name: 'In Progress', running: true }]]),
    schema,
    now: NOW,
  });
  assert.equal(row.coordinator, null);
  assert.equal(row.comments, null);
  assert.equal(row.package, null);
  assert.equal(row.department, null);
  assert.equal(row.capacity, null, 'zero seats is unknown capacity, not zero');
  assert.equal(row.traineeCount, 0);
  assert.equal(row.progress, null, 'no lectures is not 0% progress');
  assert.deepEqual(row.workDays, []);
  for (const flag of ['missing_code', 'missing_instructor', 'no_sessions', 'capacity_missing']) {
    assert.ok(row.qualityFlags.includes(flag), flag);
  }
  assert.ok(!row.qualityFlags.includes('missing_coordinator'));
});

test('quality flags catch the spreadsheet-era mistakes', () => {
  const schema = resolveEventSchema(coreFieldsMeta, trackFieldsMeta);
  const row = buildScheduleRow({
    event: event(1, { total_lectures_number: 12, date_begin: '2026-09-14 16:00:00', date_end: '2026-09-13 19:00:00' }),
    tracks: [track(1, 1, '2026-09-14 16:00:00'), track(2, 1, '2026-10-20 16:00:00')],
    stages: new Map(),
    schema,
    now: NOW,
  });
  assert.ok(row.qualityFlags.includes('end_before_start'));
  assert.ok(row.qualityFlags.includes('lecture_count_mismatch'));
  assert.ok(row.qualityFlags.includes('session_outside_range'));
});

test('join links are only ever http(s)', () => {
  assert.equal(joinUrl({ active_join_live_url: 'javascript:alert(1)', zoom_join_link: 'https://zoom.us/j/1' }), 'https://zoom.us/j/1');
  assert.equal(joinUrl({ meeting_url: 'data:text/html,x' }), null);
  assert.equal(joinUrl({ zoom_link: 'not a url' }), null);
});

/* ── schema discovery ────────────────────────────────────────────── */

test('schema discovery finds custom concepts by name and label, and refuses computed fields', () => {
  const schema = resolveEventSchema(
    {
      ...coreFieldsMeta,
      x_coordinator_id: { string: 'Coordinator', type: 'many2one', relation: 'res.users', store: true },
      x_pkg: { string: 'Training Package', type: 'many2one', relation: 'training.package', store: true },
      x_min_seats: { string: 'Minimum Seats', type: 'integer', store: true },
      x_comment_live: { string: 'Comments', type: 'text', store: false },
      note: { string: 'Note', type: 'html', store: true },
      x_misc: { string: 'Notes about nothing', type: 'integer', store: true },
      seats_taken: { string: 'Number of Taken Seats', type: 'integer', store: false },
    },
    trackFieldsMeta
  );
  assert.equal(schema.concepts.coordinator.field, 'x_coordinator_id');
  assert.equal(schema.concepts.package.field, 'x_pkg');
  assert.equal(schema.concepts.minimumCapacity.field, 'x_min_seats');
  assert.equal(schema.concepts.comments.field, 'note', 'the non-stored comments field is skipped');
  assert.equal(schema.concepts.department, null);
  assert.equal(schema.concepts.workDays, null);
  assert.ok(!schema.eventReadFields.includes('seats_taken'));
  assert.ok(!schema.eventReadFields.includes('x_comment_live'));
  assert.deepEqual(schema.zoomFields, ['zoom_join_link', 'zoom_status']);
  assert.deepEqual(schema.coreMissing, []);
});

test('schema discovery reports missing core fields and honours validated pins', () => {
  const { code: _code, ...withoutCode } = coreFieldsMeta;
  const schema = resolveEventSchema(
    { ...withoutCode, x_owner: { string: 'Owner', type: 'many2one', store: true }, sat: { type: 'boolean' }, sun: { type: 'boolean' }, mon: { type: 'boolean' }, tue: { type: 'boolean' }, wed: { type: 'boolean' }, thu: { type: 'boolean' } },
    trackFieldsMeta,
    parseFieldOverride('{"coordinator":"x_owner","department":"x_missing","bogus":"x"}')
  );
  assert.deepEqual(schema.coreMissing, ['code']);
  assert.ok(!schema.eventReadFields.includes('code'));
  assert.equal(schema.concepts.coordinator.field, 'x_owner');
  assert.equal(schema.concepts.coordinator.source, 'override');
  assert.equal(schema.concepts.department, null);
  assert.ok(schema.warnings.some((w) => w.includes('x_missing')));
  assert.equal(schema.concepts.workDays.type, 'boolean_set');
  assert.equal(parseFieldOverride('{nope').error, 'ODOO_EVENT_FIELD_MAP is not valid JSON');
});

/* ── the query plan ──────────────────────────────────────────────── */

test('a schedule load is a fixed number of Odoo requests, however many courses', async () => {
  const events = Array.from({ length: 30 }, (_, i) => event(i + 1, { attendance_method: i % 2 ? 'online' : 'offline' }));
  const tracks = events.flatMap((e) => [track(e.id * 10, e.id, '2026-09-14 16:00:00'), track(e.id * 10 + 1, e.id, '2026-09-16 16:00:00')]);
  const client = fakeOdoo({ events, tracks });
  const schema = resolveEventSchema(coreFieldsMeta, trackFieldsMeta);
  const { rows } = await loadScheduleRows(client, {
    schema,
    stages: [],
    domain: [],
    limit: 100,
    trackLimit: 1000,
    now: NOW,
  });
  assert.equal(rows.length, 30);
  assert.equal(client.calls.filter((c) => c.model === 'event.event').length, 1);
  assert.equal(client.calls.filter((c) => c.model === 'event.track').length, 1);
  assert.equal(client.calls.filter((c) => c.kind === 'read_group').length, 1);
  assert.equal(client.calls.length, 3);
});

test('the schedule shows online and offline courses and never reads seats_taken or Zoom fields in bulk', async () => {
  clearScheduleCaches();
  const client = fakeOdoo({
    events: [event(1, { attendance_method: 'online' }), event(2, { attendance_method: 'offline', event_type: 'company' })],
    tracks: [track(1, 1, '2026-09-14 16:00:00'), track(2, 2, '2026-09-15 06:00:00')],
    registrations: [{ event_id: [2, 'Course 2'], state: 'open', __count: 7 }],
  });
  const result = await trainingSchedule({ from: '2026-09-01', to: '2026-09-30' }, { now: NOW, client });
  assert.deepEqual(result.rows.map((row) => row.deliveryMode).sort(), ['offline', 'online']);
  assert.equal(result.rows.find((row) => row.id === 2).trainingType, 'شركة حضوري');
  assert.equal(result.rows.find((row) => row.id === 2).traineeCount, 7);

  const eventRead = client.calls.find((c) => c.kind === 'search_read' && c.model === 'event.event');
  assert.ok(!JSON.stringify(eventRead.domain).includes('attendance_method'));
  assert.ok(!eventRead.fields.includes('seats_taken'));
  assert.ok(eventRead.options.limit > 0);
  const trackRead = client.calls.find((c) => c.kind === 'search_read' && c.model === 'event.track');
  assert.ok(!trackRead.fields.some((f) => f.startsWith('zoom') || f.includes('join')));
  assert.equal(result.meta.from, '2026-09-01');
  assert.deepEqual(result.meta.availableTypes, ['جروب أونلاين', 'شركة حضوري']);
  assert.equal(result.meta.discoveredFields.coordinator, null);

  const before = client.calls.length;
  await trainingSchedule({ from: '2026-09-01', to: '2026-09-30' }, { now: NOW, client });
  assert.equal(client.calls.length, before, 'second load within a minute is served from cache');
});

test('a failed sync falls back to the last good schedule and says it is stale', async () => {
  clearScheduleCaches();
  const client = fakeOdoo({ events: [event(1)], tracks: [track(1, 1, '2026-09-14 16:00:00')] });
  const fresh = await trainingSchedule({ from: '2026-09-01', to: '2026-09-30' }, { now: NOW, client });
  assert.equal(fresh.stale, undefined);

  expireScheduleCaches();
  client.fail = true;
  const stale = await trainingSchedule({ from: '2026-09-01', to: '2026-09-30' }, { now: NOW, client });
  assert.equal(stale.stale, true);
  assert.equal(stale.rows.length, 1);
  assert.equal(stale.fetchedAt, fresh.fetchedAt);

  clearScheduleCaches();
  await assert.rejects(trainingSchedule({ from: '2026-09-01', to: '2026-09-30' }, { now: NOW, client }), /odoo_timeout/);
});

test('course detail validates the id, and returns sessions, registrations and safe links', async () => {
  for (const bad of ['abc', '0', '-3', '1.5', '']) {
    await assert.rejects(eventDetail(bad), (error) => error.message === 'invalid_course' && error.status === 400);
  }

  clearScheduleCaches();
  const soon = '2026-09-23 16:00:00';
  const client = fakeOdoo({
    events: [event(5)],
    tracks: [
      track(1, 5, '2026-09-14 16:00:00', { zoom_join_link: 'javascript:alert(1)', zoom_status: 'created' }),
      track(2, 5, soon, { zoom_status: 'not_created' }),
    ],
    registrations: [
      { event_id: [5, 'Course 5'], state: 'open', __count: 3 },
      { event_id: [5, 'Course 5'], state: 'draft', __count: 2 },
    ],
  });
  const detail = await eventDetail('5', { now: NOW, client });
  assert.equal(detail.course.id, 5);
  assert.deepEqual(detail.course.registrations, { confirmed: 3, interested: 2, attended: 0, cancelled: 0 });
  assert.equal(detail.course.sessions[0].joinUrl, null);
  assert.equal(detail.course.sessions[1].meetingReady, false);
  assert.ok(detail.course.qualityFlags.includes('zoom_missing'));
  assert.ok('odooUrl' in detail);

  await assert.rejects(eventDetail('99', { now: NOW, client }), (error) => error.message === 'course_not_found' && error.status === 404);
});

test('today lists every lecture of the Cairo day with its place in the course', async () => {
  clearScheduleCaches();
  const client = fakeOdoo({
    events: [event(1, { attendance_method: 'online' }), event(2, { attendance_method: 'offline' })],
    tracks: [
      track(1, 1, '2026-09-20 16:00:00'),
      track(2, 1, '2026-09-22 16:00:00', { zoom_join_link: 'https://zoom.us/j/9', zoom_status: 'created' }),
      track(3, 2, '2026-09-22 06:00:00'),
      track(4, 2, '2026-09-23 06:00:00'),
    ],
  });
  const today = await todaySessions({ now: NOW, client });
  assert.equal(today.date, '2026-09-22');
  assert.deepEqual(today.sessions.map((s) => s.id), [3, 2]);
  const online = today.sessions.find((s) => s.id === 2);
  assert.equal(online.number, 2);
  assert.equal(online.totalSessions, 2);
  assert.equal(online.joinUrl, 'https://zoom.us/j/9');
  assert.equal(online.zoomExpected, true);
  assert.equal(today.sessions.find((s) => s.id === 3).zoomExpected, false);
});

/* ── the Schedule layout never reaches operational views ─────────── */

test('3–4, 7. a package hidden from the Schedule keeps its lectures in Today and its course in Analytics', async () => {
  // Course 2 sits in a package a layout manager hid from the Schedule.
  const seed = {
    departments: [
      { department: 'Mechanical', sheet: 'Mechanical', packages: [{ id: 'seed:m:p1', label: 'Automotive Package Offline', accent: 'green', courses: [{ code: '5502' }], groups: [] }] },
    ],
  };
  let { layout } = buildDefaultLayout(seed, (code) => (code === '5502' ? [{ id: 2, dateBegin: null }] : []));
  layout = updatePackage(layout, 'seed:m:p1', { hiddenInSchedule: true });
  assert.equal(isHiddenInSchedule(layout, 2), true);

  clearScheduleCaches();
  const events = [event(1, { attendance_method: 'online' }), event(2, { attendance_method: 'offline' })];
  const client = fakeOdoo({ events, tracks: [track(1, 1, '2026-09-22 16:00:00'), track(2, 2, '2026-09-22 06:00:00')] });
  const today = await todaySessions({ now: NOW, client });
  assert.deepEqual(today.sessions.map((session) => session.event.id).sort(), [1, 2], 'Today still lists the hidden package course');
  // Only reads ever reached Odoo.
  assert.ok(client.calls.every((call) => ['search_read', 'read_group', 'fields_get'].includes(call.kind)));

  const snapshot = buildEventsSnapshot(
    [{ id: 2, name: 'Automotive', date_begin: '2026-09-02 10:00:00', attendance_method: 'offline', seats_max: 10 }],
    [{ event_id: [2, 'Automotive'], state: 'open', __count: 7 }]
  );
  assert.equal(snapshot.totals.events, 1, 'Analytics input is unaffected');
  assert.equal(snapshot.totals.bookings, 7);

  // And structurally: Today and Analytics do not read the layout at all.
  const sources = await Promise.all(
    ['server/events.js', 'server/events/schedule.js', 'src/components/events/TodaySessions.tsx', 'src/components/events/EventsAnalytics.tsx'].map((file) =>
      fs.readFile(path.join(ROOT, file), 'utf8')
    )
  );
  for (const source of sources) assert.doesNotMatch(source, /eventsLayout|hiddenInSchedule|layout\.js/);
});

test('the archive is year-bounded, closed-or-ended only, and paged', async () => {
  await assert.rejects(trainingArchive({ year: '1999' }), /invalid_archive_year/);
  await assert.rejects(trainingArchive({ from: '2024-01-01', to: '2026-01-01' }), /schedule_range_too_long/);

  clearScheduleCaches();
  const events = [
    event(1, { stage_id: [3, 'Finished'], date_begin: '2026-02-01 16:00:00', date_end: '2026-03-01 16:00:00' }),
    event(2, { stage_id: [1, 'Planned'], date_begin: '2026-11-01 16:00:00', date_end: '2026-12-01 16:00:00' }),
    event(3, { stage_id: [1, 'Planned'], date_begin: '2026-04-01 16:00:00', date_end: '2026-05-01 16:00:00' }),
    event(4, { stage_id: [4, 'Cancelled'], date_begin: '2025-04-01 16:00:00', date_end: '2025-05-01 16:00:00' }),
  ];
  const client = fakeOdoo({ events });
  const archive = await trainingArchive({ year: '2026' }, { now: NOW, client });
  assert.deepEqual(archive.rows.map((row) => row.id).sort(), [1, 3]);
  assert.equal(archive.meta.hasMore, false);
  assert.equal(archive.meta.year, 2026);
});

/* ── analytics stay what they were ───────────────────────────────── */

test('the analysis tab still counts in-person events only', () => {
  const snapshot = buildEventsSnapshot(
    [
      { id: 1, name: 'Online', date_begin: '2026-09-01 10:00:00', attendance_method: 'online', seats_max: 10 },
      { id: 2, name: 'Classroom', date_begin: '2026-09-02 10:00:00', attendance_method: 'offline', seats_max: 10 },
    ],
    [
      { event_id: [1, 'Online'], state: 'open', __count: 9 },
      { event_id: [2, 'Classroom'], state: 'open', __count: 2 },
    ]
  );
  assert.equal(snapshot.totals.events, 1);
  assert.equal(snapshot.totals.bookings, 2);
});

/* ── errors the browser can act on ───────────────────────────────── */

test('Odoo rejecting our key never reaches the browser as a 401', () => {
  assert.deepEqual(failureFor(new OdooError('odoo_auth_failed', 401)), { status: 502, error: 'odoo_auth_failed' });
  assert.deepEqual(failureFor(new OdooError('odoo_timeout')), { status: 504, error: 'odoo_timeout' });
  assert.deepEqual(failureFor(new OdooError('odoo_http_500')), { status: 502, error: 'odoo_unreachable' });
  assert.deepEqual(failureFor(new OdooError('odoo_not_configured', 503)), { status: 503, error: 'odoo_not_configured' });
  const original = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(failureFor(new OdooError('psycopg2.errors: relation "x" at SELECT ...')), { status: 502, error: 'odoo_error' });
    assert.deepEqual(failureFor(new OdooError('You are not allowed to access Event')), { status: 502, error: 'odoo_access_denied' });
  } finally {
    console.error = original;
  }
});

/* ── the live schema: fields this database actually has ──────────── */

/**
 * Taken from `fields_get` on the production database (2026-09-22). The three
 * that matter are the ones discovery originally got wrong:
 * `package_training_style` is a delivery mode wearing the word "Package",
 * the real package hangs off `related_group_id`, and the work-days field is
 * `week_day_ids` — "day", not "days".
 */
const liveFieldsMeta = {
  ...coreFieldsMeta,
  package_training_style: {
    string: 'Package Training Style',
    type: 'selection',
    store: true,
    selection: [
      ['onsite', 'On-site Attendance'],
      ['online', 'Online Attendance'],
    ],
  },
  related_group_id: {
    string: 'Related Training Package Group',
    type: 'many2one',
    relation: 'training.package.group',
    store: true,
  },
  week_day_ids: { string: 'Week Day', type: 'many2many', relation: 'week.day', store: true },
  user_id: { string: 'Responsible', type: 'many2one', relation: 'res.users', store: true },
  note: { string: 'Note', type: 'html', store: true },
  event_type_id: { string: 'Template', type: 'many2one', relation: 'event.type', store: true },
  tag_ids: { string: 'Tags', type: 'many2many', relation: 'event.tag', store: true },
};

test('"Package Training Style" is a delivery mode, not a package, and never wins the package slot', () => {
  const schema = resolveEventSchema(liveFieldsMeta, trackFieldsMeta);
  assert.equal(schema.concepts.package, null);
  assert.equal(schema.concepts.packageGroup.field, 'related_group_id');
  assert.equal(schema.concepts.packageGroup.relation, 'training.package.group');
  // It is still reported as a candidate so a human can see why it was rejected.
  assert.ok(!schema.eventReadFields.includes('package_training_style'));
});

test('the work-days field is found when Odoo spells it "week_day_ids"', () => {
  const schema = resolveEventSchema(liveFieldsMeta, trackFieldsMeta);
  assert.equal(schema.concepts.workDays.field, 'week_day_ids');
  assert.equal(schema.concepts.workDays.type, 'many2many');
  assert.ok(schema.eventReadFields.includes('week_day_ids'));
});

test('a course reaches its package through the cohort group, in one extra query', async () => {
  const client = fakeOdoo({
    events: [
      event(1, { related_group_id: [77, 'Evening Group September 2026'], user_id: [4, 'Ramy Emad'] }),
      event(2, { related_group_id: [77, 'Evening Group September 2026'] }),
      event(3, { related_group_id: false }),
    ],
    groups: [{ id: 77, name: 'Evening Group September 2026', package_id: [6, 'Mechanical Engineering Professional Track'] }],
    eventFields: liveFieldsMeta,
  });
  const schema = resolveEventSchema(liveFieldsMeta, trackFieldsMeta);
  const stages = await readStages(client);
  client.calls.length = 0;

  const { rows } = await loadScheduleRows(client, {
    schema,
    stages,
    domain: [['id', 'in', [1, 2, 3]]],
    limit: 50,
    now: NOW,
  });

  const groupReads = client.calls.filter((c) => c.model === 'training.package.group');
  assert.equal(groupReads.length, 1, 'one read for the page, never one per course');
  assert.deepEqual(groupReads[0].domain, [['id', 'in', [77]]]);

  assert.equal(rows[0].package, 'Mechanical Engineering Professional Track');
  assert.equal(rows[0].cohort, 'Evening Group September 2026');
  assert.equal(rows[1].package, 'Mechanical Engineering Professional Track');
  // A course outside any package is not in a package — not "unknown", not "".
  assert.equal(rows[2].package, null);
  assert.equal(rows[2].cohort, null);
});

test('the package name, not the course name, decides the department', async () => {
  const client = fakeOdoo({
    // "Revit" alone is deliberately unclassifiable: it is taught in several
    // departments, so only the package can place this course.
    events: [event(1, { name: 'Revit Work-Sharing 5406', related_group_id: [8, 'April Group 2026'] })],
    groups: [{ id: 8, name: 'April Group 2026', package_id: [12, 'BIM MEP Professional Track'] }],
    eventFields: liveFieldsMeta,
  });
  const schema = resolveEventSchema(liveFieldsMeta, trackFieldsMeta);
  const stages = await readStages(client);
  const { rows } = await loadScheduleRows(client, { schema, stages, domain: [], limit: 50, now: NOW });

  assert.equal(rows[0].department, 'Mechanical');
  assert.equal(rows[0].departmentSource, 'category');
});

test('Odoo\'s "Responsible" fills the Coordinator column, and says that is where it came from', async () => {
  const client = fakeOdoo({
    events: [event(1, { user_id: [4, 'Ramy Emad'] }), event(2, { user_id: false })],
    eventFields: liveFieldsMeta,
  });
  const schema = resolveEventSchema(liveFieldsMeta, trackFieldsMeta);
  assert.equal(schema.concepts.responsible.field, 'user_id');
  const stages = await readStages(client);
  const { rows } = await loadScheduleRows(client, { schema, stages, domain: [], limit: 50, now: NOW });

  assert.equal(rows[0].coordinator, 'Ramy Emad');
  assert.equal(rows[0].coordinatorSource, 'responsible');
  assert.equal(rows[1].coordinator, null);
  assert.equal(rows[1].coordinatorSource, null);
});

test('a database with no cohort groups asks for none', async () => {
  const client = fakeOdoo({ events: [event(1)], eventFields: coreFieldsMeta });
  const schema = resolveEventSchema(coreFieldsMeta, trackFieldsMeta);
  assert.equal(schema.concepts.packageGroup, null);
  const stages = await readStages(client);
  client.calls.length = 0;
  const { rows } = await loadScheduleRows(client, { schema, stages, domain: [], limit: 50, now: NOW });

  assert.equal(client.calls.filter((c) => c.model === 'training.package.group').length, 0);
  assert.equal(rows[0].package, null);
  assert.equal(rows[0].cohort, null);
});
