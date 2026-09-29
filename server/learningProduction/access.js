/**
 * E-Learning Production — the authorization core.
 *
 * Three rules hold everywhere in this module:
 *
 *   1. **The organization comes from the session.** An id in the URL is a
 *      claim, checked against the caller's organization before anything is
 *      read. Every query that touches a table filters on `organization_id`.
 *   2. **A course you may not see does not exist.** Missing, archived,
 *      another tenant's, or simply not yours — all four answer 404, because a
 *      403 would confirm that the id names something.
 *   3. **Deny by default.** A verdict that is not an explicit yes is a no.
 *
 * Who can see a course: anyone holding `elearning_production.view` (every
 * course), its manager, its team members, and anyone named as the assignee or
 * reviewer of one of its assets. What they may *do* there is `grants`, built
 * from their workspace keys plus their course roles — see
 * `shared/learningProduction/permissions.js`.
 */

import { permissionsFor } from '../../shared/permissions.js';
import { organizationOf } from '../../shared/organization.js';
import { buildGrants, lpPermissionsOf, LP_PERMISSIONS as P } from '../../shared/learningProduction/permissions.js';
import { ASSET_TYPES } from '../../shared/learningProduction/constants.js';
import { normalizeSettings } from '../../shared/learningProduction/workflow.js';
import { SCHEMA as S, direct } from './db.js';
import { forbidden, notFound } from './errors.js';
import { mapCourse } from './mappers.js';

/** The caller, resolved once per request. */
export function actorFor(user) {
  const orgPermissions = lpPermissionsOf(permissionsFor(user));
  return {
    user,
    userId: user.id,
    organizationId: organizationOf(user),
    orgPermissions,
    grants: buildGrants({ orgPermissions }),
  };
}

export function seesEveryCourse(actor) {
  return actor.grants.has(P.VIEW);
}

/**
 * The SQL condition that limits `alias` (a courses table) to what the actor
 * may see. Appends its own parameters, so it composes with any query.
 */
export function visibleCourseCondition(actor, params, alias = 'c') {
  params.push(actor.organizationId);
  const organization = `${alias}.organization_id = $${params.length}`;
  if (seesEveryCourse(actor)) return organization;

  params.push(actor.userId);
  const me = `$${params.length}`;
  return `${organization} AND (
    ${alias}.manager_user_id = ${me}
    OR EXISTS (SELECT 1 FROM ${S}.learning_course_members vm WHERE vm.course_id = ${alias}.id AND vm.user_id = ${me})
    OR EXISTS (SELECT 1 FROM ${S}.learning_assets va
                WHERE va.course_id = ${alias}.id AND (va.assignee_user_id = ${me} OR va.reviewer_user_id = ${me}))
    OR EXISTS (SELECT 1 FROM ${S}.learning_production_runs vr
                WHERE vr.course_id = ${alias}.id AND (
                  vr.manager_user_id = ${me}
                  OR EXISTS (SELECT 1 FROM ${S}.learning_run_members vrm WHERE vrm.run_id = vr.id AND vrm.user_id = ${me})
                  OR EXISTS (SELECT 1 FROM ${S}.learning_task_instances vt
                              WHERE vt.run_id = vr.id AND (vt.assignee_user_id = ${me} OR vt.reviewer_user_id = ${me}))
                  OR EXISTS (SELECT 1 FROM ${S}.learning_run_issues vi WHERE vi.run_id = vr.id AND vi.owner_user_id = ${me})))
  )`;
}

/**
 * One course, and what this person may do in it. Throws 404 for anything the
 * caller may not see. `lock` takes a row lock, for changes that must not race.
 */
export async function courseContext(actor, courseId, { includeArchived = false, db = direct, lock = false } = {}) {
  const found = await db.row(
    `SELECT c.*, m.roles AS member_roles,
            EXISTS (SELECT 1 FROM ${S}.learning_assets a
                     WHERE a.course_id = c.id AND (a.assignee_user_id = $3 OR a.reviewer_user_id = $3)) AS has_assignment,
            open_run.id AS open_run_id, open_run.manager_user_id AS open_run_manager,
            rm.roles AS run_roles,
            EXISTS (SELECT 1 FROM ${S}.learning_production_runs r
                      JOIN ${S}.learning_task_instances t ON t.run_id = r.id
                     WHERE r.course_id = c.id AND (t.assignee_user_id = $3 OR t.reviewer_user_id = $3)) AS has_task,
            EXISTS (SELECT 1 FROM ${S}.learning_production_runs r
                     WHERE r.course_id = c.id AND r.manager_user_id = $3) AS manages_run,
            EXISTS (SELECT 1 FROM ${S}.learning_production_runs r
                      JOIN ${S}.learning_run_members x ON x.run_id = r.id AND x.user_id = $3
                     WHERE r.course_id = c.id) AS run_member,
            EXISTS (SELECT 1 FROM ${S}.learning_production_runs r
                      JOIN ${S}.learning_run_issues i ON i.run_id = r.id AND i.owner_user_id = $3
                     WHERE r.course_id = c.id) AS owns_issue
       FROM ${S}.learning_courses c
       LEFT JOIN ${S}.learning_course_members m ON m.course_id = c.id AND m.user_id = $3
       LEFT JOIN ${S}.learning_production_runs open_run ON open_run.course_id = c.id AND open_run.status IN ('ACTIVE', 'ON_HOLD')
       LEFT JOIN ${S}.learning_run_members rm ON rm.run_id = open_run.id AND rm.user_id = $3
      WHERE c.id = $1 AND c.organization_id = $2
      ${lock ? 'FOR UPDATE OF c' : ''}`,
    [courseId, actor.organizationId, actor.userId]
  );
  if (!found) throw notFound();
  if (found.archived_at && !includeArchived) throw notFound();

  const courseRoles = found.member_roles ?? [];
  // Roles on the run in flight count only there — a closed run takes no more
  // actions, so its roles would add nothing. The open run's manager manages it.
  const runRoles = [...(found.run_roles ?? []), ...(found.open_run_manager === actor.userId ? ['PRODUCTION_MANAGER'] : [])];
  const roles = [...new Set([...courseRoles, ...runRoles])];
  const visible =
    seesEveryCourse(actor) ||
    roles.length > 0 ||
    found.has_assignment ||
    found.has_task ||
    found.manages_run ||
    found.run_member ||
    found.owns_issue ||
    found.manager_user_id === actor.userId;
  if (!visible) throw notFound();

  return {
    ...actor,
    course: mapCourse(found),
    rawSettings: found.settings_json ?? {},
    settings: normalizeSettings(found.settings_json),
    roles,
    courseRoles,
    runRoles,
    openRunId: found.open_run_id ?? null,
    grants: buildGrants({ orgPermissions: actor.orgPermissions, roles }),
  };
}

/** Throws 403 unless the grant holds. Only ever called after visibility passed. */
export function requireGrant(ctx, permission, stage) {
  if (!ctx.grants.has(permission, stage)) throw forbidden('FORBIDDEN', { permission });
}

/** Course-level switches the interface uses to decide what to draw. */
export function courseCapabilities(ctx) {
  const assign = {};
  for (const type of ASSET_TYPES) assign[type] = ctx.grants.has(P.ASSET_ASSIGN, type);
  return {
    edit: ctx.grants.has(P.COURSE_EDIT),
    archive: ctx.grants.has(P.COURSE_DELETE),
    createLessons: ctx.grants.has(P.LESSON_CREATE),
    editLessons: ctx.grants.has(P.LESSON_EDIT),
    manageTeam: ctx.grants.has(P.TEAM_MANAGE),
    viewReports: ctx.grants.has(P.REPORT_VIEW),
    assign,
    assignAny: Object.values(assign).some(Boolean),
    manageRuns: ctx.grants.has(P.RUN_MANAGE),
    assignTasks: ctx.grants.has(P.TASK_ASSIGN),
    signoffReleases: ctx.grants.has(P.RELEASE_SIGNOFF),
    publishReleases: ctx.grants.has(P.RELEASE_PUBLISH),
    seeSensitive: canSeeSensitive(ctx),
    roles: ctx.roles,
    isAdmin: ctx.grants.isAdmin,
  };
}

/**
 * Candidate records, CVs, assessments and contracts. Narrower than seeing the
 * course: the coordinator, the production manager, administrators and holders
 * of the organization-wide key. A course manager does not qualify.
 */
export function canSeeSensitive(ctx) {
  return ctx.grants.has(P.EXPERTS_SENSITIVE, 'EXPERT_ACQUISITION');
}

/**
 * Who may leave a comment on an asset: anybody with a hand in the work.
 * A course Viewer, or somebody who only holds the organization-wide view key,
 * reads the review but does not take part in it.
 */
export function canComment(ctx, asset) {
  if (asset.assigneeUserId === ctx.userId || asset.reviewerUserId === ctx.userId) return true;
  if (ctx.grants.isAdmin) return true;
  const stage = asset.assetType;
  if ([P.ASSET_EDIT, P.ASSET_SUBMIT, P.ASSET_REVIEW, P.ASSET_APPROVE, P.ASSET_ASSIGN].some((key) => ctx.grants.has(key, stage))) {
    return true;
  }
  return ctx.roles.some((role) => role !== 'VIEWER');
}

/**
 * Whether this person assigns work anywhere — the question behind the people
 * picker. A designer has no reason to list every colleague in the company.
 */
export async function assignsAnywhere(actor) {
  if ([P.ASSET_ASSIGN, P.TASK_ASSIGN, P.TEAM_MANAGE, P.COURSE_CREATE].some((key) => actor.grants.has(key))) return true;
  const runManager = await direct.row(
    `SELECT 1 FROM ${S}.learning_production_runs WHERE organization_id = $1 AND manager_user_id = $2 AND status IN ('ACTIVE', 'ON_HOLD') LIMIT 1`,
    [actor.organizationId, actor.userId]
  );
  if (runManager) return true;
  const found = await direct.row(
    `SELECT 1 FROM ${S}.learning_course_members m
       JOIN ${S}.learning_courses c ON c.id = m.course_id AND c.archived_at IS NULL
      WHERE m.organization_id = $1 AND m.user_id = $2
        AND m.roles && ARRAY['PRODUCTION_MANAGER', 'COURSE_MANAGER']::text[]
      LIMIT 1`,
    [actor.organizationId, actor.userId]
  );
  return Boolean(found);
}
