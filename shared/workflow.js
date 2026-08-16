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
 * This is the whole of the opt-in. Marketing declares "قيد الموافقة" and the
 * reviewed work waits for the final approver; sales, IT and the rest declare no
 * such column and approving closes the task outright, exactly as before.
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

/** The final Marketing hand-off: approved work may now be marked delivered. */
export function canPublishWork(user) {
  return can(user, PERMISSIONS.TASKS_PUBLISH);
}

/**
 * The override: move a card between any two stages, in either direction,
 * without passing the gate that normally owns that transition.
 *
 * Everything else in this file exists to stop exactly this, so it is a
 * permission of its own rather than something the admin role quietly implies —
 * an administrator holds it because they hold everything, and anybody else has
 * to be given it one box at a time from the Users screen.
 *
 * It is for the case the workflow has no answer to: a task filed in the wrong
 * column, a board being corrected after an import, work that finished somewhere
 * the workspace never saw. It is *not* a faster way to approve — a forced move
 * writes no score, and the stamps it does write are marked for what they are, so
 * the record still says "somebody put this here" rather than "this was earned".
 */
export function canMoveAnyStage(user) {
  return can(user, PERMISSIONS.TASKS_MOVE_ANY);
}

/** A reviewer is whoever may pass judgement on submitted work. */
export function isReviewer(user) {
  return canReviewWork(user);
}

/**
 * Everybody who owes this work.
 *
 * A task used to carry one `assigneeId`, and most of the workspace still reads
 * through this function rather than the field so that rows written before the
 * change — and any the migration has not reached — answer the same question the
 * same way.
 */
export function assigneesOf(task) {
  if (Array.isArray(task?.assigneeIds)) return task.assigneeIds;
  return task?.assigneeId ? [task.assigneeId] : [];
}

export function isAssignee(user, task) {
  return Boolean(user) && assigneesOf(task).includes(user.id);
}

/**
 * Each partner answers their own assignment. One shared status would mean the
 * first person to accept answers for everybody, and the second person's silence
 * would be invisible — which is the thing the accept gate exists to surface.
 */
export function assignmentRows(task) {
  if (Array.isArray(task?.assignments)) return task.assignments;
  if (!task?.assigneeId) return [];
  return [
    {
      userId: task.assigneeId,
      status: task.assignmentStatus ?? 'accepted',
      note: task.assignmentNote ?? '',
      acceptedAt: task.acceptedAt ?? null,
      declinedAt: task.declinedAt ?? null,
      proposedDueDate: task.proposedDueDate ?? null,
    },
  ];
}

export function assignmentFor(task, userId) {
  return assignmentRows(task).find((row) => row.userId === userId) ?? null;
}

/**
 * The person who owes the work. Normally a named partner; on an unassigned task
 * it falls back to whoever filed it, so a task nobody owns is never stuck.
 */
export function isDoer(user, task) {
  if (!user || !task) return false;
  const owners = assigneesOf(task);
  if (owners.length > 0) return owners.includes(user.id);
  return task.createdBy === user.id || canAssignWork(user);
}

/**
 * A named partner must explicitly accept before *they* start work.
 *
 * Asked about a particular person it means their own answer. Asked about nobody
 * in particular — the board checking whether a card may move at all — it means
 * at least one partner has accepted, because on a shared task the one who said
 * yes can legitimately get going without waiting for the others.
 */
export function assignmentReady(task, user) {
  const owners = assigneesOf(task);
  if (owners.length === 0) return true;

  const rows = assignmentRows(task);
  // Legacy rows carry no answers at all and are treated as accepted, exactly as
  // a missing `assignmentStatus` used to be.
  if (rows.length === 0) return true;

  if (user && owners.includes(user.id)) {
    const mine = rows.find((row) => row.userId === user.id);
    return !mine || mine.status === 'accepted';
  }
  return rows.some((row) => row.status === 'accepted');
}

export function canRespondToAssignment(user, task) {
  if (!user || !isAssignee(user, task)) return false;
  const state = taskState(task);
  if (state !== 'assigned' && state !== 'working') return false;
  const mine = assignmentFor(task, user.id);
  return !mine || mine.status !== 'accepted';
}

/** How many partners still owe an answer — what a manager chases. */
export function unansweredAssignees(task) {
  return assignmentRows(task).filter((row) => row.status === 'pending').length;
}

/* ── the gates ───────────────────────────────────────────────────── */

export function canStart(user, task) {
  return (
    taskState(task) === 'assigned' &&
    ((isDoer(user, task) && assignmentReady(task, user)) ||
      (canAssignWork(user) && assigneesOf(task).length === 0))
  );
}

export function canSubmit(user, task) {
  const state = taskState(task);
  return (
    (state === 'assigned' || state === 'working') &&
    ((isDoer(user, task) && assignmentReady(task, user)) ||
      (canAssignWork(user) && assigneesOf(task).length === 0))
  );
}

export function canReview(user, task) {
  return taskState(task) === 'submitted' && canReviewWork(user);
}

/**
 * Publishing is the one move out of sign-off. It is an explicit permission so
 * the final approver is appointed from the Users screen rather than hidden in
 * a display-name check.
 */
export function canPublish(user, task) {
  return taskState(task) === 'signed_off' && canPublishWork(user);
}

/**
 * Whoever carries the Marketing reset permission may pull a task all the way
 * back to Pending. The department check prevents this specialised board action
 * from replacing other departments' normal review/reopen workflows.
 */
export function canResetToPending(user, task) {
  return departmentOfTask(task) === 'marketing' && can(user, PERMISSIONS.TASKS_RESET_PENDING);
}

/**
 * Reopening is a manager's correction, not an employee's undo. It reaches back
 * from sign-off too: work reviewed this morning and not finally approved is the
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
 *   'review'     this is a review/final-approval gate, so use its explicit action
 *   'reopen'     approved work must be reopened explicitly before it can move
 *   'reset'      a permitted Marketing desk is returning it all the way to Pending
 *   'override'   a gate stands here, and `tasks.move_any` is walking through it
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
 * a column literally named "قيد الموافقة". Same type, so the old rule read it as an
 * ordinary move and allowed it.
 */
export function stageWriteVerdict(user, task, nextDepartment, nextStage) {
  const verdict = gatedStageVerdict(user, task, nextDepartment, nextStage);
  // The override is read last, and never in place of `reset`: a Marketing desk
  // that holds both keys keeps its dedicated action, which clears the delivery,
  // review and score stamps as one transaction and tells the assignees why the
  // card moved. Everything else a gate would have refused becomes an override.
  if (verdict === 'ok' || verdict === 'reset') return verdict;
  return canMoveAnyStage(user) ? 'override' : verdict;
}

/** The verdict the workflow itself gives, before any override is considered. */
function gatedStageVerdict(user, task, nextDepartment, nextStage) {
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

  // The explicit reset permission is the escape hatch from every later state.
  // It goes through its own endpoint because moving to Pending must clear the
  // current delivery, review, completion and score stamps as one transaction.
  if (to === 'assigned' && canResetToPending(user, task)) return 'reset';

  const forward = TASK_STATES.indexOf(to) > TASK_STATES.indexOf(from);
  const reviewer = canReviewWork(user);
  const doer = isDoer(user, task);

  // A pending assignment is a real gate. Without this check, dragging the card
  // from an open column to an active one bypasses the explicit accept/decline
  // response even though the dedicated /start action correctly refuses it.
  if (
    from === 'assigned' &&
    to === 'working' &&
    assigneesOf(task).length > 0 &&
    !assignmentReady(task, user)
  ) {
    return doer || reviewer ? 'assignment' : 'forbidden';
  }
  // Sign-off to done is the publish step, and the only move that is allowed to
  // leave the sign-off column without a manager: the decision was already made
  // and scored, this just records that the approved thing went out.
  if (from === 'signed_off' && to === 'approved') {
    return canPublish(user, task) ? 'publish' : 'forbidden';
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
 * Finally approved the first time it was submitted — the cleanest signal of a
 * clear brief. Passing review alone does not count until the final approver has
 * scored and closed it.
 */
export function approvedFirstPass(task) {
  const state = taskState(task);
  return state === 'approved' && (task.reworkCount ?? 0) === 0;
}
