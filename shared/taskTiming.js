/**
 * How long a task took, and whose clock it was on.
 *
 * The board used to answer this with one number: the due date minus today. That
 * reading never stops running, so a task delivered on time still turned red the
 * day after its deadline and kept counting up for the rest of its life — the
 * card claimed a delay that had already been beaten.
 *
 * The fix is that a duration needs both ends. Which end is "now" depends on
 * where the task is, and every stage hands the clock to somebody else:
 *
 *   assigned   the person who owes the work — they have not started
 *   working    the same person — they are on it
 *   submitted  the reviewer — the work is off the doer's desk
 *   approved   nobody — the clock stopped, and its reading is history
 *
 * So a card in review that reads "11 days" is 11 days of a manager not looking
 * at it, and blaming the doer for that number was the second thing wrong here.
 *
 * The anchors below are the ones the stamps actually support; each is a
 * separate export because they answer different questions and the callers ask
 * different ones.
 */

import { assignmentRows, taskState } from './workflow.js';

const DAY = 86_400_000;

/**
 * When the work landed on somebody.
 *
 * An acceptance is the strongest form — the person said yes, on a date. Where
 * nobody has accepted (or the row predates per-partner assignment) the moment
 * it was pushed to them stands in, and a task nobody was ever given falls back
 * to when it was filed. On shared work the earliest acceptance wins: the task
 * became somebody's problem then, not when the last partner got round to it.
 */
export function receivedAt(task) {
  if (!task) return null;
  const accepted = assignmentRows(task)
    .map((row) => row.acceptedAt)
    .filter(Boolean)
    .sort();
  return accepted[0] ?? task.assignedAt ?? task.createdAt ?? null;
}

/**
 * When work actually began — or null when nothing proves it did.
 *
 * A hand-in writes `startedAt` for a task nobody ever started, so the stamp
 * exists on rows where it means "we had to put something here". Reading that
 * as a real start produces a cycle time of zero, which is not a fast task, it
 * is a missing measurement. `startedAtInferred` marks those, and this returns
 * null for them so an absent number stays absent instead of averaging in as 0.
 */
export function workStartedAt(task) {
  if (!task || task.startedAtInferred) return null;
  return task.startedAt ?? null;
}

/**
 * The first time the work was handed in.
 *
 * `submittedAt` is cleared by every send-back, so on any task that came back
 * once it answers "when was it handed in *last*" — the original delivery, and
 * with it the only honest reading of whether the deadline was met, was gone.
 * `firstSubmittedAt` survives review; the fallbacks cover rows written before
 * it existed.
 */
export function firstDeliveredAt(task) {
  if (!task) return null;
  return task.firstSubmittedAt ?? task.submittedAt ?? task.completedAt ?? null;
}

/** The hand-in currently on the table — what a reviewer is looking at now. */
export function deliveredAt(task) {
  if (!task) return null;
  return task.submittedAt ?? task.completedAt ?? null;
}

/**
 * Whose desk the task is sitting on. Null once it is closed: a finished task is
 * nobody's delay, which is the whole reason its chip has to stop moving.
 */
export function clockOwner(task) {
  const state = taskState(task);
  if (state === 'submitted' || state === 'signed_off') return 'reviewer';
  if (state === 'approved') return null;
  return 'doer';
}

/** Whole days between two instants, floored — 25 hours is one day, not two. */
export function daysBetween(from, to) {
  if (!from || !to) return null;
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.floor((end - start) / DAY);
}

/** Hours between two instants, floored. Used only below the one-day mark. */
export function hoursBetween(from, to) {
  if (!from || !to) return null;
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.floor((end - start) / 3_600_000);
}

/** Calendar days between two YYYY-MM-DD dates. Date-only, so no timezone drift. */
export function calendarDaysBetween(fromDate, toDate) {
  if (!fromDate || !toDate) return null;
  const start = Date.parse(`${fromDate}T00:00:00Z`);
  const end = Date.parse(`${toDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / DAY);
}

/**
 * How late the delivery was, in whole days. Positive means the promise broke,
 * zero or negative means it held, and null means there was never a promise —
 * an undated task cannot be late, only old.
 *
 * Measured at the hand-in and frozen there. This is the same rule the
 * performance summary already scores punctuality by, so a card and a report
 * cannot disagree about whether somebody delivered on time.
 */
export function deliveryLatenessDays(task, { first = false } = {}) {
  if (!task?.dueDate) return null;
  const delivered = first ? firstDeliveredAt(task) : deliveredAt(task);
  if (!delivered) return null;
  return calendarDaysBetween(task.dueDate, delivered.slice(0, 10));
}

/**
 * Every duration a task can report, with the ends they were measured between.
 * A caller picks the one its surface has room for; the dialog shows them all.
 *
 * `sinceReceived`, `sinceStarted` and `inReview` are live readings against
 * `now`, so they are only present while that clock is the one running.
 */
export function taskDurations(task, now = Date.now()) {
  const state = taskState(task);
  const owner = clockOwner(task);
  const nowIso = new Date(now).toISOString();

  const received = receivedAt(task);
  const started = workStartedAt(task);
  const firstDelivery = firstDeliveredAt(task);
  const delivery = deliveredAt(task);
  const closed = task?.completedAt ?? null;

  return {
    state,
    owner,
    received,
    started,
    firstDelivery,
    delivery,
    closed,
    /** Waiting on the doer to pick it up. Runs until the first thing happens. */
    waiting: daysBetween(received, started ?? delivery ?? closed ?? nowIso),
    /** Hands-on time: start → hand-in, or start → now while it is being done. */
    working: started ? daysBetween(started, delivery ?? nowIso) : null,
    /** Receipt → hand-in. The number an employee is actually answerable for. */
    turnaround: delivery ? daysBetween(received, delivery) : null,
    /** Hand-in → verdict. The reviewer's clock, live while it waits. */
    inReview: delivery ? daysBetween(delivery, closed ?? nowIso) : null,
    /** Receipt → now, for a task with no deadline: not lateness, just age. */
    age: daysBetween(received, closed ?? delivery ?? nowIso),
    lateBy: deliveryLatenessDays(task),
    lateOnFirstDelivery: deliveryLatenessDays(task, { first: true }),
  };
}
