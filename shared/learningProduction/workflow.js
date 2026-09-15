/**
 * E-Learning Production — the workflow rules.
 *
 * Pure functions, no I/O. The API runs every domain action through
 * `evaluateAsset` before it writes anything, and hands the same verdicts to the
 * browser so a button is only drawn when the server would accept the click.
 *
 * The status of an asset is never set directly. There is no PATCH that takes a
 * status: each change is a named action with its own legal starting states,
 * its own authority, and its own record in the activity log.
 */

import {
  ASSET_TYPES,
  COMPLETE_STATUSES,
  DEFAULT_COURSE_SETTINGS,
  DUE_SOON_DAYS,
  REVIEW_STATUSES,
  SETTINGS_LIMITS,
  STAGE_DEPENDENCIES,
  isComplete,
  isTextAsset,
} from './constants.js';
import { LP_PERMISSIONS as P } from './permissions.js';

/* ------------------------------------------------------------------ */
/* Actions and transitions                                              */
/* ------------------------------------------------------------------ */

export const ASSET_ACTIONS = /** @type {const} */ ([
  'ASSIGN',
  'START',
  'START_REVISION',
  'SAVE_DRAFT',
  'UPLOAD_VERSION',
  'SUBMIT',
  'START_REVIEW',
  'REQUEST_CHANGES',
  'APPROVE',
  'LOCK',
  'REOPEN',
  'OVERRIDE_DEPENDENCY',
]);

const EVERY_STATUS_BUT_LOCKED = [
  'NOT_STARTED',
  'ASSIGNED',
  'IN_PROGRESS',
  'SUBMITTED',
  'UNDER_REVIEW',
  'CHANGES_REQUESTED',
  'RESUBMITTED',
  'APPROVED',
];

/**
 * The states each action may start from.
 *
 * Content cannot change while it is with a reviewer — the reviewer would be
 * commenting on a moving target — so neither a draft save nor an upload is
 * legal from a review state. Uploading over an *approved* asset is legal and
 * starts a new cycle; the approval stays attached to the version it was given
 * to, and the new version has to earn its own.
 */
export const LEGAL_FROM = /** @type {Record<string, readonly string[]>} */ ({
  ASSIGN: EVERY_STATUS_BUT_LOCKED,
  START: ['NOT_STARTED', 'ASSIGNED'],
  START_REVISION: ['APPROVED'],
  SAVE_DRAFT: ['NOT_STARTED', 'ASSIGNED', 'IN_PROGRESS', 'CHANGES_REQUESTED'],
  UPLOAD_VERSION: ['NOT_STARTED', 'ASSIGNED', 'IN_PROGRESS', 'CHANGES_REQUESTED', 'APPROVED'],
  SUBMIT: ['IN_PROGRESS', 'CHANGES_REQUESTED'],
  START_REVIEW: ['SUBMITTED', 'RESUBMITTED'],
  REQUEST_CHANGES: ['SUBMITTED', 'UNDER_REVIEW', 'RESUBMITTED'],
  APPROVE: ['SUBMITTED', 'UNDER_REVIEW', 'RESUBMITTED'],
  LOCK: ['APPROVED'],
  REOPEN: ['APPROVED', 'LOCKED'],
  OVERRIDE_DEPENDENCY: ['NOT_STARTED', 'ASSIGNED'],
});

/** The status an action leads to, or `null` when it is not legal from `status`. */
export function nextStatus(action, status) {
  if (!LEGAL_FROM[action]?.includes(status)) return null;
  switch (action) {
    case 'START':
    case 'START_REVISION':
    case 'REOPEN':
      return 'IN_PROGRESS';
    case 'SAVE_DRAFT':
    case 'UPLOAD_VERSION':
      return status === 'CHANGES_REQUESTED' ? 'CHANGES_REQUESTED' : 'IN_PROGRESS';
    case 'SUBMIT':
      return status === 'CHANGES_REQUESTED' ? 'RESUBMITTED' : 'SUBMITTED';
    case 'START_REVIEW':
      return 'UNDER_REVIEW';
    case 'REQUEST_CHANGES':
      return 'CHANGES_REQUESTED';
    case 'APPROVE':
      return 'APPROVED';
    case 'LOCK':
      return 'LOCKED';
    case 'ASSIGN':
    case 'OVERRIDE_DEPENDENCY':
      return status;
    default:
      return null;
  }
}

/**
 * Putting a name on unstarted work moves it to Assigned; taking the name off
 * again moves it back. Once work has started, changing hands changes nothing
 * about where the work is.
 */
export function statusAfterAssignment(status, assigneeUserId) {
  if (status === 'NOT_STARTED' && assigneeUserId) return 'ASSIGNED';
  if (status === 'ASSIGNED' && !assigneeUserId) return 'NOT_STARTED';
  return status;
}

/* ------------------------------------------------------------------ */
/* Dependencies                                                         */
/* ------------------------------------------------------------------ */

/**
 * What an asset is waiting for.
 *
 * Only unstarted work can be blocked. If a Script is reopened after the Voice
 * Over has started, the recording in progress is not frozen — the dependency
 * gate is the decision to begin, and that decision has already been made.
 */
export function dependencyState(assetType, status, siblingStatuses, { enforce = true, overridden = false } = {}) {
  const required = STAGE_DEPENDENCIES[assetType] ?? [];
  const waitingFor = required.filter((type) => !isComplete(siblingStatuses?.[type]));
  const unstarted = status === 'NOT_STARTED' || status === 'ASSIGNED';
  return {
    required: [...required],
    waitingFor,
    overridden: Boolean(overridden),
    blocked: Boolean(enforce) && !overridden && unstarted && waitingFor.length > 0,
  };
}

/* ------------------------------------------------------------------ */
/* Evaluation                                                           */
/* ------------------------------------------------------------------ */

/**
 * Every action's verdict for one person on one asset.
 *
 * `asset` needs `assetType`, `status`, `assigneeUserId`, `reviewerUserId`,
 * `submittedBy` and `dependencyOverrideAt`. `grants` comes from `buildGrants`.
 * `hasContent` says whether there is something to submit (a version, or a
 * written draft); `versionSinceChanges` whether there is anything that has
 * not been reviewed yet — false when the current version already carries a
 * decision and nothing new has been written or uploaded since.
 *
 * A verdict is `{ allowed, reason }`, where the reason is the API error code
 * the server would answer with — so a disabled button and a refused request
 * explain themselves in the same words.
 */
export function evaluateAsset({
  asset,
  siblingStatuses = {},
  settings = DEFAULT_COURSE_SETTINGS,
  grants,
  userId,
  hasContent = false,
  versionSinceChanges = true,
}) {
  const stage = asset.assetType;
  const status = asset.status;
  const text = isTextAsset(stage);
  const dependencies = dependencyState(stage, status, siblingStatuses, {
    enforce: settings?.enforceDependencies !== false,
    overridden: Boolean(asset.dependencyOverrideAt),
  });

  const isAssignee = Boolean(userId) && asset.assigneeUserId === userId;
  const isReviewer = Boolean(userId) && asset.reviewerUserId === userId;
  const isSubmitter = Boolean(userId) && asset.submittedBy === userId;

  const canWork = isAssignee || grants.has(P.ASSET_EDIT, stage);
  const canSubmit = isAssignee || grants.has(P.ASSET_SUBMIT, stage);
  const canReview = isReviewer || grants.has(P.ASSET_REVIEW, stage) || grants.has(P.ASSET_APPROVE, stage);
  const canApprove = isReviewer || grants.has(P.ASSET_APPROVE, stage);
  // Nobody signs off their own submission. The module administrator is the
  // one escape hatch, for a team of one.
  const ownWork = isSubmitter && !grants.isAdmin;

  const actions = {};
  const decide = (action, authorised, blocker = null) => {
    if (!LEGAL_FROM[action].includes(status)) {
      actions[action] = { allowed: false, reason: status === 'LOCKED' ? 'ASSET_LOCKED' : 'INVALID_TRANSITION' };
    } else if (!authorised) {
      actions[action] = { allowed: false, reason: 'FORBIDDEN' };
    } else if (blocker) {
      actions[action] = { allowed: false, reason: blocker };
    } else {
      actions[action] = { allowed: true, reason: null };
    }
  };

  const blocked = dependencies.blocked ? 'ASSET_BLOCKED' : null;

  decide('ASSIGN', grants.has(P.ASSET_ASSIGN, stage));
  decide('START', canWork, blocked);
  decide('START_REVISION', canWork);
  decide('SAVE_DRAFT', canWork, text ? blocked : 'NOT_SUPPORTED');
  decide('UPLOAD_VERSION', canWork, text ? 'NOT_SUPPORTED' : blocked);
  decide('SUBMIT', canSubmit, !hasContent ? 'CONTENT_REQUIRED' : !versionSinceChanges ? 'NEW_VERSION_REQUIRED' : null);
  decide('START_REVIEW', canReview, ownWork ? 'OWN_WORK' : null);
  decide('REQUEST_CHANGES', canReview, ownWork ? 'OWN_WORK' : null);
  decide('APPROVE', canApprove, ownWork ? 'OWN_WORK' : null);
  decide('LOCK', grants.has(P.ASSET_LOCK, stage));
  decide('REOPEN', grants.has(P.ASSET_REOPEN, stage));
  decide('OVERRIDE_DEPENDENCY', grants.has(P.DEPENDENCY_OVERRIDE, stage), dependencies.blocked ? null : 'NOT_BLOCKED');

  return {
    status,
    dependencies,
    blocked: dependencies.blocked,
    isAssignee,
    isReviewer,
    actions,
    canComment: true,
    canResolveComments: isAssignee || isReviewer || canReview || canWork,
  };
}

/** Throws the refusal as `{ code }` when an action is not allowed — for the services. */
export function assertAllowed(evaluation, action) {
  const verdict = evaluation.actions[action];
  if (!verdict?.allowed) {
    const error = new Error(verdict?.reason ?? 'INVALID_TRANSITION');
    error.code = verdict?.reason ?? 'INVALID_TRANSITION';
    throw error;
  }
}

/**
 * The one thing the page should invite this person to do next.
 *
 * Returns `{ kind, action, disabledReason }`: `kind` is `action` (draw the
 * button), `review` (draw Approve and Request Changes together), `waiting`
 * (the work is with the reviewer), `blocked`, `done`, or `none`. A written
 * asset whose Submit is not ready yet still gets the button, disabled, with
 * the reason beside it — "make the requested changes first" is more useful
 * than a missing button.
 */
export function primaryAction(evaluation, { assetType } = {}) {
  const { actions, status } = evaluation;
  const allowed = (action) => actions[action]?.allowed;
  const text = isTextAsset(assetType);
  const result = (kind, action = null, disabledReason = null) => ({ kind, action, disabledReason });

  if (evaluation.blocked) return result('blocked', allowed('OVERRIDE_DEPENDENCY') ? 'OVERRIDE_DEPENDENCY' : null);
  if (allowed('APPROVE') || allowed('REQUEST_CHANGES')) return result('review', 'APPROVE');
  if (allowed('START')) return result('action', 'START');
  if (allowed('SUBMIT')) return result('action', 'SUBMIT');

  const submitReason = actions.SUBMIT?.reason;
  const makerCouldSubmit = submitReason === 'CONTENT_REQUIRED' || submitReason === 'NEW_VERSION_REQUIRED';
  if (!text && allowed('UPLOAD_VERSION') && status !== 'APPROVED') return result('action', 'UPLOAD_VERSION');
  if (text && makerCouldSubmit && allowed('SAVE_DRAFT')) return result('action', 'SUBMIT', submitReason);

  if (REVIEW_STATUSES.includes(status)) return result('waiting', allowed('START_REVIEW') ? 'START_REVIEW' : null);
  if (status === 'APPROVED') return result('done', allowed('LOCK') ? 'LOCK' : null);
  if (status === 'LOCKED') return result('done');
  return result('none');
}

/* ------------------------------------------------------------------ */
/* Progress                                                             */
/* ------------------------------------------------------------------ */

export function percent(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

/**
 * A lesson is five stages; each approved or locked stage is a fifth of it.
 * In Progress counts for nothing — work that is not signed off is not done.
 */
export function lessonProgress(statuses) {
  const list = Object.values(statuses ?? {});
  const complete = list.filter(isComplete).length;
  return { complete, total: ASSET_TYPES.length, percent: percent(complete, ASSET_TYPES.length) };
}

/** The first stage, in production order, that is not finished yet. */
export function currentStage(statuses) {
  return ASSET_TYPES.find((type) => !isComplete(statuses?.[type])) ?? null;
}

/**
 * One word for a whole lesson, most urgent first: feedback waiting on the
 * maker outranks a submission waiting on the reviewer, which outranks work
 * simply being under way.
 */
export function lessonState(statuses) {
  const list = ASSET_TYPES.map((type) => statuses?.[type] ?? 'NOT_STARTED');
  if (list.every(isComplete)) return 'COMPLETE';
  if (list.includes('CHANGES_REQUESTED')) return 'CHANGES_REQUESTED';
  if (list.some((status) => REVIEW_STATUSES.includes(status))) return 'IN_REVIEW';
  if (list.some((status) => status !== 'NOT_STARTED' && status !== 'ASSIGNED')) return 'IN_PRODUCTION';
  return 'NOT_STARTED';
}

/* ------------------------------------------------------------------ */
/* Dates                                                                */
/* ------------------------------------------------------------------ */

/** Today as `YYYY-MM-DD` in a timezone — a due date is a calendar day, not an instant. */
export function todayIn(timeZone = 'Africa/Cairo', now = new Date()) {
  try {
    return now.toLocaleDateString('en-CA', { timeZone });
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. Negative when `to` is earlier. */
export function daysBetween(from, to) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Where a deadline stands: `OVERDUE`, `DUE_TODAY`, `DUE_SOON` or `null`.
 * Finished work is never late — its deadline has become history.
 */
export function dueState(dueDate, status, today) {
  if (!dueDate || isComplete(status)) return null;
  const days = daysBetween(today, String(dueDate).slice(0, 10));
  if (days === null) return null;
  if (days < 0) return 'OVERDUE';
  if (days === 0) return 'DUE_TODAY';
  if (days <= DUE_SOON_DAYS) return 'DUE_SOON';
  return null;
}

/* ------------------------------------------------------------------ */
/* Course settings and health                                           */
/* ------------------------------------------------------------------ */

/** Defaults filled in, and every number clamped to what makes sense. */
export function normalizeSettings(input) {
  const merged = { ...DEFAULT_COURSE_SETTINGS };
  const source = input && typeof input === 'object' ? input : {};
  for (const [key, [min, max]] of Object.entries(SETTINGS_LIMITS)) {
    const value = Number(source[key]);
    if (Number.isFinite(value)) merged[key] = Math.min(max, Math.max(min, value));
  }
  if (typeof source.enforceDependencies === 'boolean') merged.enforceDependencies = source.enforceDependencies;
  merged.wordsPerMinute = Math.round(merged.wordsPerMinute);
  merged.atRiskProgressGap = Math.round(merged.atRiskProgressGap);
  merged.atRiskDaysBeforeTarget = Math.round(merged.atRiskDaysBeforeTarget);
  return merged;
}

/**
 * Course health, with its reasons.
 *
 * Deliberately simple and deliberately explained: a manager who sees "At Risk"
 * gets the reason next to it, and every threshold is a course setting. The
 * order of the checks is the order of seriousness — a course past its target
 * date is Delayed whatever else is true of it.
 */
export function courseHealth({
  totalAssets = 0,
  completeAssets = 0,
  openAssets = 0,
  overdueAssets = 0,
  startDate = null,
  targetDate = null,
  today,
  settings = DEFAULT_COURSE_SETTINGS,
}) {
  const progress = percent(completeAssets, totalAssets);
  if (totalAssets > 0 && completeAssets === totalAssets) {
    return { health: 'COMPLETED', progress, reasons: [] };
  }

  const delayed = [];
  if (targetDate && daysBetween(today, targetDate) < 0) {
    delayed.push({ code: 'TARGET_PASSED', targetDate });
  }
  const share = openAssets > 0 ? overdueAssets / openAssets : 0;
  if (overdueAssets > 0 && share >= settings.delayedOverdueShare) {
    delayed.push({ code: 'MANY_OVERDUE', count: overdueAssets, share: Math.round(share * 100) });
  }
  if (delayed.length) return { health: 'DELAYED', progress, reasons: delayed };

  const risk = [];
  if (overdueAssets > 0) risk.push({ code: 'SOME_OVERDUE', count: overdueAssets });

  if (startDate && targetDate) {
    const span = daysBetween(startDate, targetDate);
    const elapsed = daysBetween(startDate, today);
    if (span > 0 && elapsed > 0) {
      const expected = Math.min(100, Math.round((elapsed / span) * 100));
      if (expected - progress >= settings.atRiskProgressGap) {
        risk.push({ code: 'BEHIND_SCHEDULE', expected, actual: progress });
      }
    }
  }

  if (targetDate) {
    const daysLeft = daysBetween(today, targetDate);
    if (daysLeft !== null && daysLeft <= settings.atRiskDaysBeforeTarget && progress < 90) {
      risk.push({ code: 'TARGET_CLOSE', daysLeft, actual: progress });
    }
  }

  if (risk.length) return { health: 'AT_RISK', progress, reasons: risk };
  return { health: 'ON_TRACK', progress, reasons: [] };
}

export { COMPLETE_STATUSES, REVIEW_STATUSES };
