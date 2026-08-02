/**
 * The task lifecycle — one definition, imported by the Express API (which
 * enforces it) and the React app (which draws it).
 *
 * A task is a small contract between two people, and it moves through four
 * states in one direction, with exactly two gates:
 *
 *      ┌───────── manager sends it back, with a reason ─────────┐
 *      ▼                                                        │
 *   assigned ──▶ working ──▶ submitted ──────────────────▶ approved
 *   (manager      (the       (deliverable      gate 2:      (done, and
 *    files it      person     attached, note   the manager   scored)
 *    and picks     starts)    written)         reviews and
 *    the owner)               ▲ gate 1:        scores it
 *                               only the owner
 *                               can submit, and
 *                               only with proof
 *
 * The gates are the whole point. Before this existed, anyone who could edit a
 * task could drag it to "done" and type a score into the same form the task was
 * created in — so a score was just another field, and "finished" was an opinion.
 * Now finishing is an event: the person doing the work submits evidence, and the
 * manager is the only one who can close it, and closing it requires a score.
 *
 * The four states are derived from the canonical stage `type` in
 * departments.js, so every department keeps its own column names — Sales still
 * says "Negotiation" where IT says "Verification" — and both still mean
 * "submitted, waiting on a reviewer".
 */

import { PERMISSIONS, can } from './permissions.js';
import { DEFAULT_DEPARTMENT, getStages, stageType } from './departments.js';

/** The lifecycle, in order. Maps 1:1 onto the canonical stage types. */
export const TASK_STATES = ['assigned', 'working', 'submitted', 'approved'];

const STATE_BY_STAGE_TYPE = {
  open: 'assigned',
  active: 'working',
  review: 'submitted',
  done: 'approved',
};

const STAGE_TYPE_BY_STATE = {
  assigned: 'open',
  working: 'active',
  submitted: 'review',
  approved: 'done',
};

export const REVIEW_DECISIONS = ['approved', 'changes_requested'];
export const ASSIGNMENT_STATUSES = [
  'unassigned',
  'pending',
  'accepted',
  'declined',
  'clarification_requested',
  'due_date_proposed',
  'reassignment_requested',
];
export const ASSIGNMENT_ACTIONS = [
  'accept',
  'decline',
  'request_clarification',
  'propose_due_date',
  'request_reassignment',
];

/** How large a single deliverable may be, in bytes. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** How many deliverables one task may carry. */
export const MAX_ATTACHMENTS_PER_TASK = 12;

/**
 * Score bands. A bare 0–100 number invites managers to invent their own scale,
 * so the number always renders next to a named band — the rubric practice from
 * performance reviews, compressed to one axis because a task is one deliverable,
 * not a whole appraisal.
 */
export const SCORE_BANDS = [
  { id: 'excellent', min: 90, ar: 'ممتاز', en: 'Excellent' },
  { id: 'good', min: 75, ar: 'جيد', en: 'Good' },
  { id: 'fair', min: 60, ar: 'مقبول', en: 'Acceptable' },
  { id: 'weak', min: 0, ar: 'دون المتوقع', en: 'Below expectations' },
];

export function scoreBand(score) {
  if (!Number.isFinite(score)) return null;
  return SCORE_BANDS.find((band) => score >= band.min) ?? SCORE_BANDS[SCORE_BANDS.length - 1];
}

export const departmentOfTask = (task) => task?.department ?? DEFAULT_DEPARTMENT;

/** Where this task sits in the lifecycle, whatever its department calls the column. */
export function taskState(task) {
  return STATE_BY_STAGE_TYPE[stageType(departmentOfTask(task), task.stage)] ?? 'assigned';
}

/**
 * The stage a gate should land on: the first column of that canonical type in
 * the task's own department. Falls back to the current stage when a department
 * has no column of that type at all.
 */
export function stageForState(department, state, fallback) {
  const type = STAGE_TYPE_BY_STATE[state];
  const match = getStages(department).find((stage) => stage.type === type);
  return match?.id ?? fallback;
}

/**
 * Where returned work lands. Marketing already models this as its own column
 * ("إعادة عمل"), and a department that took the trouble to name the state
 * should get it back rather than having everything collapse into "working".
 */
export function stageForReturn(department, fallback) {
  const rework = getStages(department).find(
    (stage) => stage.id === 'rework' && stage.type === 'active'
  );
  return rework?.id ?? stageForState(department, 'working', fallback);
}

/* ── who is who ──────────────────────────────────────────────────── */

/**
 * A reviewer is anyone who may edit other people's tasks — managers and
 * administrators. Deliberately reusing `tasks.edit_any` rather than minting a
 * new permission: users can carry an explicit permission override, so a new key
 * would silently strip the ability from everyone who has one.
 */
export function isReviewer(user) {
  return can(user, PERMISSIONS.TASKS_EDIT_ANY);
}

/**
 * The person who owes the work. Normally the assignee; on an unassigned task it
 * falls back to whoever filed it, so a task nobody owns is never stuck.
 */
export function isDoer(user, task) {
  if (!user || !task) return false;
  if (task.assigneeId) return task.assigneeId === user.id;
  return task.createdBy === user.id || isReviewer(user);
}

/** A named assignee must explicitly accept before execution starts. */
export function assignmentReady(task) {
  if (!task?.assigneeId) return true;
  // Legacy rows are treated as accepted until the boot migration stamps them.
  return !task.assignmentStatus || task.assignmentStatus === 'accepted';
}

export function canRespondToAssignment(user, task) {
  const state = taskState(task);
  return Boolean(
    user &&
      task?.assigneeId === user.id &&
      (state === 'assigned' || state === 'working') &&
      task.assignmentStatus !== 'accepted'
  );
}

/* ── the gates ───────────────────────────────────────────────────── */

export function canStart(user, task) {
  return (
    taskState(task) === 'assigned' &&
    ((isDoer(user, task) && assignmentReady(task)) ||
      (isReviewer(user) && !task.assigneeId))
  );
}

export function canSubmit(user, task) {
  const state = taskState(task);
  return (
    (state === 'assigned' || state === 'working') &&
    ((isDoer(user, task) && assignmentReady(task)) ||
      (isReviewer(user) && !task.assigneeId))
  );
}

export function canReview(user, task) {
  return taskState(task) === 'submitted' && isReviewer(user);
}

/** Reopening an approved task is a manager's correction, not an employee's undo. */
export function canReopen(user, task) {
  return taskState(task) === 'approved' && isReviewer(user);
}

export function canScore(user) {
  return isReviewer(user);
}

/**
 * Whether a drag may drop a card into a column of this canonical type.
 *
 * `review` and `done` are the two gates, so a drop onto them is not a move —
 * the client turns it into the submit or review dialog, and the API refuses a
 * bare stage write that would cross either one.
 */
export function canMoveTo(user, task, type) {
  if (!user || !task) return false;
  if (type === 'done') return isReviewer(user);
  if (type === 'review') return isDoer(user, task) || isReviewer(user);
  return isDoer(user, task) || isReviewer(user) || task.createdBy === user.id;
}

/**
 * What a plain stage write means — the one rule the API enforces and the board
 * consults before it lets a card land:
 *
 *   'ok'        move it, it crosses nothing
 *   'assignment' the assignee must answer the assignment before work starts
 *   'submit'    this is a hand-in; it needs a deliverable, so use the submit gate
 *   'review'    this is an approval; it needs a score, so use the review gate
 *   'reopen'    approved work must be reopened explicitly before it can move
 *   'forbidden' the caller cannot make this transition
 *
 * The client turns every non-'ok' verdict into the matching task action rather
 * than silently moving the card around the workflow contract.
 */
export function stageWriteVerdict(user, task, nextDepartment, nextStage) {
  const from = taskState(task);
  const to = STATE_BY_STAGE_TYPE[stageType(nextDepartment, nextStage)] ?? 'assigned';
  if (from === to) return 'ok';

  const forward = TASK_STATES.indexOf(to) > TASK_STATES.indexOf(from);
  // A pending assignment is a real gate. Without this check, dragging the card
  // from an open column to an active one bypasses the explicit accept/decline
  // response even though the dedicated /start action correctly refuses it.
  if (from === 'assigned' && to === 'working' && task.assigneeId && !assignmentReady(task)) {
    return isDoer(user, task) || isReviewer(user) ? 'assignment' : 'forbidden';
  }
  if (to === 'approved') return 'review';
  if (to === 'submitted' && forward) return 'submit';
  // Returning submitted work requires the review gate because that action owns
  // the mandatory reason, rework counter and assignee notification. Approved
  // work similarly has to pass through the explicit reopen action.
  if (!forward && from === 'submitted') return isReviewer(user) ? 'review' : 'forbidden';
  if (!forward && from === 'approved') return isReviewer(user) ? 'reopen' : 'forbidden';
  return 'ok';
}

/* ── reading a task's history ────────────────────────────────────── */

/** Was the deliverable handed in on or before the due date? */
export function submittedOnTime(task) {
  if (!task?.dueDate) return null;
  const stamp = task.submittedAt ?? task.completedAt;
  if (!stamp) return null;
  return stamp.slice(0, 10) <= task.dueDate;
}

/** Approved the first time it was submitted — the cleanest signal of a clear brief. */
export function approvedFirstPass(task) {
  return taskState(task) === 'approved' && (task.reworkCount ?? 0) === 0;
}
