/**
 * Qodo Projects — task lists.
 *
 * The layer between a phase and the work. Small, but it carries the flag that
 * matters most: `is_external`. An internal task list and everything inside it is
 * invisible to a client, and that is enforced in the SQL of every listing here —
 * not by the caller, and never in the component.
 */

import { query, rows, row, transaction } from './db.js';
import * as audit from './auditService.js';
import { clientVisibilitySql } from './projectAccess.js';

export async function list(context, options = {}) {
  const params = [context.project.id, context.organizationId];
  let phaseFilter = '';
  if (options.phaseId === null) {
    // Explicit null means "the lists that belong to no phase", which is a real
    // question the UI asks — undefined means "all of them".
    phaseFilter = 'AND tl.phase_id IS NULL';
  } else if (options.phaseId) {
    params.push(options.phaseId);
    phaseFilter = `AND tl.phase_id = $${params.length}`;
  }

  const found = await rows(
    `SELECT tl.id, tl.name, tl.description, tl.phase_id, tl.is_external,
            tl.billing_type, tl.order_index, tl.color, tl.created_at, tl.updated_at,
            ph.name AS phase_name,
            rollup.task_count, rollup.done_count
       FROM qodo_projects.task_lists tl
       LEFT JOIN qodo_projects.phases ph ON ph.id = tl.phase_id AND ph.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS task_count,
                count(*) FILTER (WHERE s.category = 'done')::int AS done_count
           FROM qodo_projects.project_task_extensions t
           LEFT JOIN qodo_projects.statuses s ON s.id = t.status_id
          WHERE t.task_list_id = tl.id AND t.deleted_at IS NULL
       ) rollup ON true
      WHERE tl.project_id = $1
        AND tl.organization_id = $2
        AND tl.deleted_at IS NULL
        ${phaseFilter}
        ${clientVisibilitySql(context, 'tl.is_external')}
      ORDER BY tl.order_index, tl.created_at`,
    params
  );

  return found.map(toTaskList);
}

export async function get(context, taskListId) {
  const found = await row(
    `SELECT * FROM qodo_projects.task_lists
      WHERE id = $1 AND project_id = $2 AND organization_id = $3 AND deleted_at IS NULL
        ${clientVisibilitySql(context, 'is_external')}`,
    [taskListId, context.project.id, context.organizationId]
  );
  return found ? toTaskList(found) : null;
}

function toTaskList(record) {
  const total = Number(record.task_count ?? 0);
  const done = Number(record.done_count ?? 0);
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    phaseId: record.phase_id,
    phaseName: record.phase_name ?? null,
    isExternal: record.is_external,
    billingType: record.billing_type,
    orderIndex: record.order_index,
    color: record.color,
    taskCount: total,
    doneCount: done,
    progress: total === 0 ? 0 : Math.round((done / total) * 100),
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

export async function create(context, input) {
  const { user, project, organizationId } = context;

  const name = String(input?.name ?? '').trim();
  if (!name) throw badRequest('name_required');

  return transaction(async (tx) => {
    // A list inside an internal phase cannot itself be external. Allowing it
    // would produce a list a client can see hanging off a phase they cannot,
    // which renders as an orphan and reveals that the phase exists.
    let isExternal = Boolean(input?.isExternal);
    if (isExternal && input?.phaseId) {
      const phase = await tx.row(
        'SELECT is_external FROM qodo_projects.phases WHERE id = $1 AND project_id = $2',
        [input.phaseId, project.id]
      );
      if (phase && phase.is_external === false) isExternal = false;
    }

    const last = await tx.row(
      'SELECT COALESCE(max(order_index), -1) AS last FROM qodo_projects.task_lists WHERE project_id = $1 AND deleted_at IS NULL',
      [project.id]
    );

    const created = await tx.row(
      `INSERT INTO qodo_projects.task_lists
         (organization_id, project_id, phase_id, name, description, is_external,
          billing_type, order_index, color, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
       RETURNING *`,
      [
        organizationId,
        project.id,
        input?.phaseId ?? null,
        name,
        String(input?.description ?? ''),
        isExternal,
        input?.billingType ?? 'none',
        input?.orderIndex ?? Number(last.last) + 1,
        input?.color ?? '#64748B',
        user.id,
      ]
    );

    await audit.record({
      actor: user,
      organizationId,
      projectId: project.id,
      entityType: 'task_list',
      entityId: created.id,
      action: 'tasklist.create',
      after: { name: created.name, isExternal: created.is_external },
      tx,
    });

    return toTaskList(created);
  });
}

const UPDATABLE = {
  name: 'name',
  description: 'description',
  phaseId: 'phase_id',
  isExternal: 'is_external',
  billingType: 'billing_type',
  orderIndex: 'order_index',
  color: 'color',
};

export async function update(context, taskListId, input) {
  const { user, project, organizationId } = context;

  const current = await get(context, taskListId);
  if (!current) return null;

  const assignments = [];
  const params = [taskListId, project.id, organizationId, user.id];
  const changed = {};

  for (const [field, column] of Object.entries(UPDATABLE)) {
    if (input?.[field] === undefined) continue;
    const value = field === 'isExternal' ? Boolean(input[field]) : input[field];
    params.push(value === '' ? null : value);
    assignments.push(`${column} = $${params.length}`);
    changed[field] = value;
  }
  if (assignments.length === 0) return current;

  const updated = await row(
    `UPDATE qodo_projects.task_lists
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
    entityType: 'task_list',
    entityId: taskListId,
    action: 'tasklist.update',
    before: pick(current, Object.keys(changed)),
    after: changed,
  });

  return toTaskList(updated);
}

export async function remove(context, taskListId) {
  const { user, project, organizationId } = context;

  return transaction(async (tx) => {
    const batch = (await tx.row('SELECT gen_random_uuid() AS id')).id;

    const deleted = await tx.row(
      `UPDATE qodo_projects.task_lists
          SET deleted_at = now(), deleted_by = $4, deleted_batch_id = $5
        WHERE id = $1 AND project_id = $2 AND organization_id = $3 AND deleted_at IS NULL
        RETURNING id, name`,
      [taskListId, project.id, organizationId, user.id, batch]
    );
    if (!deleted) return null;

    // The tasks go with it, stamped with the same batch, so restoring the list
    // brings back exactly the tasks that were in it at the moment it went.
    await tx.query(
      `UPDATE qodo_projects.project_task_extensions
          SET deleted_at = now(), deleted_by = $2, deleted_batch_id = $3
        WHERE task_list_id = $1 AND deleted_at IS NULL`,
      [taskListId, user.id, batch]
    );

    await audit.record({
      actor: user,
      organizationId,
      projectId: project.id,
      entityType: 'task_list',
      entityId: taskListId,
      action: 'tasklist.delete',
      before: { name: deleted.name },
      after: { deletedBatch: batch },
      tx,
    });

    return { id: taskListId, deleted: true, batch };
  });
}

export async function reorder(context, orderedIds) {
  const { user, project, organizationId } = context;
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return [];

  await query(
    `UPDATE qodo_projects.task_lists AS tl
        SET order_index = ordering.position
       FROM (SELECT id, ordinality - 1 AS position
               FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, ordinality)) AS ordering
      WHERE tl.id = ordering.id AND tl.project_id = $2 AND tl.organization_id = $3`,
    [orderedIds, project.id, organizationId]
  );

  await audit.record({
    actor: user,
    organizationId,
    projectId: project.id,
    entityType: 'task_list',
    entityId: project.id,
    action: 'tasklist.reorder',
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
