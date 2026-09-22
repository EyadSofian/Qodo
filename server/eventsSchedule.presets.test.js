import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMPTY_FILTERS,
  activeFilterCount,
  applyFilters,
  availableQuickFilters,
  VIEW_MODES,
  departmentBreakdown,
  departmentCounts,
  ksaWeek,
  overviewStats,
  resolveViewMode,
  rowMatches,
  sessionState,
  sortRows,
  todaysSessions,
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

test('the course list has two shapes, and neither of them is a spreadsheet', () => {
  assert.deepEqual(VIEW_MODES, ['cards', 'list']);
  assert.equal(resolveViewMode('cards'), 'cards');
  assert.equal(resolveViewMode('list'), 'list');
  // Anything left over from the spreadsheet era falls back rather than throwing.
  assert.equal(resolveViewMode('excel'), 'cards');
  assert.equal(resolveViewMode(undefined), 'cards');
});

test('the overview counts real rows and never invents a denominator', () => {
  const rows = [
    row(1, { statusCanonical: 'in_progress', traineeCount: 20, capacity: 20 }),
    row(2, { statusCanonical: 'in_progress', traineeCount: 5, capacity: null }),
    row(3, { statusCanonical: 'planned', startsAt: '2026-09-25T06:00:00Z', traineeCount: 7, capacity: 50 }),
    row(4, { statusCanonical: 'finished', traineeCount: 30, capacity: 30 }),
  ];
  const stats = overviewStats(rows, NOW);

  assert.equal(stats.active, 2);
  assert.equal(stats.startingSoon, 1, 'planned and inside the next seven days');
  // A finished course's trainees are history, not active load.
  assert.equal(stats.trainees, 32);
  // Course 2 has no capacity in Odoo, so it cannot be "near capacity" — only 1 is.
  assert.equal(stats.nearCapacity, 1);
});

test('today\'s lectures are gathered across every course, in time order', () => {
  const rows = [
    row(1, { sessions: [{ id: 11, number: 3, startsAt: '2026-09-22T16:00:00Z' }] }),
    row(2, { sessions: [{ id: 21, number: 1, startsAt: '2026-09-22T07:00:00Z' }, { id: 22, number: 2, startsAt: '2026-09-29T07:00:00Z' }] }),
    row(3, { sessions: [{ id: 31, number: 9, startsAt: '2026-09-23T07:00:00Z' }] }),
  ];
  const today = todaysSessions(rows, NOW);
  assert.deepEqual(today.map((entry) => entry.session.id), [21, 11]);
});

test('the department breakdown counts courses, busiest first', () => {
  const rows = [row(1), row(2), row(3, { department: 'Civil' }), row(4, { department: null })];
  assert.deepEqual(departmentBreakdown(rows), [
    { department: 'Mechanical', count: 2 },
    { department: 'Civil', count: 1 },
    { department: 'Unclassified', count: 1 },
  ]);
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
