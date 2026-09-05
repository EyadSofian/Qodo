/**
 * Qodo Projects — the schedule, persisted.
 *
 * `schedulingService.js` is the arithmetic: working days, dependency types, the
 * critical path, baseline variance, cascade. It is pure and knows nothing about
 * a database. This file is what puts it to work — it loads a project's tasks and
 * dependencies, hands them over, and writes the answer back.
 *
 * The split matters because the arithmetic is the part most likely to be
 * quietly wrong, and a pure function can be tested against dates written out by
 * hand rather than against its own output.
 */

import { query, rows, row, transaction } from './db.js';
import * as audit from './auditService.js';
import {
  DEFAULT_WORKDAYS,
  baselineVariance,
  cascadeFrom,
  computeSchedule,
  makeCalendar,
  wouldCycle,
} from './schedulingService.js';

/* ------------------------------------------------------------------ */
/* Loading                                                              */
/* ------------------------------------------------------------------ */

/**
 * The working calendar a project schedules against.
 *
 * Falls back to the organization's default, and then to Engosoft's own week —
 * a project with no calendar must still schedule, and scheduling it against a
 * Monday-to-Friday assumption would be worse than refusing.
 */
export async function calendarFor(context) {
  const found = await row(
    `SELECT c.id, c.workdays
       FROM qodo_projects.work_calendars c
      WHERE c.organization_id = $1
        AND (c.id = $2 OR ($2 IS NULL AND c.is_default))
      LIMIT 1`,
    [context.organizationId, context.project.calendarId ?? null]
  );

  const holidays = found
    ? (
        await rows('SELECT holiday_on FROM qodo_projects.calendar_holidays WHERE calendar_id = $1', [
          found.id,
        ])
      ).map((r) => (r.holiday_on instanceof Date ? r.holiday_on.toISOString().slice(0, 10) : String(r.holiday_on)))
    : [];

  return makeCalendar({ workdays: found?.workdays ?? DEFAULT_WORKDAYS, holidays });
}

/** Every task in the project, in the shape the scheduler wants. */
async function scheduleInputs(context) {
  const tasks = await rows(
    `SELECT task_id AS id, start_date, end_date, duration_days
       FROM qodo_projects.project_task_extensions
      WHERE project_id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [context.project.id, context.organizationId]
  );

  const dependencies = await rows(
    `SELECT predecessor_id, successor_id, type, lag_days
       FROM qodo_projects.task_dependencies
      WHERE project_id = $1 AND organization_id = $2`,
    [context.project.id, context.organizationId]
  );

  return {
    tasks: tasks.map((task) => ({
      id: task.id,
      startDate: asDate(task.start_date),
      durationDays: task.duration_days,
    })),
    dependencies: dependencies.map((edge) => ({
      predecessorId: edge.predecessor_id,
      successorId: edge.successor_id,
      type: edge.type,
      lagDays: edge.lag_days,
    })),
  };
}

const asDate = (value) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : value ? String(value).slice(0, 10) : null;

/* ------------------------------------------------------------------ */
/* The schedule                                                         */
/* ------------------------------------------------------------------ */

/**
 * Compute the project's schedule and critical path.
 *
 * Read-only: it says what the dates *would* be, and does not write them. A
 * Gantt renders this; whether the stored dates are then updated to match is a
 * separate, authorized decision — see `applySchedule`.
 */
export async function scheduleOf(context) {
  const [{ tasks, dependencies }, calendar] = await Promise.all([
    scheduleInputs(context),
    calendarFor(context),
  ]);

  return computeSchedule({
    tasks,
    dependencies,
    projectStart: asDate(context.project.startDate),
    calendar,
  });
}

/**
 * Move one task and report what else has to move with it.
 *
 * `commit: false` — the default — is the preview a drag shows before it lands,
 * and it is what makes "this pushes the project out by six working days" a
 * warning rather than a discovery. Nothing is written until a caller asks for
 * it and has cleared `task.edit_schedule`.
 */
export async function reschedule(context, taskId, newStartDate, { commit = false } = {}) {
  const [{ tasks, dependencies }, calendar] = await Promise.all([
    scheduleInputs(context),
    calendarFor(context),
  ]);

  const result = cascadeFrom({
    tasks,
    dependencies,
    movedTaskId: taskId,
    newStartDate,
    projectStart: asDate(context.project.startDate),
    calendar,
  });

  if (!result.ok || !commit) return result;

  await transaction(async (tx) => {
    for (const change of result.changes) {
      await tx.query(
        `UPDATE qodo_projects.project_task_extensions
            SET start_date = $2, end_date = $3, updated_by = $4
          WHERE task_id = $1 AND project_id = $5`,
        [change.id, change.to.startDate, change.to.endDate, context.user.id, context.project.id]
      );
    }

    await audit.record({
      actor: context.user,
      organizationId: context.organizationId,
      projectId: context.project.id,
      entityType: 'task',
      entityId: taskId,
      action: 'task.reschedule',
      after: {
        movedTo: newStartDate,
        cascaded: result.changes.length - 1,
        projectSlipDays: result.projectSlipDays,
      },
      tx,
    });
  });

  return { ...result, committed: true };
}

/**
 * Write the computed schedule onto the tasks.
 *
 * Used when a planner asks the product to level the plan rather than dragging
 * bars one at a time. Every write goes through the same authorized path a drag
 * does, and the whole thing is one transaction — half a levelled schedule is
 * not a slow request, it is a plan that contradicts itself.
 */
export async function applySchedule(context) {
  const schedule = await scheduleOf(context);
  if (!schedule.ok) return schedule;

  await transaction(async (tx) => {
    for (const task of schedule.tasks) {
      await tx.query(
        `UPDATE qodo_projects.project_task_extensions
            SET start_date = $2, end_date = $3, updated_by = $4
          WHERE task_id = $1 AND project_id = $5
            AND (start_date IS DISTINCT FROM $2::date OR end_date IS DISTINCT FROM $3::date)`,
        [task.id, task.earlyStart, task.earlyFinish, context.user.id, context.project.id]
      );
    }

    await audit.record({
      actor: context.user,
      organizationId: context.organizationId,
      projectId: context.project.id,
      entityType: 'project',
      entityId: context.project.id,
      action: 'project.schedule.apply',
      after: { tasks: schedule.tasks.length, projectFinish: schedule.projectFinish },
      tx,
    });
  });

  return { ...schedule, applied: true };
}

/* ------------------------------------------------------------------ */
/* Dependencies                                                         */
/* ------------------------------------------------------------------ */

export async function dependencies(context) {
  return (
    await rows(
      `SELECT id, predecessor_id, successor_id, type, lag_days, created_at
         FROM qodo_projects.task_dependencies
        WHERE project_id = $1 AND organization_id = $2
        ORDER BY created_at`,
      [context.project.id, context.organizationId]
    )
  ).map((edge) => ({
    id: edge.id,
    predecessorId: edge.predecessor_id,
    successorId: edge.successor_id,
    type: edge.type,
    lagDays: edge.lag_days,
  }));
}

/**
 * Link two tasks.
 *
 * The cycle check runs *before* the insert and reports the offending path
 * rather than a boolean, because "you cannot add that dependency" is not
 * something anybody can act on. An unschedulable graph must never reach the
 * database — every view that draws the network would recurse forever on it.
 */
export async function addDependency(context, input) {
  const { user, project, organizationId } = context;

  const predecessorId = String(input?.predecessorId ?? '');
  const successorId = String(input?.successorId ?? '');
  const type = ['FS', 'SS', 'FF', 'SF'].includes(input?.type) ? input.type : 'FS';
  const lagDays = Math.trunc(Number(input?.lagDays) || 0);

  if (!predecessorId || !successorId) throw badRequest('tasks_required');

  // Both ends must be in *this* project. Without this a caller could link a
  // task to one in a project they cannot see and learn that it exists.
  const ends = await rows(
    `SELECT task_id FROM qodo_projects.project_task_extensions
      WHERE task_id = ANY($1::text[]) AND project_id = $2 AND deleted_at IS NULL`,
    [[predecessorId, successorId], project.id]
  );
  if (ends.length !== 2) throw badRequest('task_not_found');

  const existing = await dependencies(context);
  const cycle = wouldCycle(existing, { predecessorId, successorId });
  if (cycle) {
    throw Object.assign(new Error('would_create_cycle'), {
      status: 409,
      body: { error: 'would_create_cycle', cycle },
    });
  }

  const created = await row(
    `INSERT INTO qodo_projects.task_dependencies
       (organization_id, project_id, predecessor_id, successor_id, type, lag_days, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (predecessor_id, successor_id)
       DO UPDATE SET type = EXCLUDED.type, lag_days = EXCLUDED.lag_days
     RETURNING *`,
    [organizationId, project.id, predecessorId, successorId, type, lagDays, user.id]
  );

  await audit.record({
    actor: user,
    organizationId,
    projectId: project.id,
    entityType: 'task_dependency',
    entityId: created.id,
    action: 'dependency.create',
    after: { predecessorId, successorId, type, lagDays },
  });

  return {
    id: created.id,
    predecessorId: created.predecessor_id,
    successorId: created.successor_id,
    type: created.type,
    lagDays: created.lag_days,
  };
}

export async function removeDependency(context, dependencyId) {
  const { user, project, organizationId } = context;

  const { rowCount } = await query(
    'DELETE FROM qodo_projects.task_dependencies WHERE id = $1 AND project_id = $2 AND organization_id = $3',
    [dependencyId, project.id, organizationId]
  );
  if (rowCount === 0) return false;

  await audit.record({
    actor: user,
    organizationId,
    projectId: project.id,
    entityType: 'task_dependency',
    entityId: dependencyId,
    action: 'dependency.delete',
    before: { id: dependencyId },
    after: null,
  });

  return true;
}

/* ------------------------------------------------------------------ */
/* Baselines                                                            */
/* ------------------------------------------------------------------ */

export async function baselines(context) {
  return rows(
    `SELECT id, name, notes, captured_at, captured_by
       FROM qodo_projects.project_baselines
      WHERE project_id = $1 AND organization_id = $2
      ORDER BY captured_at DESC`,
    [context.project.id, context.organizationId]
  );
}

/**
 * Freeze the current plan.
 *
 * Insert-only, and the trigger in migration 003 refuses updates: a baseline
 * that can be edited is not a baseline, it is a second copy of the current
 * plan, and comparing the plan to itself always says "on schedule".
 */
export async function captureBaseline(context, input) {
  const { user, project, organizationId } = context;

  return transaction(async (tx) => {
    const baseline = await tx.row(
      `INSERT INTO qodo_projects.project_baselines
         (organization_id, project_id, name, notes, captured_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [
        organizationId,
        project.id,
        String(input?.name ?? '').trim() || new Date().toISOString().slice(0, 10),
        String(input?.notes ?? ''),
        user.id,
      ]
    );

    await tx.query(
      `INSERT INTO qodo_projects.task_baselines
         (baseline_id, task_id, organization_id, start_date, end_date, duration_days, estimated_hours)
       SELECT $1, task_id, organization_id, start_date, end_date, duration_days, estimated_hours
         FROM qodo_projects.project_task_extensions
        WHERE project_id = $2 AND deleted_at IS NULL`,
      [baseline.id, project.id]
    );

    await audit.record({
      actor: user,
      organizationId,
      projectId: project.id,
      entityType: 'project_baseline',
      entityId: baseline.id,
      action: 'baseline.capture',
      after: { name: baseline.name },
      tx,
    });

    return baseline;
  });
}

/**
 * The current plan against a captured one.
 *
 * Positive variance is late. A task added after the baseline was taken reports
 * `null` rather than zero — it has no plan to be measured against, and calling
 * that "on time" would be a fabricated measurement (§51).
 */
export async function compareToBaseline(context, baselineId) {
  const [current, baseline, calendar] = await Promise.all([
    rows(
      `SELECT task_id AS id, start_date, end_date
         FROM qodo_projects.project_task_extensions
        WHERE project_id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [context.project.id, context.organizationId]
    ),
    rows(
      `SELECT task_id AS id, start_date, end_date
         FROM qodo_projects.task_baselines
        WHERE baseline_id = $1 AND organization_id = $2`,
      [baselineId, context.organizationId]
    ),
    calendarFor(context),
  ]);

  if (baseline.length === 0) return null;

  return baselineVariance({
    current: current.map((task) => ({
      id: task.id,
      startDate: asDate(task.start_date),
      endDate: asDate(task.end_date),
    })),
    baseline: baseline.map((task) => ({
      id: task.id,
      startDate: asDate(task.start_date),
      endDate: asDate(task.end_date),
    })),
    calendar,
  });
}

function badRequest(code) {
  return Object.assign(new Error(code), { status: 400, body: { error: code } });
}
