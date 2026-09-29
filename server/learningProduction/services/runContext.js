/**
 * Loading a run, a stage or a task with everything its rules need.
 *
 * Every run, stage, task, issue and release action starts here, so the
 * organization check and the course visibility check happen in one place: an
 * id from another organization, or from a course the caller cannot see, is
 * "not found" — the same answer as an id that names nothing.
 */

import { SCHEMA as S, direct } from '../db.js';
import { courseContext } from '../access.js';
import { notFound } from '../errors.js';
import { mapRun, mapStage, mapTask } from '../runMappers.js';

export async function runContext(actor, runId, { db = direct, lock = false } = {}) {
  const row = await db.row(
    `SELECT r.* FROM ${S}.learning_production_runs r WHERE r.id = $1 AND r.organization_id = $2 ${lock ? 'FOR UPDATE' : ''}`,
    [runId, actor.organizationId]
  );
  if (!row) throw notFound();
  const ctx = await courseContext(actor, row.course_id, { db });
  const run = mapRun(row);
  return {
    ...ctx,
    run,
    /** Work happens only on an active run. On hold, released, closed and cancelled runs are read-only. */
    runOpen: row.status === 'ACTIVE',
    isCurrentRun: ctx.openRunId === row.id,
  };
}

export async function stageContext(actor, stageId, { db = direct, lock = false } = {}) {
  const row = await db.row(
    `SELECT st.* FROM ${S}.learning_stage_instances st WHERE st.id = $1 AND st.organization_id = $2 ${lock ? 'FOR UPDATE' : ''}`,
    [stageId, actor.organizationId]
  );
  if (!row) throw notFound();
  const ctx = await runContext(actor, row.run_id, { db });
  return { ...ctx, stage: mapStage(row) };
}

export async function taskContext(actor, taskId, { db = direct, lock = false } = {}) {
  const row = await db.row(
    `SELECT t.*, st.stage_key, st.skipped_at AS stage_skipped_at, st.label_json AS stage_label, st.status AS stage_status
       FROM ${S}.learning_task_instances t
       JOIN ${S}.learning_stage_instances st ON st.id = t.stage_id
      WHERE t.id = $1 AND t.organization_id = $2
      ${lock ? 'FOR UPDATE OF t' : ''}`,
    [taskId, actor.organizationId]
  );
  if (!row) throw notFound();
  const ctx = await runContext(actor, row.run_id, { db });
  return {
    ...ctx,
    task: mapTask(row),
    stage: { id: row.stage_id, key: row.stage_key, label: row.stage_label, skipped: Boolean(row.stage_skipped_at), status: row.stage_status },
  };
}
