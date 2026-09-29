/**
 * E-Learning Production — production runs, stages and tasks.
 *
 * A course is the long-lived catalogue identity. A production run is one pass
 * of one workflow template over it: new program (AI-assisted or expert-led),
 * or a revamp of an earlier release. A run has stages; a stage has tasks; a
 * task may have a checklist, evidence, a reviewer and a history of
 * submissions. Lesson assets (Outline → Video) keep their own workflow in
 * workflow.js; the run reads them through automatic gates.
 *
 * Everything here is pure. The API runs every task action through
 * `evaluateTask` before writing, recomputes stages with `computeRun` after,
 * and hands the same verdicts to the browser — so a button is only drawn
 * when the server would accept the click, and a disabled one says why.
 */

import { ASSET_TYPES, DUE_SOON_DAYS, STAGE_KEYS } from './constants.js';
import { LP_PERMISSIONS as P } from './permissions.js';
import { daysBetween, percent } from './workflow.js';

/* ------------------------------------------------------------------ */
/* Vocabulary                                                           */
/* ------------------------------------------------------------------ */

/** Every stage key any template can produce — defined beside the other enums. */
export { STAGE_KEYS };

export const RUN_STATUSES = /** @type {const} */ (['ACTIVE', 'ON_HOLD', 'RELEASED', 'CLOSED', 'CANCELLED']);
export const OPEN_RUN_STATUSES = /** @type {const} */ (['ACTIVE', 'ON_HOLD']);

/** Stage status is derived from its tasks and prerequisites, and stored so lists can filter on it. */
export const STAGE_STATUSES = /** @type {const} */ (['BLOCKED', 'READY', 'IN_PROGRESS', 'DONE', 'SKIPPED']);

/**
 * Task statuses. "Blocked" and "Ready" are not stored: they are what an
 * unstarted task *is* given its prerequisites, and a stored copy would go
 * stale the moment a prerequisite moved.
 */
export const TASK_STATUSES = /** @type {const} */ ([
  'NOT_STARTED',
  'IN_PROGRESS',
  'SUBMITTED',
  'UNDER_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
  'DONE',
  'WAIVED',
]);

export const TASK_KINDS = /** @type {const} */ (['WORK', 'REVIEW', 'HANDOFF', 'ISSUES', 'SIGNOFF', 'AUTO']);
export const TASK_CLASSIFICATIONS = /** @type {const} */ (['REQUIRED', 'OPTIONAL', 'CONDITIONAL']);
export const ORIGINS = /** @type {const} */ (['WORKBOOK', 'WORKBOOK_HIDDEN', 'OLD_PROMPT', 'PROPOSED']);
export const CHECK_STATUSES = /** @type {const} */ (['PENDING', 'DONE', 'ISSUE', 'NOT_APPLICABLE']);
export const EVIDENCE_KINDS = /** @type {const} */ (['FILE', 'LINK', 'NOTE']);
export const SUBMISSION_DECISIONS = /** @type {const} */ (['PENDING', 'APPROVED', 'CHANGES_REQUESTED']);

export const ISSUE_SEVERITIES = /** @type {const} */ (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
/** Where an issue is sent — First Dry Run r26 names Operations, Content and Product. */
export const ISSUE_AREAS = /** @type {const} */ (['CONTENT', 'OPERATIONS', 'PRODUCT', 'MEDIA', 'PLATFORM', 'OTHER']);
export const ISSUE_STATUSES = /** @type {const} */ (['OPEN', 'IN_PROGRESS', 'FIXED', 'VERIFIED', 'WONT_FIX']);
export const OPEN_ISSUE_STATUSES = /** @type {const} */ (['OPEN', 'IN_PROGRESS', 'FIXED']);
export const BLOCKING_SEVERITIES = /** @type {const} */ (['HIGH', 'CRITICAL']);

export const RELEASE_KINDS = /** @type {const} */ (['RELEASE', 'LEGACY_BASELINE']);
export const RELEASE_STATUSES = /** @type {const} */ (['CANDIDATE', 'SIGNED_OFF', 'PUBLISHED', 'SUPERSEDED', 'ROLLED_BACK', 'WITHDRAWN']);

/** What a revamp decides about each piece of the source release. */
export const IMPACT_DECISIONS = /** @type {const} */ (['KEEP', 'CHANGE', 'REMOVE']);

export const CANDIDATE_STATUSES = /** @type {const} */ ([
  'SOURCED',
  'CONTACTED',
  'SCREENING',
  'TECHNICAL_DISCUSSION',
  'PASSED',
  'ONBOARDING',
  'CONTRACTED',
  'REJECTED',
  'WITHDRAWN',
]);
export const CANDIDATE_SOURCES = /** @type {const} */ (['LINKEDIN', 'APOLLO', 'REFERRAL', 'OTHER']);
export const CANDIDATE_FILE_KINDS = /** @type {const} */ (['CV', 'SAMPLE', 'ASSESSMENT', 'CONTRACT', 'OTHER']);

export const TASK_ACTIONS = /** @type {const} */ ([
  'ASSIGN',
  'START',
  'EDIT',
  'SUBMIT',
  'COMPLETE',
  'START_REVIEW',
  'REQUEST_CHANGES',
  'APPROVE',
  'WAIVE',
  'REOPEN',
  'OVERRIDE_DEPENDENCY',
]);

const COMPLETE_TASK = ['APPROVED', 'DONE'];
const REVIEW_TASK = ['SUBMITTED', 'UNDER_REVIEW'];

export function isTaskComplete(status) {
  return COMPLETE_TASK.includes(status);
}

export function isTaskInReview(status) {
  return REVIEW_TASK.includes(status);
}

/** Whether a task holds its stage open: required and conditional tasks do, until done or waived. */
export function isTaskGating(task) {
  return task.classification !== 'OPTIONAL' && task.status !== 'WAIVED';
}

/* ------------------------------------------------------------------ */
/* Transitions                                                          */
/* ------------------------------------------------------------------ */

/** The states each action may start from. Anything else is refused as INVALID_TRANSITION. */
export const TASK_LEGAL_FROM = /** @type {Record<string, readonly string[]>} */ ({
  ASSIGN: ['NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED'],
  START: ['NOT_STARTED'],
  // Ticking a checklist item or adding evidence. Doing it on unstarted work starts it.
  EDIT: ['NOT_STARTED', 'IN_PROGRESS', 'CHANGES_REQUESTED'],
  SUBMIT: ['IN_PROGRESS', 'CHANGES_REQUESTED'],
  COMPLETE: ['IN_PROGRESS'],
  START_REVIEW: ['SUBMITTED'],
  REQUEST_CHANGES: ['SUBMITTED', 'UNDER_REVIEW'],
  APPROVE: ['SUBMITTED', 'UNDER_REVIEW'],
  WAIVE: ['NOT_STARTED', 'IN_PROGRESS', 'CHANGES_REQUESTED'],
  REOPEN: ['APPROVED', 'DONE', 'WAIVED'],
  OVERRIDE_DEPENDENCY: ['NOT_STARTED'],
});

/** The status an action leads to, or null when it is not legal from `status`. */
export function nextTaskStatus(action, status) {
  if (!TASK_LEGAL_FROM[action]?.includes(status)) return null;
  switch (action) {
    case 'START':
    case 'REOPEN':
      return 'IN_PROGRESS';
    case 'EDIT':
      return status === 'NOT_STARTED' ? 'IN_PROGRESS' : status;
    case 'SUBMIT':
      return 'SUBMITTED';
    case 'COMPLETE':
      return 'DONE';
    case 'START_REVIEW':
      return 'UNDER_REVIEW';
    case 'REQUEST_CHANGES':
      return 'CHANGES_REQUESTED';
    case 'APPROVE':
      return 'APPROVED';
    case 'WAIVE':
      return 'WAIVED';
    case 'ASSIGN':
    case 'OVERRIDE_DEPENDENCY':
      return status;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Evaluating one task for one person                                   */
/* ------------------------------------------------------------------ */

/** A checklist line counts as addressed once it is done, not applicable, or logged as an issue. */
export function checklistState(items = []) {
  const active = items.filter((entry) => !entry.archived);
  const required = active.filter((entry) => entry.required);
  const pendingRequired = required.filter((entry) => entry.status === 'PENDING');
  return {
    total: active.length,
    addressed: active.filter((entry) => entry.status !== 'PENDING').length,
    required: required.length,
    pendingRequired: pendingRequired.length,
    issues: active.filter((entry) => entry.status === 'ISSUE').length,
  };
}

/**
 * Every action's verdict for one person on one task.
 *
 * `task` carries `status`, `kind`, `classification`, `role`, `reviewerRole`,
 * `requiresApproval`, `requiresEvidence`, `assigneeUserId`, `reviewerUserId`,
 * `submittedBy`, `dependencyOverrideAt` and `stageKey`. `roles` are the
 * person's roles on this course and run. `blockers` come from `computeRun`.
 * `evidenceCount` counts live evidence; `evidenceSinceDecision` counts
 * evidence added after the last review decision.
 *
 * A verdict is `{ allowed, reason }`, where the reason is the API error code.
 */
export function evaluateTask({
  task,
  grants,
  roles = [],
  userId,
  blockers = [],
  checklist = [],
  evidenceCount = 0,
  evidenceSinceDecision = 0,
  stageSkipped = false,
  runOpen = true,
}) {
  const stage = task.stageKey;
  const status = task.status;
  const isAssignee = Boolean(userId) && task.assigneeUserId === userId;
  const isReviewer = Boolean(userId) && task.reviewerUserId === userId;
  const isSubmitter = Boolean(userId) && task.submittedBy === userId;
  const holds = (role) => Boolean(role) && roles.includes(role);

  const canWork = isAssignee || grants.has(P.TASK_WORK, stage) || holds(task.role);
  const canAssign = grants.has(P.TASK_ASSIGN, stage);
  const canReview = isReviewer || grants.has(P.TASK_REVIEW, stage) || grants.has(P.TASK_APPROVE, stage) || holds(task.reviewerRole);
  const canApprove = isReviewer || grants.has(P.TASK_APPROVE, stage) || holds(task.reviewerRole);
  // Nobody signs off their own submission. An administrator may, but only
  // with a stated reason, and the override is kept with the decision.
  const ownWork = isSubmitter;

  const blocked = status === 'NOT_STARTED' && !task.dependencyOverrideAt && blockers.length > 0;
  const checks = checklistState(checklist);
  const automatic = task.kind === 'AUTO';

  const actions = {};
  const decide = (action, authorised, blocker = null) => {
    if (!runOpen) actions[action] = { allowed: false, reason: 'RUN_CLOSED' };
    else if (stageSkipped) actions[action] = { allowed: false, reason: 'STAGE_SKIPPED' };
    else if (automatic) actions[action] = { allowed: false, reason: 'AUTOMATIC' };
    else if (!TASK_LEGAL_FROM[action].includes(status)) actions[action] = { allowed: false, reason: 'INVALID_TRANSITION' };
    else if (!authorised) actions[action] = { allowed: false, reason: 'FORBIDDEN' };
    else if (blocker) actions[action] = { allowed: false, reason: blocker };
    else actions[action] = { allowed: true, reason: null };
  };

  const isBlocked = blocked ? 'TASK_BLOCKED' : null;
  const contentMissing = checks.pendingRequired > 0 ? 'CHECKLIST_INCOMPLETE' : task.requiresEvidence && evidenceCount === 0 ? 'EVIDENCE_REQUIRED' : null;
  const resubmitNeedsNew =
    status === 'CHANGES_REQUESTED' && task.requiresEvidence && evidenceSinceDecision === 0 ? 'NEW_EVIDENCE_REQUIRED' : null;

  decide('ASSIGN', canAssign);
  decide('START', canWork, isBlocked);
  decide('EDIT', canWork, isBlocked);
  decide('SUBMIT', canWork, !task.requiresApproval ? 'NOT_SUPPORTED' : isBlocked ?? contentMissing ?? resubmitNeedsNew);
  decide('COMPLETE', canWork, task.requiresApproval ? 'APPROVAL_REQUIRED' : contentMissing);
  decide('START_REVIEW', canReview, ownWork && !grants.isAdmin ? 'OWN_WORK' : null);
  decide('REQUEST_CHANGES', canReview, ownWork && !grants.isAdmin ? 'OWN_WORK' : null);
  decide('APPROVE', canApprove, ownWork && !grants.isAdmin ? 'OWN_WORK' : null);
  decide(
    'WAIVE',
    task.classification === 'REQUIRED' ? grants.isAdmin : grants.has(P.TASK_WAIVE, stage),
    null
  );
  if (!actions.WAIVE.allowed && actions.WAIVE.reason === 'FORBIDDEN' && task.classification === 'REQUIRED') {
    actions.WAIVE = { allowed: false, reason: 'REQUIRED_TASK' };
  }
  decide('REOPEN', grants.has(P.TASK_REOPEN, stage));
  decide('OVERRIDE_DEPENDENCY', grants.has(P.DEPENDENCY_OVERRIDE, stage), blocked ? null : 'NOT_BLOCKED');

  return {
    status,
    blocked,
    blockers,
    isAssignee,
    isReviewer,
    /** An administrator approving their own submission must give a reason. */
    approvalNeedsOverride: ownWork && grants.isAdmin && actions.APPROVE.allowed,
    checklist: checks,
    evidenceCount,
    actions,
    canView: true,
    canComment: runOpen && (canWork || canReview || canAssign || roles.some((role) => role !== 'VIEWER')),
  };
}

/**
 * The one thing the task drawer should invite this person to do next —
 * the same shape as `primaryAction` for assets.
 */
export function primaryTaskAction(evaluation, task) {
  const { actions, status } = evaluation;
  const allowed = (action) => actions[action]?.allowed;
  const result = (kind, action = null, disabledReason = null) => ({ kind, action, disabledReason });

  if (task.kind === 'AUTO') return result(isTaskComplete(status) ? 'done' : 'automatic');
  if (status === 'WAIVED') return result('waived');
  if (evaluation.blocked) return result('blocked', allowed('OVERRIDE_DEPENDENCY') ? 'OVERRIDE_DEPENDENCY' : null);
  if (allowed('APPROVE') || allowed('REQUEST_CHANGES')) return result('review', 'APPROVE');
  if (allowed('START')) return result('action', 'START');
  if (allowed('SUBMIT')) return result('action', 'SUBMIT');
  if (allowed('COMPLETE')) return result('action', 'COMPLETE');
  const pending = task.requiresApproval ? actions.SUBMIT?.reason : actions.COMPLETE?.reason;
  if (['CHECKLIST_INCOMPLETE', 'EVIDENCE_REQUIRED', 'NEW_EVIDENCE_REQUIRED'].includes(pending) && allowed('EDIT')) {
    return result('action', task.requiresApproval ? 'SUBMIT' : 'COMPLETE', pending);
  }
  if (isTaskInReview(status)) return result('waiting', allowed('START_REVIEW') ? 'START_REVIEW' : null);
  if (isTaskComplete(status)) return result('done');
  return result('none');
}

/* ------------------------------------------------------------------ */
/* Automatic gates                                                      */
/* ------------------------------------------------------------------ */

/**
 * The facts an automatic gate is judged on, gathered by the server:
 *
 *   assets: { [assetType]: { total, approved, submitted, reviewed, changesRequested, openComments } }
 *           counting only applicable assets of non-archived lessons;
 *   issues: { [stageKey]: { open, total } };
 *   releasePublished: boolean.
 *
 * Returns `{ satisfied, done, total }` so the interface can say "12 of 18".
 */
export function evaluateRule(rule, facts, { lessonAssetTypes = ASSET_TYPES } = {}) {
  if (!rule) return { satisfied: false, done: 0, total: 0 };
  const types = rule.assetTypes ?? lessonAssetTypes;
  const sum = (field) => types.reduce((total, type) => total + (facts?.assets?.[type]?.[field] ?? 0), 0);

  switch (rule.type) {
    case 'ASSETS_APPROVED': {
      const total = sum('total');
      const done = sum('approved');
      const quiet = !rule.noOpenComments || sum('openComments') === 0;
      return { satisfied: total > 0 && done === total && quiet, done, total, ...(rule.noOpenComments ? { openComments: sum('openComments') } : {}) };
    }
    case 'ASSETS_SUBMITTED': {
      const total = sum('total');
      const done = sum('submitted');
      return { satisfied: total > 0 && done === total, done, total };
    }
    case 'ASSETS_REVIEWED': {
      const total = sum('total');
      const done = sum('reviewed');
      return { satisfied: total > 0 && done === total, done, total };
    }
    case 'ASSET_FEEDBACK_ADDRESSED': {
      const total = sum('total');
      const reviewed = sum('reviewed');
      const waiting = sum('changesRequested');
      const open = sum('openComments');
      return {
        satisfied: total > 0 && reviewed === total && waiting === 0 && open === 0,
        done: Math.max(0, total - waiting),
        total,
        openComments: open,
      };
    }
    case 'ISSUES_RESOLVED': {
      const open = rule.stages.reduce((n, key) => n + (facts?.issues?.[key]?.open ?? 0), 0);
      const total = rule.stages.reduce((n, key) => n + (facts?.issues?.[key]?.total ?? 0), 0);
      return { satisfied: open === 0, done: total - open, total };
    }
    case 'RELEASE_PUBLISHED':
      return { satisfied: Boolean(facts?.releasePublished), done: facts?.releasePublished ? 1 : 0, total: 1 };
    default:
      return { satisfied: false, done: 0, total: 0 };
  }
}

/* ------------------------------------------------------------------ */
/* Computing a whole run                                                */
/* ------------------------------------------------------------------ */

const STAGE_DONE = ['DONE', 'SKIPPED'];

/**
 * Derive every stage's status and every task's blockers, in order.
 *
 * `stages` are in sort order with `key`, `after`, `skippedAt`; `tasks` carry
 * `id`, `key`, `stageKey`, `after`, `status`, `kind`, `rule`. Automatic tasks
 * get their status from their rule — but only once they are unblocked, so
 * "every dry-run issue fixed" is not true merely because the dry run has not
 * happened yet.
 *
 * Returns `{ stages, tasks, changes }` where `changes` lists the automatic
 * task statuses and stage statuses that differ from what was passed in, for
 * the server to persist.
 */
export function computeRun({ stages, tasks, facts = {}, lessonAssetTypes = ASSET_TYPES }) {
  const stageState = new Map();
  const taskByKey = new Map(tasks.map((entry) => [entry.key, { ...entry }]));
  const outTasks = [];
  const outStages = [];
  const changes = { tasks: [], stages: [] };

  for (const stage of stages) {
    const stagePrereqs = (stage.after ?? [])
      .map((key) => stageState.get(key))
      .filter((entry) => entry && !STAGE_DONE.includes(entry.status))
      .map((entry) => ({ type: 'STAGE', key: entry.key, label: entry.label ?? null, status: entry.status, ownerRole: entry.ownerRole ?? null }));

    const stageTasks = tasks.filter((entry) => entry.stageKey === stage.key);
    const computedTasks = [];
    for (const original of stageTasks) {
      const current = taskByKey.get(original.key);
      const taskPrereqs = (original.after ?? [])
        .map((key) => taskByKey.get(key))
        .filter((entry) => entry && !isTaskComplete(entry.status) && entry.status !== 'WAIVED')
        .map((entry) => ({
          type: 'TASK',
          key: entry.key,
          id: entry.id ?? null,
          label: entry.label ?? null,
          status: entry.status,
          assigneeUserId: entry.assigneeUserId ?? null,
          role: entry.role ?? null,
        }));
      const blockers = [...stagePrereqs, ...taskPrereqs];

      let status = current.status;
      let gate = null;
      if (original.kind === 'AUTO' && !stage.skippedAt) {
        gate = evaluateRule(original.rule, facts, { lessonAssetTypes });
        const waiting = blockers.length > 0;
        status = waiting ? 'NOT_STARTED' : gate.satisfied ? 'DONE' : 'IN_PROGRESS';
        if (status !== original.status) changes.tasks.push({ id: original.id, key: original.key, from: original.status, to: status });
      }
      current.status = status;
      computedTasks.push({ ...original, status, blockers, gate });
    }

    let status;
    const gating = computedTasks.filter(isTaskGating);
    const prerequisitesMet = stagePrereqs.length === 0;
    if (stage.skippedAt) status = 'SKIPPED';
    else if (gating.every((entry) => isTaskComplete(entry.status))) status = prerequisitesMet || gating.length > 0 ? 'DONE' : 'BLOCKED';
    else if (computedTasks.some((entry) => entry.status !== 'NOT_STARTED' && entry.status !== 'WAIVED')) status = 'IN_PROGRESS';
    else status = prerequisitesMet ? 'READY' : 'BLOCKED';

    if (status !== stage.status) changes.stages.push({ id: stage.id, key: stage.key, from: stage.status ?? null, to: status });
    const computedStage = {
      ...stage,
      status,
      blockers: stagePrereqs,
      progress: {
        done: gating.filter((entry) => isTaskComplete(entry.status)).length,
        total: gating.length,
        waived: computedTasks.filter((entry) => entry.status === 'WAIVED').length,
        optional: computedTasks.filter((entry) => entry.classification === 'OPTIONAL').length,
      },
    };
    stageState.set(stage.key, computedStage);
    outStages.push(computedStage);
    outTasks.push(...computedTasks);
  }

  return { stages: outStages, tasks: outTasks, changes };
}

/** The first stage, in order, that is neither done nor skipped — "where the run is". */
export function currentRunStage(stages) {
  return stages.find((entry) => !STAGE_DONE.includes(entry.status)) ?? null;
}

/* ------------------------------------------------------------------ */
/* Progress and readiness                                               */
/* ------------------------------------------------------------------ */

/**
 * Four separate answers, never blended into one number:
 *
 *   content    — share of applicable lesson assets approved;
 *   workflow   — share of gating tasks done across stages not skipped;
 *   readiness  — the release checks, each with its own verdict;
 *   published  — whether a release of this run is live.
 *
 * Approving every lesson asset moves "content" to 100% and nothing else: a
 * program with deployment and UAT still open is not complete.
 */
export function runProgress({ stages, tasks, facts = {}, lessonAssetTypes = ASSET_TYPES, scenario }) {
  const live = new Set(stages.filter((entry) => entry.status !== 'SKIPPED').map((entry) => entry.key));
  const gating = tasks.filter((entry) => live.has(entry.stageKey) && isTaskGating(entry));
  const workflowDone = gating.filter((entry) => isTaskComplete(entry.status)).length;

  const assetTotal = lessonAssetTypes.reduce((n, type) => n + (facts?.assets?.[type]?.total ?? 0), 0);
  const assetApproved = lessonAssetTypes.reduce((n, type) => n + (facts?.assets?.[type]?.approved ?? 0), 0);

  const byKey = new Map(tasks.map((entry) => [entry.key, entry]));
  const stageOf = new Map(stages.map((entry) => [entry.key, entry]));
  const taskCheck = (key, id) => {
    const found = byKey.get(key);
    if (!found || stageOf.get(found.stageKey)?.status === 'SKIPPED') return null;
    return { id, ok: found.status === 'APPROVED', status: found.status, taskKey: key };
  };

  const legacy = scenario === 'LEGACY';
  const openStages = stages.filter((entry) => entry.key !== 'RELEASE' && !STAGE_DONE.includes(entry.status)).map((entry) => entry.key);
  const checks = legacy
    ? []
    : [
        { id: 'STAGES_COMPLETE', ok: openStages.length === 0, open: openStages },
        { id: 'CONTENT_APPROVED', ok: assetTotal > 0 && assetApproved === assetTotal, done: assetApproved, total: assetTotal },
        { id: 'NO_BLOCKING_ISSUES', ok: (facts?.blockingIssues ?? 0) === 0, count: facts?.blockingIssues ?? 0 },
        taskCheck('deploy.verify', 'DEPLOYMENT_VERIFIED'),
        taskCheck('uat.signoff', 'UAT_SIGNED_OFF'),
        { id: 'RELEASE_SIGNED_OFF', ok: Boolean(facts?.releaseSignedOff), gate: true },
      ].filter(Boolean);

  const beforeSignoff = checks.filter((entry) => !entry.gate);
  return {
    content: { done: assetApproved, total: assetTotal, percent: percent(assetApproved, assetTotal) },
    workflow: {
      done: workflowDone,
      total: gating.length,
      percent: percent(workflowDone, gating.length),
      waived: tasks.filter((entry) => live.has(entry.stageKey) && entry.status === 'WAIVED').length,
      skippedStages: stages.filter((entry) => entry.status === 'SKIPPED').length,
    },
    readiness: {
      assessed: !legacy,
      checks,
      readyForSignoff: !legacy && beforeSignoff.every((entry) => entry.ok),
      readyToPublish: !legacy && checks.every((entry) => entry.ok),
    },
    published: facts?.publishedRelease ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Dates and health                                                     */
/* ------------------------------------------------------------------ */

/** OVERDUE, DUE_TODAY, DUE_SOON or null. Done and waived work is never late. */
export function taskDueState(dueDate, status, today) {
  if (!dueDate || isTaskComplete(status) || status === 'WAIVED') return null;
  const days = daysBetween(today, String(dueDate).slice(0, 10));
  if (days === null) return null;
  if (days < 0) return 'OVERDUE';
  if (days === 0) return 'DUE_TODAY';
  if (days <= DUE_SOON_DAYS) return 'DUE_SOON';
  return null;
}

/**
 * A run's health, with reasons — the same thresholds as a course's
 * (`courseHealth`), measured on workflow progress rather than on assets.
 */
export function runHealth({ status, workflowPercent = 0, overdue = 0, open = 0, startDate, targetDate, today, settings }) {
  if (status === 'RELEASED') return { health: 'COMPLETED', reasons: [] };
  const delayed = [];
  if (targetDate && daysBetween(today, targetDate) < 0) delayed.push({ code: 'TARGET_PASSED', targetDate });
  const share = open > 0 ? overdue / open : 0;
  if (overdue > 0 && share >= (settings?.delayedOverdueShare ?? 0.1)) delayed.push({ code: 'MANY_OVERDUE', count: overdue, share: Math.round(share * 100) });
  if (delayed.length) return { health: 'DELAYED', reasons: delayed };

  const risk = [];
  if (overdue > 0) risk.push({ code: 'SOME_OVERDUE', count: overdue });
  if (startDate && targetDate) {
    const span = daysBetween(startDate, targetDate);
    const elapsed = daysBetween(startDate, today);
    if (span > 0 && elapsed > 0) {
      const expected = Math.min(100, Math.round((elapsed / span) * 100));
      if (expected - workflowPercent >= (settings?.atRiskProgressGap ?? 15)) risk.push({ code: 'BEHIND_SCHEDULE', expected, actual: workflowPercent });
    }
  }
  if (targetDate) {
    const daysLeft = daysBetween(today, targetDate);
    if (daysLeft !== null && daysLeft <= (settings?.atRiskDaysBeforeTarget ?? 7) && workflowPercent < 90) {
      risk.push({ code: 'TARGET_CLOSE', daysLeft, actual: workflowPercent });
    }
  }
  if (risk.length) return { health: 'AT_RISK', reasons: risk };
  return { health: 'ON_TRACK', reasons: [] };
}

/** The next release label after `previous` ("r1.0.0" → "r2.0.0" for a revamp, "r1.1.0" otherwise). */
export function nextReleaseLabel(previous, { major = false } = {}) {
  const match = /^r?(\d+)\.(\d+)\.(\d+)$/.exec(String(previous ?? '').trim());
  if (!match) return 'r1.0.0';
  const [x, y] = [Number(match[1]), Number(match[2])];
  return major ? `r${x + 1}.0.0` : `r${x}.${y + 1}.0`;
}
