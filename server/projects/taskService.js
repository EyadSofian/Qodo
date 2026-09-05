/**
 * Qodo Projects — project tasks.
 *
 * This file is the seam described in ADR-3, and it is the only place in the
 * codebase that knows a project task is two records.
 *
 * A Qodo task lives in the document store, where it carries its title, its
 * assignees and the whole two-sided review contract that `shared/workflow.js`
 * encodes — assign, accept or decline, work, submit evidence, review, send
 * back, approve, score. A *project* task is one of those with a row in
 * `project_task_extensions` carrying the things a project needs and a
 * department board never did: a phase, a task list, a parent, a duration,
 * estimated hours, a schedule.
 *
 * The rule that keeps this from leaking everywhere: **the join lives here and
 * is not exported piecemeal.** Any code path that reads a task through some
 * other route sees a project-less task, which is exactly what a standalone
 * department task is — so forgetting the join degrades, it does not corrupt.
 *
 * The two stores cannot share a transaction. When a create half-fails the
 * document is written and the extension is not, which leaves a valid standalone
 * task rather than an orphaned extension row. That is the right way round, and
 * `create` is ordered deliberately to make it the only possible failure.
 */

import { create as createDocument, find, findOne, getStore } from '../store.js';
import { paginate, query, rows, row, transaction } from './db.js';
import * as audit from './auditService.js';
import * as notifications from './notificationService.js';
import {
  assignmentLifecycle,
  blankLifecycle,
  taskReference,
} from '../../shared/taskDocument.js';
import { DEFAULT_DEPARTMENT, firstStage } from '../../shared/departments.js';

/** How deep subtasks may nest. Matches the CHECK on `depth` in migration 003. */
export const MAX_DEPTH = 5;

/* ------------------------------------------------------------------ */
/* Reading                                                              */
/* ------------------------------------------------------------------ */

const SORTS = {
  order: 't.order_index',
  due: 't.end_date',
  start: 't.start_date',
  created: 't.created_at',
  updated: 't.updated_at',
  progress: 't.progress',
};

/**
 * The project's tasks, filtered and paged in SQL.
 *
 * Returns the extension rows joined to their documents. The extensions are what
 * the database can filter and sort; the documents supply the title and the
 * lifecycle. Fetching the documents by id afterwards — rather than scanning the
 * collection per row — is what keeps this from being the N+1 §83 forbids.
 */
export async function list(context, options = {}) {
  const { limit, offset } = paginate(options);
  const params = [context.project.id, context.organizationId];
  const conditions = [
    't.project_id = $1',
    't.organization_id = $2',
    't.deleted_at IS NULL',
  ];

  if (options.phaseId) {
    params.push(options.phaseId);
    conditions.push(`t.phase_id = $${params.length}`);
  }
  if (options.taskListId) {
    params.push(options.taskListId);
    conditions.push(`t.task_list_id = $${params.length}`);
  }
  if (options.statusId) {
    params.push(options.statusId);
    conditions.push(`t.status_id = $${params.length}`);
  }
  if (options.assigneeId) {
    params.push(options.assigneeId);
    conditions.push(
      `EXISTS (SELECT 1 FROM qodo_projects.task_assignees a
                WHERE a.task_id = t.task_id AND a.user_id = $${params.length}
                  AND a.kind IN ('assignee', 'contributor'))`
    );
  }
  if (options.overdue) {
    conditions.push(`t.end_date < CURRENT_DATE AND COALESCE(s.category, 'active') <> 'done'`);
  }
  // `topLevel` is what the tree view asks for: roots only, with children
  // fetched per expanded node rather than the whole forest up front.
  if (options.topLevel) conditions.push('t.parent_task_id IS NULL');
  if (options.parentTaskId) {
    params.push(options.parentTaskId);
    conditions.push(`t.parent_task_id = $${params.length}`);
  }

  // A client never sees a task in an internal list. Enforced by the join, not
  // by a filter the caller might omit.
  const clientJoin = context.isClient
    ? `JOIN qodo_projects.task_lists tl ON tl.id = t.task_list_id AND tl.is_external = true AND tl.deleted_at IS NULL`
    : `LEFT JOIN qodo_projects.task_lists tl ON tl.id = t.task_list_id AND tl.deleted_at IS NULL`;

  const orderColumn = SORTS[options.sort] ?? SORTS.order;
  const direction = options.direction === 'desc' ? 'DESC' : 'ASC';
  params.push(limit, offset);

  const found = await rows(
    `SELECT t.*, tl.name AS task_list_name, tl.is_external AS list_is_external,
            ph.name AS phase_name,
            s.key AS status_key, s.label_ar AS status_ar, s.label_en AS status_en,
            s.color AS status_color, s.category AS status_category,
            COALESCE(kids.child_count, 0) AS child_count,
            COALESCE(checks.total, 0) AS checklist_total,
            COALESCE(checks.done, 0) AS checklist_done,
            COALESCE(checks.required_open, 0) AS checklist_required_open
       FROM qodo_projects.project_task_extensions t
       ${clientJoin}
       LEFT JOIN qodo_projects.phases ph ON ph.id = t.phase_id AND ph.deleted_at IS NULL
       LEFT JOIN qodo_projects.statuses s ON s.id = t.status_id
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS child_count
           FROM qodo_projects.project_task_extensions c
          WHERE c.parent_task_id = t.task_id AND c.deleted_at IS NULL
       ) kids ON true
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS total,
                count(*) FILTER (WHERE cl.is_done)::int AS done,
                count(*) FILTER (WHERE cl.is_required AND NOT cl.is_done)::int AS required_open
           FROM qodo_projects.task_checklists cl
          WHERE cl.task_id = t.task_id
       ) checks ON true
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${orderColumn} ${direction} NULLS LAST, t.created_at
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const counted = await row(
    `SELECT count(*)::int AS total
       FROM qodo_projects.project_task_extensions t
       ${clientJoin}
       LEFT JOIN qodo_projects.statuses s ON s.id = t.status_id
      WHERE ${conditions.join(' AND ')}`,
    params.slice(0, params.length - 2)
  );

  const documents = await documentsFor(found.map((record) => record.task_id));
  const assignees = await assigneesFor(found.map((record) => record.task_id));

  return {
    tasks: found
      // A document that has vanished leaves an extension with nothing to
      // describe. Dropping the row is right: it is not a task any more, and
      // rendering a titleless card would be worse than rendering nothing.
      .filter((record) => documents.has(record.task_id))
      .map((record) => merge(record, documents.get(record.task_id), assignees.get(record.task_id) ?? [])),
    total: counted?.total ?? 0,
    limit,
    offset,
  };
}

export async function get(context, taskId) {
  const found = await row(
    `SELECT t.*, tl.name AS task_list_name, tl.is_external AS list_is_external,
            ph.name AS phase_name,
            s.key AS status_key, s.label_ar AS status_ar, s.label_en AS status_en,
            s.color AS status_color, s.category AS status_category
       FROM qodo_projects.project_task_extensions t
       LEFT JOIN qodo_projects.task_lists tl ON tl.id = t.task_list_id
       LEFT JOIN qodo_projects.phases ph ON ph.id = t.phase_id
       LEFT JOIN qodo_projects.statuses s ON s.id = t.status_id
      WHERE t.task_id = $1 AND t.project_id = $2 AND t.organization_id = $3
        AND t.deleted_at IS NULL`,
    [taskId, context.project.id, context.organizationId]
  );
  if (!found) return null;

  // The client check is applied after the read rather than in the query,
  // because a single-record read needs to answer "not found" for an internal
  // task and the join form would silently return nothing for a missing one too.
  if (context.isClient && found.list_is_external !== true) return null;

  const document = await findOne('tasks', (task) => task.id === taskId);
  if (!document) return null;

  const assignees = await assigneesFor([taskId]);
  const items = await checklistOf(taskId);

  // `checklist` is the summary on every path, including this one. It used to be
  // the item array here and the summary in a listing, which meant the
  // required-item guard read `.requiredOpen` off an array, found undefined, and
  // silently let a task be completed with an unticked mandatory item. The items
  // themselves get their own name.
  return {
    ...merge(found, document, assignees.get(taskId) ?? []),
    checklist: {
      total: items.length,
      done: items.filter((item) => item.isDone).length,
      requiredOpen: items.filter((item) => item.isRequired && !item.isDone).length,
    },
    checklistItems: items,
  };
}

/** Load many task documents by id, in one pass over the collection. */
async function documentsFor(ids) {
  if (ids.length === 0) return new Map();
  const wanted = new Set(ids);
  const documents = await find('tasks', (task) => wanted.has(task.id));
  return new Map(documents.map((task) => [task.id, task]));
}

async function assigneesFor(ids) {
  if (ids.length === 0) return new Map();
  const found = await rows(
    'SELECT task_id, user_id, kind FROM qodo_projects.task_assignees WHERE task_id = ANY($1::text[])',
    [ids]
  );
  const grouped = new Map();
  for (const record of found) {
    if (!grouped.has(record.task_id)) grouped.set(record.task_id, []);
    grouped.get(record.task_id).push({ userId: record.user_id, kind: record.kind });
  }
  return grouped;
}

/**
 * One task, from both halves.
 *
 * The document wins on everything it owns — title, description, the lifecycle —
 * and the extension wins on everything a project added. Where both have a name
 * for the same idea (`progress`), the extension is authoritative, because that
 * is the one a phase rollup and a Gantt bar read.
 */
function merge(extension, document, assignees) {
  return {
    id: document.id,
    reference: document.reference,
    title: document.title,
    description: document.description ?? '',
    objective: document.objective ?? '',
    definitionOfDone: document.definitionOfDone ?? '',
    priority: document.priority,
    labels: document.labels ?? [],

    /* the Qodo contract, inherited whole */
    department: document.department,
    stage: document.stage,
    assigneeIds: document.assigneeIds ?? [],
    assignments: document.assignments ?? [],
    createdBy: document.createdBy,
    dueDate: document.dueDate,
    submittedAt: document.submittedAt,
    reviewedAt: document.reviewedAt,
    reviewDecision: document.reviewDecision,
    reworkCount: document.reworkCount ?? 0,
    completedAt: document.completedAt,
    attachmentCount: document.attachmentCount ?? 0,

    /* what being in a project adds */
    projectId: extension.project_id,
    phaseId: extension.phase_id,
    phaseName: extension.phase_name ?? null,
    taskListId: extension.task_list_id,
    taskListName: extension.task_list_name ?? null,
    parentTaskId: extension.parent_task_id,
    depth: extension.depth,
    orderIndex: extension.order_index,
    statusId: extension.status_id,
    status: extension.status_key
      ? {
          key: extension.status_key,
          label: { ar: extension.status_ar, en: extension.status_en },
          color: extension.status_color,
          category: extension.status_category,
        }
      : null,
    progress: extension.progress,
    startDate: extension.start_date,
    endDate: extension.end_date,
    durationDays: extension.duration_days,
    estimatedHours: extension.estimated_hours === null ? null : Number(extension.estimated_hours),
    actualHours: Number(extension.actual_hours ?? 0),
    remainingHours: extension.remaining_hours === null ? null : Number(extension.remaining_hours),
    billingType: extension.billing_type,
    isBillable: extension.is_billable,
    color: extension.color,

    childCount: Number(extension.child_count ?? 0),
    checklist: {
      total: Number(extension.checklist_total ?? 0),
      done: Number(extension.checklist_done ?? 0),
      requiredOpen: Number(extension.checklist_required_open ?? 0),
    },
    contributors: assignees,
    createdAt: document.createdAt,
    updatedAt: extension.updated_at,
  };
}

/* ------------------------------------------------------------------ */
/* Writing                                                              */
/* ------------------------------------------------------------------ */

/**
 * Create a project task.
 *
 * Document first, extension second — deliberately. If the second write fails,
 * what exists is an ordinary Qodo task with no project, which is a valid record
 * somebody can see and fix. The other order would leave an extension row
 * pointing at nothing, which nothing in the product knows how to render.
 */
export async function create(context, input) {
  const { user, project, organizationId } = context;

  const title = String(input?.title ?? '').trim();
  if (!title) throw badRequest('title_required');

  if (input?.startDate && input?.endDate && input.endDate < input.startDate) {
    throw badRequest('end_before_start');
  }

  // Depth and parentage are decided before anything is written, so a rejected
  // subtask never leaves a document behind.
  let depth = 0;
  if (input?.parentTaskId) {
    const parent = await row(
      `SELECT depth FROM qodo_projects.project_task_extensions
        WHERE task_id = $1 AND project_id = $2 AND deleted_at IS NULL`,
      [input.parentTaskId, project.id]
    );
    if (!parent) throw badRequest('parent_not_found');
    depth = parent.depth + 1;
    if (depth > MAX_DEPTH) throw badRequest('max_depth_exceeded');
  }

  // A project task still belongs to a department board — that is how it reaches
  // My Work and the performance tables. The creator's department is the honest
  // default; the project does not have one of its own.
  const department = input?.department ?? user.department ?? DEFAULT_DEPARTMENT;
  const stage = input?.stage ?? firstStage(department)?.id ?? 'todo';

  const document = await createDocument('tasks', {
    reference: taskReference(),
    title,
    description: String(input?.description ?? ''),
    objective: String(input?.objective ?? ''),
    definitionOfDone: String(input?.definitionOfDone ?? ''),
    organizationId,
    department,
    subteam: user.subteam ?? null,
    stage,
    priority: input?.priority ?? 'normal',
    dueDate: input?.endDate ?? null,
    taskDate: new Date().toISOString().slice(0, 10),
    notes: '',
    effortPoints: null,
    estimatedMinutes: input?.estimatedHours ? Math.round(Number(input.estimatedHours) * 60) : null,
    progress: 0,
    appId: null,
    labels: input?.labels ?? [],
    source: 'project',
    order: 0,
    completedAt: null,
    ...blankLifecycle(),
    ...assignmentLifecycle(input?.assigneeIds ?? [], user.id),
    createdBy: user.id,
  });

  try {
    const extension = await transaction(async (tx) => {
      // A task with no status sits outside every column of the board. The
      // module's default is what an organization configured, so use it.
      let statusId = input?.statusId ?? null;
      if (!statusId) {
        const fallback = await tx.row(
          `SELECT s.id FROM qodo_projects.statuses s
             JOIN qodo_projects.modules m ON m.id = s.module_id
            WHERE s.organization_id = $1 AND m.key = 'task' AND s.is_default
            LIMIT 1`,
          [organizationId]
        );
        statusId = fallback?.id ?? null;
      }

      const last = await tx.row(
        `SELECT COALESCE(max(order_index), -1) AS last
           FROM qodo_projects.project_task_extensions
          WHERE project_id = $1 AND COALESCE(task_list_id::text, '') = COALESCE($2::text, '')
            AND deleted_at IS NULL`,
        [project.id, input?.taskListId ?? null]
      );

      const created = await tx.row(
        `INSERT INTO qodo_projects.project_task_extensions
           (task_id, organization_id, project_id, phase_id, task_list_id, parent_task_id,
            depth, order_index, status_id, progress, start_date, end_date, duration_days,
            estimated_hours, billing_type, is_billable, color, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         RETURNING *`,
        [
          document.id,
          organizationId,
          project.id,
          input?.phaseId ?? null,
          input?.taskListId ?? null,
          input?.parentTaskId ?? null,
          depth,
          input?.orderIndex ?? Number(last.last) + 1,
          statusId,
          0,
          input?.startDate ?? null,
          input?.endDate ?? null,
          Math.max(1, Number(input?.durationDays) || 1),
          input?.estimatedHours ?? null,
          input?.billingType ?? 'none',
          Boolean(input?.isBillable),
          input?.color ?? null,
          user.id,
        ]
      );

      for (const userId of input?.assigneeIds ?? []) {
        await tx.query(
          `INSERT INTO qodo_projects.task_assignees (task_id, organization_id, user_id, kind, added_by)
           VALUES ($1,$2,$3,'assignee',$4) ON CONFLICT DO NOTHING`,
          [document.id, organizationId, userId, user.id]
        );
      }

      await audit.record({
        actor: user,
        organizationId,
        projectId: project.id,
        entityType: 'task',
        entityId: document.id,
        action: 'task.create',
        after: { title, taskListId: input?.taskListId ?? null, parentTaskId: input?.parentTaskId ?? null },
        tx,
      });

      return created;
    });

    // Re-read through `get` rather than shaping the INSERT's own row. The
    // returned row has `status_id` but none of the joined status, list or phase
    // columns, so a caller would get a task whose `statusId` is set and whose
    // `status` is null — the same object in two shapes depending on how it was
    // obtained, which is exactly the ambiguity that hid the checklist bug.
    return get(context, extension.task_id);
  } catch (error) {
    // The document survives as a standalone task. Say so in the log rather than
    // silently leaving somebody wondering where their task went — it is in
    // /tasks, just not in the project.
    console.error(
      `[projects] task ${document.id} was created but could not be attached to project ${project.id}:`,
      error.message
    );
    throw error;
  }
}

/** Extension fields an update may touch, and the column each writes. */
const EXTENSION_FIELDS = {
  phaseId: 'phase_id',
  taskListId: 'task_list_id',
  statusId: 'status_id',
  progress: 'progress',
  startDate: 'start_date',
  endDate: 'end_date',
  durationDays: 'duration_days',
  estimatedHours: 'estimated_hours',
  remainingHours: 'remaining_hours',
  billingType: 'billing_type',
  isBillable: 'is_billable',
  orderIndex: 'order_index',
  color: 'color',
};

/** Document fields an update may touch. The lifecycle is deliberately absent. */
const DOCUMENT_FIELDS = ['title', 'description', 'objective', 'definitionOfDone', 'priority', 'labels'];

/**
 * Update a project task.
 *
 * Writes both halves, and neither list includes anything the review contract
 * owns. Submitting, reviewing, approving and scoring stay on `/api/tasks`,
 * where the workflow guard lives — a project edit form must not be a way to
 * mark somebody else's work approved.
 */
export async function update(context, taskId, input) {
  const { user, project, organizationId } = context;

  const current = await get(context, taskId);
  if (!current) return null;

  const startDate = input?.startDate ?? current.startDate;
  const endDate = input?.endDate ?? current.endDate;
  if (startDate && endDate && endDate < startDate) throw badRequest('end_before_start');

  // A task cannot be completed while a required checklist item is open. The
  // guard is here rather than in the UI because a status change can arrive from
  // a Kanban drag, an automation or the raw API.
  if (input?.statusId && input.statusId !== current.statusId) {
    const target = await row('SELECT category FROM qodo_projects.statuses WHERE id = $1', [input.statusId]);
    if (target?.category === 'done' && current.checklist.requiredOpen > 0) {
      throw Object.assign(new Error('checklist_incomplete'), {
        status: 409,
        body: { error: 'checklist_incomplete', open: current.checklist.requiredOpen },
      });
    }
  }

  const assignments = [];
  const params = [taskId, project.id, organizationId, user.id];
  const changed = {};

  for (const [field, column] of Object.entries(EXTENSION_FIELDS)) {
    if (input?.[field] === undefined) continue;
    let value = input[field];
    if (field === 'progress') value = Math.max(0, Math.min(100, Number(value) || 0));
    if (field === 'durationDays') value = Math.max(1, Number(value) || 1);
    if (field === 'isBillable') value = Boolean(value);
    if (value === '') value = null;
    params.push(value);
    assignments.push(`${column} = $${params.length}`);
    changed[field] = value;
  }

  let extension = null;
  if (assignments.length > 0) {
    extension = await row(
      `UPDATE qodo_projects.project_task_extensions
          SET ${assignments.join(', ')}, updated_by = $4
        WHERE task_id = $1 AND project_id = $2 AND organization_id = $3 AND deleted_at IS NULL
        RETURNING *`,
      params
    );
    if (!extension) return null;
  }

  const documentPatch = {};
  for (const field of DOCUMENT_FIELDS) {
    if (input?.[field] === undefined) continue;
    documentPatch[field] = input[field];
    changed[field] = input[field];
  }
  // The due date lives on the document as well, because that is what the
  // workspace board and every overdue count already read. Keeping them in step
  // is this function's job; letting them diverge would give one task two
  // deadlines.
  if (input?.endDate !== undefined) documentPatch.dueDate = input.endDate || null;

  if (Object.keys(documentPatch).length > 0) {
    const store = await getStore();
    await store.update('tasks', taskId, documentPatch);
  }

  if (Object.keys(changed).length === 0) return current;

  await audit.record({
    actor: user,
    organizationId,
    projectId: project.id,
    entityType: 'task',
    entityId: taskId,
    action: 'task.update',
    before: pick(current, Object.keys(changed)),
    after: changed,
  });

  return get(context, taskId);
}

/**
 * Re-parent a task, refusing anything that would make a loop.
 *
 * The check walks up from the proposed parent looking for the task being moved.
 * Doing it before the write is what keeps an unrenderable tree out of the
 * database — a cycle here is not a bad schedule, it is an infinite recursion in
 * every view that draws the hierarchy.
 */
export async function reparent(context, taskId, parentTaskId) {
  const { user, project, organizationId } = context;

  if (parentTaskId === taskId) throw badRequest('cannot_be_own_parent');

  let depth = 0;
  if (parentTaskId) {
    const ancestry = await rows(
      `WITH RECURSIVE up AS (
         SELECT task_id, parent_task_id, 0 AS level
           FROM qodo_projects.project_task_extensions
          WHERE task_id = $1 AND project_id = $2
         UNION ALL
         SELECT t.task_id, t.parent_task_id, up.level + 1
           FROM qodo_projects.project_task_extensions t
           JOIN up ON t.task_id = up.parent_task_id
          WHERE up.level < 20
       )
       SELECT task_id, level FROM up`,
      [parentTaskId, project.id]
    );

    if (ancestry.length === 0) throw badRequest('parent_not_found');
    if (ancestry.some((node) => node.task_id === taskId)) throw badRequest('would_create_cycle');
    depth = Math.max(...ancestry.map((node) => node.level)) + 1;
    if (depth > MAX_DEPTH) throw badRequest('max_depth_exceeded');
  }

  return transaction(async (tx) => {
    const moved = await tx.row(
      `UPDATE qodo_projects.project_task_extensions
          SET parent_task_id = $4, depth = $5, updated_by = $6
        WHERE task_id = $1 AND project_id = $2 AND organization_id = $3 AND deleted_at IS NULL
        RETURNING *`,
      [taskId, project.id, organizationId, parentTaskId ?? null, depth, user.id]
    );
    if (!moved) return null;

    // The subtree moves with it. Renumbering in one recursive statement rather
    // than a loop is what keeps a deep tree from becoming N round trips.
    await tx.query(
      `WITH RECURSIVE down AS (
         SELECT task_id, $2::int AS new_depth
           FROM qodo_projects.project_task_extensions
          WHERE task_id = $1
         UNION ALL
         SELECT c.task_id, down.new_depth + 1
           FROM qodo_projects.project_task_extensions c
           JOIN down ON c.parent_task_id = down.task_id
          WHERE down.new_depth < 20
       )
       UPDATE qodo_projects.project_task_extensions t
          SET depth = down.new_depth
         FROM down
        WHERE t.task_id = down.task_id`,
      [taskId, depth]
    );

    await audit.record({
      actor: user,
      organizationId,
      projectId: project.id,
      entityType: 'task',
      entityId: taskId,
      action: 'task.reparent',
      after: { parentTaskId: parentTaskId ?? null, depth },
      tx,
    });

    return moved;
  });
}

export async function remove(context, taskId) {
  const { user, project, organizationId } = context;

  return transaction(async (tx) => {
    const batch = (await tx.row('SELECT gen_random_uuid() AS id')).id;

    // The subtree goes with the task, under one batch id. A subtask that
    // outlived its parent would be unreachable in every view that draws the
    // tree from the top.
    const deleted = await tx.rows(
      `WITH RECURSIVE down AS (
         SELECT task_id FROM qodo_projects.project_task_extensions
          WHERE task_id = $1 AND project_id = $2 AND organization_id = $3 AND deleted_at IS NULL
         UNION ALL
         SELECT c.task_id FROM qodo_projects.project_task_extensions c
           JOIN down ON c.parent_task_id = down.task_id
          WHERE c.deleted_at IS NULL
       )
       UPDATE qodo_projects.project_task_extensions t
          SET deleted_at = now(), deleted_by = $4, deleted_batch_id = $5
         FROM down
        WHERE t.task_id = down.task_id
        RETURNING t.task_id`,
      [taskId, project.id, organizationId, user.id, batch]
    );
    if (deleted.length === 0) return null;

    await audit.record({
      actor: user,
      organizationId,
      projectId: project.id,
      entityType: 'task',
      entityId: taskId,
      action: 'task.delete',
      after: { deletedBatch: batch, subtreeSize: deleted.length },
      tx,
    });

    return { id: taskId, deleted: true, batch, subtreeSize: deleted.length };
  });
}

/* ------------------------------------------------------------------ */
/* Assignees                                                            */
/* ------------------------------------------------------------------ */

/**
 * Set who is on a task.
 *
 * Assignees are written to *both* halves: the relational table, which reports
 * and workload queries filter on, and the document's `assignments` array, which
 * carries each person's accept-or-decline answer. `assignmentLifecycle` is what
 * keeps an existing partner's answer when a second person is added.
 */
export async function setAssignees(context, taskId, userIds, kind = 'assignee') {
  const { user, project, organizationId } = context;

  const current = await get(context, taskId);
  if (!current) return null;

  const owners = [...new Set(userIds ?? [])];

  await transaction(async (tx) => {
    await tx.query(
      'DELETE FROM qodo_projects.task_assignees WHERE task_id = $1 AND kind = $2',
      [taskId, kind]
    );
    for (const userId of owners) {
      await tx.query(
        `INSERT INTO qodo_projects.task_assignees (task_id, organization_id, user_id, kind, added_by)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [taskId, organizationId, userId, kind, user.id]
      );
    }
  });

  if (kind === 'assignee') {
    const store = await getStore();
    const document = await findOne('tasks', (task) => task.id === taskId);
    await store.update('tasks', taskId, assignmentLifecycle(owners, user.id, document?.assignments ?? []));
  }

  await audit.record({
    actor: user,
    organizationId,
    projectId: project.id,
    entityType: 'task',
    entityId: taskId,
    action: 'task.assign',
    before: { [kind]: current.contributors.filter((c) => c.kind === kind).map((c) => c.userId) },
    after: { [kind]: owners },
  });

  const reread = await get(context, taskId);

  // Only the people who were not already on it, and never the person doing the
  // assigning. Telling somebody they have been assigned work they already had
  // is how a notification centre stops being read.
  if (kind === 'assignee') {
    const previous = new Set(
      current.contributors.filter((c) => c.kind === 'assignee').map((c) => c.userId)
    );
    const added = owners.filter((userId) => !previous.has(userId));
    if (added.length > 0) {
      await notifications.events.taskAssigned(context, reread, added).catch((error) => {
        // A notification failing must not fail the assignment.
        console.error('[projects] could not announce the assignment:', error.message);
      });
    }
  }

  return reread;
}

/* ------------------------------------------------------------------ */
/* Checklists                                                           */
/* ------------------------------------------------------------------ */

export async function checklistOf(taskId) {
  return (
    await rows(
      `SELECT id, text, is_done, is_required, order_index, done_at, done_by
         FROM qodo_projects.task_checklists
        WHERE task_id = $1
        ORDER BY order_index, created_at`,
      [taskId]
    )
  ).map((item) => ({
    id: item.id,
    text: item.text,
    isDone: item.is_done,
    isRequired: item.is_required,
    orderIndex: item.order_index,
    doneAt: item.done_at,
    doneBy: item.done_by,
  }));
}

export async function addChecklistItem(context, taskId, input) {
  const { user, organizationId } = context;
  const text = String(input?.text ?? '').trim();
  if (!text) throw badRequest('text_required');

  const last = await row(
    'SELECT COALESCE(max(order_index), -1) AS last FROM qodo_projects.task_checklists WHERE task_id = $1',
    [taskId]
  );

  const created = await row(
    `INSERT INTO qodo_projects.task_checklists
       (task_id, organization_id, text, is_required, order_index, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [taskId, organizationId, text, Boolean(input?.isRequired), Number(last.last) + 1, user.id]
  );

  return {
    id: created.id,
    text: created.text,
    isDone: created.is_done,
    isRequired: created.is_required,
    orderIndex: created.order_index,
  };
}

export async function setChecklistItem(context, taskId, itemId, input) {
  const { user } = context;
  const assignments = [];
  const params = [itemId, taskId];

  if (input?.text !== undefined) {
    params.push(String(input.text));
    assignments.push(`text = $${params.length}`);
  }
  if (input?.isRequired !== undefined) {
    params.push(Boolean(input.isRequired));
    assignments.push(`is_required = $${params.length}`);
  }
  if (input?.isDone !== undefined) {
    params.push(Boolean(input.isDone));
    assignments.push(`is_done = $${params.length}`);
    params.push(input.isDone ? new Date().toISOString() : null);
    assignments.push(`done_at = $${params.length}`);
    params.push(input.isDone ? user.id : null);
    assignments.push(`done_by = $${params.length}`);
  }
  if (assignments.length === 0) return null;

  const updated = await row(
    `UPDATE qodo_projects.task_checklists SET ${assignments.join(', ')}
      WHERE id = $1 AND task_id = $2 RETURNING *`,
    params
  );
  if (!updated) return null;

  return {
    id: updated.id,
    text: updated.text,
    isDone: updated.is_done,
    isRequired: updated.is_required,
    orderIndex: updated.order_index,
  };
}

export async function removeChecklistItem(_context, taskId, itemId) {
  const { rowCount } = await query(
    'DELETE FROM qodo_projects.task_checklists WHERE id = $1 AND task_id = $2',
    [itemId, taskId]
  );
  return rowCount > 0;
}

/* ------------------------------------------------------------------ */
/* Rollups                                                              */
/* ------------------------------------------------------------------ */

/**
 * Recompute a parent's progress and hours from its children.
 *
 * Rolls up one level at a time from the changed task towards the root, which is
 * correct because each parent's own recomputation feeds the next. Doing it as
 * one sweep over the project would be simpler and would also rewrite every row
 * in the project on every checkbox.
 */
export async function rollUp(context, taskId) {
  let cursor = taskId;
  const touched = [];

  for (let guard = 0; guard < MAX_DEPTH + 1 && cursor; guard += 1) {
    const parent = await row(
      'SELECT parent_task_id FROM qodo_projects.project_task_extensions WHERE task_id = $1',
      [cursor]
    );
    cursor = parent?.parent_task_id ?? null;
    if (!cursor) break;

    const updated = await row(
      `UPDATE qodo_projects.project_task_extensions p
          SET progress = COALESCE(kids.progress, p.progress),
              estimated_hours = kids.estimated_hours,
              actual_hours = COALESCE(kids.actual_hours, 0)
         FROM (
           SELECT round(avg(progress))::int AS progress,
                  NULLIF(sum(estimated_hours), 0) AS estimated_hours,
                  sum(actual_hours) AS actual_hours
             FROM qodo_projects.project_task_extensions
            WHERE parent_task_id = $1 AND deleted_at IS NULL
         ) kids
        WHERE p.task_id = $1
        RETURNING p.task_id, p.progress`,
      [cursor]
    );
    if (updated) touched.push(updated);
  }

  return touched;
}

function pick(source, fields) {
  const out = {};
  for (const field of fields) out[field] = source?.[field] ?? null;
  return out;
}

function badRequest(code) {
  return Object.assign(new Error(code), { status: 400, body: { error: code } });
}
