/**
 * Which month of work the task page shows.
 *
 * The board and table used to hold every task ever filed, so Done grew for ever
 * and this month's work sat in one pile with last spring's. The page is now a
 * view of one calendar month — the current one by default — with any other
 * month, or the whole history, a click away.
 *
 * Every task belongs to exactly one month:
 *
 *   finished work  the month it was *finished* — `completedAt`, never
 *                  `createdAt` or `taskDate`. Filed in August and approved in
 *                  September is September's work. Read in the viewer's own
 *                  calendar, because "September" on screen has to mean the
 *                  September the viewer lives in.
 *   open work      the month of its business date, `taskDate` — the date the
 *                  table shows in its first column. It is a calendar date
 *                  already, so it is read as written, not through a timezone.
 *                  A row without one falls back to when it was filed.
 *
 * This is a lens, not a migration: nothing here writes, and a task whose
 * `completedAt` is missing is reported as missing rather than given a date.
 */

import { DEFAULT_DEPARTMENT, stageType } from './departments.js';

/** Every closed task, whatever month it closed in. */
export const ALL_HISTORY = 'all';

const pad = (value) => String(value).padStart(2, '0');

/**
 * `YYYY-MM` in local time, or null for a missing or unreadable stamp.
 * @param {string | Date | null | undefined} value
 * @returns {string | null}
 */
export function monthKeyOf(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function currentMonthKey(now = new Date()) {
  return monthKeyOf(now);
}

/**
 * @param {string} key `YYYY-MM`
 * @param {number} delta months, negative for earlier
 * @returns {string}
 */
export function shiftMonth(key, delta) {
  const [year, month] = key.split('-').map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return /** @type {string} */ (monthKeyOf(date));
}

/** The first day of a month key, for formatting it as a name. */
export function monthStart(key) {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1);
}

export function isDoneTask(task) {
  return stageType(task.department ?? DEFAULT_DEPARTMENT, task.stage) === 'done';
}

/**
 * The month a task is filed under, or null when it cannot be placed — a
 * finished task without a `completedAt`, which only the full history shows.
 * @returns {string | null}
 */
export function taskMonthKey(task) {
  if (isDoneTask(task)) return monthKeyOf(task.completedAt);
  const date = String(task.taskDate ?? '');
  if (/^\d{4}-\d{2}/.test(date)) return date.slice(0, 7);
  return monthKeyOf(task.createdAt);
}

/** Whether a task is on screen under the chosen period. */
export function inTaskPeriod(task, period) {
  return period === ALL_HISTORY || taskMonthKey(task) === period;
}

/** Newest completion first; undated rows sink to the bottom. */
export function byCompletionDesc(a, b) {
  return String(b.completedAt ?? '').localeCompare(String(a.completedAt ?? ''));
}

/** Finished tasks that cannot be placed in any month — a data problem to surface. */
export function undatedDoneTasks(tasks) {
  return tasks.filter((task) => isDoneTask(task) && !monthKeyOf(task.completedAt));
}
