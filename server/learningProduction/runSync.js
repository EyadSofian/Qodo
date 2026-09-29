/**
 * Keeping a run's derived state true.
 *
 * Stage status and automatic gates are derived (runs.js `computeRun`) from
 * tasks, lesson assets, issues and releases. They are stored so lists can
 * filter on them, which means somebody must re-derive them whenever any of
 * those inputs change: every task, issue and release action, and every asset
 * action and lesson change in a course with a run, calls `syncRun` inside its
 * own transaction before it commits.
 *
 * `syncRun` locks the run row, so two changes to the same run serialise here
 * and the second always derives from the first's result.
 */

import { ASSET_TYPES } from '../../shared/learningProduction/constants.js';
import { BLOCKING_SEVERITIES, OPEN_ISSUE_STATUSES, computeRun } from '../../shared/learningProduction/runs.js';
import { SCHEMA as S } from './db.js';
import { record } from './activity.js';
import { WINDOW, taskLink, runLink } from './notifications.js';
import { mapRun, mapStage, mapTask } from './runMappers.js';

const OPEN_ISSUES_SQL = `(${OPEN_ISSUE_STATUSES.map((status) => `'${status}'`).join(', ')})`;
const BLOCKING_SQL = `(${BLOCKING_SEVERITIES.map((severity) => `'${severity}'`).join(', ')})`;

/** Stages and tasks of one run, in order, with task dependency keys attached. */
export async function loadRunStructure(db, runId) {
  const [stages, tasks, dependencies] = await Promise.all([
    db.rows(`SELECT * FROM ${S}.learning_stage_instances WHERE run_id = $1 ORDER BY sort_order`, [runId]),
    db.rows(
      `SELECT t.*, st.stage_key FROM ${S}.learning_task_instances t
         JOIN ${S}.learning_stage_instances st ON st.id = t.stage_id
        WHERE t.run_id = $1 ORDER BY st.sort_order, t.sort_order`,
      [runId]
    ),
    db.rows(
      `SELECT d.task_id, dep.task_key AS depends_on_key
         FROM ${S}.learning_task_dependencies d
         JOIN ${S}.learning_task_instances dep ON dep.id = d.depends_on_task_id
         JOIN ${S}.learning_task_instances t ON t.id = d.task_id
        WHERE t.run_id = $1`,
      [runId]
    ),
  ]);
  const after = new Map();
  for (const entry of dependencies) after.set(entry.task_id, [...(after.get(entry.task_id) ?? []), entry.depends_on_key]);
  return {
    stages: stages.map(mapStage),
    tasks: tasks.map((row) => ({ ...mapTask(row), after: after.get(row.id) ?? [] })),
  };
}

/**
 * The facts automatic gates and readiness are judged on. Counts only
 * applicable assets of lessons that are not archived; "reviewed" counts only
 * decisions made during this run, so a revamp is not satisfied by the review
 * its source release had.
 */
export async function runFacts(db, run) {
  const [assetRows, issueRows, blocking, releases] = await Promise.all([
    db.rows(
      `SELECT a.asset_type,
              count(*)::int AS total,
              count(*) FILTER (WHERE a.status IN ('APPROVED', 'LOCKED'))::int AS approved,
              count(*) FILTER (WHERE a.status NOT IN ('NOT_STARTED', 'ASSIGNED', 'IN_PROGRESS'))::int AS submitted,
              count(*) FILTER (WHERE a.status = 'CHANGES_REQUESTED')::int AS changes_requested,
              count(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM ${S}.learning_asset_approvals ap
                 WHERE ap.asset_id = a.id AND ap.decision <> 'PENDING' AND ap.reviewed_at >= $2))::int AS reviewed,
              coalesce(sum((SELECT count(*) FROM ${S}.learning_comments cm
                             WHERE cm.asset_id = a.id AND cm.status = 'OPEN' AND cm.parent_comment_id IS NULL
                               AND cm.deleted_at IS NULL)), 0)::int AS open_comments
         FROM ${S}.learning_assets a
         JOIN ${S}.learning_lessons l ON l.id = a.lesson_id AND l.archived_at IS NULL
        WHERE a.course_id = $1 AND a.applicable
        GROUP BY a.asset_type`,
      [run.courseId, run.createdAt]
    ),
    db.rows(
      `SELECT st.stage_key,
              count(i.id)::int AS total,
              count(i.id) FILTER (WHERE i.status IN ${OPEN_ISSUES_SQL})::int AS open
         FROM ${S}.learning_stage_instances st
         LEFT JOIN ${S}.learning_run_issues i ON i.stage_id = st.id
        WHERE st.run_id = $1
        GROUP BY st.stage_key`,
      [run.id]
    ),
    db.row(
      `SELECT count(*)::int AS n FROM ${S}.learning_run_issues
        WHERE run_id = $1 AND status IN ${OPEN_ISSUES_SQL} AND severity IN ${BLOCKING_SQL}`,
      [run.id]
    ),
    db.rows(
      `SELECT id, version_label, status, signoff_at, published_at FROM ${S}.learning_releases
        WHERE run_id = $1 ORDER BY release_number DESC`,
      [run.id]
    ),
  ]);

  const assets = {};
  for (const type of ASSET_TYPES) assets[type] = { total: 0, approved: 0, submitted: 0, reviewed: 0, changesRequested: 0, openComments: 0 };
  for (const row of assetRows) {
    assets[row.asset_type] = {
      total: row.total,
      approved: row.approved,
      submitted: row.submitted,
      reviewed: row.reviewed,
      changesRequested: row.changes_requested,
      openComments: row.open_comments,
    };
  }
  const issues = Object.fromEntries(issueRows.map((row) => [row.stage_key, { open: row.open, total: row.total }]));
  const published = releases.find((release) => release.published_at);
  const live = releases.find((release) => !['WITHDRAWN'].includes(release.status));
  return {
    assets,
    issues,
    blockingIssues: blocking?.n ?? 0,
    releasePublished: Boolean(published),
    releaseSignedOff: Boolean(live?.signoff_at),
    publishedRelease: published
      ? { id: published.id, versionLabel: published.version_label, publishedAt: published.published_at instanceof Date ? published.published_at.toISOString() : published.published_at }
      : null,
  };
}

/**
 * Re-derive one run and persist what changed. Returns the computed run for
 * callers that want to read it back without another query.
 *
 * `justCompleted` names tasks this action finished, so the people whose work
 * they unblocked can be told — together with every task in a stage that has
 * just stopped being blocked.
 */
export async function syncRun(tx, runId, { actorId = null, outbox = null, justCompleted = [] } = {}) {
  const runRow = await tx.row(
    `SELECT r.*, c.name AS course_name FROM ${S}.learning_production_runs r
       JOIN ${S}.learning_courses c ON c.id = r.course_id
      WHERE r.id = $1 FOR UPDATE OF r`,
    [runId]
  );
  if (!runRow) return null;
  const run = mapRun(runRow);
  const { stages, tasks } = await loadRunStructure(tx, runId);
  const facts = await runFacts(tx, run);
  const computed = computeRun({ stages, tasks, facts, lessonAssetTypes: run.lessonAssetTypes });

  for (const change of computed.changes.tasks) {
    await tx.query(
      `UPDATE ${S}.learning_task_instances
          SET status = $2,
              started_at = CASE WHEN $2 <> 'NOT_STARTED' THEN coalesce(started_at, now()) ELSE started_at END,
              done_at = CASE WHEN $2 = 'DONE' THEN now() ELSE NULL END
        WHERE id = $1`,
      [change.id, change.to]
    );
  }

  const unblockedStages = new Set();
  for (const change of computed.changes.stages) {
    await tx.query(
      `UPDATE ${S}.learning_stage_instances
          SET status = $2,
              started_at = CASE WHEN $2 IN ('IN_PROGRESS', 'DONE') THEN coalesce(started_at, now()) ELSE started_at END,
              completed_at = CASE WHEN $2 = 'DONE' THEN coalesce(completed_at, now()) ELSE NULL END
        WHERE id = $1`,
      [change.id, change.to]
    );
    const stage = computed.stages.find((entry) => entry.id === change.id);
    if (change.from === 'BLOCKED' && change.to !== 'BLOCKED') unblockedStages.add(change.key);
    if (change.to === 'DONE' && change.from !== 'DONE') {
      await record(tx, {
        organizationId: runRow.organization_id,
        courseId: run.courseId,
        runId,
        stageId: change.id,
        actorUserId: actorId,
        eventType: 'STAGE_COMPLETED',
        metadata: { stageKey: change.key },
      });
      outbox?.push({
        organizationId: runRow.organization_id,
        actorId,
        recipients: [run.managerUserId],
        type: 'stage_completed',
        message: 'stageCompleted',
        dedupeKey: `stage-done:${change.id}`,
        windowMinutes: WINDOW.DAY,
        entityType: 'STAGE',
        entityId: change.id,
        link: `${runLink({ courseId: run.courseId })}/plan?stage=${change.key}`,
        data: { courseName: runRow.course_name, stageLabel: stage?.label ?? null },
      });
    }
    if (change.from === 'DONE' && change.to !== 'DONE' && change.to !== 'SKIPPED') {
      await record(tx, {
        organizationId: runRow.organization_id,
        courseId: run.courseId,
        runId,
        stageId: change.id,
        actorUserId: actorId,
        eventType: 'STAGE_REOPENED',
        metadata: { stageKey: change.key, to: change.to },
      });
    }
  }

  if (outbox) {
    const completed = new Set(justCompleted);
    for (const entry of computed.tasks) {
      if (entry.status !== 'NOT_STARTED' || entry.blockers.length > 0 || !entry.assigneeUserId || entry.kind === 'AUTO') continue;
      const freedByStage = unblockedStages.has(entry.stageKey);
      const freedByTask = entry.after.some((key) => completed.has(key));
      if (!freedByStage && !freedByTask) continue;
      const stage = computed.stages.find((item) => item.key === entry.stageKey);
      outbox.push({
        organizationId: runRow.organization_id,
        actorId,
        recipients: [entry.assigneeUserId],
        type: 'task_unblocked',
        message: 'taskUnblocked',
        dedupeKey: `unblocked:${entry.id}`,
        windowMinutes: WINDOW.DAY,
        taskId: entry.id,
        link: taskLink({ courseId: run.courseId, taskId: entry.id }),
        data: { courseName: runRow.course_name, taskLabel: entry.label, stageLabel: stage?.label ?? null },
      });
    }
  }

  return { run, facts, ...computed };
}

/**
 * Sync the run in flight on a course, if it has one — the hook asset and
 * lesson actions call. A course with no open run has nothing to derive.
 */
export async function syncCourseRun(tx, courseId, options = {}) {
  const open = await tx.row(
    `SELECT id FROM ${S}.learning_production_runs WHERE course_id = $1 AND status IN ('ACTIVE', 'ON_HOLD') AND scenario <> 'LEGACY'`,
    [courseId]
  );
  if (!open) return null;
  return syncRun(tx, open.id, options);
}
