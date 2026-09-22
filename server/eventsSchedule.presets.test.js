import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMPTY_FILTERS,
  activeFilterCount,
  applyFilters,
  availableQuickFilters,
  departmentCounts,
  headerGroups,
  ksaWeek,
  maxSessionCount,
  resolveView,
  rowMatches,
  sessionState,
  sortRows,
  visibleColumns,
} from '../shared/eventsSchedule.js';

const NOW = new Date('2026-09-22T12:00:00Z');

const row = (id, overrides = {}) => ({
  id,
  courseName: `Course ${id}`,
  courseCode: String(5500 + id),
  department: 'Mechanical',
  package: 'Mechanical Package',
  section: null,
  instructor: 'Micheal Adel',
  coordinator: null,
  trainingType: 'Group Online',
  deliveryMode: 'online',
  statusCanonical: 'planned',
  startsAt: '2026-10-01T16:00:00Z',
  endsAt: '2026-10-20T19:00:00Z',
  startTimeKsa: '19:00',
  workDays: ['SAT', 'MON', 'WED'],
  traineeCount: 10,
  registrations: { confirmed: 10, interested: 0, attended: 0, cancelled: 0 },
  capacity: 50,
  minimumCapacity: null,
  sessions: [],
  nextSession: null,
  qualityFlags: [],
  location: { venue: null },
  ...overrides,
});

test('session columns grow to the longest visible course, and only where the view has them', () => {
  const rows = [row(1, { sessions: new Array(16).fill({}) }), row(2, { sessions: new Array(40).fill({}) })];
  assert.equal(maxSessionCount(rows), 40);
  assert.equal(maxSessionCount([rows[0]]), 16);
  assert.equal(maxSessionCount([]), 0);

  const excel = visibleColumns('excel', { sessionCount: 16 });
  assert.equal(excel.filter((id) => /^s\d+$/.test(id)).length, 16);
  assert.equal(excel.at(-1), 's16');
  assert.deepEqual(visibleColumns('compact', { sessionCount: 40 }).filter((id) => /^s\d+$/.test(id)), []);
  assert.deepEqual(visibleColumns('sessions', { sessionCount: 2 }), ['courseName', 'code', 'instructor', 'status', 's1', 's2']);
});

test('hidden columns disappear, but the frozen course column cannot be hidden', () => {
  const columns = visibleColumns('excel', { hidden: ['comments', 'courseName', 'dayPart'], sessionCount: 0 });
  assert.ok(!columns.includes('comments'));
  assert.ok(!columns.includes('dayPart'));
  assert.ok(columns.includes('courseName'));
});

test('grouped headers span their columns in the sheet order', () => {
  const groups = headerGroups(visibleColumns('excel', { sessionCount: 3 }));
  assert.deepEqual(
    groups.map((g) => [g.label, g.span]),
    [
      ['Course Info', 5],
      ['Capacity', 2],
      ['Schedule', 6],
      ['Operations', 3],
      ['Sessions', 3],
    ]
  );
});

test('English and Webinar tabs get their own sheet layout unless a view is chosen', () => {
  assert.equal(resolveView('auto', 'english'), 'english');
  assert.equal(resolveView('auto', 'webinar'), 'webinar');
  assert.equal(resolveView('auto', 'civil'), 'excel');
  assert.equal(resolveView('compact', 'english'), 'compact');
  assert.ok(visibleColumns('english').includes('courseNameCode'));
});

test('closed courses are hidden from the schedule unless asked for', () => {
  const rows = [row(1), row(2, { statusCanonical: 'finished' }), row(3, { statusCanonical: 'canceled' }), row(4, { statusCanonical: 'hold' })];
  assert.deepEqual(applyFilters(rows, EMPTY_FILTERS, NOW).map((r) => r.id), [1, 4]);
  assert.deepEqual(applyFilters(rows, { ...EMPTY_FILTERS, showClosed: true }, NOW).map((r) => r.id), [1, 2, 3, 4]);
  assert.deepEqual(applyFilters(rows, { ...EMPTY_FILTERS, status: ['finished'] }, NOW).map((r) => r.id), [2]);
});

test('department presets filter the same rows; counts come from one list', () => {
  const rows = [row(1), row(2, { department: 'Civil' }), row(3, { department: null })];
  assert.deepEqual(applyFilters(rows, { ...EMPTY_FILTERS, department: 'civil' }, NOW).map((r) => r.id), [2]);
  const counts = departmentCounts(rows, EMPTY_FILTERS, NOW);
  assert.equal(counts.all, 3);
  assert.equal(counts.mechanical, 1);
  assert.equal(counts.english, 0);
});

test('quick filters answer the operational questions', () => {
  const rows = [
    row(1, { statusCanonical: 'in_progress' }),
    row(2, { startsAt: '2026-09-24T16:00:00Z' }),
    row(3, { traineeCount: 0, registrations: { confirmed: 0, interested: 0, attended: 0, cancelled: 0 } }),
    row(4, { traineeCount: 45, capacity: 50 }),
    row(5, { instructor: null }),
    row(6, { capacity: null, traineeCount: 99 }),
  ];
  const pick = (quick) => applyFilters(rows, { ...EMPTY_FILTERS, quick }, NOW).map((r) => r.id);
  assert.deepEqual(pick('running'), [1]);
  assert.deepEqual(pick('startsThisWeek'), [2]);
  assert.deepEqual(pick('noRegistrations'), [3]);
  assert.deepEqual(pick('nearCapacity'), [4], 'unknown capacity is never "near capacity"');
  assert.deepEqual(pick('missingInstructor'), [5]);
  assert.deepEqual(ksaWeek(NOW), { from: '2026-09-19', to: '2026-09-25' });
});

test('filters that need a field this Odoo lacks are not offered', () => {
  const keys = (fields) => availableQuickFilters(fields).map((f) => f.key);
  assert.ok(!keys({}).includes('missingCoordinator'));
  assert.ok(!keys({}).includes('belowMinimum'));
  assert.ok(keys({ coordinator: 'x_coordinator_id', minimumCapacity: 'x_min' }).includes('belowMinimum'));
});

test('search covers name, code, instructor, package and Arabic spelling variants', () => {
  assert.ok(rowMatches(row(1), '5501'));
  assert.ok(rowMatches(row(1), 'micheal mechanical'));
  assert.ok(rowMatches(row(1, { courseName: 'التصميــم الداخلي' }), 'التصميم'));
  assert.ok(!rowMatches(row(1), 'revit'));
});

test('the default order keeps running courses on top, then by start', () => {
  const rows = [
    row(1, { statusCanonical: 'planned', startsAt: '2026-10-05T16:00:00Z' }),
    row(2, { statusCanonical: 'hold' }),
    row(3, { statusCanonical: 'in_progress', startsAt: '2026-09-01T16:00:00Z' }),
    row(4, { statusCanonical: 'planned', startsAt: '2026-09-25T16:00:00Z' }),
  ];
  assert.deepEqual(sortRows(rows).map((r) => r.id), [3, 4, 1, 2]);
  assert.deepEqual(sortRows(rows, { key: 'start', dir: 'desc' }).map((r) => r.id)[0], 1);
});

test('session cells read past, today, upcoming or missing on the KSA calendar', () => {
  assert.equal(sessionState({ startsAt: '2026-09-20T16:00:00Z' }, NOW), 'past');
  assert.equal(sessionState({ startsAt: '2026-09-22T17:00:00Z' }, NOW), 'today');
  assert.equal(sessionState({ startsAt: '2026-09-22T06:00:00Z' }, NOW), 'today', 'earlier today is still today');
  assert.equal(sessionState({ startsAt: '2026-09-24T16:00:00Z' }, NOW), 'upcoming');
  assert.equal(sessionState({ startsAt: null }, NOW), 'missing');
  assert.equal(sessionState(undefined, NOW), 'missing');
});

test('the filter badge counts what is narrowing the list', () => {
  assert.equal(activeFilterCount(EMPTY_FILTERS), 0);
  assert.equal(activeFilterCount({ ...EMPTY_FILTERS, status: ['planned'], instructor: 'X', quick: 'running' }), 3);
});
