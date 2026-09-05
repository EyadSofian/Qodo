/**
 * Qodo Projects — scheduling.
 *
 * The critical path, working-day arithmetic and cycle detection are the part of
 * this product most likely to be quietly wrong: a schedule that is off by a day
 * still looks like a schedule. So these tests use real dates on Engosoft's
 * actual working week — Sunday to Thursday — and check the arithmetic against
 * dates written out by hand rather than against the code's own output.
 *
 * September 2026, for reference:
 *   Sun 6 · Mon 7 · Tue 8 · Wed 9 · Thu 10 · [Fri 11 · Sat 12 off]
 *   Sun 13 · Mon 14 · Tue 15 · Wed 16 · Thu 17 · [Fri 18 · Sat 19 off] · Sun 20
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_WORKDAYS,
  addWorkingDays,
  baselineVariance,
  cascadeFrom,
  computeSchedule,
  findCycle,
  finishOf,
  formatDate,
  isWorkingDay,
  makeCalendar,
  parseDate,
  workingDaysBetween,
  wouldCycle,
} from './projects/schedulingService.js';

const cal = makeCalendar();
const on = (date) => parseDate(date);
const add = (date, days) => formatDate(addWorkingDays(on(date), days, cal));

/* ── the calendar ─────────────────────────────────────────────────── */

test('the default working week is Engosoft’s, not a Western one', () => {
  // Sunday through Thursday. A Monday-to-Friday default would have been
  // plausible, silent, and wrong for every project in the company.
  assert.deepEqual(DEFAULT_WORKDAYS, [7, 1, 2, 3, 4]);
  assert.equal(isWorkingDay(on('2026-09-06'), cal), true, 'Sunday is a working day');
  assert.equal(isWorkingDay(on('2026-09-10'), cal), true, 'Thursday is a working day');
  assert.equal(isWorkingDay(on('2026-09-11'), cal), false, 'Friday is not');
  assert.equal(isWorkingDay(on('2026-09-12'), cal), false, 'Saturday is not');
});

test('a holiday is not a working day even on a working weekday', () => {
  const withHoliday = makeCalendar({ holidays: ['2026-09-08'] });
  assert.equal(isWorkingDay(on('2026-09-08'), withHoliday), false);
  assert.equal(isWorkingDay(on('2026-09-08'), cal), true);
});

test('a calendar with no working days falls back instead of hanging', () => {
  const broken = makeCalendar({ workdays: [] });
  assert.equal(isWorkingDay(on('2026-09-06'), broken), true);
});

test('adding zero working days snaps onto the next working day', () => {
  // A task that starts "today" when today is Friday starts on Sunday.
  assert.equal(add('2026-09-11', 0), '2026-09-13');
  assert.equal(add('2026-09-06', 0), '2026-09-06');
});

test('adding working days steps over the weekend', () => {
  assert.equal(add('2026-09-10', 1), '2026-09-13');
  assert.equal(add('2026-09-06', 4), '2026-09-10');
  assert.equal(add('2026-09-06', 5), '2026-09-13');
  assert.equal(add('2026-09-06', 9), '2026-09-17');
});

test('adding negative working days walks backwards over the weekend', () => {
  assert.equal(add('2026-09-13', -1), '2026-09-10');
  assert.equal(add('2026-09-13', -5), '2026-09-06');
});

test('a span counts both of its ends', () => {
  // Sunday to Sunday is one day of work, not zero.
  assert.equal(workingDaysBetween(on('2026-09-06'), on('2026-09-06'), cal), 1);
  assert.equal(workingDaysBetween(on('2026-09-06'), on('2026-09-10'), cal), 5);
  // Across the weekend: Sun–Thu plus Sun = 6.
  assert.equal(workingDaysBetween(on('2026-09-06'), on('2026-09-13'), cal), 6);
  assert.equal(workingDaysBetween(on('2026-09-13'), on('2026-09-06'), cal), 0, 'backwards is empty');
});

test('a five-day task starting Sunday finishes Thursday, not the following Monday', () => {
  assert.equal(formatDate(finishOf(on('2026-09-06'), 5, cal)), '2026-09-10');
  assert.equal(formatDate(finishOf(on('2026-09-09'), 5, cal)), '2026-09-15');
  assert.equal(formatDate(finishOf(on('2026-09-06'), 1, cal)), '2026-09-06');
});

test('a date is parsed as UTC, so a schedule does not shift with the reader', () => {
  assert.equal(formatDate(parseDate('2026-09-06')), '2026-09-06');
  assert.equal(parseDate('not a date'), null);
  assert.equal(parseDate(null), null);
});

/* ── cycles ───────────────────────────────────────────────────────── */

test('a straight chain has no cycle', () => {
  assert.equal(
    findCycle([
      { predecessorId: 'a', successorId: 'b' },
      { predecessorId: 'b', successorId: 'c' },
    ]),
    null
  );
});

test('a cycle is reported as the path, not as a boolean', () => {
  const cycle = findCycle([
    { predecessorId: 'a', successorId: 'b' },
    { predecessorId: 'b', successorId: 'c' },
    { predecessorId: 'c', successorId: 'a' },
  ]);
  assert.ok(cycle, 'the cycle was not detected');
  // Whichever node it starts from, the path must close on itself and name all three.
  assert.equal(cycle[0], cycle[cycle.length - 1]);
  assert.deepEqual([...new Set(cycle)].sort(), ['a', 'b', 'c']);
});

test('a diamond is not a cycle', () => {
  assert.equal(
    findCycle([
      { predecessorId: 'a', successorId: 'b' },
      { predecessorId: 'a', successorId: 'c' },
      { predecessorId: 'b', successorId: 'd' },
      { predecessorId: 'c', successorId: 'd' },
    ]),
    null
  );
});

test('a task cannot depend on itself', () => {
  assert.ok(wouldCycle([], { predecessorId: 'a', successorId: 'a' }));
});

test('the edge that would close a loop is refused before it is stored', () => {
  const existing = [
    { predecessorId: 'a', successorId: 'b' },
    { predecessorId: 'b', successorId: 'c' },
  ];
  assert.ok(wouldCycle(existing, { predecessorId: 'c', successorId: 'a' }));
  assert.equal(wouldCycle(existing, { predecessorId: 'c', successorId: 'd' }), null);
});

test('a long chain does not overflow the stack', () => {
  // A thousand sequential tasks is an ordinary construction schedule, and a
  // recursive search would fail on it.
  const chain = Array.from({ length: 2000 }, (_, i) => ({
    predecessorId: `t${i}`,
    successorId: `t${i + 1}`,
  }));
  assert.equal(findCycle(chain), null);
  assert.ok(wouldCycle(chain, { predecessorId: 't2000', successorId: 't0' }));
});

/* ── the schedule ─────────────────────────────────────────────────── */

test('an unconstrained task starts at the project start', () => {
  const result = computeSchedule({
    tasks: [{ id: 'a', durationDays: 3 }],
    projectStart: '2026-09-06',
    calendar: cal,
  });
  assert.equal(result.ok, true);
  assert.equal(result.tasks[0].earlyStart, '2026-09-06');
  assert.equal(result.tasks[0].earlyFinish, '2026-09-08');
});

test('a project start on a Friday moves to the Sunday', () => {
  const result = computeSchedule({
    tasks: [{ id: 'a', durationDays: 1 }],
    projectStart: '2026-09-11',
    calendar: cal,
  });
  assert.equal(result.projectStart, '2026-09-13');
  assert.equal(result.tasks[0].earlyStart, '2026-09-13');
});

test('finish-to-start puts the successor on the next working day', () => {
  const result = computeSchedule({
    tasks: [
      { id: 'a', durationDays: 5 },
      { id: 'b', durationDays: 2 },
    ],
    dependencies: [{ predecessorId: 'a', successorId: 'b', type: 'FS' }],
    projectStart: '2026-09-06',
    calendar: cal,
  });
  const [a, b] = result.tasks;
  assert.equal(a.earlyFinish, '2026-09-10', 'Sun–Thu');
  // Not Friday. The next working day after Thursday is Sunday.
  assert.equal(b.earlyStart, '2026-09-13');
  assert.equal(b.earlyFinish, '2026-09-14');
});

test('lag on a finish-to-start adds working days, not calendar days', () => {
  const result = computeSchedule({
    tasks: [
      { id: 'a', durationDays: 1 },
      { id: 'b', durationDays: 1 },
    ],
    dependencies: [{ predecessorId: 'a', successorId: 'b', type: 'FS', lagDays: 2 }],
    projectStart: '2026-09-09',
    calendar: cal,
  });
  const b = result.tasks.find((task) => task.id === 'b');
  // A finishes Wed 9. +1 = Thu 10, +2 lag steps over the weekend to Mon 14.
  assert.equal(b.earlyStart, '2026-09-14');
});

test('start-to-start lets the successor begin alongside the predecessor', () => {
  const result = computeSchedule({
    tasks: [
      { id: 'a', durationDays: 5 },
      { id: 'b', durationDays: 2 },
    ],
    dependencies: [{ predecessorId: 'a', successorId: 'b', type: 'SS' }],
    projectStart: '2026-09-06',
    calendar: cal,
  });
  const b = result.tasks.find((task) => task.id === 'b');
  assert.equal(b.earlyStart, '2026-09-06');
});

test('finish-to-finish lands the two finishes together', () => {
  const result = computeSchedule({
    tasks: [
      { id: 'a', durationDays: 5 },
      { id: 'b', durationDays: 2 },
    ],
    dependencies: [{ predecessorId: 'a', successorId: 'b', type: 'FF' }],
    projectStart: '2026-09-06',
    calendar: cal,
  });
  const a = result.tasks.find((task) => task.id === 'a');
  const b = result.tasks.find((task) => task.id === 'b');
  assert.equal(a.earlyFinish, '2026-09-10');
  assert.equal(b.earlyFinish, '2026-09-10');
  assert.equal(b.earlyStart, '2026-09-09', 'two days ending Thursday start Wednesday');
});

test('a typed start date is a constraint the network cannot pull earlier', () => {
  const result = computeSchedule({
    tasks: [
      { id: 'a', durationDays: 1 },
      { id: 'b', durationDays: 1, startDate: '2026-09-16' },
    ],
    dependencies: [{ predecessorId: 'a', successorId: 'b', type: 'FS' }],
    projectStart: '2026-09-06',
    calendar: cal,
  });
  const b = result.tasks.find((task) => task.id === 'b');
  assert.equal(b.earlyStart, '2026-09-16', 'the planner’s date won');
});

test('a cycle is refused rather than scheduled into an infinite loop', () => {
  const result = computeSchedule({
    tasks: [
      { id: 'a', durationDays: 1 },
      { id: 'b', durationDays: 1 },
    ],
    dependencies: [
      { predecessorId: 'a', successorId: 'b', type: 'FS' },
      { predecessorId: 'b', successorId: 'a', type: 'FS' },
    ],
    projectStart: '2026-09-06',
    calendar: cal,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'cycle');
  assert.ok(result.cycle);
});

/* ── the critical path ────────────────────────────────────────────── */

test('the longest chain is critical and the shorter one has float', () => {
  //   a(3) ──▶ b(5) ──▶ d(2)      the long way: 10 days
  //   a(3) ──▶ c(1) ──▶ d(2)      the short way: 6 days
  const result = computeSchedule({
    tasks: [
      { id: 'a', durationDays: 3 },
      { id: 'b', durationDays: 5 },
      { id: 'c', durationDays: 1 },
      { id: 'd', durationDays: 2 },
    ],
    dependencies: [
      { predecessorId: 'a', successorId: 'b', type: 'FS' },
      { predecessorId: 'a', successorId: 'c', type: 'FS' },
      { predecessorId: 'b', successorId: 'd', type: 'FS' },
      { predecessorId: 'c', successorId: 'd', type: 'FS' },
    ],
    projectStart: '2026-09-06',
    calendar: cal,
  });

  const byId = Object.fromEntries(result.tasks.map((task) => [task.id, task]));
  assert.equal(byId.a.isCritical, true);
  assert.equal(byId.b.isCritical, true);
  assert.equal(byId.d.isCritical, true);
  assert.equal(byId.c.isCritical, false, 'the one-day branch cannot be critical');
  assert.equal(byId.c.totalFloat, 4, 'c may slip four working days before it matters');
  assert.deepEqual(result.criticalPath.sort(), ['a', 'b', 'd']);
});

test('every task on a single chain is critical', () => {
  const result = computeSchedule({
    tasks: [
      { id: 'a', durationDays: 2 },
      { id: 'b', durationDays: 2 },
      { id: 'c', durationDays: 2 },
    ],
    dependencies: [
      { predecessorId: 'a', successorId: 'b', type: 'FS' },
      { predecessorId: 'b', successorId: 'c', type: 'FS' },
    ],
    projectStart: '2026-09-06',
    calendar: cal,
  });
  assert.deepEqual(result.criticalPath.sort(), ['a', 'b', 'c']);
  for (const task of result.tasks) assert.equal(task.totalFloat, 0);
});

test('a holiday inside a task pushes the finish and the whole chain with it', () => {
  const withHoliday = makeCalendar({ holidays: ['2026-09-08'] });
  const result = computeSchedule({
    tasks: [
      { id: 'a', durationDays: 3 },
      { id: 'b', durationDays: 1 },
    ],
    dependencies: [{ predecessorId: 'a', successorId: 'b', type: 'FS' }],
    projectStart: '2026-09-06',
    calendar: withHoliday,
  });
  const byId = Object.fromEntries(result.tasks.map((task) => [task.id, task]));
  // Sun 6, Mon 7, [Tue 8 holiday], Wed 9.
  assert.equal(byId.a.earlyFinish, '2026-09-09');
  assert.equal(byId.b.earlyStart, '2026-09-10');
});

/* ── baselines ────────────────────────────────────────────────────── */

test('slipping later is a positive variance', () => {
  const variance = baselineVariance({
    baseline: [{ id: 'a', startDate: '2026-09-06', endDate: '2026-09-08' }],
    current: [{ id: 'a', startDate: '2026-09-09', endDate: '2026-09-13' }],
    calendar: cal,
  });
  // Sun 6 → Mon 7 → Tue 8 → Wed 9: three working days of slip, not two.
  assert.equal(variance[0].startVarianceDays, 3);
  // Tue 8 → Sun 13: Wed, Thu, Sun = three working days.
  assert.equal(variance[0].finishVarianceDays, 3);
});

test('finishing early is a negative variance', () => {
  const variance = baselineVariance({
    baseline: [{ id: 'a', startDate: '2026-09-13', endDate: '2026-09-14' }],
    current: [{ id: 'a', startDate: '2026-09-09', endDate: '2026-09-10' }],
    calendar: cal,
  });
  assert.equal(variance[0].startVarianceDays, -2);
  assert.equal(variance[0].finishVarianceDays, -2);
});

test('on plan is zero, not null', () => {
  const variance = baselineVariance({
    baseline: [{ id: 'a', startDate: '2026-09-06', endDate: '2026-09-08' }],
    current: [{ id: 'a', startDate: '2026-09-06', endDate: '2026-09-08' }],
    calendar: cal,
  });
  assert.equal(variance[0].startVarianceDays, 0);
  assert.equal(variance[0].finishVarianceDays, 0);
});

test('a task added after the baseline reports no variance rather than a fabricated zero', () => {
  const variance = baselineVariance({
    baseline: [],
    current: [{ id: 'new', startDate: '2026-09-06', endDate: '2026-09-08' }],
    calendar: cal,
  });
  assert.equal(variance[0].isNew, true);
  assert.equal(variance[0].startVarianceDays, null);
});

/* ── cascade ──────────────────────────────────────────────────────── */

test('moving a task reports only what actually moved', () => {
  const tasks = [
    { id: 'a', durationDays: 2 },
    { id: 'b', durationDays: 2 },
    { id: 'independent', durationDays: 2 },
  ];
  const dependencies = [{ predecessorId: 'a', successorId: 'b', type: 'FS' }];

  const result = cascadeFrom({
    tasks,
    dependencies,
    movedTaskId: 'a',
    newStartDate: '2026-09-13',
    projectStart: '2026-09-06',
    calendar: cal,
  });

  assert.equal(result.ok, true);
  const moved = result.changes.map((change) => change.id).sort();
  assert.deepEqual(moved, ['a', 'b'], 'the unrelated task was rewritten');
  assert.equal(result.changes.find((c) => c.id === 'b').to.startDate, '2026-09-15');
});

test('a cascade says how far the project itself slipped', () => {
  const result = cascadeFrom({
    tasks: [
      { id: 'a', durationDays: 2 },
      { id: 'b', durationDays: 2 },
    ],
    dependencies: [{ predecessorId: 'a', successorId: 'b', type: 'FS' }],
    movedTaskId: 'a',
    newStartDate: '2026-09-13',
    projectStart: '2026-09-06',
    calendar: cal,
  });
  // The chain was Sun 6 → Thu 10; it becomes Sun 13 → Thu 17. Five working days.
  assert.equal(result.projectSlipDays, 5);
});

test('a cascade that would create a cycle refuses instead of writing', () => {
  const result = cascadeFrom({
    tasks: [
      { id: 'a', durationDays: 1 },
      { id: 'b', durationDays: 1 },
    ],
    dependencies: [
      { predecessorId: 'a', successorId: 'b', type: 'FS' },
      { predecessorId: 'b', successorId: 'a', type: 'FS' },
    ],
    movedTaskId: 'a',
    newStartDate: '2026-09-13',
    projectStart: '2026-09-06',
    calendar: cal,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'cycle');
});
