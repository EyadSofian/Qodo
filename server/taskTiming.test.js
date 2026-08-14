import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clockOwner,
  deliveryLatenessDays,
  firstDeliveredAt,
  receivedAt,
  taskDurations,
  workStartedAt,
} from '../shared/taskTiming.js';

const DAY = 86_400_000;
const iso = (daysFromNow, hour = 9) =>
  new Date(Date.now() + daysFromNow * DAY).toISOString().slice(0, 11) +
  String(hour).padStart(2, '0') +
  ':00:00.000Z';
const date = (daysFromNow) => iso(daysFromNow).slice(0, 10);

/** A marketing task at a given stage, with only the stamps a test cares about. */
const task = (stage, fields = {}) => ({
  department: 'marketing',
  stage,
  assignments: [],
  ...fields,
});

test('a delivered task stops counting the day it was handed in', () => {
  // Due four days ago, handed in five days ago: early then, early forever.
  const done = task('done', {
    dueDate: date(-4),
    assignedAt: iso(-9),
    startedAt: iso(-8),
    submittedAt: iso(-5),
    firstSubmittedAt: iso(-5),
    completedAt: iso(-3),
  });

  assert.equal(deliveryLatenessDays(done), -1, 'a day early, and it stays a day early');
  assert.equal(clockOwner(done), null, 'a closed task is nobody’s delay');

  // The reading must not move when the calendar does — this is the whole bug:
  // the old label was due-date minus today, so it grew every night.
  const tomorrow = taskDurations(done, Date.now() + DAY);
  const nextMonth = taskDurations(done, Date.now() + 30 * DAY);
  assert.equal(tomorrow.lateBy, nextMonth.lateBy);
  assert.equal(tomorrow.turnaround, nextMonth.turnaround);
});

test('a hand-in that missed the deadline says so, by how much, once', () => {
  const late = task('done', {
    dueDate: date(-10),
    assignedAt: iso(-14),
    submittedAt: iso(-7),
    firstSubmittedAt: iso(-7),
    completedAt: iso(-6),
  });
  assert.equal(deliveryLatenessDays(late), 3);
  assert.equal(taskDurations(late, Date.now() + 60 * DAY).lateBy, 3);
});

test('the clock in a review column belongs to the reviewer', () => {
  const waiting = task('review', {
    dueDate: date(2),
    assignedAt: iso(-12),
    startedAt: iso(-11),
    submittedAt: iso(-11),
  });
  const d = taskDurations(waiting);

  assert.equal(clockOwner(waiting), 'reviewer');
  assert.equal(d.inReview, 11, 'eleven days of nobody looking at it');
  // Handed in well before a deadline that has not even arrived: the eleven days
  // are real, and none of them are the doer's — nothing here reads as late.
  assert.equal(d.lateBy, -13);
});

test('a send-back cannot rewrite when the work was first delivered', () => {
  const reworked = task('rework', {
    dueDate: date(-8),
    assignedAt: iso(-12),
    // The current hand-in is gone — the review cleared it — and the resubmission
    // has not happened yet. Without the first stamp the task looks undelivered.
    submittedAt: null,
    firstSubmittedAt: iso(-9),
    reworkCount: 1,
  });

  assert.equal(firstDeliveredAt(reworked), iso(-9));
  assert.equal(
    deliveryLatenessDays(reworked, { first: true }),
    -1,
    'the original delivery beat the deadline by a day'
  );
});

test('a start invented by the hand-in is an absent measurement, not a fast task', () => {
  const stamp = iso(-3);
  const guessed = task('done', {
    assignedAt: iso(-6),
    startedAt: stamp,
    startedAtInferred: true,
    submittedAt: stamp,
    completedAt: iso(-2),
  });

  assert.equal(workStartedAt(guessed), null);
  assert.equal(taskDurations(guessed).working, null, 'no start, so no hands-on figure — not zero');
  assert.equal(taskDurations(guessed).turnaround, 3, 'receipt to hand-in is still measurable');
});

test('receipt is when somebody accepted, not when the task was filed', () => {
  const shared = task('working', {
    createdAt: iso(-20),
    assignedAt: iso(-10),
    assignments: [
      { userId: 'b', acceptedAt: iso(-6) },
      { userId: 'a', acceptedAt: iso(-8) },
    ],
    startedAt: iso(-5),
  });

  assert.equal(receivedAt(shared), iso(-8), 'the earliest acceptance — it became work then');
  assert.equal(taskDurations(shared).waiting, 3, 'three days between accepting and starting');

  const never = task('assigned', { createdAt: iso(-4), assignedAt: iso(-2), assignments: [] });
  assert.equal(receivedAt(never), iso(-2), 'nobody answered, so the assignment stands in');
});

test('an undated task can be old but never late', () => {
  const undated = task('working', { assignedAt: iso(-30), startedAt: iso(-28) });
  const d = taskDurations(undated);

  assert.equal(d.lateBy, null, 'no deadline was promised, so none was broken');
  assert.equal(d.age, 30);
  assert.equal(d.working, 28);
});
