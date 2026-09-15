/**
 * The aggregate reads several screens share: a course with its progress and
 * health, the progress of each stage, and the compact summary of one asset
 * that the matrix, the lesson header and the work lists all draw.
 *
 * All of it is computed from the underlying asset states — no percentage is
 * stored anywhere, so no percentage can be stale.
 */

import { ASSET_TYPES } from '../../../shared/learningProduction/constants.js';
import {
  courseHealth,
  dependencyState,
  dueState,
  normalizeSettings,
  percent,
  todayIn,
} from '../../../shared/learningProduction/workflow.js';
import { SCHEMA as S } from '../db.js';
import { mapCourse, num } from '../mappers.js';

export const COMPLETE_SQL = `('APPROVED', 'LOCKED')`;
export const REVIEW_SQL = `('SUBMITTED', 'UNDER_REVIEW', 'RESUBMITTED')`;
export const WORKING_SQL = `('NOT_STARTED', 'ASSIGNED', 'IN_PROGRESS', 'CHANGES_REQUESTED')`;

/** Today in the organization's timezone — the day a deadline is measured against. */
export function today() {
  return todayIn(process.env.DIGEST_TIMEZONE || 'Africa/Cairo');
}

const iso = (value) => (value instanceof Date ? value.toISOString() : value ?? null);

/** The summary of one asset in a list, given its lesson's five statuses. */
export function assetSummary(r, siblingStatuses, settings, day = today()) {
  const dependencies = dependencyState(r.asset_type, r.status, siblingStatuses, {
    enforce: settings?.enforceDependencies !== false,
    overridden: Boolean(r.dependency_override_at),
  });
  return {
    id: r.id,
    assetType: r.asset_type,
    status: r.status,
    priority: r.priority,
    assigneeUserId: r.assignee_user_id ?? null,
    reviewerUserId: r.reviewer_user_id ?? null,
    dueDate: r.due_date ?? null,
    dueState: dueState(r.due_date, r.status, day),
    blocked: dependencies.blocked,
    waitingFor: dependencies.blocked ? dependencies.waitingFor : [],
    currentVersionNumber: r.current_version_number ?? null,
    openComments: Number(r.open_comments ?? 0),
    submittedAt: iso(r.submitted_at),
    updatedAt: iso(r.updated_at),
  };
}

/**
 * Courses with their counts, progress and health.
 *
 * `condition` is SQL over the alias `c`, with its parameters already in
 * `params`. Health needs each course's own thresholds, so it is decided here in
 * JavaScript over rows the database has already aggregated — a few numbers per
 * course, never the assets themselves.
 */
export async function coursesWithStats(db, { condition, params, limit = 500 }) {
  const values = [...params];
  const day = today();
  values.push(day);
  const todayRef = `$${values.length}::date`;
  values.push(limit);
  const limitRef = `$${values.length}`;

  const found = await db.rows(
    `SELECT c.*, s.*, cl.completed_lessons, la.last_activity_at
       FROM ${S}.learning_courses c
       LEFT JOIN LATERAL (
         SELECT count(a.id)::int AS total_assets,
                count(a.id) FILTER (WHERE a.status IN ${COMPLETE_SQL})::int AS complete_assets,
                count(a.id) FILTER (WHERE a.status NOT IN ${COMPLETE_SQL})::int AS open_assets,
                count(a.id) FILTER (WHERE a.status NOT IN ${COMPLETE_SQL} AND a.due_date < ${todayRef})::int AS overdue_assets,
                count(a.id) FILTER (WHERE a.status IN ${REVIEW_SQL})::int AS review_assets,
                count(a.id) FILTER (WHERE a.status = 'CHANGES_REQUESTED')::int AS changes_assets,
                count(DISTINCT a.lesson_id)::int AS lesson_count
           FROM ${S}.learning_assets a
           JOIN ${S}.learning_lessons l ON l.id = a.lesson_id AND l.archived_at IS NULL
          WHERE a.course_id = c.id
       ) s ON true
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS completed_lessons
           FROM (SELECT a.lesson_id
                   FROM ${S}.learning_assets a
                   JOIN ${S}.learning_lessons l ON l.id = a.lesson_id AND l.archived_at IS NULL
                  WHERE a.course_id = c.id
                  GROUP BY a.lesson_id
                 HAVING bool_and(a.status IN ${COMPLETE_SQL})) finished
       ) cl ON true
       LEFT JOIN LATERAL (
         SELECT e.created_at AS last_activity_at
           FROM ${S}.learning_activity_log e
          WHERE e.course_id = c.id
          ORDER BY e.id DESC
          LIMIT 1
       ) la ON true
      WHERE ${condition}
      ORDER BY c.updated_at DESC
      LIMIT ${limitRef}`,
    values
  );

  return found.map((r) => {
    const settings = normalizeSettings(r.settings_json);
    const health = courseHealth({
      totalAssets: r.total_assets,
      completeAssets: r.complete_assets,
      openAssets: r.open_assets,
      overdueAssets: r.overdue_assets,
      startDate: r.start_date,
      targetDate: r.target_date,
      today: day,
      settings,
    });
    return {
      ...mapCourse(r),
      settings,
      stats: {
        lessons: r.lesson_count ?? 0,
        completedLessons: r.completed_lessons ?? 0,
        totalAssets: r.total_assets ?? 0,
        completeAssets: r.complete_assets ?? 0,
        openAssets: r.open_assets ?? 0,
        overdueAssets: r.overdue_assets ?? 0,
        reviewAssets: r.review_assets ?? 0,
        changesAssets: r.changes_assets ?? 0,
      },
      progress: health.progress,
      health: health.health,
      healthReasons: health.reasons,
      lastActivityAt: iso(r.last_activity_at),
    };
  });
}

/** Progress of each stage across the courses `condition` selects. */
export async function stageStats(db, { condition, params }) {
  const values = [...params];
  values.push(today());
  const todayRef = `$${values.length}::date`;
  const found = await db.rows(
    `SELECT a.asset_type,
            count(*)::int AS total,
            count(*) FILTER (WHERE a.status IN ${COMPLETE_SQL})::int AS complete,
            count(*) FILTER (WHERE a.status IN ${REVIEW_SQL})::int AS review,
            count(*) FILTER (WHERE a.status = 'CHANGES_REQUESTED')::int AS changes,
            count(*) FILTER (WHERE a.status = 'IN_PROGRESS')::int AS in_progress,
            count(*) FILTER (WHERE a.status NOT IN ${COMPLETE_SQL} AND a.due_date < ${todayRef})::int AS overdue
       FROM ${S}.learning_courses c
       JOIN ${S}.learning_lessons l ON l.course_id = c.id AND l.archived_at IS NULL
       JOIN ${S}.learning_assets a ON a.lesson_id = l.id
      WHERE ${condition}
      GROUP BY a.asset_type`,
    values
  );
  const byType = new Map(found.map((r) => [r.asset_type, r]));
  return ASSET_TYPES.map((assetType) => {
    const r = byType.get(assetType) ?? {};
    const total = r.total ?? 0;
    const complete = r.complete ?? 0;
    return {
      assetType,
      total,
      complete,
      review: r.review ?? 0,
      changes: r.changes ?? 0,
      inProgress: r.in_progress ?? 0,
      overdue: r.overdue ?? 0,
      percent: percent(complete, total),
    };
  });
}

/**
 * The columns a work list row needs — course, lesson, stage, deadline, open
 * feedback and what the asset is waiting for. `FROM`/`JOIN` included; the
 * caller adds `WHERE`.
 */
export const WORK_ROW_SQL = `
  SELECT a.id, a.asset_type, a.status, a.priority, a.due_date, a.assignee_user_id, a.reviewer_user_id,
         a.submitted_at, a.submitted_by, a.approved_at, a.updated_at, a.dependency_override_at, a.lesson_id,
         c.id AS course_id, c.name AS course_name, c.code AS course_code, c.settings_json,
         l.name AS lesson_name, m.name AS module_name,
         v.version_number AS current_version_number,
         (SELECT count(*)::int FROM ${S}.learning_comments cm
           WHERE cm.asset_id = a.id AND cm.status = 'OPEN' AND cm.parent_comment_id IS NULL AND cm.deleted_at IS NULL) AS open_comments,
         (SELECT jsonb_object_agg(sib.asset_type, sib.status) FROM ${S}.learning_assets sib WHERE sib.lesson_id = a.lesson_id) AS siblings
    FROM ${S}.learning_assets a
    JOIN ${S}.learning_lessons l ON l.id = a.lesson_id AND l.archived_at IS NULL
    JOIN ${S}.learning_courses c ON c.id = a.course_id AND c.archived_at IS NULL
    LEFT JOIN ${S}.learning_course_modules m ON m.id = l.module_id
    LEFT JOIN ${S}.learning_asset_versions v ON v.id = a.current_version_id`;

export function mapWorkRow(r, day = today()) {
  const settings = normalizeSettings(r.settings_json);
  return {
    ...assetSummary(r, r.siblings ?? {}, settings, day),
    submittedBy: r.submitted_by ?? null,
    approvedAt: iso(r.approved_at),
    course: { id: r.course_id, name: r.course_name, code: r.course_code ?? null },
    lesson: { id: r.lesson_id, name: r.lesson_name, moduleName: r.module_name ?? null },
  };
}

const PRIORITY_RANK = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

/** Most pressing first: overdue, then priority, then the nearest deadline. */
export function byUrgency(a, b) {
  const lateA = a.dueState === 'OVERDUE' ? 0 : 1;
  const lateB = b.dueState === 'OVERDUE' ? 0 : 1;
  if (lateA !== lateB) return lateA - lateB;
  const rank = (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2);
  if (rank !== 0) return rank;
  return String(a.dueDate ?? '9999').localeCompare(String(b.dueDate ?? '9999'));
}

export { num };
