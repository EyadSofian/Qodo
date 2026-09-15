/**
 * The course team: who is on it, in which roles, and how loaded each of them is
 * inside this course.
 */

import { COURSE_ROLES } from '../../../shared/learningProduction/constants.js';
import { LP_PERMISSIONS as P } from '../../../shared/learningProduction/permissions.js';
import { SCHEMA as S, direct, transaction } from '../db.js';
import { assignsAnywhere, courseCapabilities, courseContext, requireGrant } from '../access.js';
import { record } from '../activity.js';
import { badRequest, forbidden, validation } from '../errors.js';
import { assertAssignable, organizationPeople, peopleFor } from '../people.js';
import { plainObject } from '../validate.js';
import { COMPLETE_SQL, REVIEW_SQL, today } from './summaries.js';

export async function listTeam(actor, courseId) {
  const ctx = await courseContext(actor, courseId);
  const day = today();
  const [members, load] = await Promise.all([
    direct.rows(
      `SELECT user_id, roles, created_at FROM ${S}.learning_course_members WHERE course_id = $1 ORDER BY created_at`,
      [courseId]
    ),
    direct.rows(
      `SELECT person AS user_id, sum(active)::int AS active, sum(reviewing)::int AS reviewing, sum(overdue)::int AS overdue
         FROM (
           SELECT a.assignee_user_id AS person,
                  (a.status IN ('ASSIGNED', 'IN_PROGRESS', 'CHANGES_REQUESTED'))::int AS active,
                  0 AS reviewing,
                  (a.status IN ('ASSIGNED', 'IN_PROGRESS', 'CHANGES_REQUESTED') AND a.due_date < $2::date)::int AS overdue
             FROM ${S}.learning_assets a
             JOIN ${S}.learning_lessons l ON l.id = a.lesson_id AND l.archived_at IS NULL
            WHERE a.course_id = $1 AND a.assignee_user_id IS NOT NULL AND a.status NOT IN ${COMPLETE_SQL}
           UNION ALL
           SELECT a.reviewer_user_id, 0, 1, 0
             FROM ${S}.learning_assets a
             JOIN ${S}.learning_lessons l ON l.id = a.lesson_id AND l.archived_at IS NULL
            WHERE a.course_id = $1 AND a.reviewer_user_id IS NOT NULL AND a.status IN ${REVIEW_SQL}
         ) work
        GROUP BY person`,
      [courseId, day]
    ),
  ]);

  const loadByUser = new Map(load.map((entry) => [entry.user_id, entry]));
  const memberIds = new Set(members.map((member) => member.user_id));
  const withLoad = (userId) => ({
    active: loadByUser.get(userId)?.active ?? 0,
    reviewing: loadByUser.get(userId)?.reviewing ?? 0,
    overdue: loadByUser.get(userId)?.overdue ?? 0,
  });

  const team = members.map((member) => ({ userId: member.user_id, roles: member.roles, workload: withLoad(member.user_id) }));
  // People with work in the course who were never added to its team — still
  // shown, because "who is doing this course" should not depend on paperwork.
  const contributors = load
    .filter((entry) => !memberIds.has(entry.user_id))
    .map((entry) => ({ userId: entry.user_id, workload: withLoad(entry.user_id) }));

  return {
    members: team,
    contributors,
    productionDefaults: ctx.course.productionDefaults,
    capabilities: courseCapabilities(ctx),
    people: await peopleFor([
      ...team.map((member) => member.userId),
      ...contributors.map((person) => person.userId),
      ...Object.values(ctx.course.productionDefaults ?? {}).flatMap((entry) => [entry?.assigneeUserId, entry?.reviewerUserId]),
    ]),
  };
}

function normalizeRoles(value) {
  if (!Array.isArray(value) || value.length === 0) throw validation('roles', 'required');
  if (!value.every((role) => COURSE_ROLES.includes(role))) throw validation('roles', 'invalid');
  return [...new Set(value)];
}

async function managersExcept(tx, courseId, userId) {
  const found = await tx.row(
    `SELECT count(*)::int AS n FROM ${S}.learning_course_members
      WHERE course_id = $1 AND user_id <> $2 AND 'PRODUCTION_MANAGER' = ANY(roles)`,
    [courseId, userId]
  );
  return found.n;
}

export async function saveMember(actor, courseId, userId, input) {
  const ctx = await courseContext(actor, courseId);
  requireGrant(ctx, P.TEAM_MANAGE);
  const roles = normalizeRoles(plainObject(input, 'body').roles);
  await assertAssignable(actor, userId, 'userId');

  return transaction(async (tx) => {
    const existing = await tx.row(
      `SELECT roles FROM ${S}.learning_course_members WHERE course_id = $1 AND user_id = $2 FOR UPDATE`,
      [courseId, userId]
    );
    if (existing?.roles.includes('PRODUCTION_MANAGER') && !roles.includes('PRODUCTION_MANAGER')) {
      if ((await managersExcept(tx, courseId, userId)) === 0) throw badRequest('LAST_MANAGER');
    }
    await tx.query(
      `INSERT INTO ${S}.learning_course_members (organization_id, course_id, user_id, roles, added_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (course_id, user_id) DO UPDATE SET roles = EXCLUDED.roles`,
      [ctx.organizationId, courseId, userId, roles, ctx.userId]
    );
    await record(tx, {
      organizationId: ctx.organizationId,
      courseId,
      actorUserId: ctx.userId,
      eventType: existing ? 'TEAM_MEMBER_UPDATED' : 'TEAM_MEMBER_ADDED',
      metadata: { userId, roles, previousRoles: existing?.roles ?? null },
    });
    return { member: { userId, roles } };
  });
}

export async function removeMember(actor, courseId, userId) {
  const ctx = await courseContext(actor, courseId);
  requireGrant(ctx, P.TEAM_MANAGE);

  return transaction(async (tx) => {
    const existing = await tx.row(
      `SELECT roles FROM ${S}.learning_course_members WHERE course_id = $1 AND user_id = $2 FOR UPDATE`,
      [courseId, userId]
    );
    if (!existing) return { removed: false };
    if (existing.roles.includes('PRODUCTION_MANAGER') && (await managersExcept(tx, courseId, userId)) === 0) {
      throw badRequest('LAST_MANAGER');
    }
    await tx.query(`DELETE FROM ${S}.learning_course_members WHERE course_id = $1 AND user_id = $2`, [courseId, userId]);
    await record(tx, {
      organizationId: ctx.organizationId,
      courseId,
      actorUserId: ctx.userId,
      eventType: 'TEAM_MEMBER_REMOVED',
      metadata: { userId, roles: existing.roles },
    });
    return { removed: true };
  });
}

/** People who can be put on a team or on a piece of work. Only for those who assign work somewhere. */
export async function assignablePeople(actor, search) {
  if (!(await assignsAnywhere(actor))) throw forbidden();
  return { people: await organizationPeople(actor, search) };
}
