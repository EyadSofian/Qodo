/**
 * Which finished work the board shows.
 *
 * The Done column used to hold every task ever closed, so it grew for ever and
 * this month's work sat in one pile with last spring's. It is now a view of one
 * calendar month — the current one by default — with the rest a click away.
 *
 * The month a task belongs to is the month it was *finished*: `completedAt`,
 * never `createdAt` or `taskDate`. Something filed in August and approved in
 * September is September's work. Months are read in the viewer's own calendar,
 * because "September" on screen has to mean the September the viewer lives in.
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
 * Whether a task belongs on screen under the chosen period. Open work always
 * does — the period narrows finished work only. A finished task without a
 * `completedAt` has no month to belong to, so only the full history shows it.
 */
export function inDonePeriod(task, period) {
  if (!isDoneTask(task)) return true;
  if (period === ALL_HISTORY) return true;
  return monthKeyOf(task.completedAt) === period;
}

/** Newest completion first; undated rows sink to the bottom. */
export function byCompletionDesc(a, b) {
  return String(b.completedAt ?? '').localeCompare(String(a.completedAt ?? ''));
}

/** Finished tasks that cannot be placed in any month — a data problem to surface. */
export function undatedDoneTasks(tasks) {
  return tasks.filter((task) => isDoneTask(task) && !monthKeyOf(task.completedAt));
}
