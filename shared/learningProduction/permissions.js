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

import { ASSET_TYPES } from './constants.js';

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
});

export const LP_PERMISSION_LIST = Object.values(LP_PERMISSIONS);

const P = LP_PERMISSIONS;
const ALL = ASSET_TYPES;

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
  QUALITY_REVIEWER: { [P.ASSET_REVIEW]: ALL, [P.ASSET_APPROVE]: ALL },
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
