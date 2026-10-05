/**
 * What is mine, what is next, what is blocked, and where do I act.
 *
 * My Work and Reviews span both levels of the module — program tasks, lesson
 * assets, issues and releases — and return one item shape for all of them,
 * each with its status, deadline, blocking reason and a deep link to the
 * exact task, asset, issue or release. The portfolio is the manager's view of
 * every run in flight.
 *
 * Everything is limited to what the caller may see (`visibleCourseCondition`)
 * and, for anything that asks the caller to act, to what the caller may do.
 */

import { LP_PERMISSIONS as P, buildGrants } from '../../../shared/learningProduction/permissions.js';
import {
  BLOCKING_SEVERITIES,
  OPEN_ISSUE_STATUSES,
  computeRun,
  runHealth,
  taskDueState,
} from '../../../shared/learningProduction/runs.js';
import { normalizeSettings } from '../../../shared/learningProduction/workflow.js';
import { STAGE_DEPENDENCIES } from '../../../shared/learningProduction/constants.js';
import { SCHEMA as S, direct } from '../db.js';
import { visibleCourseCondition } from '../access.js';
import { PREFERENCE_EVENTS, issueLink, releaseLink, taskLink, assetLink } from '../notifications.js';
import { peopleFor, userIdsIn } from '../people.js';
import { integer, plainObject } from '../validate.js';
import { loadRunStructure, runFacts } from '../runSync.js';
import { mapRun } from '../runMappers.js';
import { reviewQueue } from './insightsService.js';
import { WORK_ROW_SQL, mapWorkRow, today } from './summaries.js';

const iso = (value) => (value instanceof Date ? value.toISOString() : value ?? null);

/** Stages whose approvals are curriculum decisions — the Reviews page groups them. */
const CURRICULUM_STAGES = [
  'RESEARCH',
  'CURRICULUM_DRAFT',
  'EXPERT_ACQUISITION',
  'FINAL_CURRICULUM',
  'INSTRUCTIONAL_DESIGN',
  'CHANGE_IMPACT',
  'AI_INPUT',
  'AI_OUTLINES',
  'AI_OUTLINE_REVIEW',
  'AI_SCRIPT_REVIEW',
];
const MEDIA_TYPES = ['PPT', 'VOICE_OVER', 'VIDEO'];

function visible(actor, alias = 'c') {
  const params = [];
  const condition = `${visibleCourseCondition(actor, params, alias)} AND ${alias}.archived_at IS NULL`;
  return { params, condition };
}

/**
 * The actor's authority in each course, as grants: course roles plus roles on
 * that course's open run, plus the open run's manager.
 */
async function grantsByCourse(actor, courseIds) {
  if (!courseIds.length) return new Map();
  const rows = await direct.rows(
    `SELECT c.id AS course_id,
            coalesce(m.roles, '{}'::text[]) || coalesce(rm.roles, '{}'::text[])
              || CASE WHEN r.manager_user_id = $2 THEN ARRAY['PRODUCTION_MANAGER'] ELSE '{}'::text[] END AS roles
       FROM ${S}.learning_courses c
       LEFT JOIN ${S}.learning_course_members m ON m.course_id = c.id AND m.user_id = $2
       LEFT JOIN ${S}.learning_production_runs r ON r.course_id = c.id AND r.status IN ('ACTIVE', 'ON_HOLD')
       LEFT JOIN ${S}.learning_run_members rm ON rm.run_id = r.id AND rm.user_id = $2
      WHERE c.id = ANY($1::uuid[])`,
    [courseIds, actor.userId]
  );
  return new Map(
    rows.map((row) => [row.course_id, { roles: row.roles, grants: buildGrants({ orgPermissions: actor.orgPermissions, roles: row.roles }) }])
  );
}

/** Blockers for a set of tasks, computed run by run. */
async function blockersFor(taskRows) {
  const byRun = new Map();
  for (const row of taskRows) byRun.set(row.run_id, [...(byRun.get(row.run_id) ?? []), row.id]);
  const result = new Map();
  for (const runId of byRun.keys()) {
    const runRow = await direct.row(`SELECT * FROM ${S}.learning_production_runs WHERE id = $1`, [runId]);
    const run = mapRun(runRow);
    const { stages, tasks } = await loadRunStructure(direct, runId);
    const facts = await runFacts(direct, run);
    const computed = computeRun({ stages, tasks, facts, lessonAssetTypes: run.lessonAssetTypes });
    for (const entry of computed.tasks) result.set(entry.id, entry);
  }
  return result;
}

const TASK_ROW_SQL = `
  SELECT t.*, st.stage_key, st.label_json AS stage_label, st.status AS stage_status,
         r.run_number, r.scenario, r.status AS run_status,
         c.id AS course_id, c.name AS course_name, c.code AS course_code,
         (SELECT s.is_resubmission FROM ${S}.learning_task_submissions s
           WHERE s.task_id = t.id AND s.decision = 'PENDING' LIMIT 1) AS is_resubmission
    FROM ${S}.learning_task_instances t
    JOIN ${S}.learning_stage_instances st ON st.id = t.stage_id
    JOIN ${S}.learning_production_runs r ON r.id = t.run_id
    JOIN ${S}.learning_courses c ON c.id = r.course_id AND c.archived_at IS NULL`;

function taskItem(row, computed, day, action) {
  const blockers = computed?.blockers ?? [];
  const blocked = row.status === 'NOT_STARTED' && !row.dependency_override_at && blockers.length > 0;
  return {
    kind: 'TASK',
    id: row.id,
    key: row.task_key,
    title: row.label_json,
    course: { id: row.course_id, name: row.course_name, code: row.course_code ?? null },
    run: { id: row.run_id, runNumber: row.run_number, scenario: row.scenario, status: row.run_status },
    stage: { key: row.stage_key, label: row.stage_label },
    status: row.status,
    display: row.status === 'NOT_STARTED' ? (blocked ? 'BLOCKED' : 'READY') : row.status,
    taskKind: row.kind,
    requiresApproval: row.requires_approval,
    sensitive: row.sensitive,
    priority: row.priority,
    dueDate: row.due_date ?? null,
    dueState: taskDueState(row.due_date, row.status, day),
    blocked,
    blockers,
    assigneeUserId: row.assignee_user_id ?? null,
    reviewerUserId: row.reviewer_user_id ?? null,
    submittedBy: row.submitted_by ?? null,
    submittedAt: iso(row.submitted_at),
    isResubmission: Boolean(row.is_resubmission),
    action,
    link: taskLink({ courseId: row.course_id, taskId: row.id }),
  };
}

function assetItem(item, action) {
  return {
    kind: 'ASSET',
    id: item.id,
    title: null,
    assetType: item.assetType,
    course: item.course,
    lesson: item.lesson,
    status: item.status,
    display: item.blocked ? 'BLOCKED' : item.status,
    priority: item.priority,
    dueDate: item.dueDate,
    dueState: item.dueState,
    blocked: item.blocked,
    blockers: item.blocked ? item.waitingFor.map((type) => ({ type: 'ASSET', key: type })) : [],
    assigneeUserId: item.assigneeUserId,
    reviewerUserId: item.reviewerUserId,
    submittedBy: item.submittedBy ?? null,
    submittedAt: item.submittedAt,
    versionNumber: item.currentVersionNumber,
    openComments: item.openComments,
    isResubmission: Boolean(item.isResubmission) || item.status === 'RESUBMITTED',
    action,
    link: assetLink({ courseId: item.course.id, lessonId: item.lesson.id, assetType: item.assetType }),
  };
}

function issueItem(row, day, action) {
  return {
    kind: 'ISSUE',
    id: row.id,
    title: `#${row.issue_number} ${row.title}`,
    course: { id: row.course_id, name: row.course_name, code: row.course_code ?? null },
    run: { id: row.run_id, runNumber: row.run_number, scenario: row.scenario },
    stage: { key: row.stage_key, label: row.stage_label },
    status: row.status,
    display: row.status,
    severity: row.severity,
    priority: row.severity === 'CRITICAL' ? 'URGENT' : row.severity === 'HIGH' ? 'HIGH' : 'NORMAL',
    dueDate: row.due_date ?? null,
    dueState: row.due_date && row.due_date < day && ['OPEN', 'IN_PROGRESS'].includes(row.status) ? 'OVERDUE' : null,
    blocked: false,
    blockers: [],
    assigneeUserId: row.owner_user_id ?? null,
    action,
    link: issueLink({ courseId: row.course_id, issueId: row.id }),
  };
}

const ISSUE_ROW_SQL = `
  SELECT i.*, st.stage_key, st.label_json AS stage_label, r.run_number, r.scenario,
         c.id AS course_id, c.name AS course_name, c.code AS course_code
    FROM ${S}.learning_run_issues i
    JOIN ${S}.learning_stage_instances st ON st.id = i.stage_id
    JOIN ${S}.learning_production_runs r ON r.id = i.run_id AND r.status = 'ACTIVE'
    JOIN ${S}.learning_courses c ON c.id = r.course_id AND c.archived_at IS NULL`;

const urgency = (a, b) => {
  const late = (item) => (item.dueState === 'OVERDUE' ? 0 : item.dueState === 'DUE_TODAY' ? 1 : item.dueState === 'DUE_SOON' ? 2 : 3);
  const rank = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
  return late(a) - late(b) || (rank[a.priority] ?? 2) - (rank[b.priority] ?? 2) || String(a.dueDate ?? '9999').localeCompare(String(b.dueDate ?? '9999'));
};

/* ------------------------------------------------------------------ */
/* My Work                                                              */
/* ------------------------------------------------------------------ */

/**
 * The work that is mine, in four answers:
 *
 *   now      what I can act on today — my tasks and assets that are ready,
 *            in progress or sent back, and issues I own;
 *   review   what waits for my decision (the Reviews page, briefly);
 *   blocked  my work that cannot start yet, with what it waits for and who
 *            holds that;
 *   done     what I finished in the last fortnight.
 */
/** Courses the actor runs: their run's manager, or a production/course manager on the team. */
const MANAGED_SQL = `(r.manager_user_id = $2 OR EXISTS (
    SELECT 1 FROM ${S}.learning_course_members m
     WHERE m.course_id = c.id AND m.user_id = $2
       AND m.roles && ARRAY['PRODUCTION_MANAGER', 'COURSE_MANAGER']::text[]))`;

/** The lesson files an asset waits for, as SQL — the same rule as STAGE_DEPENDENCIES. */
const DEPENDENCY_SQL = `CASE a.asset_type
    ${Object.entries(STAGE_DEPENDENCIES)
      .filter(([, deps]) => deps.length)
      .map(([type, deps]) => `WHEN '${type}' THEN ARRAY[${deps.map((dep) => `'${dep}'`).join(', ')}]::text[]`)
      .join('\n    ')}
    ELSE ARRAY[]::text[] END`;

/**
 * Work that is ready but has nobody on it, for the people who run the course:
 * a stage task whose stage is open, and lesson files that could start now
 * with no maker — one line per course and file type, not one per lesson.
 * Without this, a role left empty when the run was created means work that
 * sits silently in nobody's list.
 */
async function unownedWork(actor, day) {
  const [taskRows, assetGroups] = await Promise.all([
    direct.rows(
      `${TASK_ROW_SQL}
        WHERE t.organization_id = $1 AND t.assignee_user_id IS NULL AND r.status = 'ACTIVE'
          AND t.kind <> 'AUTO' AND t.classification <> 'OPTIONAL'
          AND t.status = 'NOT_STARTED' AND st.status IN ('READY', 'IN_PROGRESS')
          AND ${MANAGED_SQL}
        ORDER BY st.sort_order, t.sort_order LIMIT 100`,
      [actor.organizationId, actor.userId]
    ),
    direct.rows(
      `SELECT c.id AS course_id, c.name AS course_name, c.code AS course_code, a.asset_type, count(*)::int AS lessons,
              min(a.due_date) AS due_date
         FROM ${S}.learning_assets a
         JOIN ${S}.learning_lessons l ON l.id = a.lesson_id AND l.archived_at IS NULL
         JOIN ${S}.learning_courses c ON c.id = a.course_id AND c.archived_at IS NULL
         JOIN ${S}.learning_production_runs r ON r.course_id = c.id AND r.status = 'ACTIVE'
        WHERE a.organization_id = $1 AND a.assignee_user_id IS NULL AND a.applicable AND a.status = 'NOT_STARTED'
          AND ${MANAGED_SQL}
          AND NOT EXISTS (
            SELECT 1 FROM ${S}.learning_assets d
             WHERE d.lesson_id = a.lesson_id AND d.applicable AND d.status NOT IN ('APPROVED', 'LOCKED')
               AND d.asset_type = ANY(${DEPENDENCY_SQL}))
        GROUP BY c.id, c.name, c.code, a.asset_type
        ORDER BY c.name, a.asset_type`,
      [actor.organizationId, actor.userId]
    ),
  ]);
  const computed = await blockersFor(taskRows);
  const tasks = taskRows
    .map((row) => ({ ...taskItem(row, computed.get(row.id), day, 'ASSIGN'), unowned: true }))
    .filter((item) => !item.blocked);
  const assets = assetGroups.map((row) => ({
    kind: 'ASSET',
    id: `${row.course_id}:${row.asset_type}:unowned`,
    assetType: row.asset_type,
    course: { id: row.course_id, name: row.course_name, code: row.course_code ?? null },
    lesson: null,
    status: 'NOT_STARTED',
    display: 'NOT_STARTED',
    priority: 'NORMAL',
    dueDate: row.due_date ?? null,
    dueState: row.due_date && row.due_date < day ? 'OVERDUE' : null,
    blocked: false,
    blockers: [],
    assigneeUserId: null,
    unowned: true,
    count: row.lessons,
    action: 'ASSIGN',
    link: `/learning-production/courses/${row.course_id}/production`,
  }));
  return [...tasks, ...assets];
}

export async function myWork(actor) {
  const day = today();
  const [taskRows, assetRows, doneAssets, doneTasks, issueRows, reviewSet, unowned] = await Promise.all([
    direct.rows(
      `${TASK_ROW_SQL}
        WHERE t.organization_id = $1 AND t.assignee_user_id = $2 AND r.status = 'ACTIVE'
          AND t.kind <> 'AUTO' AND st.status <> 'SKIPPED'
          AND t.status IN ('NOT_STARTED', 'IN_PROGRESS', 'CHANGES_REQUESTED')
        ORDER BY t.due_date NULLS LAST LIMIT 300`,
      [actor.organizationId, actor.userId]
    ),
    direct.rows(
      `${WORK_ROW_SQL}
        WHERE a.organization_id = $1 AND a.assignee_user_id = $2 AND a.status IN ('ASSIGNED', 'IN_PROGRESS', 'CHANGES_REQUESTED', 'NOT_STARTED')
        ORDER BY a.due_date NULLS LAST LIMIT 400`,
      [actor.organizationId, actor.userId]
    ),
    direct.rows(
      `${WORK_ROW_SQL}
        WHERE a.organization_id = $1 AND a.assignee_user_id = $2 AND a.status IN ('APPROVED', 'LOCKED')
          AND a.approved_at >= now() - interval '14 days'
        ORDER BY a.approved_at DESC LIMIT 10`,
      [actor.organizationId, actor.userId]
    ),
    direct.rows(
      `${TASK_ROW_SQL}
        WHERE t.organization_id = $1 AND t.assignee_user_id = $2 AND t.status IN ('APPROVED', 'DONE')
          AND coalesce(t.approved_at, t.done_at) >= now() - interval '14 days'
        ORDER BY coalesce(t.approved_at, t.done_at) DESC LIMIT 10`,
      [actor.organizationId, actor.userId]
    ),
    direct.rows(
      `${ISSUE_ROW_SQL} WHERE i.organization_id = $1 AND i.owner_user_id = $2 AND i.status IN ('OPEN', 'IN_PROGRESS') ORDER BY i.reported_at LIMIT 100`,
      [actor.organizationId, actor.userId]
    ),
    reviews(actor),
    unownedWork(actor, today()),
  ]);

  const computed = await blockersFor(taskRows);
  const tasks = taskRows.map((row) =>
    taskItem(row, computed.get(row.id), day, row.status === 'CHANGES_REQUESTED' ? 'FIX' : row.status === 'NOT_STARTED' ? 'START' : 'CONTINUE')
  );
  const assets = assetRows.map((row) => {
    const item = mapWorkRow(row, day);
    return assetItem(item, item.status === 'CHANGES_REQUESTED' ? 'FIX' : ['NOT_STARTED', 'ASSIGNED'].includes(item.status) ? 'START' : 'CONTINUE');
  });
  // Fixed issues waiting for the reporter's check are a decision, so they are
  // listed under review (reviewSet), not here.
  const issues = issueRows.map((row) => issueItem(row, day, 'FIX'));

  const all = [...tasks, ...assets];
  const now = [...all.filter((item) => !item.blocked), ...issues, ...unowned].sort(urgency);
  const blocked = all.filter((item) => item.blocked).sort(urgency);
  const done = [
    ...doneTasks.map((row) => taskItem(row, null, day, null)),
    ...doneAssets.map((row) => assetItem(mapWorkRow(row, day), null)),
  ];

  const sections = { now, review: reviewSet.all, blocked, done };
  return {
    sections,
    counts: {
      now: now.length,
      overdue: now.filter((item) => item.dueState === 'OVERDUE').length,
      changes: now.filter((item) => item.action === 'FIX').length,
      review: reviewSet.all.length,
      blocked: blocked.length,
    },
    people: await peopleFor(userIdsIn([now, blocked, done, reviewSet.all])),
  };
}

/* ------------------------------------------------------------------ */
/* Reviews                                                              */
/* ------------------------------------------------------------------ */

/**
 * Everything waiting for this person's decision, as items: task
 * submissions, asset submissions, release candidates to sign off and fixed
 * issues to verify. Their own submissions are never here.
 */
async function reviewItemsFor(actor, { scope = 'mine' } = {}) {
  const day = today();
  const { params, condition } = visible(actor);

  const [taskRows, assetQueue, releaseRows, issueRows] = await Promise.all([
    direct.rows(
      `${TASK_ROW_SQL}
        WHERE ${condition} AND r.status = 'ACTIVE' AND t.status IN ('SUBMITTED', 'UNDER_REVIEW')
        ORDER BY t.submitted_at LIMIT 300`,
      params
    ),
    reviewQueue(actor, { scope }),
    direct.rows(
      `SELECT rel.*, c.name AS course_name, c.code AS course_code, r.run_number, r.scenario
         FROM ${S}.learning_releases rel
         JOIN ${S}.learning_production_runs r ON r.id = rel.run_id AND r.status = 'ACTIVE'
         JOIN ${S}.learning_courses c ON c.id = rel.course_id
        WHERE ${condition} AND rel.status IN ('CANDIDATE', 'SIGNED_OFF')
        ORDER BY rel.prepared_at LIMIT 50`,
      params
    ),
    direct.rows(`${ISSUE_ROW_SQL} WHERE ${condition} AND i.status = 'FIXED' ORDER BY i.fixed_at LIMIT 200`, params),
  ]);

  const courseIds = [...new Set([...taskRows.map((row) => row.course_id), ...releaseRows.map((row) => row.course_id), ...issueRows.map((row) => row.course_id)])];
  const authority = await grantsByCourse(actor, courseIds);

  const tasks = taskRows
    .filter((row) => {
      const entry = authority.get(row.course_id);
      if (!entry) return false;
      const isReviewer = row.reviewer_user_id === actor.userId;
      const may =
        isReviewer ||
        entry.grants.has(P.TASK_APPROVE, row.stage_key) ||
        entry.grants.has(P.TASK_REVIEW, row.stage_key) ||
        (row.reviewer_role && entry.roles.includes(row.reviewer_role));
      if (!may) return false;
      if (row.submitted_by === actor.userId && !entry.grants.isAdmin) return false;
      return scope === 'all' || isReviewer || !row.reviewer_user_id;
    })
    .map((row) => taskItem(row, null, day, 'REVIEW'));

  const assets = [...assetQueue.sections.needsReview, ...assetQueue.sections.resubmitted].map((item) => assetItem(item, 'REVIEW'));

  const releases = [];
  for (const row of releaseRows) {
    const entry = authority.get(row.course_id);
    if (!entry) continue;
    const signoff = row.status === 'CANDIDATE' && entry.grants.has(P.RELEASE_SIGNOFF) && row.prepared_by !== actor.userId;
    const publish = row.status === 'SIGNED_OFF' && entry.grants.has(P.RELEASE_PUBLISH);
    if (!signoff && !publish) continue;
    releases.push({
      kind: 'RELEASE',
      id: row.id,
      title: row.version_label,
      course: { id: row.course_id, name: row.course_name, code: row.course_code ?? null },
      run: { id: row.run_id, runNumber: row.run_number, scenario: row.scenario },
      status: row.status,
      display: row.status,
      priority: 'HIGH',
      dueDate: null,
      dueState: null,
      blocked: false,
      blockers: [],
      submittedBy: row.prepared_by,
      submittedAt: iso(row.prepared_at),
      action: signoff ? 'SIGN_OFF' : 'PUBLISH',
      link: releaseLink({ courseId: row.course_id, releaseId: row.id }),
    });
  }

  const issues = issueRows
    .filter((row) => {
      const entry = authority.get(row.course_id);
      if (!entry) return false;
      if (row.fixed_by === actor.userId && !entry.grants.isAdmin) return false;
      return row.reported_by === actor.userId || entry.grants.has(P.TASK_REVIEW, row.stage_key);
    })
    .map((row) => issueItem(row, day, 'VERIFY'));

  return { tasks, assets, releases, issues };
}

/**
 * The review queue in the five groups reviewers asked for: first
 * submissions, resubmissions, curriculum approvals, media QA, and UAT and
 * release sign-off (with fixed issues waiting to be verified).
 */
export async function reviews(actor, query = {}) {
  const scope = query.scope === 'all' ? 'all' : 'mine';
  const { tasks, assets, releases, issues } = await reviewItemsFor(actor, { scope });

  const groups = { firstSubmissions: [], resubmissions: [], curriculum: [], mediaQa: [], signoff: [] };
  for (const item of tasks) {
    if (item.key === 'uat.signoff') groups.signoff.push(item);
    else if (CURRICULUM_STAGES.includes(item.stage.key)) groups.curriculum.push(item);
    else (item.isResubmission ? groups.resubmissions : groups.firstSubmissions).push(item);
  }
  for (const item of assets) {
    if (MEDIA_TYPES.includes(item.assetType)) groups.mediaQa.push(item);
    else (item.isResubmission ? groups.resubmissions : groups.firstSubmissions).push(item);
  }
  groups.signoff.push(...releases, ...issues);
  for (const key of Object.keys(groups)) groups[key].sort((a, b) => String(a.submittedAt ?? '').localeCompare(String(b.submittedAt ?? '')));

  const all = Object.values(groups).flat();
  return { groups, all, scope, people: await peopleFor(userIdsIn(all)) };
}

/* ------------------------------------------------------------------ */
/* Portfolio                                                            */
/* ------------------------------------------------------------------ */

/**
 * Every run in flight, one row each — where it is, how healthy, what gate is
 * next and what waits on whom — with the counts a manager scans first.
 */
export async function portfolio(actor) {
  const day = today();
  const { params, condition } = visible(actor);
  const values = [...params, day];
  const dayRef = `$${values.length}::date`;

  const rows = await direct.rows(
    `SELECT r.*, c.name AS course_name, c.code AS course_code, c.settings_json, c.cover_storage_key,
            tv.version_number AS template_version_number,
            g.gating, g.gating_done, g.pending_approvals, g.overdue_tasks, g.open_tasks,
            cur.stage_key AS current_stage, cur.label_json AS current_stage_label, cur.status AS current_stage_status,
            cur.sort_order AS current_stage_index, sc.stage_count,
            coalesce(iss.blocking, 0) AS blocking_issues, coalesce(iss.open, 0) AS open_issues,
            coalesce(ast.total, 0) AS assets_total, coalesce(ast.approved, 0) AS assets_approved,
            coalesce(ast.overdue, 0) AS assets_overdue, coalesce(ast.open, 0) AS assets_open,
            coalesce(ast.in_review, 0) AS assets_in_review
       FROM ${S}.learning_production_runs r
       JOIN ${S}.learning_courses c ON c.id = r.course_id
       LEFT JOIN ${S}.learning_workflow_template_versions tv ON tv.id = r.template_version_id
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE t.classification <> 'OPTIONAL' AND t.status <> 'WAIVED' AND st.status <> 'SKIPPED')::int AS gating,
                count(*) FILTER (WHERE t.classification <> 'OPTIONAL' AND t.status IN ('APPROVED', 'DONE') AND st.status <> 'SKIPPED')::int AS gating_done,
                count(*) FILTER (WHERE t.status IN ('SUBMITTED', 'UNDER_REVIEW'))::int AS pending_approvals,
                count(*) FILTER (WHERE t.due_date < ${dayRef} AND t.status NOT IN ('APPROVED', 'DONE', 'WAIVED'))::int AS overdue_tasks,
                count(*) FILTER (WHERE t.classification <> 'OPTIONAL' AND t.status NOT IN ('APPROVED', 'DONE', 'WAIVED'))::int AS open_tasks
           FROM ${S}.learning_task_instances t JOIN ${S}.learning_stage_instances st ON st.id = t.stage_id
          WHERE t.run_id = r.id
       ) g ON true
       LEFT JOIN LATERAL (
         SELECT st.stage_key, st.label_json, st.status, st.sort_order FROM ${S}.learning_stage_instances st
          WHERE st.run_id = r.id AND st.status NOT IN ('DONE', 'SKIPPED') ORDER BY st.sort_order LIMIT 1
       ) cur ON true
       LEFT JOIN LATERAL (SELECT count(*)::int AS stage_count FROM ${S}.learning_stage_instances st WHERE st.run_id = r.id) sc ON true
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE i.severity IN (${BLOCKING_SEVERITIES.map((v) => `'${v}'`).join(', ')}))::int AS blocking,
                count(*)::int AS open
           FROM ${S}.learning_run_issues i
          WHERE i.run_id = r.id AND i.status IN (${OPEN_ISSUE_STATUSES.map((v) => `'${v}'`).join(', ')})
       ) iss ON true
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS total,
                count(*) FILTER (WHERE a.status IN ('APPROVED', 'LOCKED'))::int AS approved,
                count(*) FILTER (WHERE a.status NOT IN ('APPROVED', 'LOCKED') AND a.due_date < ${dayRef})::int AS overdue,
                count(*) FILTER (WHERE a.status NOT IN ('APPROVED', 'LOCKED'))::int AS open,
                count(*) FILTER (WHERE a.status IN ('SUBMITTED', 'UNDER_REVIEW', 'RESUBMITTED'))::int AS in_review
           FROM ${S}.learning_assets a JOIN ${S}.learning_lessons l ON l.id = a.lesson_id AND l.archived_at IS NULL
          WHERE a.course_id = r.course_id AND a.applicable
       ) ast ON true
      WHERE ${condition} AND r.status IN ('ACTIVE', 'ON_HOLD')
      ORDER BY r.target_date NULLS LAST, r.created_at DESC
      LIMIT 300`,
    values
  );

  const runs = rows.map((row) => {
    const run = mapRun(row);
    const workflowPercent = row.gating ? Math.round((row.gating_done / row.gating) * 100) : 0;
    const health = runHealth({
      status: run.status,
      workflowPercent,
      overdue: row.overdue_tasks + row.assets_overdue,
      open: row.open_tasks + row.assets_open,
      startDate: run.startDate,
      targetDate: run.targetDate,
      today: day,
      settings: normalizeSettings(row.settings_json),
    });
    return {
      ...run,
      course: { id: row.course_id, name: row.course_name, code: row.course_code ?? null, hasCover: Boolean(row.cover_storage_key) },
      templateVersionNumber: row.template_version_number ?? null,
      currentStage: row.current_stage ? { key: row.current_stage, label: row.current_stage_label, status: row.current_stage_status, index: row.current_stage_index } : null,
      stageCount: row.stage_count ?? 0,
      workflow: { done: row.gating_done ?? 0, total: row.gating ?? 0, percent: workflowPercent },
      content: { done: row.assets_approved, total: row.assets_total, percent: row.assets_total ? Math.round((row.assets_approved / row.assets_total) * 100) : 0 },
      pendingApprovals: (row.pending_approvals ?? 0) + (row.assets_in_review ?? 0),
      overdue: (row.overdue_tasks ?? 0) + row.assets_overdue,
      blockingIssues: row.blocking_issues,
      openIssues: row.open_issues,
      health: health.health,
      healthReasons: health.reasons,
    };
  });

  const pipeline = {};
  for (const run of runs) if (run.currentStage) pipeline[run.currentStage.key] = (pipeline[run.currentStage.key] ?? 0) + 1;

  const [releases, workload] = await Promise.all([
    direct.rows(
      `SELECT rel.id, rel.version_label, rel.kind, rel.published_at, rel.status, c.id AS course_id, c.name AS course_name
         FROM ${S}.learning_releases rel JOIN ${S}.learning_courses c ON c.id = rel.course_id
        WHERE ${condition} AND rel.published_at >= now() - interval '90 days' AND rel.kind = 'RELEASE'
        ORDER BY rel.published_at DESC LIMIT 20`,
      params
    ),
    direct.rows(
      `SELECT person AS user_id, sum(active)::int AS active, sum(reviewing)::int AS reviewing, sum(overdue)::int AS overdue
         FROM (
           SELECT t.assignee_user_id AS person, 1 AS active, 0 AS reviewing,
                  coalesce(t.due_date < ${dayRef}, false)::int AS overdue
             FROM ${S}.learning_task_instances t
             JOIN ${S}.learning_production_runs r ON r.id = t.run_id AND r.status = 'ACTIVE'
             -- Load is the work people can pick up now, not every task of later stages.
             JOIN ${S}.learning_stage_instances st ON st.id = t.stage_id AND st.status IN ('READY', 'IN_PROGRESS')
             JOIN ${S}.learning_courses c ON c.id = r.course_id
            WHERE ${condition} AND t.assignee_user_id IS NOT NULL AND t.kind <> 'AUTO'
              AND t.status IN ('NOT_STARTED', 'IN_PROGRESS', 'CHANGES_REQUESTED')
           UNION ALL
           SELECT t.reviewer_user_id, 0, 1, 0
             FROM ${S}.learning_task_instances t
             JOIN ${S}.learning_production_runs r ON r.id = t.run_id AND r.status = 'ACTIVE'
             JOIN ${S}.learning_courses c ON c.id = r.course_id
            WHERE ${condition} AND t.reviewer_user_id IS NOT NULL AND t.status IN ('SUBMITTED', 'UNDER_REVIEW')
           UNION ALL
           SELECT a.assignee_user_id, 1, 0, coalesce(a.due_date < ${dayRef}, false)::int
             FROM ${S}.learning_assets a
             JOIN ${S}.learning_lessons l ON l.id = a.lesson_id AND l.archived_at IS NULL
             JOIN ${S}.learning_courses c ON c.id = a.course_id
            WHERE ${condition} AND a.applicable AND a.assignee_user_id IS NOT NULL
              AND a.status IN ('ASSIGNED', 'IN_PROGRESS', 'CHANGES_REQUESTED')
           UNION ALL
           SELECT a.reviewer_user_id, 0, 1, 0
             FROM ${S}.learning_assets a
             JOIN ${S}.learning_lessons l ON l.id = a.lesson_id AND l.archived_at IS NULL
             JOIN ${S}.learning_courses c ON c.id = a.course_id
            WHERE ${condition} AND a.applicable AND a.reviewer_user_id IS NOT NULL
              AND a.status IN ('SUBMITTED', 'UNDER_REVIEW', 'RESUBMITTED')
         ) work
        GROUP BY person
        ORDER BY sum(active) + sum(reviewing) DESC, sum(overdue) DESC
        LIMIT 12`,
      values
    ),
  ]);

  const active = runs.filter((run) => run.status === 'ACTIVE');
  return {
    runs,
    kpis: {
      activeRuns: active.filter((run) => run.scenario !== 'LEGACY').length,
      legacyRuns: runs.filter((run) => run.scenario === 'LEGACY').length,
      pendingApprovals: active.reduce((sum, run) => sum + run.pendingApprovals, 0),
      overdue: active.reduce((sum, run) => sum + run.overdue, 0),
      blockingIssues: active.reduce((sum, run) => sum + run.blockingIssues, 0),
      releasedLast90: releases.length,
      atRisk: active.filter((run) => run.health === 'AT_RISK' || run.health === 'DELAYED').length,
    },
    pipeline,
    bottleneck: Object.entries(pipeline).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    scenarioMix: runs.reduce((mix, run) => ({ ...mix, [run.scenario]: (mix[run.scenario] ?? 0) + 1 }), {}),
    releases: releases.map((row) => ({ id: row.id, versionLabel: row.version_label, publishedAt: iso(row.published_at), status: row.status, course: { id: row.course_id, name: row.course_name } })),
    workload: workload.map((row) => ({ userId: row.user_id, active: row.active, reviewing: row.reviewing, overdue: row.overdue })),
    canCreate: actor.grants.has(P.COURSE_CREATE),
    people: await peopleFor(userIdsIn([runs, workload.map((row) => ({ userId: row.user_id }))])),
  };
}

/* ------------------------------------------------------------------ */
/* Notification preferences                                             */
/* ------------------------------------------------------------------ */

export async function getPreferences(actor) {
  const row = await direct.row(`SELECT * FROM ${S}.learning_notification_preferences WHERE user_id = $1`, [actor.userId]);
  return {
    preferences: {
      mutedEvents: row?.muted_events ?? [],
      dueSoonDays: row?.due_soon_days ?? 2,
      overdueRepeatDays: row?.overdue_repeat_days ?? 3,
    },
    events: PREFERENCE_EVENTS,
  };
}

export async function savePreferences(actor, input) {
  const body = plainObject(input, 'body');
  const current = (await getPreferences(actor)).preferences;
  const muted = Array.isArray(body.mutedEvents) ? [...new Set(body.mutedEvents.filter((event) => PREFERENCE_EVENTS.includes(event)))] : current.mutedEvents;
  const dueSoonDays = 'dueSoonDays' in body ? integer(body.dueSoonDays, 'dueSoonDays', { min: 0, max: 14, required: true }) : current.dueSoonDays;
  const overdueRepeatDays =
    'overdueRepeatDays' in body ? integer(body.overdueRepeatDays, 'overdueRepeatDays', { min: 0, max: 30, required: true }) : current.overdueRepeatDays;
  await direct.query(
    `INSERT INTO ${S}.learning_notification_preferences (user_id, organization_id, muted_events, due_soon_days, overdue_repeat_days, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (user_id) DO UPDATE SET muted_events = EXCLUDED.muted_events, due_soon_days = EXCLUDED.due_soon_days,
       overdue_repeat_days = EXCLUDED.overdue_repeat_days, updated_at = now()`,
    [actor.userId, actor.organizationId, muted, dueSoonDays, overdueRepeatDays]
  );
  return getPreferences(actor);
}

