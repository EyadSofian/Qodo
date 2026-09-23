import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALL_HISTORY,
  byCompletionDesc,
  currentMonthKey,
  inTaskPeriod,
  monthKeyOf,
  shiftMonth,
  taskMonthKey,
  undatedDoneTasks,
} from '../shared/doneHistory.js';

// Local-time stamps, so the tests read the same month in every timezone.
const at = (year, month, day, hour = 12) => new Date(year, month - 1, day, hour).toISOString();

const august = {
  id: 'aug',
  department: 'general',
  stage: 'done',
  createdAt: at(2026, 7, 2),
  taskDate: '2026-07-02',
  completedAt: at(2026, 8, 20),
};
const september = {
  id: 'sep',
  department: 'general',
  stage: 'done',
  // Filed in August, finished in September — September's work.
  createdAt: at(2026, 8, 28),
  taskDate: '2026-08-28',
  completedAt: at(2026, 9, 3),
};
const active = {
  id: 'active',
  department: 'general',
  stage: 'doing',
  createdAt: at(2025, 1, 1),
  taskDate: '2026-09-15',
  completedAt: null,
};

const shown = (period) =>
  [august, september, active].filter((task) => inTaskPeriod(task, period)).map((task) => task.id);

test('September shows the task completed in September and the open task dated in September', () => {
  assert.deepEqual(shown('2026-09'), ['sep', 'active']);
});

test('the previous month shows only its own work', () => {
  assert.deepEqual(shown(shiftMonth('2026-09', -1)), ['aug']);
});

test('open work is filed by its task date, and by when it was filed without one', () => {
  assert.equal(taskMonthKey(active), '2026-09');
  assert.equal(taskMonthKey({ ...active, taskDate: null }), '2025-01');
  // The task date is a calendar date already — never shifted by a timezone.
  assert.equal(taskMonthKey({ ...active, taskDate: '2026-08-31' }), '2026-08');
});

test('switching back and forth never duplicates or loses a task', () => {
  const again = shown(shiftMonth(shiftMonth('2026-09', -1), 1));
  assert.deepEqual(again, ['sep', 'active']);
  assert.deepEqual(shown(ALL_HISTORY), ['aug', 'sep', 'active']);
});

test('the month comes from completedAt, never createdAt or taskDate', () => {
  assert.equal(monthKeyOf(september.completedAt), '2026-09');
  assert.equal(inTaskPeriod(september, '2026-08'), false);
});

test('month arithmetic crosses year boundaries', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2025-12', 1), '2026-01');
  assert.equal(currentMonthKey(new Date(2026, 8, 23)), '2026-09');
});

test('newest completion first', () => {
  const sorted = [august, september].sort(byCompletionDesc).map((task) => task.id);
  assert.deepEqual(sorted, ['sep', 'aug']);
});

test('a finished task without completedAt is reported, not dated', () => {
  const undated = { ...september, id: 'undated', completedAt: null };
  assert.equal(inTaskPeriod(undated, '2026-09'), false);
  assert.equal(inTaskPeriod(undated, ALL_HISTORY), true);
  assert.deepEqual(undatedDoneTasks([undated, september, active]).map((task) => task.id), ['undated']);
});

/**
 * The month is the viewer's calendar month. Node re-reads `TZ` when it is
 * assigned, so each case runs the same instants under a different clock.
 */
function inZone(zone, fn) {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

test('month boundaries follow the local calendar, not the UTC date', () => {
  const lateAugustUtc = '2026-08-31T21:30:00Z';
  const earlySeptemberUtc = '2026-09-01T00:30:00Z';

  inZone('UTC', () => {
    assert.equal(monthKeyOf(lateAugustUtc), '2026-08');
    assert.equal(monthKeyOf(earlySeptemberUtc), '2026-09');
  });
  // Cairo is ahead of UTC: 21:30Z on the 31st is already 1 September there.
  inZone('Africa/Cairo', () => {
    assert.equal(monthKeyOf(lateAugustUtc), '2026-09');
    assert.equal(monthKeyOf(earlySeptemberUtc), '2026-09');
  });
  // New York is behind: 00:30Z on the 1st is still 31 August evening there.
  inZone('America/New_York', () => {
    assert.equal(monthKeyOf(lateAugustUtc), '2026-08');
    assert.equal(monthKeyOf(earlySeptemberUtc), '2026-08');
    const task = { department: 'general', stage: 'done', completedAt: earlySeptemberUtc };
    assert.equal(inTaskPeriod(task, '2026-08'), true);
    assert.equal(inTaskPeriod(task, '2026-09'), false);
  });
});
