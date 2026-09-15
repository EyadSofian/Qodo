/**
 * The questions people open the module to answer.
 *
 * Every figure here is aggregated in SQL over the courses the caller may see.
 * The browser receives counts and short lists — never the asset table to count
 * for itself.
 */

import { ASSET_TYPES, DUE_SOON_DAYS, PRIORITIES } from '../../../shared/learningProduction/constants.js';
import { LP_PERMISSIONS as P, buildGrants } from '../../../shared/learningProduction/permissions.js';
import { SCHEMA as S, direct, isAvailable } from '../db.js';
import { actorFor, assignsAnywhere, courseContext, requireGrant, seesEveryCourse, visibleCourseCondition } from '../access.js';
import { HEADLINE_EVENTS, feed } from '../activity.js';
import { forbidden, notFound } from '../errors.js';
import { mapVersion, num } from '../mappers.js';
import { peopleFor, userIdsIn } from '../people.js';
import { isUuid, isoDate, oneOf } from '../validate.js';
import { assetContext } from './context.js';
import { blockedCounts } from './courseService.js';
import { COMPLETE_SQL, REVIEW_SQL, WORK_ROW_SQL, byUrgency, coursesWithStats, mapWorkRow, stageStats, today } from './summaries.js';

const escapeLike = (value) => value.replace(/[\\%_]/g, (match) => `\\${match}`);

function scope(actor, alias = 'c') {
  const params = [];
  const condition = `${visibleCourseCondition(actor, params, alias)} AND ${alias}.archived_at IS NULL`;
  return { params, condition };
}

/* ------------------------------------------------------------------ */
/* Who am I here                                                        */
/* ------------------------------------------------------------------ */

export async function me(actor) {
  const { params, condition } = scope(actor);
  const [visible, manages, reportCourses] = await Promise.all([
    direct.row(`SELECT count(*)::int AS n FROM ${S}.learning_courses c WHERE ${condition}`, params),
    assignsAnywhere(actor),
    direct.row(
      `SELECT count(*)::int AS n FROM ${S}.learning_course_members m
         JOIN ${S}.learning_courses c ON c.id = m.course_id AND c.archived_at IS NULL
        WHERE m.organization_id = $1 AND m.user_id = $2 AND m.roles && ARRAY['PRODUCTION_MANAGER', 'COURSE_MANAGER']::text[]`,
      [actor.organizationId, actor.userId]
    ),
  ]);
  return {
    permissions: actor.orgPermissions,
    isAdmin: actor.grants.isAdmin,
    seesEveryCourse: seesEveryCourse(actor),
    canCreateCourse: actor.grants.has(P.COURSE_CREATE),
    canViewReports: actor.grants.has(P.REPORT_VIEW) || reportCourses.n > 0,
    managesWork: manages,
    visibleCourses: visible.n,
    demoAvailable: actor.grants.isAdmin && (process.env.NODE_ENV !== 'production' || process.env.LEARNING_PRODUCTION_DEMO === 'enabled'),
  };
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                            */
/* ------------------------------------------------------------------ */

async function workloadRows(db, { condition, params, limit = 8 }) {
  const values = [...params, today(), limit];
  const dayRef = `$${values.length - 1}::date`;
  return db.rows(
    `SELECT person AS user_id, sum(active)::int AS active, sum(reviewing)::int AS reviewing, sum(overdue)::int AS overdue
       FROM (
         SELECT a.assignee_user_id AS person,
                (a.status IN ('ASSIGNED', 'IN_PROGRESS', 'CHANGES_REQUESTED'))::int AS active,
                0 AS reviewing,
                (a.status IN ('ASSIGNED', 'IN_PROGRESS', 'CHANGES_REQUESTED') AND a.due_date < ${dayRef})::int AS overdue
           FROM ${S}.learning_courses c
           JOIN ${S}.learning_lessons l ON l.course_id = c.id AND l.archived_at IS NULL
           JOIN ${S}.learning_assets a ON a.lesson_id = l.id
          WHERE ${condition} AND a.assignee_user_id IS NOT NULL AND a.status NOT IN ${COMPLETE_SQL}
         UNION ALL
         SELECT a.reviewer_user_id, 0, 1, 0
           FROM ${S}.learning_courses c
           JOIN ${S}.learning_lessons l ON l.course_id = c.id AND l.archived_at IS NULL
           JOIN ${S}.learning_assets a ON a.lesson_id = l.id
          WHERE ${condition} AND a.reviewer_user_id IS NOT NULL AND a.status IN ${REVIEW_SQL}
       ) work
      GROUP BY person
      ORDER BY sum(active) + sum(reviewing) DESC, sum(overdue) DESC
      LIMIT $${values.length}`,
    values
  );
}

async function myCounts(actor) {
  const found = await direct.row(
    `SELECT count(*) FILTER (WHERE a.assignee_user_id = $2 AND a.status IN ('ASSIGNED', 'IN_PROGRESS', 'CHANGES_REQUESTED'))::int AS assigned,
            count(*) FILTER (WHERE a.reviewer_user_id = $2 AND a.status IN ${REVIEW_SQL})::int AS reviews,
            count(*) FILTER (WHERE a.assignee_user_id = $2 AND a.status = 'CHANGES_REQUESTED')::int AS changes,
            count(*) FILTER (WHERE a.assignee_user_id = $2 AND a.status IN ('ASSIGNED', 'IN_PROGRESS', 'CHANGES_REQUESTED') AND a.due_date < $3::date)::int AS overdue
       FROM ${S}.learning_assets a
       JOIN ${S}.learning_lessons l ON l.id = a.lesson_id AND l.archived_at IS NULL
       JOIN ${S}.learning_courses c ON c.id = a.course_id AND c.archived_at IS NULL
      WHERE a.organization_id = $1 AND (a.assignee_user_id = $2 OR a.reviewer_user_id = $2)`,
    [actor.organizationId, actor.userId, today()]
  );
  return found;
}

const HEALTH_RANK = { DELAYED: 0, AT_RISK: 1, ON_TRACK: 2, COMPLETED: 3 };

export async function dashboard(actor) {
  const { params, condition } = scope(actor);
  const feedParams = [];
  const feedCondition = visibleCourseCondition(actor, feedParams, 'vc');
  const managerView = seesEveryCourse(actor) || (await assignsAnywhere(actor));
  const day = today();

  const [courses, stages, kpi, blocked, workload, activity, mine] = await Promise.all([
    coursesWithStats(direct, { condition, params }),
    stageStats(direct, { condition, params }),
    direct.row(
      `SELECT count(a.id) FILTER (WHERE a.status IN ${REVIEW_SQL})::int AS review,
              count(a.id) FILTER (WHERE a.status = 'CHANGES_REQUESTED')::int AS changes,
              count(a.id) FILTER (WHERE a.status NOT IN ${COMPLETE_SQL} AND a.due_date < $${params.length + 1}::date)::int AS overdue,
              count(a.id) FILTER (WHERE a.status NOT IN ${COMPLETE_SQL}
                                    AND a.due_date >= $${params.length + 1}::date
                                    AND a.due_date <= $${params.length + 1}::date + ${DUE_SOON_DAYS})::int AS due_soon,
              count(a.id)::int AS assets,
              count(a.id) FILTER (WHERE a.status IN ${COMPLETE_SQL})::int AS complete
         FROM ${S}.learning_courses c
         JOIN ${S}.learning_lessons l ON l.course_id = c.id AND l.archived_at IS NULL
         JOIN ${S}.learning_assets a ON a.lesson_id = l.id
        WHERE ${condition}`,
      [...params, day]
    ),
    blockedCounts(direct, { condition, params }),
    managerView ? workloadRows(direct, { condition, params }) : Promise.resolve([]),
    feed(direct, {
      condition: `e.course_id IN (SELECT vc.id FROM ${S}.learning_courses vc WHERE ${feedCondition} AND vc.archived_at IS NULL)`,
      params: feedParams,
      events: HEADLINE_EVENTS,
      limit: 12,
    }),
    myCounts(actor),
  ]);

  const totalLessons = courses.reduce((sum, course) => sum + course.stats.lessons, 0);
  const completedLessons = courses.reduce((sum, course) => sum + course.stats.completedLessons, 0);
  const watchlist = courses
    .filter((course) => course.status === 'ACTIVE')
    .sort((a, b) => HEALTH_RANK[a.health] - HEALTH_RANK[b.health] || a.progress - b.progress)
    .slice(0, 5)
    .map(({ settings: _settings, ...course }) => course);
  const workloadList = workload.map((entry) => ({
    userId: entry.user_id,
    active: entry.active,
    reviewing: entry.reviewing,
    overdue: entry.overdue,
  }));

  return {
    kpis: {
      activeCourses: courses.filter((course) => course.status === 'ACTIVE' && course.health !== 'COMPLETED').length,
      totalLessons,
      completedLessons,
      underReview: kpi.review,
      changesRequested: kpi.changes,
      overdue: kpi.overdue,
      dueSoon: kpi.due_soon,
    },
    overallPercent: kpi.assets ? Math.round((kpi.complete / kpi.assets) * 100) : 0,
    stages,
    attention: {
      overdue: kpi.overdue,
      review: kpi.review,
      changes: kpi.changes,
      blockedAssets: blocked.assets,
      blockedLessons: blocked.lessons,
    },
    healthCounts: courses.reduce((counts, course) => ({ ...counts, [course.health]: (counts[course.health] ?? 0) + 1 }), {}),
    watchlist,
    workload: workloadList,
    activity,
    mine,
    managerView,
    canCreateCourse: actor.grants.has(P.COURSE_CREATE),
    people: await peopleFor(userIdsIn([watchlist, workloadList, activity])),
  };
}

const ATTENTION = {
  overdue: `a.status NOT IN ${COMPLETE_SQL} AND a.due_date < $DAY::date`,
  review: `a.status IN ${REVIEW_SQL}`,
  changes: `a.status = 'CHANGES_REQUESTED'`,
  blocked: `a.status = 'ASSIGNED' AND a.dependency_override_at IS NULL`,
};

/** The assets behind one attention figure, so every number on the dashboard opens into its list. */
export async function attention(actor, kind) {
  const chosen = oneOf(kind, Object.keys(ATTENTION), 'kind', { required: true });
  const { params, condition } = scope(actor);
  let where = ATTENTION[chosen];
  if (where.includes('$DAY')) {
    params.push(today());
    where = where.replace('$DAY', `$${params.length}`);
  }
  const found = await direct.rows(
    `${WORK_ROW_SQL} WHERE ${condition} AND ${where}
      ORDER BY a.due_date NULLS LAST, a.submitted_at NULLS LAST
      LIMIT 300`,
    params
  );
  let items = found.map((r) => mapWorkRow(r));
  if (chosen === 'blocked') items = items.filter((item) => item.blocked);
  items = items.sort(byUrgency).slice(0, 60);
  return { kind: chosen, items, people: await peopleFor(userIdsIn(items)) };
}

/* ------------------------------------------------------------------ */
/* My Work and Reviews                                                  */
/* ------------------------------------------------------------------ */

async function roleMap(actor) {
  const found = await direct.rows(
    `SELECT course_id, roles FROM ${S}.learning_course_members WHERE organization_id = $1 AND user_id = $2`,
    [actor.organizationId, actor.userId]
  );
  return new Map(found.map((r) => [r.course_id, r.roles]));
}

/**
 * Submissions this person may review. `scope: 'mine'` is those named to them
 * plus unclaimed ones they have authority over; `all` adds submissions named
 * to other reviewers, for managers who pick up slack.
 */
async function reviewItems(actor, filters = {}) {
  const params = [];
  let condition = `${visibleCourseCondition(actor, params, 'c')} AND a.status IN ${REVIEW_SQL}`;
  if (filters.courseId) {
    params.push(filters.courseId);
    condition += ` AND c.id = $${params.length}`;
  }
  if (filters.assetType) {
    params.push(filters.assetType);
    condition += ` AND a.asset_type = $${params.length}`;
  }
  if (filters.priority) {
    params.push(filters.priority);
    condition += ` AND a.priority = $${params.length}`;
  }
  if (filters.assigneeId) {
    params.push(filters.assigneeId);
    condition += ` AND a.assignee_user_id = $${params.length}`;
  }
  if (filters.submittedFrom) {
    params.push(filters.submittedFrom);
    condition += ` AND a.submitted_at >= $${params.length}::date`;
  }
  if (filters.submittedTo) {
    params.push(filters.submittedTo);
    condition += ` AND a.submitted_at < $${params.length}::date + 1`;
  }

  const found = await direct.rows(
    `SELECT w.*, (SELECT ap.is_resubmission FROM ${S}.learning_asset_approvals ap
                   WHERE ap.asset_id = w.id AND ap.decision = 'PENDING' LIMIT 1) AS is_resubmission
       FROM (${WORK_ROW_SQL} WHERE ${condition} ORDER BY a.submitted_at ASC NULLS LAST LIMIT 500) w`,
    params
  );

  const roles = await roleMap(actor);
  const everyone = filters.scope === 'all';
  return found
    .filter((r) => {
      const isReviewer = r.reviewer_user_id === actor.userId;
      const grants = buildGrants({ orgPermissions: actor.orgPermissions, roles: roles.get(r.course_id) ?? [] });
      const authority = isReviewer || grants.has(P.ASSET_REVIEW, r.asset_type) || grants.has(P.ASSET_APPROVE, r.asset_type);
      if (!authority) return false;
      if (r.submitted_by === actor.userId && !grants.isAdmin) return false;
      return everyone || isReviewer || !r.reviewer_user_id;
    })
    .map((r) => ({ ...mapWorkRow(r), isResubmission: Boolean(r.is_resubmission) || r.status === 'RESUBMITTED' }));
}

export async function myWork(actor) {
  const day = today();
  const [open, completed, reviews] = await Promise.all([
    direct.rows(
      `${WORK_ROW_SQL}
        WHERE a.organization_id = $1 AND a.assignee_user_id = $2 AND a.status NOT IN ${COMPLETE_SQL}
        ORDER BY a.due_date NULLS LAST
        LIMIT 400`,
      [actor.organizationId, actor.userId]
    ),
    direct.rows(
      `${WORK_ROW_SQL}
        WHERE a.organization_id = $1 AND a.assignee_user_id = $2 AND a.status IN ${COMPLETE_SQL}
          AND a.approved_at >= now() - interval '14 days'
        ORDER BY a.approved_at DESC
        LIMIT 10`,
      [actor.organizationId, actor.userId]
    ),
    reviewItems(actor, { scope: 'mine' }),
  ]);

  const items = open.map((r) => mapWorkRow(r, day)).sort(byUrgency);
  const changesRequested = items.filter((item) => item.status === 'CHANGES_REQUESTED');
  const overdue = items.filter((item) => item.dueState === 'OVERDUE' && ['NOT_STARTED', 'ASSIGNED', 'IN_PROGRESS'].includes(item.status));
  const assigned = items.filter((item) => !changesRequested.includes(item) && !overdue.includes(item));
  const recentlyCompleted = completed.map((r) => mapWorkRow(r, day));

  const sections = { overdue, changesRequested, assigned, waitingForMyReview: reviews, recentlyCompleted };
  return { sections, people: await peopleFor(userIdsIn(Object.values(sections))) };
}

export async function reviewQueue(actor, query = {}) {
  const filters = {
    scope: query.scope === 'all' ? 'all' : 'mine',
    courseId: isUuid(query.courseId) ? query.courseId : null,
    assetType: ASSET_TYPES.includes(query.assetType) ? query.assetType : null,
    priority: PRIORITIES.includes(query.priority) ? query.priority : null,
    assigneeId: typeof query.assigneeId === 'string' && query.assigneeId ? query.assigneeId.slice(0, 120) : null,
    submittedFrom: isoDate(query.submittedFrom || null, 'submittedFrom'),
    submittedTo: isoDate(query.submittedTo || null, 'submittedTo'),
  };

  const [items, reviewed] = await Promise.all([
    reviewItems(actor, filters),
    direct.rows(
      `SELECT ap.id AS approval_id, ap.decision, ap.reviewed_at, ap.notes, v.version_number AS reviewed_version,
              a.id, a.asset_type, a.status, a.priority, a.due_date, a.assignee_user_id, a.reviewer_user_id, a.lesson_id,
              c.id AS course_id, c.name AS course_name, c.code AS course_code, l.name AS lesson_name
         FROM ${S}.learning_asset_approvals ap
         JOIN ${S}.learning_assets a ON a.id = ap.asset_id
         JOIN ${S}.learning_asset_versions v ON v.id = ap.version_id
         JOIN ${S}.learning_lessons l ON l.id = a.lesson_id AND l.archived_at IS NULL
         JOIN ${S}.learning_courses c ON c.id = a.course_id AND c.archived_at IS NULL
        WHERE ap.organization_id = $1 AND ap.reviewed_by = $2 AND ap.reviewed_at >= now() - interval '30 days'
        ORDER BY ap.reviewed_at DESC
        LIMIT 30`,
      [actor.organizationId, actor.userId]
    ),
  ]);

  const recentlyReviewed = reviewed.map((r) => ({
    approvalId: r.approval_id,
    decision: r.decision,
    reviewedAt: r.reviewed_at instanceof Date ? r.reviewed_at.toISOString() : r.reviewed_at,
    notes: r.notes,
    versionNumber: r.reviewed_version,
    id: r.id,
    assetType: r.asset_type,
    status: r.status,
    priority: r.priority,
    assigneeUserId: r.assignee_user_id,
    course: { id: r.course_id, name: r.course_name, code: r.course_code },
    lesson: { id: r.lesson_id, name: r.lesson_name, moduleName: null },
  }));

  const sections = {
    needsReview: items.filter((item) => !item.isResubmission),
    resubmitted: items.filter((item) => item.isResubmission),
    recentlyReviewed,
  };
  return { sections, filters, people: await peopleFor(userIdsIn(Object.values(sections))) };
}

/* ------------------------------------------------------------------ */
/* Reports                                                              */
/* ------------------------------------------------------------------ */

function weekStarts(count) {
  const now = new Date();
  const day = now.getUTCDay() || 7;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (day - 1)));
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() - (count - 1 - index) * 7);
    return date.toISOString().slice(0, 10);
  });
}

async function reportScope(actor, courseId) {
  if (courseId) {
    if (!isUuid(courseId)) throw notFound();
    const ctx = await courseContext(actor, courseId);
    requireGrant(ctx, P.REPORT_VIEW);
    return { condition: 'c.id = $1', params: [courseId] };
  }
  if (actor.grants.has(P.REPORT_VIEW)) return scope(actor);

  const params = [actor.organizationId, actor.userId];
  const condition = `c.organization_id = $1 AND c.archived_at IS NULL AND c.id IN (
    SELECT m.course_id FROM ${S}.learning_course_members m
     WHERE m.user_id = $2 AND m.roles && ARRAY['PRODUCTION_MANAGER', 'COURSE_MANAGER']::text[])`;
  const any = await direct.row(`SELECT 1 FROM ${S}.learning_courses c WHERE ${condition} LIMIT 1`, params);
  if (!any) throw forbidden('FORBIDDEN', { permission: P.REPORT_VIEW });
  return { condition, params };
}

const APPROVAL_JOIN = `
  FROM ${S}.learning_asset_approvals ap
  JOIN ${S}.learning_assets a ON a.id = ap.asset_id
  JOIN ${S}.learning_lessons l ON l.id = a.lesson_id AND l.archived_at IS NULL
  JOIN ${S}.learning_courses c ON c.id = a.course_id`;

const ASSET_JOIN = `
  FROM ${S}.learning_courses c
  JOIN ${S}.learning_lessons l ON l.course_id = c.id AND l.archived_at IS NULL
  JOIN ${S}.learning_assets a ON a.lesson_id = l.id`;

/**
 * Operational reports: completion, reviews, revisions, workload, throughput
 * and the stage holding production up.
 *
 * The bottleneck is deliberately plain: the stage whose submissions wait
 * longest for a decision, counting both the decisions made in the last ninety
 * days and the submissions still waiting now. A manager can check it by hand.
 */
export async function reports(actor, query = {}) {
  const { condition, params } = await reportScope(actor, query.courseId);
  const day = today();

  const [courses, stages, turnaround, pending, revisions, production, workload, throughput, overdue] = await Promise.all([
    coursesWithStats(direct, { condition, params }),
    stageStats(direct, { condition, params }),
    direct.rows(
      `SELECT a.asset_type, count(*)::int AS decisions,
              avg(extract(epoch FROM (ap.reviewed_at - ap.submitted_at)) / 3600)::float AS avg_hours
         ${APPROVAL_JOIN}
        WHERE ${condition} AND ap.reviewed_at IS NOT NULL AND ap.reviewed_at >= now() - interval '90 days'
        GROUP BY a.asset_type`,
      params
    ),
    direct.rows(
      `SELECT a.asset_type, count(*)::int AS waiting,
              avg(extract(epoch FROM (now() - ap.submitted_at)) / 3600)::float AS avg_hours,
              max(extract(epoch FROM (now() - ap.submitted_at)) / 3600)::float AS max_hours
         ${APPROVAL_JOIN}
        WHERE ${condition} AND ap.decision = 'PENDING'
        GROUP BY a.asset_type`,
      params
    ),
    direct.rows(
      `SELECT a.asset_type, count(*)::int AS finished,
              avg((SELECT count(*) FROM ${S}.learning_asset_versions v WHERE v.asset_id = a.id))::float AS avg_versions,
              avg((SELECT count(*) FROM ${S}.learning_asset_approvals x
                    WHERE x.asset_id = a.id AND x.decision = 'CHANGES_REQUESTED'))::float AS avg_change_rounds
         ${ASSET_JOIN}
        WHERE ${condition} AND a.status IN ${COMPLETE_SQL}
        GROUP BY a.asset_type`,
      params
    ),
    direct.rows(
      `SELECT a.asset_type, count(*)::int AS finished,
              avg(extract(epoch FROM (a.approved_at - coalesce(
                (SELECT min(e.created_at) FROM ${S}.learning_activity_log e
                  WHERE e.asset_id = a.id AND e.event_type = 'WORK_STARTED'), a.created_at))) / 86400)::float AS avg_days
         ${ASSET_JOIN}
        WHERE ${condition} AND a.status IN ${COMPLETE_SQL} AND a.approved_at >= now() - interval '180 days'
        GROUP BY a.asset_type`,
      params
    ),
    workloadRows(direct, { condition, params, limit: 50 }),
    direct.rows(
      `SELECT to_char(date_trunc('week', ap.reviewed_at), 'YYYY-MM-DD') AS week, count(*)::int AS approved
         ${APPROVAL_JOIN}
        WHERE ${condition} AND ap.decision = 'APPROVED'
          AND ap.reviewed_at >= date_trunc('week', now()) - interval '7 weeks'
        GROUP BY 1`,
      params
    ),
    direct.rows(`${WORK_ROW_SQL} WHERE ${condition} AND a.status NOT IN ${COMPLETE_SQL} AND a.due_date < $${params.length + 1}::date ORDER BY a.due_date LIMIT 25`, [
      ...params,
      day,
    ]),
  ]);

  const index = (list) => new Map(list.map((r) => [r.asset_type, r]));
  const turnaroundBy = index(turnaround);
  const pendingBy = index(pending);
  const revisionsBy = index(revisions);
  const productionBy = index(production);

  const stageReport = stages.map((stage) => {
    const decided = turnaroundBy.get(stage.assetType);
    const waiting = pendingBy.get(stage.assetType);
    const decisions = decided?.decisions ?? 0;
    const waitingCount = waiting?.waiting ?? 0;
    const samples = decisions + waitingCount;
    const waitHours = samples
      ? ((num(decided?.avg_hours) ?? 0) * decisions + (num(waiting?.avg_hours) ?? 0) * waitingCount) / samples
      : null;
    return {
      ...stage,
      decisions,
      avgReviewHours: num(decided?.avg_hours),
      waiting: waitingCount,
      avgWaitingHours: num(waiting?.avg_hours),
      oldestWaitingHours: num(waiting?.max_hours),
      waitDays: waitHours === null ? null : Math.round((waitHours / 24) * 10) / 10,
      avgVersions: revisionsBy.get(stage.assetType) ? Math.round(num(revisionsBy.get(stage.assetType).avg_versions) * 10) / 10 : null,
      avgChangeRounds: revisionsBy.get(stage.assetType) ? Math.round(num(revisionsBy.get(stage.assetType).avg_change_rounds) * 10) / 10 : null,
      avgProductionDays: productionBy.get(stage.assetType) ? Math.round(num(productionBy.get(stage.assetType).avg_days) * 10) / 10 : null,
    };
  });

  const bottleneck = stageReport
    .filter((stage) => stage.waitDays !== null)
    .sort((a, b) => b.waitDays - a.waitDays)[0] ?? null;

  const weeks = new Map(throughput.map((r) => [r.week, r.approved]));
  const overdueItems = overdue.map((r) => mapWorkRow(r, day));
  const workloadList = workload.map((entry) => ({ userId: entry.user_id, active: entry.active, reviewing: entry.reviewing, overdue: entry.overdue }));
  const courseList = courses.map(({ settings: _settings, ...course }) => course);

  return {
    courses: courseList,
    stages: stageReport,
    bottleneck: bottleneck ? { assetType: bottleneck.assetType, waitDays: bottleneck.waitDays } : null,
    throughput: weekStarts(8).map((week) => ({ week, approved: weeks.get(week) ?? 0 })),
    workload: workloadList,
    overdue: overdueItems,
    reviewTurnaroundHours: (() => {
      const total = turnaround.reduce((sum, r) => sum + r.decisions, 0);
      if (!total) return null;
      return Math.round((turnaround.reduce((sum, r) => sum + num(r.avg_hours) * r.decisions, 0) / total) * 10) / 10;
    })(),
    people: await peopleFor(userIdsIn([courseList, workloadList, overdueItems])),
  };
}

/* ------------------------------------------------------------------ */
/* Search, files, history                                               */
/* ------------------------------------------------------------------ */

export async function search(actor, query) {
  const needle = String(query ?? '').trim().toLowerCase().slice(0, 100);
  if (needle.length < 2) return { courses: [], lessons: [] };
  const { params, condition } = scope(actor);
  params.push(`%${escapeLike(needle)}%`);
  const pattern = `$${params.length}`;

  const [courses, lessons] = await Promise.all([
    direct.rows(
      `SELECT c.id, c.name, c.code FROM ${S}.learning_courses c
        WHERE ${condition} AND (lower(c.name) LIKE ${pattern} ESCAPE '\\' OR lower(coalesce(c.code, '')) LIKE ${pattern} ESCAPE '\\')
        ORDER BY c.updated_at DESC LIMIT 6`,
      params
    ),
    direct.rows(
      `SELECT l.id, l.name, c.id AS course_id, c.name AS course_name, c.code AS course_code
         FROM ${S}.learning_lessons l
         JOIN ${S}.learning_courses c ON c.id = l.course_id
        WHERE ${condition} AND l.archived_at IS NULL AND lower(l.name) LIKE ${pattern} ESCAPE '\\'
        ORDER BY l.updated_at DESC LIMIT 8`,
      params
    ),
  ]);

  return {
    courses: courses.map((r) => ({ id: r.id, name: r.name, code: r.code ?? null })),
    lessons: lessons.map((r) => ({ id: r.id, name: r.name, course: { id: r.course_id, name: r.course_name, code: r.course_code ?? null } })),
  };
}

/** Results for the workspace's own Ctrl/Cmd+K palette. Never throws. */
export async function globalSearchResults(user, query, lang = 'ar') {
  if (!isAvailable()) return [];
  try {
    const found = await search(actorFor(user), query);
    const module = lang === 'en' ? 'E-Learning Production' : 'إنتاج المحتوى التعليمي';
    return [
      ...found.courses.map((course) => ({
        type: 'learning_course',
        id: course.id,
        title: course.name,
        subtitle: course.code ? `${course.code} · ${module}` : module,
        route: `/learning-production/courses/${course.id}`,
      })),
      ...found.lessons.map((lesson) => ({
        type: 'learning_lesson',
        id: lesson.id,
        title: lesson.name,
        subtitle: lesson.course.name,
        route: `/learning-production/courses/${lesson.course.id}/lessons/${lesson.id}`,
      })),
    ];
  } catch (error) {
    console.error('[learning-production] search unavailable —', error.message);
    return [];
  }
}

export async function courseFiles(actor, courseId, query = {}) {
  const ctx = await courseContext(actor, courseId);
  const params = [courseId, ctx.organizationId];
  let extra = '';
  if (ASSET_TYPES.includes(query.assetType)) {
    params.push(query.assetType);
    extra += ` AND a.asset_type = $${params.length}`;
  }
  if (query.latest === '1') extra += ' AND a.current_version_id = v.id';
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 60));
  const offset = Math.max(0, Number(query.offset) || 0);
  params.push(limit, offset);

  const found = await direct.rows(
    `SELECT v.*, a.asset_type, (a.current_version_id = v.id) AS is_current, (a.approved_version_id = v.id) AS is_approved,
            l.id AS lesson_id, l.name AS lesson_name
       FROM ${S}.learning_asset_versions v
       JOIN ${S}.learning_assets a ON a.id = v.asset_id
       JOIN ${S}.learning_lessons l ON l.id = a.lesson_id AND l.archived_at IS NULL
      WHERE a.course_id = $1 AND v.organization_id = $2 AND v.source_kind IN ('FILE', 'LINK') ${extra}
      ORDER BY v.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const files = found.map((r) => ({
    ...mapVersion(r),
    assetType: r.asset_type,
    isCurrent: r.is_current,
    isApproved: r.is_approved,
    lesson: { id: r.lesson_id, name: r.lesson_name },
  }));
  return { files, hasMore: files.length === limit, people: await peopleFor(userIdsIn(files)) };
}

export async function courseActivity(actor, courseId, query = {}) {
  await courseContext(actor, courseId, { includeArchived: true });
  const entries = await feed(direct, {
    condition: 'e.course_id = $1',
    params: [courseId],
    before: /^\d+$/.test(String(query.before ?? '')) ? query.before : null,
    limit: 40,
  });
  return { entries, hasMore: entries.length === 40, people: await peopleFor(userIdsIn(entries)) };
}

export async function assetActivity(actor, assetId, query = {}) {
  await assetContext(actor, assetId);
  const entries = await feed(direct, {
    condition: 'e.asset_id = $1',
    params: [assetId],
    before: /^\d+$/.test(String(query.before ?? '')) ? query.before : null,
    limit: 60,
  });
  return { entries, hasMore: entries.length === 60, people: await peopleFor(userIdsIn(entries)) };
}
