/**
 * Qodo Projects — export.
 *
 * Two things this file exists to get right, and both of them are the kind of
 * bug that ships quietly:
 *
 * **CSV formula injection.** A cell beginning `=`, `+`, `-` or `@` is executed
 * by Excel when the file is opened. A task titled `=cmd|'/c calc'!A1` is a
 * remote code execution against whoever opens the export, and the task itself
 * looks harmless in the product. §67 asks for the guard by name.
 *
 * **Field leakage.** An export runs as a person, so it must contain what that
 * person could see by reading the screen — no more. Rates in particular go
 * through the same projection every other read uses.
 */

import { query, rows } from './db.js';
import { may, visibleProjectIds } from './projectAccess.js';
import * as audit from './auditService.js';

/**
 * Make one cell safe for a spreadsheet.
 *
 * The leading apostrophe is what neutralises it: Excel and LibreOffice both
 * read `'=A1` as the literal text `=A1` rather than as a formula. Quoting alone
 * does not help — a quoted cell starting with `=` is still evaluated.
 */
export function safeCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  // Tab and carriage return are in the list because some spreadsheet importers
  // treat a leading one as the start of a formula after trimming.
  if (/^[=+\-@\t\r]/.test(text)) return `'${text}`;
  return text;
}

/** One CSV row, escaped. */
function csvRow(values) {
  return values
    .map((value) => {
      const cell = safeCell(value);
      return /[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
    })
    .join(',');
}

/**
 * A CSV document.
 *
 * The BOM is deliberate: without it Excel on Windows opens a UTF-8 file as
 * Latin-1 and every Arabic column becomes mojibake, which in an Arabic-first
 * workspace means every export is unreadable.
 */
export function toCsv(columns, records) {
  const header = csvRow(columns.map((column) => column.label));
  const body = records.map((record) => csvRow(columns.map((column) => record[column.key])));
  return `﻿${[header, ...body].join('\r\n')}\r\n`;
}

/* ------------------------------------------------------------------ */
/* What each module exports                                             */
/* ------------------------------------------------------------------ */

/**
 * The columns each module offers, and which permission each needs.
 *
 * A column with a `requires` is dropped for anybody without it — that is how
 * an export stays inside what its reader could already see, rather than being a
 * side door around the field projection.
 */
const COLUMNS = {
  task: [
    { key: 'reference', label: 'Reference' },
    { key: 'title', label: 'Title' },
    { key: 'status', label: 'Status' },
    { key: 'phase', label: 'Phase' },
    { key: 'taskList', label: 'Task list' },
    { key: 'startDate', label: 'Start date' },
    { key: 'endDate', label: 'Due date' },
    { key: 'progress', label: 'Progress %' },
    { key: 'estimatedHours', label: 'Estimated hours' },
    { key: 'actualHours', label: 'Actual hours' },
  ],
  issue: [
    { key: 'key', label: 'Key' },
    { key: 'title', label: 'Title' },
    { key: 'status', label: 'Status' },
    { key: 'severity', label: 'Severity' },
    { key: 'priority', label: 'Priority' },
    { key: 'reporterId', label: 'Reported by' },
    { key: 'assigneeId', label: 'Assigned to' },
    { key: 'dueDate', label: 'Due date' },
    { key: 'closedAt', label: 'Closed' },
  ],
  time_log: [
    { key: 'logDate', label: 'Date' },
    { key: 'userId', label: 'Person' },
    { key: 'project', label: 'Project' },
    { key: 'hours', label: 'Hours' },
    { key: 'isBillable', label: 'Billable' },
    { key: 'approvalStatus', label: 'Approval' },
    { key: 'notes', label: 'Notes' },
    { key: 'costRate', label: 'Cost rate', requires: 'rate.view' },
    { key: 'billRate', label: 'Bill rate', requires: 'rate.view' },
  ],
};

export function columnsFor(context, moduleKey) {
  return (COLUMNS[moduleKey] ?? []).filter(
    (column) => !column.requires || may(context, column.requires)
  );
}

/* ------------------------------------------------------------------ */
/* Running an export                                                    */
/* ------------------------------------------------------------------ */

/**
 * Gather the rows for an export.
 *
 * Bounded, and scoped by membership first. An export is the one place somebody
 * can ask for everything at once, which makes it the one place a scoping bug
 * hands over the whole company.
 */
export async function collect(user, context, moduleKey, options = {}) {
  const limit = Math.min(10000, Math.max(1, Number(options.limit) || 5000));
  const projectIds = context
    ? [context.project.id]
    : await visibleProjectIds(user);
  if (projectIds.length === 0) return [];

  if (moduleKey === 'task') {
    const extensions = await rows(
      `SELECT t.task_id, t.start_date, t.end_date, t.progress, t.estimated_hours, t.actual_hours,
              s.label_en AS status, ph.name AS phase, tl.name AS task_list
         FROM qodo_projects.project_task_extensions t
         LEFT JOIN qodo_projects.statuses s ON s.id = t.status_id
         LEFT JOIN qodo_projects.phases ph ON ph.id = t.phase_id
         LEFT JOIN qodo_projects.task_lists tl ON tl.id = t.task_list_id
        WHERE t.project_id = ANY($1::uuid[]) AND t.deleted_at IS NULL
          ${context?.isClient ? 'AND tl.is_external = true' : ''}
        ORDER BY t.created_at LIMIT $2`,
      [projectIds, limit]
    );

    // Titles live in the task documents (ADR-3), fetched once for the whole set
    // rather than per row.
    const { find } = await import('../store.js');
    const wanted = new Set(extensions.map((task) => task.task_id));
    const documents = new Map(
      (await find('tasks', (task) => wanted.has(task.id))).map((task) => [task.id, task])
    );

    return extensions
      .filter((task) => documents.has(task.task_id))
      .map((task) => ({
        reference: documents.get(task.task_id).reference,
        title: documents.get(task.task_id).title,
        status: task.status,
        phase: task.phase,
        taskList: task.task_list,
        startDate: task.start_date,
        endDate: task.end_date,
        progress: task.progress,
        estimatedHours: task.estimated_hours,
        actualHours: task.actual_hours,
      }));
  }

  if (moduleKey === 'issue') {
    return (
      await rows(
        `SELECT i.key, i.title, i.severity, i.priority, i.reporter_id, i.assignee_id,
                i.due_date, i.closed_at, s.label_en AS status
           FROM qodo_projects.issues i
           LEFT JOIN qodo_projects.statuses s ON s.id = i.status_id
          WHERE i.project_id = ANY($1::uuid[]) AND i.deleted_at IS NULL
            ${context?.isClient ? 'AND i.is_external = true' : ''}
          ORDER BY i.number LIMIT $2`,
        [projectIds, limit]
      )
    ).map((issue) => ({
      key: issue.key,
      title: issue.title,
      status: issue.status,
      severity: issue.severity,
      priority: issue.priority,
      reporterId: issue.reporter_id,
      assigneeId: issue.assignee_id,
      dueDate: issue.due_date,
      closedAt: issue.closed_at,
    }));
  }

  if (moduleKey === 'time_log') {
    // Somebody without `time.view` exports their own time and nobody else's —
    // the same rule the listing follows.
    const mineOnly = context ? !may(context, 'time.view') : false;
    return (
      await rows(
        `SELECT e.log_date, e.user_id, e.hours, e.is_billable, e.approval_status, e.notes,
                e.cost_rate, e.bill_rate, p.name AS project
           FROM qodo_projects.time_entries e
           JOIN qodo_projects.projects p ON p.id = e.project_id
          WHERE e.project_id = ANY($1::uuid[])
            ${mineOnly ? 'AND e.user_id = $3' : ''}
          ORDER BY e.log_date DESC LIMIT $2`,
        mineOnly ? [projectIds, limit, user.id] : [projectIds, limit]
      )
    ).map((entry) => ({
      logDate: entry.log_date,
      userId: entry.user_id,
      project: entry.project,
      hours: entry.hours,
      isBillable: entry.is_billable ? 'Yes' : 'No',
      approvalStatus: entry.approval_status,
      notes: entry.notes,
      costRate: entry.cost_rate,
      billRate: entry.bill_rate,
    }));
  }

  throw badRequest('module_not_exportable');
}

/**
 * Export, and record that it happened.
 *
 * The audit row is the point of §67: "who took the client list" is a question
 * that gets asked after somebody leaves, and an export that leaves no trace
 * cannot answer it.
 */
export async function exportModule(user, context, moduleKey, options = {}) {
  const columns = columnsFor(context, moduleKey);
  if (columns.length === 0) throw badRequest('module_not_exportable');

  const records = await collect(user, context, moduleKey, options);
  const format = ['csv', 'json'].includes(options.format) ? options.format : 'csv';

  await query(
    `INSERT INTO qodo_projects.export_runs
       (organization_id, project_id, module_key, format, row_count, filters, exported_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      context?.organizationId ?? user.organizationId ?? 'engosoft',
      context?.project?.id ?? null,
      moduleKey,
      format,
      records.length,
      JSON.stringify(options.filters ?? {}),
      user.id,
    ]
  ).catch((error) => {
    console.error('[projects:export] could not record the export:', error.message);
  });

  await audit.record({
    actor: user,
    organizationId: context?.organizationId ?? user.organizationId ?? 'engosoft',
    projectId: context?.project?.id ?? null,
    entityType: 'export',
    entityId: `${moduleKey}:${Date.now()}`,
    action: 'data.export',
    after: { module: moduleKey, format, rows: records.length },
  });

  if (format === 'json') {
    return {
      contentType: 'application/json; charset=utf-8',
      filename: `${moduleKey}-${new Date().toISOString().slice(0, 10)}.json`,
      body: JSON.stringify(records, null, 2),
      rowCount: records.length,
    };
  }

  return {
    contentType: 'text/csv; charset=utf-8',
    filename: `${moduleKey}-${new Date().toISOString().slice(0, 10)}.csv`,
    body: toCsv(columns, records),
    rowCount: records.length,
  };
}

function badRequest(code) {
  return Object.assign(new Error(code), { status: 400, body: { error: code } });
}
