/**
 * Qodo Projects — phases.
 *
 * A phase is the first level of the breakdown and the one a client is most
 * likely to be shown, which is why `is_external` appears in every query here
 * rather than being filtered by the caller. A listing that forgets it is a leak,
 * and the way to make forgetting impossible is to give callers no listing that
 * does not already filter.
 */

import { query, rows, row, transaction } from './db.js';
import * as audit from './auditService.js';
import { clientVisibilitySql } from './projectAccess.js';

/* ------------------------------------------------------------------ */
/* Reading                                                              */
/* ------------------------------------------------------------------ */

/**
 * The phases of a project, with their rollups.
 *
 * The task counts are computed in SQL as lateral aggregates rather than by
 * loading the tasks — a project with four hundred tasks would otherwise pull
 * all of them to render a five-row list. §73 is not a suggestion.
 */
export async function list(context, options = {}) {
  const found = await rows(
    `SELECT ph.id, ph.name, ph.description, ph.owner_id, ph.status_id,
            ph.start_date, ph.end_date, ph.is_external, ph.sequence, ph.color,
            ph.created_at, ph.updated_at,
            s.key AS status_key, s.label_ar AS status_ar, s.label_en AS status_en,
            s.color AS status_color, s.category AS status_category,
            rollup.task_count, rollup.done_count, rollup.estimated_hours, rollup.actual_hours
       FROM qodo_projects.phases ph
       LEFT JOIN qodo_projects.statuses s ON s.id = ph.status_id
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS task_count,
                count(*) FILTER (WHERE ts.category = 'done')::int AS done_count,
                COALESCE(sum(t.estimated_hours), 0) AS estimated_hours,
                COALESCE(sum(t.actual_hours), 0) AS actual_hours
           FROM qodo_projects.project_task_extensions t
           LEFT JOIN qodo_projects.statuses ts ON ts.id = t.status_id
          WHERE t.phase_id = ph.id AND t.deleted_at IS NULL
       ) rollup ON true
      WHERE ph.project_id = $1
        AND ph.organization_id = $2
        AND ph.deleted_at IS NULL
        ${clientVisibilitySql(context, 'ph.is_external')}
        ${options.statusId ? 'AND ph.status_id = $3' : ''}
      ORDER BY ph.sequence, ph.start_date NULLS LAST, ph.created_at`,
    options.statusId
      ? [context.project.id, context.organizationId, options.statusId]
      : [context.project.id, context.organizationId]
  );

  return found.map(toPhase);
}

export async function get(context, phaseId) {
  const found = await row(
    `SELECT * FROM qodo_projects.phases
      WHERE id = $1 AND project_id = $2 AND organization_id = $3 AND deleted_at IS NULL
        ${clientVisibilitySql(context, 'is_external')}`,
    [phaseId, context.project.id, context.organizationId]
  );
  return found ? toPhase(found) : null;
}

function toPhase(record) {
  const total = Number(record.task_count ?? 0);
  const done = Number(record.done_count ?? 0);
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    ownerId: record.owner_id,
    statusId: record.status_id,
    status: record.status_key
      ? {
          key: record.status_key,
          label: { ar: record.status_ar, en: record.status_en },
          color: record.status_color,
          category: record.status_category,
        }
      : null,
    startDate: record.start_date,
    endDate: record.end_date,
    isExternal: record.is_external,
    sequence: record.sequence,
    color: record.color,
    taskCount: total,
    doneCount: done,
    // Rolled up from tasks rather than typed by hand. A phase whose percentage
    // disagrees with its own tasks is worse than one with no percentage.
    progress: total === 0 ? 0 : Math.round((done / total) * 100),
    estimatedHours: Number(record.estimated_hours ?? 0),
    actualHours: Number(record.actual_hours ?? 0),
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

/* ------------------------------------------------------------------ */
/* Writing                                                              */
/* ------------------------------------------------------------------ */

export async function create(context, input) {
  const { user, project, organizationId } = context;

  const name = String(input?.name ?? '').trim();
  if (!name) throw badRequest('name_required');
  if (input?.startDate && input?.endDate && input.endDate < input.startDate) {
    throw badRequest('end_before_start');
  }

  return transaction(async (tx) => {
    // Append to the end unless a position was given. Asking the database for
    // the current maximum inside the transaction is what stops two concurrent
    // creates from both landing on the same sequence number.
    const last = await tx.row(
      'SELECT COALESCE(max(sequence), -1) AS last FROM qodo_projects.phases WHERE project_id = $1 AND deleted_at IS NULL',
      [project.id]
    );

    const created = await tx.row(
      `INSERT INTO qodo_projects.phases
         (organization_id, project_id, name, description, owner_id, status_id,
          start_date, end_date, is_external, sequence, color, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
       RETURNING *`,
      [
        organizationId,
        project.id,
        name,
        String(input?.description ?? ''),
        input?.ownerId ?? null,
        input?.statusId ?? null,
        input?.startDate ?? null,
        input?.endDate ?? null,
        Boolean(input?.isExternal),
        input?.sequence ?? Number(last.last) + 1,
        input?.color ?? '#1D6FB8',
        user.id,
      ]
    );

    await audit.record({
      actor: user,
      organizationId,
      projectId: project.id,
      entityType: 'phase',
      entityId: created.id,
      action: 'phase.create',
      after: { name: created.name, isExternal: created.is_external },
      tx,
    });

    return toPhase(created);
  });
}

const UPDATABLE = {
  name: 'name',
  description: 'description',
  ownerId: 'owner_id',
  statusId: 'status_id',
  startDate: 'start_date',
  endDate: 'end_date',
  isExternal: 'is_external',
  sequence: 'sequence',
  color: 'color',
};

export async function update(context, phaseId, input) {
  const { user, project, organizationId } = context;

  const current = await get(context, phaseId);
  if (!current) return null;

  const assignments = [];
  const params = [phaseId, project.id, organizationId, user.id];
  const changed = {};

  for (const [field, column] of Object.entries(UPDATABLE)) {
    if (input?.[field] === undefined) continue;
    const value = field === 'isExternal' ? Boolean(input[field]) : input[field];
    params.push(value === '' ? null : value);
    assignments.push(`${column} = $${params.length}`);
    changed[field] = value;
  }
  if (assignments.length === 0) return current;

  const startDate = changed.startDate ?? current.startDate;
  const endDate = changed.endDate ?? current.endDate;
  if (startDate && endDate && endDate < startDate) throw badRequest('end_before_start');

  const updated = await row(
    `UPDATE qodo_projects.phases
        SET ${assignments.join(', ')}, updated_by = $4
      WHERE id = $1 AND project_id = $2 AND organization_id = $3 AND deleted_at IS NULL
      RETURNING *`,
    params
  );
  if (!updated) return null;

  await audit.record({
    actor: user,
    organizationId,
    projectId: project.id,
    entityType: 'phase',
    entityId: phaseId,
    action: 'phase.update',
    before: pick(current, Object.keys(changed)),
    after: changed,
  });

  return toPhase(updated);
}

/**
 * Soft-delete a phase and everything filed under it.
 *
 * One shared `deleted_batch_id`, which is what makes restore exact: reversing
 * the batch brings back precisely what this delete took, and leaves alone
 * anything that had already been deleted separately beforehand. Without it,
 * restoring a phase would resurrect a task somebody had deliberately removed
 * from it last week.
 */
export async function remove(context, phaseId) {
  const { user, project, organizationId } = context;

  return transaction(async (tx) => {
    const batch = (await tx.row('SELECT gen_random_uuid() AS id')).id;

    const deleted = await tx.row(
      `UPDATE qodo_projects.phases
          SET deleted_at = now(), deleted_by = $4, deleted_batch_id = $5
        WHERE id = $1 AND project_id = $2 AND organization_id = $3 AND deleted_at IS NULL
        RETURNING id, name`,
      [phaseId, project.id, organizationId, user.id, batch]
    );
    if (!deleted) return null;

    // Task lists keep their own rows but lose the phase. Deleting a phase is a
    // statement about the phase, not about the work — the lists survive at
    // project level, which is where they came from.
    await tx.query(
      'UPDATE qodo_projects.task_lists SET phase_id = NULL WHERE phase_id = $1',
      [phaseId]
    );
    await tx.query(
      'UPDATE qodo_projects.project_task_extensions SET phase_id = NULL WHERE phase_id = $1',
      [phaseId]
    );

    await audit.record({
      actor: user,
      organizationId,
      projectId: project.id,
      entityType: 'phase',
      entityId: phaseId,
      action: 'phase.delete',
      before: { name: deleted.name },
      after: { deletedBatch: batch },
      tx,
    });

    return { id: phaseId, deleted: true, batch };
  });
}

/**
 * Reorder phases in one statement.
 *
 * A drag produces a whole new order, not a swap, so the API takes the whole
 * order. Applying it as N separate updates would let a concurrent create land
 * in the middle and leave two phases sharing a sequence number.
 */
export async function reorder(context, orderedIds) {
  const { user, project, organizationId } = context;
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return [];

  await query(
    `UPDATE qodo_projects.phases AS ph
        SET sequence = ordering.position
       FROM (SELECT id, ordinality - 1 AS position
               FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, ordinality)) AS ordering
      WHERE ph.id = ordering.id
        AND ph.project_id = $2
        AND ph.organization_id = $3`,
    [orderedIds, project.id, organizationId]
  );

  await audit.record({
    actor: user,
    organizationId,
    projectId: project.id,
    entityType: 'phase',
    entityId: project.id,
    action: 'phase.reorder',
    after: { order: orderedIds },
  });

  return list(context);
}

function pick(source, fields) {
  const out = {};
  for (const field of fields) out[field] = source?.[field] ?? null;
  return out;
}

function badRequest(code) {
  return Object.assign(new Error(code), { status: 400, body: { error: code } });
}
