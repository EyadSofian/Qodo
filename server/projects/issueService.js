/**
 * Qodo Projects — the issue tracker.
 *
 * An issue is not a task with a different label. A task is work somebody agreed
 * to do; an issue is something wrong that somebody found. They carry different
 * fields — severity, reproducibility, the phase the defect appeared in versus
 * the one it is meant to be fixed for — and they answer to different clocks:
 * a task has a due date, an issue has an SLA.
 *
 * When an issue turns out to *be* work, it gets linked to a task rather than
 * becoming one, so the report of the defect survives the doing of the fix.
 */

import { query, paginate, rows, row, transaction } from './db.js';
import * as audit from './auditService.js';
import * as sla from './slaService.js';
import * as notifications from './notificationService.js';

/* ------------------------------------------------------------------ */
/* Reading                                                              */
/* ------------------------------------------------------------------ */

const SORTS = {
  created: 'i.created_at',
  updated: 'i.updated_at',
  due: 'i.due_date',
  severity: `CASE i.severity WHEN 'blocker' THEN 0 WHEN 'critical' THEN 1
                             WHEN 'major' THEN 2 WHEN 'minor' THEN 3 ELSE 4 END`,
  priority: `CASE i.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
                             WHEN 'normal' THEN 2 ELSE 3 END`,
  key: 'i.number',
};

export async function list(context, options = {}) {
  const { limit, offset } = paginate(options);
  const params = [context.project.id, context.organizationId];
  const conditions = ['i.project_id = $1', 'i.organization_id = $2', 'i.deleted_at IS NULL'];

  // A client sees only issues marked client-visible — which in practice means
  // the ones they raised themselves plus anything deliberately shared.
  if (context.isClient) conditions.push('i.is_external = true');

  if (options.statusId) {
    params.push(options.statusId);
    conditions.push(`i.status_id = $${params.length}`);
  }
  if (options.assigneeId) {
    params.push(options.assigneeId);
    conditions.push(`i.assignee_id = $${params.length}`);
  }
  if (options.reporterId) {
    params.push(options.reporterId);
    conditions.push(`i.reporter_id = $${params.length}`);
  }
  if (options.severity) {
    params.push(options.severity);
    conditions.push(`i.severity = $${params.length}`);
  }
  if (options.priority) {
    params.push(options.priority);
    conditions.push(`i.priority = $${params.length}`);
  }
  if (options.open) conditions.push('i.closed_at IS NULL');
  if (options.search) {
    params.push(`%${String(options.search).trim().toLowerCase()}%`);
    conditions.push(`(lower(i.title) LIKE $${params.length} OR lower(i.key) LIKE $${params.length})`);
  }

  const orderColumn = SORTS[options.sort] ?? SORTS.created;
  const direction = options.direction === 'asc' ? 'ASC' : 'DESC';
  params.push(limit, offset);

  const found = await rows(
    `SELECT i.*, s.key AS status_key, s.label_ar AS status_ar, s.label_en AS status_en,
            s.color AS status_color, s.category AS status_category,
            c.response_due_at, c.resolution_due_at,
            c.response_breached_at, c.resolution_breached_at, c.escalation_level
       FROM qodo_projects.issues i
       LEFT JOIN qodo_projects.statuses s ON s.id = i.status_id
       LEFT JOIN qodo_projects.sla_clocks c ON c.issue_id = i.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${orderColumn} ${direction} NULLS LAST
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const counted = await row(
    `SELECT count(*)::int AS total FROM qodo_projects.issues i WHERE ${conditions.join(' AND ')}`,
    params.slice(0, params.length - 2)
  );

  return { issues: found.map(toIssue), total: counted?.total ?? 0, limit, offset };
}

export async function get(context, issueId) {
  const found = await row(
    `SELECT i.*, s.key AS status_key, s.label_ar AS status_ar, s.label_en AS status_en,
            s.color AS status_color, s.category AS status_category,
            c.response_due_at, c.resolution_due_at,
            c.response_breached_at, c.resolution_breached_at, c.escalation_level
       FROM qodo_projects.issues i
       LEFT JOIN qodo_projects.statuses s ON s.id = i.status_id
       LEFT JOIN qodo_projects.sla_clocks c ON c.issue_id = i.id
      WHERE i.id = $1 AND i.project_id = $2 AND i.organization_id = $3 AND i.deleted_at IS NULL`,
    [issueId, context.project.id, context.organizationId]
  );
  if (!found) return null;
  if (context.isClient && found.is_external !== true) return null;

  const links = await rows(
    `SELECT id, linked_type, linked_id, relation FROM qodo_projects.issue_links
      WHERE issue_id = $1 ORDER BY created_at`,
    [issueId]
  );

  return {
    ...toIssue(found),
    links: links.map((link) => ({
      id: link.id,
      linkedType: link.linked_type,
      linkedId: link.linked_id,
      relation: link.relation,
    })),
  };
}

function toIssue(record) {
  return {
    id: record.id,
    key: record.key,
    number: record.number,
    title: record.title,
    description: record.description,
    reporterId: record.reporter_id,
    assigneeId: record.assignee_id,
    statusId: record.status_id,
    status: record.status_key
      ? {
          key: record.status_key,
          label: { ar: record.status_ar, en: record.status_en },
          color: record.status_color,
          category: record.status_category,
        }
      : null,
    priority: record.priority,
    severity: record.severity,
    classification: record.classification,
    reproducibility: record.reproducibility,
    moduleAffected: record.module_affected,
    affectedPhaseId: record.affected_phase_id,
    targetPhaseId: record.target_phase_id,
    dueDate: record.due_date,
    resolution: record.resolution,
    closedAt: record.closed_at,
    isExternal: record.is_external,
    // The SLA, folded in rather than fetched separately: an issue list without
    // its breach flags is a list nobody can triage from.
    sla: record.response_due_at || record.resolution_due_at
      ? {
          responseDueAt: record.response_due_at,
          resolutionDueAt: record.resolution_due_at,
          responseBreached: Boolean(record.response_breached_at),
          resolutionBreached: Boolean(record.resolution_breached_at),
          escalationLevel: record.escalation_level ?? 0,
        }
      : null,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

/* ------------------------------------------------------------------ */
/* Writing                                                              */
/* ------------------------------------------------------------------ */

/**
 * Report an issue.
 *
 * The reference (`ENG-42`) is allocated inside the transaction from the
 * project's own counter, so two people reporting at the same moment cannot both
 * be given number 42. `SELECT … FOR UPDATE`-free because the unique constraint
 * on `(project_id, number)` is the real arbiter and a retry is cheap.
 */
export async function create(context, input) {
  const { user, project, organizationId } = context;

  const title = String(input?.title ?? '').trim();
  if (!title) throw badRequest('title_required');

  const issue = await transaction(async (tx) => {
    const last = await tx.row(
      'SELECT COALESCE(max(number), 0) AS last FROM qodo_projects.issues WHERE project_id = $1',
      [project.id]
    );
    const number = Number(last.last) + 1;

    // An issue with no status never appears on a triage board, which is the one
    // place an issue is meant to appear.
    let statusId = input?.statusId ?? null;
    if (!statusId) {
      const fallback = await tx.row(
        `SELECT s.id FROM qodo_projects.statuses s
           JOIN qodo_projects.modules m ON m.id = s.module_id
          WHERE s.organization_id = $1 AND m.key = 'issue' AND s.is_default
          LIMIT 1`,
        [organizationId]
      );
      statusId = fallback?.id ?? null;
    }

    return tx.row(
      `INSERT INTO qodo_projects.issues
         (organization_id, project_id, key, number, title, description, reporter_id,
          assignee_id, status_id, priority, severity, classification, reproducibility,
          module_affected, affected_phase_id, target_phase_id, due_date, is_external,
          created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)
       RETURNING *`,
      [
        organizationId,
        project.id,
        `${project.key}-${number}`,
        number,
        title,
        String(input?.description ?? ''),
        user.id,
        input?.assigneeId ?? null,
        statusId,
        input?.priority ?? 'normal',
        input?.severity ?? 'minor',
        input?.classification ?? null,
        input?.reproducibility ?? null,
        input?.moduleAffected ?? null,
        input?.affectedPhaseId ?? null,
        input?.targetPhaseId ?? null,
        input?.dueDate ?? null,
        // An issue a client raised is visible to that client — otherwise they
        // file a report and it vanishes. Staff-raised issues stay internal
        // unless somebody shares them.
        context.isClient ? true : Boolean(input?.isExternal),
        user.id,
      ]
    );
  });

  const shaped = toIssue(issue);

  // The clock starts after the issue exists, not inside its transaction: a
  // policy that fails to match must not roll back the report.
  await sla.startClock(context, shaped).catch((error) => {
    console.error('[projects:sla] could not start a clock for', shaped.key, error.message);
  });

  await audit.record({
    actor: user,
    organizationId,
    projectId: project.id,
    entityType: 'issue',
    entityId: issue.id,
    action: 'issue.create',
    after: { key: issue.key, title, severity: issue.severity, isExternal: issue.is_external },
  });

  return get(context, issue.id);
}

const UPDATABLE = {
  title: 'title',
  description: 'description',
  assigneeId: 'assignee_id',
  statusId: 'status_id',
  priority: 'priority',
  severity: 'severity',
  classification: 'classification',
  reproducibility: 'reproducibility',
  moduleAffected: 'module_affected',
  affectedPhaseId: 'affected_phase_id',
  targetPhaseId: 'target_phase_id',
  dueDate: 'due_date',
  resolution: 'resolution',
  isExternal: 'is_external',
};

export async function update(context, issueId, input) {
  const { user, project, organizationId } = context;

  const current = await get(context, issueId);
  if (!current) return null;

  const assignments = [];
  const params = [issueId, project.id, organizationId, user.id];
  const changed = {};

  for (const [field, column] of Object.entries(UPDATABLE)) {
    if (input?.[field] === undefined) continue;
    const value = field === 'isExternal' ? Boolean(input[field]) : input[field] === '' ? null : input[field];
    params.push(value);
    assignments.push(`${column} = $${params.length}`);
    changed[field] = value;
  }

  // Closing is a status question, not a field somebody types. Deriving
  // `closed_at` from the status category is what keeps "closed" meaning the
  // same thing on a report as it does on the board.
  if (input?.statusId !== undefined) {
    const target = await row('SELECT category FROM qodo_projects.statuses WHERE id = $1', [input.statusId]);
    if (target?.category === 'done' || target?.category === 'cancelled') {
      assignments.push('closed_at = COALESCE(closed_at, now())');
    } else {
      assignments.push('closed_at = NULL');
    }
  }

  if (assignments.length === 0) return current;

  const updated = await row(
    `UPDATE qodo_projects.issues SET ${assignments.join(', ')}, updated_by = $4
      WHERE id = $1 AND project_id = $2 AND organization_id = $3 AND deleted_at IS NULL
      RETURNING *`,
    params
  );
  if (!updated) return null;

  // Assigning somebody is the response; closing is the resolution. Both stop
  // the clock they belong to, and only the first of each ever counts.
  if (changed.assigneeId) {
    await sla.markResponded(issueId).catch(() => {});
    await notifications.events
      .issueAssigned(context, { ...current, assigneeId: changed.assigneeId }, [changed.assigneeId])
      .catch((error) => console.error('[projects] could not announce the issue:', error.message));
  }
  if (updated.closed_at) await sla.markResolved(issueId).catch(() => {});

  await audit.record({
    actor: user,
    organizationId,
    projectId: project.id,
    entityType: 'issue',
    entityId: issueId,
    action: 'issue.update',
    before: pick(current, Object.keys(changed)),
    after: changed,
  });

  return get(context, issueId);
}

export async function remove(context, issueId) {
  const { user, project, organizationId } = context;

  const deleted = await row(
    `UPDATE qodo_projects.issues
        SET deleted_at = now(), deleted_by = $4, deleted_batch_id = gen_random_uuid()
      WHERE id = $1 AND project_id = $2 AND organization_id = $3 AND deleted_at IS NULL
      RETURNING id, key`,
    [issueId, project.id, organizationId, user.id]
  );
  if (!deleted) return null;

  await audit.record({
    actor: user,
    organizationId,
    projectId: project.id,
    entityType: 'issue',
    entityId: issueId,
    action: 'issue.delete',
    before: { key: deleted.key },
    after: null,
  });

  return { id: issueId, deleted: true };
}

/* ------------------------------------------------------------------ */
/* Links                                                                */
/* ------------------------------------------------------------------ */

const RELATIONS = ['relates_to', 'blocks', 'blocked_by', 'duplicates', 'caused_by'];

/**
 * Link an issue to a task or to another issue.
 *
 * The far end is checked to be in the same project before the link is written —
 * otherwise linking would be a way to confirm that a record in a project you
 * cannot see exists.
 */
export async function addLink(context, issueId, input) {
  const { user, project, organizationId } = context;

  const linkedType = input?.linkedType === 'task' ? 'task' : 'issue';
  const linkedId = String(input?.linkedId ?? '');
  const relation = RELATIONS.includes(input?.relation) ? input.relation : 'relates_to';
  if (!linkedId) throw badRequest('linked_id_required');

  const exists =
    linkedType === 'task'
      ? await row(
          `SELECT 1 FROM qodo_projects.project_task_extensions
            WHERE task_id = $1 AND project_id = $2 AND deleted_at IS NULL`,
          [linkedId, project.id]
        )
      : await row(
          `SELECT 1 FROM qodo_projects.issues
            WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
          [linkedId, project.id]
        );
  if (!exists) throw badRequest('linked_not_found');

  const created = await row(
    `INSERT INTO qodo_projects.issue_links
       (organization_id, issue_id, linked_type, linked_id, relation, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (issue_id, linked_type, linked_id, relation) DO UPDATE SET relation = EXCLUDED.relation
     RETURNING *`,
    [organizationId, issueId, linkedType, linkedId, relation, user.id]
  );

  await audit.record({
    actor: user,
    organizationId,
    projectId: project.id,
    entityType: 'issue',
    entityId: issueId,
    action: 'issue.link',
    after: { linkedType, linkedId, relation },
  });

  return {
    id: created.id,
    linkedType: created.linked_type,
    linkedId: created.linked_id,
    relation: created.relation,
  };
}

export async function removeLink(context, issueId, linkId) {
  const { rowCount } = await query(
    'DELETE FROM qodo_projects.issue_links WHERE id = $1 AND issue_id = $2 AND organization_id = $3',
    [linkId, issueId, context.organizationId]
  );
  return rowCount > 0;
}

function pick(source, fields) {
  const out = {};
  for (const field of fields) out[field] = source?.[field] ?? null;
  return out;
}

function badRequest(code) {
  return Object.assign(new Error(code), { status: 400, body: { error: code } });
}
