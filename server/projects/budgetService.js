/**
 * Qodo Projects — budgets, costing and earned value.
 *
 * One rule governs this whole file: **never invent a number.**
 *
 * §51 says it about earned value specifically, and it applies everywhere here.
 * A project with no budget has no variance; a project where nobody has logged
 * time has no actual cost; a project whose tasks carry no estimates has no
 * planned value. Every one of those is `null` in what this returns, never zero
 * — because zero is a measurement and null is the absence of one, and a manager
 * reading "0% over budget" on a project with no budget has been told something
 * false.
 *
 * The second rule follows from the first: rates are restricted. Whether a
 * project is over budget is a project-management question; what a colleague
 * costs per hour is not, and the two are separated by `rate.view`.
 */

import { rows, row, query } from './db.js';
import * as audit from './auditService.js';

/* ------------------------------------------------------------------ */
/* Budgets                                                             */
/* ------------------------------------------------------------------ */

export async function list(context) {
  return (
    await rows(
      `SELECT b.*, ph.name AS phase_name
         FROM qodo_projects.budgets b
         LEFT JOIN qodo_projects.phases ph ON ph.id = b.phase_id
        WHERE b.project_id = $1 AND b.organization_id = $2
        ORDER BY b.created_at`,
      [context.project.id, context.organizationId]
    )
  ).map(toBudget);
}

function toBudget(record) {
  return {
    id: record.id,
    projectId: record.project_id,
    phaseId: record.phase_id,
    phaseName: record.phase_name ?? null,
    type: record.type,
    amount: record.amount === null ? null : Number(record.amount),
    hours: record.hours === null ? null : Number(record.hours),
    currency: record.currency,
    thresholdPercent: record.threshold_percent,
    createdAt: record.created_at,
  };
}

export async function setBudget(context, input) {
  const { user, project, organizationId } = context;

  const TYPES = ['project_hours', 'staff_hours', 'project_amount', 'fixed_cost', 'task_hours', 'issue_hours'];
  if (!TYPES.includes(input?.type)) throw badRequest('budget_type_invalid');

  const amount = input?.amount === undefined || input?.amount === null ? null : Number(input.amount);
  const hours = input?.hours === undefined || input?.hours === null ? null : Number(input.hours);
  if (amount === null && hours === null) throw badRequest('budget_value_required');
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) throw badRequest('budget_value_invalid');
  if (hours !== null && (!Number.isFinite(hours) || hours < 0)) throw badRequest('budget_value_invalid');

  const created = await row(
    `INSERT INTO qodo_projects.budgets
       (organization_id, project_id, phase_id, type, amount, hours, currency, threshold_percent, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (project_id, type) WHERE phase_id IS NULL
       DO UPDATE SET amount = EXCLUDED.amount,
                     hours = EXCLUDED.hours,
                     threshold_percent = EXCLUDED.threshold_percent,
                     threshold_notified_at = NULL
     RETURNING *`,
    [
      organizationId,
      project.id,
      input?.phaseId ?? null,
      input.type,
      amount,
      hours,
      String(input?.currency ?? project.currency ?? 'EGP').toUpperCase().slice(0, 3),
      Number(input?.thresholdPercent ?? 80),
      user.id,
    ]
  );

  await audit.record({
    actor: user,
    organizationId,
    projectId: project.id,
    entityType: 'budget',
    entityId: created.id,
    action: 'budget.set',
    after: { type: created.type, amount: created.amount, hours: created.hours },
  });

  return toBudget(created);
}

/* ------------------------------------------------------------------ */
/* Consumption                                                         */
/* ------------------------------------------------------------------ */

/**
 * What the project has actually spent and planned, in hours and in money.
 *
 * Every figure comes from a `sum()` in SQL over the rows that produced it, and
 * every one of them can be `null`: a project with no estimates has no planned
 * hours, and saying so is more useful than saying zero.
 */
export async function consumption(context) {
  const totals = await row(
    `SELECT
       (SELECT NULLIF(sum(estimated_hours), 0)
          FROM qodo_projects.project_task_extensions
         WHERE project_id = $1 AND deleted_at IS NULL) AS planned_hours,
       (SELECT NULLIF(sum(hours), 0)
          FROM qodo_projects.time_entries WHERE project_id = $1) AS actual_hours,
       (SELECT NULLIF(sum(hours) FILTER (WHERE approval_status = 'approved'), 0)
          FROM qodo_projects.time_entries WHERE project_id = $1) AS approved_hours,
       (SELECT NULLIF(sum(hours) FILTER (WHERE is_billable), 0)
          FROM qodo_projects.time_entries WHERE project_id = $1) AS billable_hours,
       (SELECT NULLIF(sum(hours * COALESCE(cost_rate, 0)), 0)
          FROM qodo_projects.time_entries WHERE project_id = $1) AS labour_cost,
       (SELECT NULLIF(sum(hours * COALESCE(bill_rate, 0)) FILTER (WHERE is_billable), 0)
          FROM qodo_projects.time_entries WHERE project_id = $1) AS billable_amount,
       (SELECT NULLIF(sum(amount), 0)
          FROM qodo_projects.expenses WHERE project_id = $1 AND deleted_at IS NULL) AS expenses,
       (SELECT count(*)::int
          FROM qodo_projects.project_task_extensions
         WHERE project_id = $1 AND deleted_at IS NULL) AS task_count,
       (SELECT count(*)::int
          FROM qodo_projects.project_task_extensions t
          LEFT JOIN qodo_projects.statuses s ON s.id = t.status_id
         WHERE t.project_id = $1 AND t.deleted_at IS NULL AND s.category = 'done') AS done_count,
       (SELECT avg(progress)
          FROM qodo_projects.project_task_extensions
         WHERE project_id = $1 AND deleted_at IS NULL) AS average_progress`,
    [context.project.id]
  );

  const labourCost = numberOrNull(totals?.labour_cost);
  const expenses = numberOrNull(totals?.expenses);

  return {
    plannedHours: numberOrNull(totals?.planned_hours),
    actualHours: numberOrNull(totals?.actual_hours),
    approvedHours: numberOrNull(totals?.approved_hours),
    billableHours: numberOrNull(totals?.billable_hours),
    labourCost,
    billableAmount: numberOrNull(totals?.billable_amount),
    expenses,
    // Absent when neither half is known. Adding null to null is not zero.
    actualCost: labourCost === null && expenses === null ? null : (labourCost ?? 0) + (expenses ?? 0),
    taskCount: Number(totals?.task_count ?? 0),
    doneCount: Number(totals?.done_count ?? 0),
    averageProgress: numberOrNull(totals?.average_progress),
  };
}

const numberOrNull = (value) => (value === null || value === undefined ? null : Number(value));

/**
 * How a budget is doing.
 *
 * `state` is the four-way judgement §48 asks for, and the thresholds are
 * explicit rather than buried:
 *
 *   • **Healthy**  — under the warning threshold (80% by default);
 *   • **At risk**  — past the threshold but not yet over;
 *   • **Overrun**  — past 100%;
 *   • **Surplus**  — the work is finished and money is left.
 *
 * A budget with nothing consumed yet is Healthy, not Surplus: nothing has been
 * saved, nothing has been spent.
 */
export function budgetState(budget, consumed, isComplete = false) {
  const limit = budget.hours ?? budget.amount;
  if (limit === null || limit === undefined || limit === 0) return { state: 'unset', percent: null };
  if (consumed === null || consumed === undefined) return { state: 'unset', percent: null };

  const percent = Math.round((consumed / limit) * 1000) / 10;

  if (percent > 100) return { state: 'overrun', percent };
  if (isComplete) return { state: 'surplus', percent };
  if (percent >= budget.thresholdPercent) return { state: 'at_risk', percent };
  return { state: 'healthy', percent };
}

/**
 * Every budget on the project, with what has been consumed against it.
 *
 * Which figure counts against which budget is not obvious, so it is stated:
 * an hours budget is measured against logged hours, an amount budget against
 * labour cost plus expenses, and a fixed cost against the same — because a
 * fixed-price job is over budget when it has cost more than the price, not when
 * it has been billed for less.
 */
export async function status(context) {
  const [budgets, consumed] = await Promise.all([list(context), consumption(context)]);

  const complete =
    consumed.taskCount > 0 && consumed.doneCount === consumed.taskCount;

  return {
    consumption: consumed,
    budgets: budgets.map((budget) => {
      const consumedAgainst =
        budget.type.endsWith('_hours') ? consumed.actualHours : consumed.actualCost;
      return { ...budget, consumed: consumedAgainst, ...budgetState(budget, consumedAgainst, complete) };
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Earned value                                                        */
/* ------------------------------------------------------------------ */

/**
 * Earned value management, with the formulas written out.
 *
 * §51 asks for these and asks that the formulas be documented. They are the
 * standard PMI definitions, expressed in money:
 *
 *   BAC — Budget at Completion .... the project's amount budget
 *   PV  — Planned Value .......... BAC × (planned progress by now)
 *   EV  — Earned Value ........... BAC × (actual progress)
 *   AC  — Actual Cost ............ labour cost + expenses
 *   SV  — Schedule Variance ...... EV − PV      (negative = behind)
 *   CV  — Cost Variance .......... EV − AC      (negative = over)
 *   SPI — Schedule Performance ... EV ÷ PV      (< 1 = behind)
 *   CPI — Cost Performance ....... EV ÷ AC      (< 1 = over)
 *   EAC — Estimate at Completion . BAC ÷ CPI    (forecast final cost)
 *   ETC — Estimate to Complete ... EAC − AC
 *
 * **Planned progress** is the proportion of the project's calendar that has
 * elapsed. That is a simplification — a proper PV uses the time-phased budget —
 * and it is stated in the return as `plannedProgressBasis` so nobody mistakes
 * it for something more precise than it is.
 *
 * Returns `available: false` with a list of what is missing rather than
 * computing around a gap. An SPI derived from a guessed budget is worse than no
 * SPI at all, because somebody will act on it.
 */
export async function earnedValue(context) {
  const [budgets, consumed] = await Promise.all([list(context), consumption(context)]);

  const missing = [];

  const amountBudget = budgets.find((budget) => budget.amount !== null);
  if (!amountBudget) missing.push('budget_amount');

  const { startDate, endDate } = context.project;
  if (!startDate || !endDate) missing.push('project_dates');

  if (consumed.actualCost === null) missing.push('actual_cost');
  if (consumed.averageProgress === null) missing.push('progress');

  if (missing.length > 0) {
    return {
      available: false,
      missing,
      // Say what *is* known, so the screen can show the halves that exist
      // rather than an empty panel.
      partial: {
        budgetAtCompletion: amountBudget?.amount ?? null,
        actualCost: consumed.actualCost,
        progressPercent: consumed.averageProgress,
      },
    };
  }

  const bac = amountBudget.amount;
  const ac = consumed.actualCost;
  const progress = consumed.averageProgress / 100;

  const start = Date.parse(`${String(startDate).slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${String(endDate).slice(0, 10)}T00:00:00Z`);
  const now = Date.now();
  const plannedProgress = end <= start ? 1 : Math.max(0, Math.min(1, (now - start) / (end - start)));

  const pv = bac * plannedProgress;
  const ev = bac * progress;

  // A ratio with a zero denominator is not infinity, it is unknown. PV is zero
  // on the day a project starts and AC is zero before anybody logs time.
  const spi = pv === 0 ? null : round(ev / pv, 3);
  const cpi = ac === 0 ? null : round(ev / ac, 3);
  const eac = cpi === null || cpi === 0 ? null : round(bac / cpi, 2);

  return {
    available: true,
    currency: amountBudget.currency,
    budgetAtCompletion: round(bac, 2),
    plannedValue: round(pv, 2),
    earnedValue: round(ev, 2),
    actualCost: round(ac, 2),
    scheduleVariance: round(ev - pv, 2),
    costVariance: round(ev - ac, 2),
    schedulePerformanceIndex: spi,
    costPerformanceIndex: cpi,
    estimateAtCompletion: eac,
    estimateToComplete: eac === null ? null : round(eac - ac, 2),
    progressPercent: round(consumed.averageProgress, 1),
    plannedProgressPercent: round(plannedProgress * 100, 1),
    // Named so the reader knows how PV was derived and does not read more
    // precision into it than there is.
    plannedProgressBasis: 'elapsed_calendar_time',
  };
}

const round = (value, places) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/* ------------------------------------------------------------------ */
/* Rates                                                               */
/* ------------------------------------------------------------------ */

/**
 * Set what somebody costs, or what they are billed at, from a date.
 *
 * Effective-dated inserts rather than updates, so last quarter's report keeps
 * using last quarter's rate. Changing a rate is a new row; it never rewrites
 * the old one.
 */
export async function setRate(context, kind, input) {
  const table = kind === 'bill' ? 'billing_rates' : 'cost_rates';
  const rate = Number(input?.rate);
  if (!Number.isFinite(rate) || rate < 0) throw badRequest('rate_invalid');

  const created = await row(
    `INSERT INTO qodo_projects.${table}
       (organization_id, user_id, project_id, rate, currency, effective_from, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      context.organizationId,
      input?.userId ?? null,
      input?.projectId ?? null,
      rate,
      String(input?.currency ?? 'EGP').toUpperCase().slice(0, 3),
      input?.effectiveFrom ?? new Date().toISOString().slice(0, 10),
      context.user.id,
    ]
  );

  await audit.record({
    actor: context.user,
    organizationId: context.organizationId,
    projectId: input?.projectId ?? null,
    entityType: `${kind}_rate`,
    entityId: created.id,
    action: 'rate.set',
    // The rate itself is redacted by the audit service. What is recorded is
    // that somebody set one, for whom, from when — which is the question an
    // auditor asks.
    after: { userId: input?.userId ?? null, effectiveFrom: created.effective_from },
  });

  return { id: created.id, effectiveFrom: created.effective_from };
}

/* ------------------------------------------------------------------ */
/* Expenses                                                            */
/* ------------------------------------------------------------------ */

export async function expenses(context) {
  return (
    await rows(
      `SELECT * FROM qodo_projects.expenses
        WHERE project_id = $1 AND organization_id = $2 AND deleted_at IS NULL
        ORDER BY incurred_on DESC`,
      [context.project.id, context.organizationId]
    )
  ).map((record) => ({
    id: record.id,
    description: record.description,
    category: record.category,
    amount: Number(record.amount),
    currency: record.currency,
    incurredOn: record.incurred_on,
    isBillable: record.is_billable,
    invoicedAt: record.invoiced_at,
  }));
}

export async function addExpense(context, input) {
  const amount = Number(input?.amount);
  if (!Number.isFinite(amount) || amount < 0) throw badRequest('amount_invalid');
  const description = String(input?.description ?? '').trim();
  if (!description) throw badRequest('description_required');

  const created = await row(
    `INSERT INTO qodo_projects.expenses
       (organization_id, project_id, phase_id, description, category, amount, currency,
        incurred_on, is_billable, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      context.organizationId,
      context.project.id,
      input?.phaseId ?? null,
      description,
      input?.category ?? null,
      amount,
      String(input?.currency ?? context.project.currency ?? 'EGP').toUpperCase().slice(0, 3),
      input?.incurredOn ?? new Date().toISOString().slice(0, 10),
      Boolean(input?.isBillable),
      context.user.id,
    ]
  );

  await audit.record({
    actor: context.user,
    organizationId: context.organizationId,
    projectId: context.project.id,
    entityType: 'expense',
    entityId: created.id,
    action: 'expense.create',
    after: { description, amount, currency: created.currency },
  });

  return { id: created.id, description, amount, currency: created.currency };
}

/**
 * Budgets that have crossed their warning threshold and not been announced.
 *
 * Called by the scheduler. Stamping `threshold_notified_at` is what stops the
 * same warning going out every half hour, and clearing it when the budget is
 * raised is what lets a genuine second breach be announced.
 */
export async function budgetsCrossingThreshold(organizationId) {
  const candidates = await rows(
    `SELECT b.*, p.name AS project_name, p.owner_id
       FROM qodo_projects.budgets b
       JOIN qodo_projects.projects p ON p.id = b.project_id
      WHERE b.organization_id = $1
        AND b.threshold_notified_at IS NULL
        AND p.deleted_at IS NULL AND p.archived_at IS NULL`,
    [organizationId]
  );

  const crossed = [];
  for (const budget of candidates) {
    const consumed = await row(
      budget.type.endsWith('_hours')
        ? `SELECT COALESCE(sum(hours), 0) AS used FROM qodo_projects.time_entries WHERE project_id = $1`
        : `SELECT COALESCE((SELECT sum(hours * COALESCE(cost_rate, 0))
                              FROM qodo_projects.time_entries WHERE project_id = $1), 0)
                 + COALESCE((SELECT sum(amount) FROM qodo_projects.expenses
                              WHERE project_id = $1 AND deleted_at IS NULL), 0) AS used`,
      [budget.project_id]
    );

    const { state, percent } = budgetState(toBudget(budget), Number(consumed.used));
    if (state === 'at_risk' || state === 'overrun') {
      crossed.push({
        budgetId: budget.id,
        projectId: budget.project_id,
        projectName: budget.project_name,
        ownerId: budget.owner_id,
        type: budget.type,
        state,
        percent,
      });
    }
  }

  if (crossed.length > 0) {
    await query(
      `UPDATE qodo_projects.budgets SET threshold_notified_at = now() WHERE id = ANY($1::uuid[])`,
      [crossed.map((row) => row.budgetId)]
    );
  }

  return crossed;
}

function badRequest(code) {
  return Object.assign(new Error(code), { status: 400, body: { error: code } });
}
