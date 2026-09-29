/**
 * E-Learning Production — who may do what.
 *
 * Three sources of authority, checked in this order, and the first yes wins:
 *
 *   1. **Workspace grants.** The `elearning_production.*` keys live in the
 *      workspace catalogue (`shared/permissions.js`), so an administrator grants
 *      them from the Users screen like every other key. A workspace key reaches
 *      every course in the organization.
 *   2. **Course roles.** Membership of one course, with one or more roles. A
 *      role grants keys *inside that course only*, and many of them only for
 *      certain stages — a PPT Designer may upload slides, not approve a script.
 *   3. **Named responsibility.** The assignee of an asset may work on it and
 *      submit it; its named reviewer may review and approve it. A manager who
 *      puts somebody's name on the work has already made the decision a role
 *      would otherwise have to encode.
 *
 * The server always re-checks. The browser only reads the verdicts the API
 * returns with each asset — it never computes them.
 */

import { ASSET_TYPES, STAGE_KEYS } from './constants.js';

export const LP_PERMISSIONS = /** @type {const} */ ({
  VIEW: 'elearning_production.view',
  COURSE_CREATE: 'elearning_production.course.create',
  COURSE_EDIT: 'elearning_production.course.edit',
  COURSE_DELETE: 'elearning_production.course.delete',
  LESSON_CREATE: 'elearning_production.lesson.create',
  LESSON_EDIT: 'elearning_production.lesson.edit',
  ASSET_ASSIGN: 'elearning_production.asset.assign',
  ASSET_EDIT: 'elearning_production.asset.edit',
  ASSET_SUBMIT: 'elearning_production.asset.submit',
  ASSET_REVIEW: 'elearning_production.asset.review',
  ASSET_APPROVE: 'elearning_production.asset.approve',
  ASSET_REOPEN: 'elearning_production.asset.reopen',
  ASSET_LOCK: 'elearning_production.asset.lock',
  DEPENDENCY_OVERRIDE: 'elearning_production.dependency.override',
  TEAM_MANAGE: 'elearning_production.team.manage',
  REPORT_VIEW: 'elearning_production.report.view',
  ADMIN: 'elearning_production.admin',
  // Production runs. Task keys are scoped to stage keys the way asset keys
  // are scoped to asset types. Holding a task's named role (its "role" or
  // "reviewerRole") also lets a person work on or review that one task — see
  // evaluateTask in runs.js.
  RUN_MANAGE: 'elearning_production.run.manage',
  TASK_WORK: 'elearning_production.task.work',
  TASK_ASSIGN: 'elearning_production.task.assign',
  TASK_REVIEW: 'elearning_production.task.review',
  TASK_APPROVE: 'elearning_production.task.approve',
  TASK_WAIVE: 'elearning_production.task.waive',
  TASK_REOPEN: 'elearning_production.task.reopen',
  RELEASE_SIGNOFF: 'elearning_production.release.signoff',
  RELEASE_PUBLISH: 'elearning_production.release.publish',
  TEMPLATE_ADMIN: 'elearning_production.template.admin',
  // Candidate CVs, assessments and contracts. Narrower than seeing the course.
  EXPERTS_SENSITIVE: 'elearning_production.experts.sensitive',
});

export const LP_PERMISSION_LIST = Object.values(LP_PERMISSIONS);

const P = LP_PERMISSIONS;
/** Every scope: the five asset types and every stage key. */
const ALL = [...ASSET_TYPES, ...STAGE_KEYS];

/**
 * What each course role grants, as `{ permission: stages }`.
 *
 * Stage-less keys (team, lessons, reports) carry every stage so one lookup
 * shape serves both. `VIEWER` grants nothing: membership alone is what lets a
 * person open the course.
 */
export const ROLE_GRANTS = /** @type {Record<string, Record<string, readonly string[]>>} */ ({
  PRODUCTION_MANAGER: {
    [P.COURSE_EDIT]: ALL,
    [P.COURSE_DELETE]: ALL,
    [P.LESSON_CREATE]: ALL,
    [P.LESSON_EDIT]: ALL,
    [P.ASSET_ASSIGN]: ALL,
    [P.ASSET_EDIT]: ALL,
    [P.ASSET_SUBMIT]: ALL,
    [P.ASSET_REVIEW]: ALL,
    [P.ASSET_APPROVE]: ALL,
    [P.ASSET_REOPEN]: ALL,
    [P.ASSET_LOCK]: ALL,
    [P.DEPENDENCY_OVERRIDE]: ALL,
    [P.TEAM_MANAGE]: ALL,
    [P.REPORT_VIEW]: ALL,
    [P.RUN_MANAGE]: ALL,
    [P.TASK_WORK]: ALL,
    [P.TASK_ASSIGN]: ALL,
    [P.TASK_REVIEW]: ALL,
    [P.TASK_APPROVE]: ALL,
    [P.TASK_WAIVE]: ALL,
    [P.TASK_REOPEN]: ALL,
    [P.RELEASE_SIGNOFF]: ALL,
    [P.RELEASE_PUBLISH]: ALL,
    [P.EXPERTS_SENSITIVE]: ALL,
  },
  COURSE_MANAGER: {
    [P.COURSE_EDIT]: ALL,
    [P.LESSON_CREATE]: ALL,
    [P.LESSON_EDIT]: ALL,
    [P.ASSET_ASSIGN]: ALL,
    [P.ASSET_REVIEW]: ALL,
    [P.ASSET_APPROVE]: ALL,
    [P.ASSET_REOPEN]: ALL,
    [P.ASSET_LOCK]: ALL,
    [P.DEPENDENCY_OVERRIDE]: ALL,
    [P.TEAM_MANAGE]: ALL,
    [P.REPORT_VIEW]: ALL,
    // Plans, assigns, reviews and releases — but does not see candidate
    // records: that stays with the coordinator and the production manager.
    [P.RUN_MANAGE]: ALL,
    [P.TASK_ASSIGN]: ALL,
    [P.TASK_REVIEW]: ALL,
    [P.TASK_APPROVE]: ALL,
    [P.TASK_WAIVE]: ALL,
    [P.TASK_REOPEN]: ALL,
    [P.RELEASE_SIGNOFF]: ALL,
    [P.RELEASE_PUBLISH]: ALL,
  },
  SUBJECT_MATTER_EXPERT: {
    [P.ASSET_REVIEW]: ['OUTLINE', 'PPT', 'SCRIPT', 'VIDEO'],
    [P.ASSET_APPROVE]: ['OUTLINE', 'SCRIPT'],
  },
  INSTRUCTIONAL_DESIGNER: {
    [P.ASSET_EDIT]: ['OUTLINE', 'SCRIPT'],
    [P.ASSET_SUBMIT]: ['OUTLINE', 'SCRIPT'],
    [P.ASSET_REVIEW]: ['OUTLINE', 'PPT', 'SCRIPT'],
  },
  OUTLINE_WRITER: { [P.ASSET_EDIT]: ['OUTLINE'], [P.ASSET_SUBMIT]: ['OUTLINE'] },
  SCRIPT_WRITER: { [P.ASSET_EDIT]: ['SCRIPT'], [P.ASSET_SUBMIT]: ['SCRIPT'] },
  PPT_DESIGNER: { [P.ASSET_EDIT]: ['PPT'], [P.ASSET_SUBMIT]: ['PPT'] },
  VOICE_OVER_ARTIST: { [P.ASSET_EDIT]: ['VOICE_OVER'], [P.ASSET_SUBMIT]: ['VOICE_OVER'] },
  AUDIO_REVIEWER: { [P.ASSET_REVIEW]: ['VOICE_OVER'], [P.ASSET_APPROVE]: ['VOICE_OVER'] },
  VIDEO_EDITOR: { [P.ASSET_EDIT]: ['VIDEO'], [P.ASSET_SUBMIT]: ['VIDEO'] },
  QUALITY_REVIEWER: { [P.ASSET_REVIEW]: ASSET_TYPES, [P.ASSET_APPROVE]: ASSET_TYPES },
  // The roles below work mostly through tasks that name them. What they get
  // here is what reaches beyond one named task.
  RESEARCHER: {},
  EXPERT_COORDINATOR: {
    [P.TASK_WORK]: ['EXPERT_ACQUISITION'],
    [P.TASK_ASSIGN]: ['EXPERT_ACQUISITION'],
    [P.EXPERTS_SENSITIVE]: ['EXPERT_ACQUISITION'],
  },
  TECHNICAL_PM: {},
  DELIVERY_PM: {},
  TECHNICAL_CONSULTANT: {
    [P.ASSET_REVIEW]: ['OUTLINE', 'PPT', 'SCRIPT'],
  },
  LEARNING_OPERATIONS: {},
  MARKETING: {},
  UAT_COORDINATOR: {
    [P.TASK_ASSIGN]: ['UAT'],
    [P.TASK_REVIEW]: ['UAT'],
  },
  // Testers record scenario results and log issues on the UAT run.
  UAT_TESTER: { [P.TASK_WORK]: ['UAT'] },
  VIEWER: {},
});

/**
 * The role a person usually holds to make, or to review, each stage. Used to
 * put the likeliest people first in a picker — never to grant anything.
 */
export const STAGE_ROLES = /** @type {const} */ ({
  OUTLINE: { maker: 'OUTLINE_WRITER', reviewer: 'SUBJECT_MATTER_EXPERT' },
  PPT: { maker: 'PPT_DESIGNER', reviewer: 'QUALITY_REVIEWER' },
  SCRIPT: { maker: 'SCRIPT_WRITER', reviewer: 'SUBJECT_MATTER_EXPERT' },
  VOICE_OVER: { maker: 'VOICE_OVER_ARTIST', reviewer: 'AUDIO_REVIEWER' },
  VIDEO: { maker: 'VIDEO_EDITOR', reviewer: 'QUALITY_REVIEWER' },
});

/** The module's keys out of a workspace user's effective permission list. */
export function lpPermissionsOf(effectivePermissions) {
  return (effectivePermissions ?? []).filter((key) => String(key).startsWith('elearning_production.'));
}

/**
 * One question object for one person inside one course.
 *
 * `has(permission)` asks "anywhere in this course"; `has(permission, stage)`
 * asks about one stage. An organization-wide key or the module administrator
 * key answers yes for both.
 */
export function buildGrants({ orgPermissions = [], roles = [] } = {}) {
  const org = new Set(orgPermissions);
  const isAdmin = org.has(P.ADMIN);
  const roleList = [...new Set(roles)];

  return {
    isAdmin,
    roles: roleList,
    has(permission, stage) {
      if (isAdmin || org.has(permission)) return true;
      for (const role of roleList) {
        const stages = ROLE_GRANTS[role]?.[permission];
        if (!stages || stages.length === 0) continue;
        if (!stage || stages.includes(stage)) return true;
      }
      return false;
    },
  };
}
