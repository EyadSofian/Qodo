/**
 * Qodo Projects — timers, time logs and timesheets.
 *
 * Three layers, and they are not the same thing:
 *
 *   • a **timer** is running right now and belongs to one person;
 *   • a **time entry** is a fact — this many hours, on this day, on this work;
 *   • a **timesheet** is a claim — a week of entries somebody submits and
 *     somebody else answers for.
 *
 * Zoho rebuilt timesheets in November 2025 around exactly that third object,
 * and the reason is worth keeping in mind here: approving a hundred individual
 * entries is not review, it is clicking. A week is the unit a manager can
 * actually form a judgement about.
 */

import { paginate, query, rows, row, transaction } from './db.js';
import * as audit from './auditService.js';
import * as notifications from './notificationService.js';
import { may } from './projectAccess.js';

/* ------------------------------------------------------------------ */
/* Timers                                                              */
/* ------------------------------------------------------------------ */

/**
 * The timer this person has running, wherever it was started.
 *
 * Global rather than per project, because §46 asks for a timer somebody can see
 * and stop without navigating back to the task that started it — and because
 * the invariant is one per person, not one per project.
 */
export async function runningTimer(user) {
  const found = await row(
    `SELECT t.*, p.name AS project_name, p.key AS project_key
       FROM qodo_projects.timers t
       LEFT JOIN qodo_projects.projects p ON p.id = t.project_id
      WHERE t.organization_id = $1 AND t.user_id = $2 AND t.stopped_at IS NULL`,
    [user.organizationId ?? 'engosoft', user.id]
  );
  return found ? toTimer(found) : null;
}

function toTimer(record) {
  const running = !record.paused_at && !record.stopped_at;
  const currentRun = running ? Math.floor((Date.now() - new Date(record.started_at).getTime()) / 1000) : 0;
  return {
    id: record.id,
    projectId: record.project_id,
    projectName: record.project_name ?? null,
    projectKey: record.project_key ?? null,
    entityType: record.entity_type,
    entityId: record.entity_id,
    startedAt: record.started_at,
    pausedAt: record.paused_at,
    notes: record.notes,
    isRunning: running,
    // The banked time plus whatever the current run has added. Computed on read
    // so a paused timer does not keep counting and a running one does not need
    // a write per second.
    elapsedSeconds: Number(record.accumulated_seconds ?? 0) + currentRun,
  };
}

/**
 * Start the clock on a piece of work.
 *
 * If another timer is already running it is stopped first and its time is
 * logged — which is what people mean when they start a second one. The
 * alternative, refusing, produces the familiar outcome of somebody forgetting
 * the first timer and logging eleven hours to a task they left at ten.
 */
export async function startTimer(context, input) {
  const { user, project, organizationId } = context;

  const entityType = input?.entityType === 'issue' ? 'issue' : 'task';
  const entityId = String(input?.entityId ?? '');
  if (!entityId) throw badRequest('entity_required');

  return transaction(async (tx) => {
    const current = await tx.row(
      `SELECT * FROM qodo_projects.timers
        WHERE organization_id = $1 AND user_id = $2 AND stopped_at IS NULL`,
      [organizationId, user.id]
    );

    if (current) {
      await stopInside(tx, context, current, { reason: 'superseded' });
    }

    const started = await tx.row(
      `INSERT INTO qodo_projects.timers
         (organization_id, user_id, project_id, entity_type, entity_id, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [organizationId, user.id, project.id, entityType, entityId, String(input?.notes ?? '')]
    );

    return toTimer(started);
  });
}

export async function pauseTimer(context) {
  const updated = await row(
    `UPDATE qodo_projects.timers
        SET accumulated_seconds = accumulated_seconds
              + GREATEST(0, EXTRACT(EPOCH FROM (now() - started_at))::int),
            paused_at = now()
      WHERE organization_id = $1 AND user_id = $2 AND stopped_at IS NULL AND paused_at IS NULL
      RETURNING *`,
    [context.organizationId, context.user.id]
  );
  return updated ? toTimer(updated) : null;
}

export async function resumeTimer(context) {
  const updated = await row(
    `UPDATE qodo_projects.timers
        SET started_at = now(), paused_at = NULL
      WHERE organization_id = $1 AND user_id = $2 AND stopped_at IS NULL AND paused_at IS NOT NULL
      RETURNING *`,
    [context.organizationId, context.user.id]
  );
  return updated ? toTimer(updated) : null;
}

/**
 * Stop the clock and write the time down.
 *
 * A timer that stops without producing an entry has measured nothing, so the
 * two happen in one transaction. Rounded to two decimal places of an hour —
 * seconds of precision on a timesheet is false precision, and it makes every
 * total look like a rounding error.
 */
export async function stopTimer(context) {
  const current = await row(
    `SELECT * FROM qodo_projects.timers
      WHERE organization_id = $1 AND user_id = $2 AND stopped_at IS NULL`,
    [context.organizationId, context.user.id]
  );
  if (!current) return null;

  return transaction(async (tx) => stopInside(tx, context, current, {}));
}

async function stopInside(tx, context, timer, { reason = 'stopped' } = {}) {
  const running = !timer.paused_at;
  const currentRun = running
    ? Math.max(0, Math.floor((Date.now() - new Date(timer.started_at).getTime()) / 1000))
    : 0;
  const seconds = Number(timer.accumulated_seconds ?? 0) + currentRun;

  await tx.query('UPDATE qodo_projects.timers SET stopped_at = now() WHERE id = $1', [timer.id]);

  // Under a minute is a mis-click, not work. Recording it would fill the sheet
  // with noise a reviewer has to read past.
  if (seconds < 60) return { timer: null, entry: null, discarded: true, reason };

  const hours = Math.round((seconds / 3600) * 100) / 100;
  const entry = await insertEntry(tx, context, {
    projectId: timer.project_id,
    taskId: timer.entity_type === 'task' ? timer.entity_id : null,
    issueId: timer.entity_type === 'issue' ? timer.entity_id : null,
    userId: context.user.id,
    logDate: new Date().toISOString().slice(0, 10),
    hours,
    notes: timer.notes,
  });

  await audit.record({
    actor: context.user,
    organizationId: context.organizationId,
    projectId: timer.project_id,
    entityType: 'time_entry',
    entityId: entry.id,
    action: 'time.log',
    after: { hours, source: 'timer', reason },
    tx,
  });

  return { timer: null, entry: toEntry(entry), discarded: false, reason };
}

/* ------------------------------------------------------------------ */
/* Time entries                                                        */
/* ------------------------------------------------------------------ */

async function insertEntry(tx, context, values) {
  return tx.row(
    `INSERT INTO qodo_projects.time_entries
       (organization_id, project_id, task_id, issue_id, user_id, log_date, hours,
        notes, is_billable, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
     RETURNING *`,
    [
      context.organizationId,
      values.projectId,
      values.taskId ?? null,
      values.issueId ?? null,
      values.userId,
      values.logDate,
      values.hours,
      String(values.notes ?? ''),
      Boolean(values.isBillable),
      context.user.id,
    ]
  );
}

function toEntry(record) {
  return {
    id: record.id,
    projectId: record.project_id,
    taskId: record.task_id,
    issueId: record.issue_id,
    userId: record.user_id,
    timesheetId: record.timesheet_id,
    logDate: record.log_date,
    hours: Number(record.hours),
    notes: record.notes,
    isBillable: record.is_billable,
    approvalStatus: record.approval_status,
    invoicedAt: record.invoiced_at,
    // Rates are attached by the projection in `projectAccess`, not here — this
    // shape carries them so that somebody with `rate.view` sees them and the
    // projection strips them for everybody else.
    billRate: record.bill_rate === null ? null : Number(record.bill_rate),
    costRate: record.cost_rate === null ? null : Number(record.cost_rate),
    createdAt: record.created_at,
  };
}

/**
 * Log time by hand.
 *
 * `time.log` covers your own time; logging somebody else's needs
 * `time.log_others`, and the distinction is not pedantry — a timesheet is a
 * claim a person makes, and one filed on their behalf without that authority is
 * somebody else's claim wearing their name.
 */
export async function logTime(context, input) {
  const { user, project, organizationId } = context;

  const hours = Number(input?.hours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) throw badRequest('hours_invalid');

  const logDate = String(input?.logDate ?? new Date().toISOString().slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(logDate)) throw badRequest('date_invalid');

  const forUser = String(input?.userId ?? user.id);
  if (forUser !== user.id && !may(context, 'time.log_others')) {
    throw forbidden('time.log_others');
  }

  // The entry has to hang off something in this project. Without the check a
  // caller could log time against a task in a project they cannot see and learn
  // it exists.
  if (input?.taskId) {
    const task = await row(
      `SELECT 1 FROM qodo_projects.project_task_extensions
        WHERE task_id = $1 AND project_id = $2 AND deleted_at IS NULL`,
      [input.taskId, project.id]
    );
    if (!task) throw badRequest('task_not_found');
  }
  if (input?.issueId) {
    const issue = await row(
      `SELECT 1 FROM qodo_projects.issues WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
      [input.issueId, project.id]
    );
    if (!issue) throw badRequest('issue_not_found');
  }

  const entry = await transaction(async (tx) => {
    const created = await insertEntry(tx, context, {
      projectId: project.id,
      taskId: input?.taskId ?? null,
      issueId: input?.issueId ?? null,
      userId: forUser,
      logDate,
      hours,
      notes: input?.notes,
      isBillable: input?.isBillable,
    });

    await audit.record({
      actor: user,
      organizationId,
      projectId: project.id,
      entityType: 'time_entry',
      entityId: created.id,
      action: 'time.log',
      after: { hours, logDate, forUser, source: 'manual' },
      tx,
    });

    return created;
  });

  // The task's actual hours follow from its entries rather than being typed,
  // so the two can never disagree.
  if (input?.taskId) await refreshTaskHours(input.taskId);

  return toEntry(entry);
}

/** Recompute a task's actual hours from its time entries. */
export async function refreshTaskHours(taskId) {
  await query(
    `UPDATE qodo_projects.project_task_extensions t
        SET actual_hours = COALESCE(totals.hours, 0)
       FROM (SELECT COALESCE(sum(hours), 0) AS hours
               FROM qodo_projects.time_entries WHERE task_id = $1) totals
      WHERE t.task_id = $1`,
    [taskId]
  );
}

export async function listEntries(context, options = {}) {
  const { limit, offset } = paginate(options);
  const params = [context.project.id, context.organizationId];
  const conditions = ['e.project_id = $1', 'e.organization_id = $2'];

  // Seeing everybody's time is a permission. Without it a person sees their own,
  // which is what they need to fill in a timesheet.
  if (!may(context, 'time.view')) {
    params.push(context.user.id);
    conditions.push(`e.user_id = $${params.length}`);
  } else if (options.userId) {
    params.push(options.userId);
    conditions.push(`e.user_id = $${params.length}`);
  }

  if (options.from) {
    params.push(options.from);
    conditions.push(`e.log_date >= $${params.length}`);
  }
  if (options.to) {
    params.push(options.to);
    conditions.push(`e.log_date <= $${params.length}`);
  }
  if (options.taskId) {
    params.push(options.taskId);
    conditions.push(`e.task_id = $${params.length}`);
  }
  if (options.approvalStatus) {
    params.push(options.approvalStatus);
    conditions.push(`e.approval_status = $${params.length}`);
  }

  params.push(limit, offset);

  const found = await rows(
    `SELECT e.* FROM qodo_projects.time_entries e
      WHERE ${conditions.join(' AND ')}
      ORDER BY e.log_date DESC, e.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const totals = await row(
    `SELECT count(*)::int AS entries,
            COALESCE(sum(hours), 0) AS hours,
            COALESCE(sum(hours) FILTER (WHERE is_billable), 0) AS billable_hours
       FROM qodo_projects.time_entries e
      WHERE ${conditions.join(' AND ')}`,
    params.slice(0, params.length - 2)
  );

  return {
    entries: found.map(toEntry),
    total: totals?.entries ?? 0,
    totalHours: Number(totals?.hours ?? 0),
    billableHours: Number(totals?.billable_hours ?? 0),
    limit,
    offset,
  };
}

/**
 * Change or delete an entry.
 *
 * Approved and invoiced time is frozen. Editing an approved entry would mean a
 * manager's decision no longer describes what was approved, and editing an
 * invoiced one would make the system disagree with a document already sent to a
 * customer.
 */
export async function updateEntry(context, entryId, input) {
  const current = await row(
    `SELECT * FROM qodo_projects.time_entries
      WHERE id = $1 AND project_id = $2 AND organization_id = $3`,
    [entryId, context.project.id, context.organizationId]
  );
  if (!current) return null;

  if (current.invoiced_at) throw conflict('time_entry_invoiced');
  if (current.approval_status === 'approved' && !may(context, 'time.edit_any')) {
    throw conflict('time_entry_approved');
  }
  if (current.user_id !== context.user.id && !may(context, 'time.edit_any')) {
    throw forbidden('time.edit_any');
  }

  const assignments = [];
  const params = [entryId, context.user.id];
  const changed = {};

  for (const [field, column] of Object.entries({
    hours: 'hours',
    logDate: 'log_date',
    notes: 'notes',
    isBillable: 'is_billable',
  })) {
    if (input?.[field] === undefined) continue;
    let value = input[field];
    if (field === 'hours') {
      value = Number(value);
      if (!Number.isFinite(value) || value <= 0 || value > 24) throw badRequest('hours_invalid');
    }
    if (field === 'isBillable') value = Boolean(value);
    params.push(value);
    assignments.push(`${column} = $${params.length}`);
    changed[field] = value;
  }
  if (assignments.length === 0) return toEntry(current);

  const updated = await row(
    `UPDATE qodo_projects.time_entries SET ${assignments.join(', ')}, updated_by = $2
      WHERE id = $1 RETURNING *`,
    params
  );

  await audit.record({
    actor: context.user,
    organizationId: context.organizationId,
    projectId: context.project.id,
    entityType: 'time_entry',
    entityId: entryId,
    action: 'time.update',
    before: { hours: Number(current.hours), logDate: current.log_date },
    after: changed,
  });

  if (updated.task_id) await refreshTaskHours(updated.task_id);
  return toEntry(updated);
}

export async function deleteEntry(context, entryId) {
  const current = await row(
    `SELECT * FROM qodo_projects.time_entries
      WHERE id = $1 AND project_id = $2 AND organization_id = $3`,
    [entryId, context.project.id, context.organizationId]
  );
  if (!current) return false;
  if (current.invoiced_at) throw conflict('time_entry_invoiced');
  if (current.approval_status === 'approved' && !may(context, 'time.edit_any')) {
    throw conflict('time_entry_approved');
  }
  if (current.user_id !== context.user.id && !may(context, 'time.edit_any')) {
    throw forbidden('time.edit_any');
  }

  await query('DELETE FROM qodo_projects.time_entries WHERE id = $1', [entryId]);

  await audit.record({
    actor: context.user,
    organizationId: context.organizationId,
    projectId: context.project.id,
    entityType: 'time_entry',
    entityId: entryId,
    action: 'time.delete',
    before: { hours: Number(current.hours), logDate: current.log_date },
    after: null,
  });

  if (current.task_id) await refreshTaskHours(current.task_id);
  return true;
}

/* ------------------------------------------------------------------ */
/* Timesheets                                                          */
/* ------------------------------------------------------------------ */

/** The Sunday that starts the week containing `date`. Engosoft's week. */
export function weekStart(date) {
  const parsed = new Date(`${String(date).slice(0, 10)}T00:00:00Z`);
  const day = parsed.getUTCDay(); // 0 = Sunday
  parsed.setUTCDate(parsed.getUTCDate() - day);
  return parsed.toISOString().slice(0, 10);
}

export function weekEnd(start) {
  const parsed = new Date(`${start}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 6);
  return parsed.toISOString().slice(0, 10);
}

/**
 * The sheet covering a week, created on demand.
 *
 * Made lazily rather than by a scheduler, because a sheet that exists for every
 * person for every week whether or not they logged anything is a queue full of
 * empty claims for a manager to dismiss.
 */
export async function timesheetFor(context, userId, anyDateInWeek) {
  const start = weekStart(anyDateInWeek ?? new Date().toISOString().slice(0, 10));

  const existing = await row(
    `SELECT * FROM qodo_projects.timesheets
      WHERE organization_id = $1 AND user_id = $2 AND period_start = $3`,
    [context.organizationId, userId, start]
  );
  if (existing) return toTimesheet(existing);

  const created = await row(
    `INSERT INTO qodo_projects.timesheets (organization_id, user_id, period_start, period_end)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (organization_id, user_id, period_start) DO UPDATE SET period_end = EXCLUDED.period_end
     RETURNING *`,
    [context.organizationId, userId, start, weekEnd(start)]
  );
  return toTimesheet(created);
}

function toTimesheet(record) {
  return {
    id: record.id,
    userId: record.user_id,
    periodStart: record.period_start,
    periodEnd: record.period_end,
    status: record.status,
    submittedAt: record.submitted_at,
    reviewedAt: record.reviewed_at,
    reviewedBy: record.reviewed_by,
    rejectionReason: record.rejection_reason,
    lockedAt: record.locked_at,
  };
}

/**
 * Hand a week in.
 *
 * Gathers every unattached entry in the period, attaches them, and moves both
 * the sheet and its entries to `submitted` in one transaction — a sheet that
 * says submitted while its entries say draft is a claim a reviewer cannot act
 * on.
 */
export async function submitTimesheet(context, anyDateInWeek) {
  const { user, organizationId } = context;
  const sheet = await timesheetFor(context, user.id, anyDateInWeek);

  if (sheet.status === 'approved') throw conflict('timesheet_approved');
  if (sheet.lockedAt) throw conflict('timesheet_locked');

  return transaction(async (tx) => {
    const attached = await tx.rows(
      `UPDATE qodo_projects.time_entries
          SET timesheet_id = $1, approval_status = 'submitted'
        WHERE organization_id = $2 AND user_id = $3
          AND log_date BETWEEN $4 AND $5
          AND approval_status IN ('draft', 'rejected')
        RETURNING id, hours`,
      [sheet.id, organizationId, user.id, sheet.periodStart, sheet.periodEnd]
    );

    if (attached.length === 0) {
      throw Object.assign(new Error('timesheet_empty'), {
        status: 409,
        body: { error: 'timesheet_empty' },
      });
    }

    const updated = await tx.row(
      `UPDATE qodo_projects.timesheets
          SET status = 'submitted', submitted_at = now(), rejection_reason = ''
        WHERE id = $1 RETURNING *`,
      [sheet.id]
    );

    await audit.record({
      actor: user,
      organizationId,
      entityType: 'timesheet',
      entityId: sheet.id,
      action: 'timesheet.submit',
      after: {
        period: `${sheet.periodStart}..${sheet.periodEnd}`,
        entries: attached.length,
        hours: attached.reduce((sum, entry) => sum + Number(entry.hours), 0),
      },
      tx,
    });

    return toTimesheet(updated);
  });
}

/**
 * Approve or reject a submitted week.
 *
 * Rejection carries a reason, always. "Rejected" with no explanation is a
 * message that costs the person a conversation to decode, and the field is
 * required rather than optional for that reason.
 */
export async function reviewTimesheet(context, timesheetId, decision, reason = '') {
  const { user, organizationId } = context;

  if (!['approved', 'rejected'].includes(decision)) throw badRequest('decision_invalid');
  if (decision === 'rejected' && !String(reason).trim()) throw badRequest('rejection_reason_required');

  const sheet = await row(
    `SELECT * FROM qodo_projects.timesheets WHERE id = $1 AND organization_id = $2`,
    [timesheetId, organizationId]
  );
  if (!sheet) return null;
  if (sheet.status !== 'submitted') throw conflict('timesheet_not_submitted');

  // Nobody approves their own week. The whole point of an approval is that a
  // second person looked at it.
  if (sheet.user_id === user.id) throw conflict('cannot_approve_own_timesheet');

  return transaction(async (tx) => {
    const updated = await tx.row(
      `UPDATE qodo_projects.timesheets
          SET status = $2, reviewed_at = now(), reviewed_by = $3, rejection_reason = $4
        WHERE id = $1 RETURNING *`,
      [timesheetId, decision, user.id, decision === 'rejected' ? String(reason).trim() : '']
    );

    await tx.query(
      `UPDATE qodo_projects.time_entries SET approval_status = $2 WHERE timesheet_id = $1`,
      [timesheetId, decision]
    );

    // Approving freezes the rates in force on each entry's own date, so a raise
    // next month cannot restate this month's cost report.
    if (decision === 'approved') {
      await tx.query(
        `UPDATE qodo_projects.time_entries e
            SET cost_rate = COALESCE(e.cost_rate, (
                  SELECT r.rate FROM qodo_projects.cost_rates r
                   WHERE r.organization_id = e.organization_id
                     AND r.user_id = e.user_id
                     AND (r.project_id = e.project_id OR r.project_id IS NULL)
                     AND r.effective_from <= e.log_date
                   ORDER BY r.project_id NULLS LAST, r.effective_from DESC
                   LIMIT 1)),
                bill_rate = COALESCE(e.bill_rate, (
                  SELECT b.rate FROM qodo_projects.billing_rates b
                   WHERE b.organization_id = e.organization_id
                     AND (b.user_id = e.user_id OR b.user_id IS NULL)
                     AND (b.project_id = e.project_id OR b.project_id IS NULL)
                     AND b.effective_from <= e.log_date
                   ORDER BY b.project_id NULLS LAST, b.user_id NULLS LAST, b.effective_from DESC
                   LIMIT 1))
          WHERE e.timesheet_id = $1`,
        [timesheetId]
      );
    }

    await audit.record({
      actor: user,
      organizationId,
      entityType: 'timesheet',
      entityId: timesheetId,
      action: `timesheet.${decision}`,
      before: { status: sheet.status },
      after: { status: decision, reason: decision === 'rejected' ? reason : undefined },
      tx,
    });

    return toTimesheet(updated);
  });
}

/** Take a submitted week back before anybody has looked at it. */
export async function recallTimesheet(context, timesheetId) {
  const updated = await row(
    `UPDATE qodo_projects.timesheets
        SET status = 'draft', submitted_at = NULL
      WHERE id = $1 AND organization_id = $2 AND user_id = $3 AND status = 'submitted'
      RETURNING *`,
    [timesheetId, context.organizationId, context.user.id]
  );
  if (!updated) return null;

  await query(
    `UPDATE qodo_projects.time_entries SET approval_status = 'draft' WHERE timesheet_id = $1`,
    [timesheetId]
  );
  return toTimesheet(updated);
}

export async function pendingTimesheets(context) {
  return (
    await rows(
      `SELECT t.*, COALESCE(sum(e.hours), 0) AS hours, count(e.id)::int AS entries
         FROM qodo_projects.timesheets t
         LEFT JOIN qodo_projects.time_entries e ON e.timesheet_id = t.id
        WHERE t.organization_id = $1 AND t.status = 'submitted' AND t.user_id <> $2
        GROUP BY t.id
        ORDER BY t.submitted_at`,
      [context.organizationId, context.user.id]
    )
  ).map((record) => ({ ...toTimesheet(record), hours: Number(record.hours), entries: record.entries }));
}

function badRequest(code) {
  return Object.assign(new Error(code), { status: 400, body: { error: code } });
}
function conflict(code) {
  return Object.assign(new Error(code), { status: 409, body: { error: code } });
}
function forbidden(permission) {
  return Object.assign(new Error('forbidden'), {
    status: 403,
    body: { error: 'forbidden', missing: permission },
  });
}
