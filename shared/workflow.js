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
 * A board may insert one optional stop between the gate and the end:
 *
 *   submitted ──▶ signed_off ──▶ approved
 *                 (manager said   (and it actually
 *                  yes, scored)     went out)
 *
 * Only departments that declare a `signoff` column ever see it — marketing
 * does, because approving a post and posting it are different days. Everywhere
 * else the review gate still lands straight on the done column.
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

/**
 * The lifecycle, in order. Maps 1:1 onto the canonical stage types.
 *
 * `signed_off` is optional and most departments never see it: it exists only
 * where a board declares a `signoff` column, and the review gate falls straight
 * through to `approved` everywhere else. Note that `approved` still means "in a
 * done column" — the new state was inserted before it rather than renaming it,
 * so every rule that already asked "is this finished" kept its answer.
 */
export const TASK_STATES = ['assigned', 'working', 'submitted', 'signed_off', 'approved'];

const STATE_BY_STAGE_TYPE = {
  open: 'assigned',
  active: 'working',
  review: 'submitted',
  signoff: 'signed_off',
  done: 'approved',
};

const STAGE_TYPE_BY_STATE = {
  assigned: 'open',
  working: 'active',
  submitted: 'review',
  signed_off: 'signoff',
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
 * Where an approval lands: the sign-off column when the department has one,
 * and the done column when it does not.
 *
 * This is the whole of the opt-in. Marketing declares "معتمدة" and approved
 * work waits there to be published; sales, IT and the rest declare no such
 * column and approving closes the task outright, exactly as before.
 */
export function stageForApproval(department, fallback) {
  return stageForState(department, 'signed_off', null) ?? stageForState(department, 'approved', fallback);
}

/** Does this board separate "signed off" from "delivered" at all? */
export function hasSignoffStage(department) {
  return getStages(department).some((stage) => stage.type === 'signoff');
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
 * The commissioning side of the contract, one authority per key.
 *
 * These four used to be a single `tasks.edit_any`, which made "may edit a
 * colleague's task" indistinguishable from "may close it and put a number on
 * someone's performance record". They are separate so a team lead can be given
 * assignment without approval, or a reviewer without the power to re-plan the
 * work they are reviewing. `permissionsFor` back-fills them for anyone whose
 * stored override predates the split.
 */
export function canAssignWork(user) {
  return can(user, PERMISSIONS.TASKS_ASSIGN);
}

export function canReviewWork(user) {
  return can(user, PERMISSIONS.TASKS_REVIEW);
}

export function canApproveWork(user) {
  return can(user, PERMISSIONS.TASKS_APPROVE);
}

export function canScoreWork(user) {
  return can(user, PERMISSIONS.TASKS_SCORE);
}

/** A reviewer is whoever may pass judgement on submitted work. */
export function isReviewer(user) {
  return canReviewWork(user);
}

/**
 * The person who owes the work. Normally the assignee; on an unassigned task it
 * falls back to whoever filed it, so a task nobody owns is never stuck.
 */
export function isDoer(user, task) {
  if (!user || !task) return false;
  if (task.assigneeId) return task.assigneeId === user.id;
  return task.createdBy === user.id || canAssignWork(user);
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
      (canAssignWork(user) && !task.assigneeId))
  );
}

export function canSubmit(user, task) {
  const state = taskState(task);
  return (
    (state === 'assigned' || state === 'working') &&
    ((isDoer(user, task) && assignmentReady(task)) ||
      (canAssignWork(user) && !task.assigneeId))
  );
}

export function canReview(user, task) {
  return taskState(task) === 'submitted' && canReviewWork(user);
}

/**
 * Publishing is the one move out of sign-off, and it is deliberately not a
 * gate: the judgement already happened at review and the score is already on
 * the record. This only says the approved thing is now out in the world, which
 * is usually the person who does the work — the media buyer posts the post —
 * so the doer may do it as well as a reviewer.
 */
export function canPublish(user, task) {
  return taskState(task) === 'signed_off' && (isDoer(user, task) || isReviewer(user));
}

/**
 * Reopening is a manager's correction, not an employee's undo. It reaches back
 * from sign-off too: work approved this morning and not yet published is the
 * easiest thing to pull back, and refusing there would mean publishing it first
 * just to be allowed to take it back.
 */
export function canReopen(user, task) {
  const state = taskState(task);
  return (state === 'approved' || state === 'signed_off') && canApproveWork(user);
}

export function canScore(user) {
  return canScoreWork(user);
}

/**
 * What a plain stage write means — the one rule the API enforces and the board
 * consults before it lets a card land:
 *
 *   'ok'         move it; this caller may rearrange the board freely
 *   'assignment' the assignee must answer the assignment before work starts
 *   'start'      this is picking the work up, so use the start action
 *   'submit'     this is a hand-in; it needs a deliverable, so use the submit gate
 *   'review'     this is an approval; it needs a score, so use the review gate
 *   'reopen'     approved work must be reopened explicitly before it can move
 *   'forbidden'  the caller cannot make this transition
 *
 * The client turns every non-'ok' verdict into the matching task action rather
 * than silently moving the card around the workflow contract.
 *
 * The asymmetry at the bottom is deliberate and is the rule the whole board
 * rests on: **for the person doing the work a stage is the result of an action,
 * never a drag.** They have exactly two moves — pick the work up, and hand it
 * in — and both go through an action that records who, when and with what. Only
 * a reviewer may push a card around for any other reason.
 *
 * Without that, an employee could drag their own card between two columns of
 * the same canonical type, which in a department like marketing means moving it
 * out of "إعادة عمل" — where a manager put it — back into "قيد العمل", or into
 * a column literally named "معتمدة". Same type, so the old rule read it as an
 * ordinary move and allowed it.
 */
export function stageWriteVerdict(user, task, nextDepartment, nextStage) {
  const from = taskState(task);
  const to = STATE_BY_STAGE_TYPE[stageType(nextDepartment, nextStage)] ?? 'assigned';
  // Not a stage change at all — a reorder inside a column, or a patch that never
  // mentioned the stage. Both sides are read through `departmentOfTask` so a
  // task stored without a department compares equal to the default rather than
  // looking like a move to a different board.
  const sameStage =
    nextStage === task.stage &&
    departmentOfTask({ department: nextDepartment }) === departmentOfTask(task);
  if (sameStage) return 'ok';

  const forward = TASK_STATES.indexOf(to) > TASK_STATES.indexOf(from);
  const reviewer = canReviewWork(user);
  const doer = isDoer(user, task);

  // A pending assignment is a real gate. Without this check, dragging the card
  // from an open column to an active one bypasses the explicit accept/decline
  // response even though the dedicated /start action correctly refuses it.
  if (from === 'assigned' && to === 'working' && task.assigneeId && !assignmentReady(task)) {
    return doer || reviewer ? 'assignment' : 'forbidden';
  }
  // Sign-off to done is the publish step, and the only move that is allowed to
  // leave the sign-off column without a manager: the decision was already made
  // and scored, this just records that the approved thing went out.
  if (from === 'signed_off' && to === 'approved') {
    return doer || reviewer ? 'publish' : 'forbidden';
  }
  // Landing in either terminal column is the review gate's verdict. On a board
  // with a sign-off column that is where approving lands, so both are named.
  if (to === 'signed_off' || to === 'approved') {
    return canApproveWork(user) ? 'review' : 'forbidden';
  }
  if (to === 'submitted' && forward) {
    return doer || reviewer ? 'submit' : 'forbidden';
  }
  // Returning submitted work requires the review gate because that action owns
  // the mandatory reason, rework counter and assignee notification. Work that
  // is already approved — signed off or delivered — has to pass through the
  // explicit reopen action.
  if (from === 'submitted' && to !== from) return reviewer ? 'review' : 'forbidden';
  if ((from === 'approved' || from === 'signed_off') && to !== from) {
    return canApproveWork(user) ? 'reopen' : 'forbidden';
  }
  // Picking the work up is the doer's other legitimate move, and it belongs to
  // the start action so `startedAt` is stamped and the board is not the record.
  if (from === 'assigned' && to === 'working' && doer && !reviewer) return 'start';

  return reviewer ? 'ok' : 'forbidden';
}

/* ── reading a task's history ────────────────────────────────────── */

/** Was the deliverable handed in on or before the due date? */
export function submittedOnTime(task) {
  if (!task?.dueDate) return null;
  const stamp = task.submittedAt ?? task.completedAt;
  if (!stamp) return null;
  return stamp.slice(0, 10) <= task.dueDate;
}

/**
 * Approved the first time it was submitted — the cleanest signal of a clear
 * brief. Sign-off counts: the manager already said yes, and whether the post
 * has gone out yet says nothing about how clear the brief was.
 */
export function approvedFirstPass(task) {
  const state = taskState(task);
  return (state === 'approved' || state === 'signed_off') && (task.reworkCount ?? 0) === 0;
}
