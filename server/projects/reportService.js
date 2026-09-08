/**
 * Qodo Projects — the report engine.
 *
 * One engine over every module, driven by a report *definition*: what to count,
 * how to group it, what to filter by. A saved report stores that definition and
 * never a result set — rows frozen at save time would describe a project as it
 * was, and the whole value of a report is that it is current.
 *
 * The security property that shapes this file: **a report is a query somebody
 * else wrote.** Group-by fields, measures and aggregates are matched against
 * allowlists and turned into SQL by *us*; nothing from a definition is ever
 * interpolated. A report builder that concatenates a column name is a SQL
 * injection with a chart on top.
 */

import { rows, row } from './db.js';
import { resolveRange } from './criteria.js';
import { may, visibleProjectIds } from './projectAccess.js';
import { find } from '../store.js';

/* ------------------------------------------------------------------ */
/* The allowlists                                                       */
/* ------------------------------------------------------------------ */

/**
 * What a report may group by, per module, and the SQL each name means.
 *
 * The map is the allowlist. A `groupBy` that is not a key here is refused
 * rather than passed through, so no definition can name a column, a subquery or
 * anything else.
 *
 * `sql` may be a function of the reader's language. Only the entries that group
 * by a *human-written label* need it — a status is stored in both languages, so
 * grouping by `label_en` produced a report that said "Done" and "In progress"
 * down the side of an Arabic screen. Everything else here groups by a name, a
 * date or an enum key the interface translates for itself, and stays a plain
 * string.
 */
const statusLabel = (lang) =>
  lang === 'en'
    ? "COALESCE(s.label_en, s.label_ar, 'No status')"
    : "COALESCE(s.label_ar, s.label_en, 'بدون حالة')";
const GROUPINGS = {
  task: {
    status: { sql: statusLabel, join: 'status' },
    // Priority is deliberately absent. It lives on the task *document*, not the
    // extension table (ADR-3), so it cannot be grouped in SQL — and offering an
    // option that always fails is worse than not offering it.
    phase: { sql: "COALESCE(ph.name, 'No phase')", join: 'phase' },
    task_list: { sql: "COALESCE(tl.name, 'No list')", join: 'list' },
    project: { sql: 'p.name', join: 'project' },
    assignee: { sql: "COALESCE(a.user_id, 'Unassigned')", join: 'assignee' },
    month: { sql: "to_char(t.created_at, 'YYYY-MM')" },
    due_month: { sql: "to_char(t.end_date, 'YYYY-MM')" },
  },
  issue: {
    status: { sql: statusLabel, join: 'status' },
    severity: { sql: 'i.severity' },
    priority: { sql: 'i.priority' },
    assignee: { sql: "COALESCE(i.assignee_id, 'Unassigned')" },
    reporter: { sql: 'i.reporter_id' },
    project: { sql: 'p.name', join: 'project' },
    month: { sql: "to_char(i.created_at, 'YYYY-MM')" },
  },
  time_log: {
    user: { sql: 'e.user_id' },
    project: { sql: 'p.name', join: 'project' },
    billable: { sql: "CASE WHEN e.is_billable THEN 'Billable' ELSE 'Non-billable' END" },
    approval: { sql: 'e.approval_status' },
    day: { sql: "to_char(e.log_date, 'YYYY-MM-DD')" },
    month: { sql: "to_char(e.log_date, 'YYYY-MM')" },
  },
};

/** What a report may measure, and how. */
const MEASURES = {
  task: {
    count: 'count(*)',
    estimated_hours: 'COALESCE(sum(t.estimated_hours), 0)',
    actual_hours: 'COALESCE(sum(t.actual_hours), 0)',
    progress: 'COALESCE(round(avg(t.progress)), 0)',
  },
  issue: {
    count: 'count(*)',
  },
  time_log: {
    count: 'count(*)',
    hours: 'COALESCE(sum(e.hours), 0)',
    // Cost is only ever visible to somebody with `rate.view`; the caller checks
    // before it reaches here, and `availableMeasures` hides it in the builder.
    cost: 'COALESCE(sum(e.hours * COALESCE(e.cost_rate, 0)), 0)',
    billable_amount: 'COALESCE(sum(e.hours * COALESCE(e.bill_rate, 0)) FILTER (WHERE e.is_billable), 0)',
  },
};

/** The date column each module is filtered on, by name. */
const DATE_FIELDS = {
  task: { created: 't.created_at::date', due: 't.end_date', start: 't.start_date' },
  issue: { created: 'i.created_at::date', due: 'i.due_date', closed: 'i.closed_at::date' },
  time_log: { logged: 'e.log_date' },
};

/** Which measures this person may ask for. */
export function availableMeasures(context, moduleKey) {
  const all = Object.keys(MEASURES[moduleKey] ?? {});
  if (may(context, 'rate.view')) return all;
  // Money is a rate question. Somebody who may not see a colleague's rate must
  // not be able to derive it by grouping cost by user.
  return all.filter((measure) => measure !== 'cost' && measure !== 'billable_amount');
}

export function availableGroupings(moduleKey) {
  return Object.keys(GROUPINGS[moduleKey] ?? {});
}

/* ------------------------------------------------------------------ */
/* Running a report                                                     */
/* ------------------------------------------------------------------ */

/**
 * Run one report definition and return its rows.
 *
 * `scope` is either a single project or the portfolio; either way the set of
 * projects is resolved from membership first, so a portfolio report is the
 * union of what this person may see and never more.
 */
export async function run(user, context, definition) {
  const moduleKey = String(definition?.module ?? 'task');
  if (!GROUPINGS[moduleKey]) throw badRequest('module_not_reportable');

  const found = GROUPINGS[moduleKey][definition?.groupBy];
  if (!found) throw badRequest('group_by_not_allowed');

  // Resolve a language-dependent grouping before it reaches the query builder,
  // so everything downstream still receives a plain `{ sql, join }`.
  //
  // English is the default because it is what this endpoint already returned:
  // a caller that does not ask for a language gets exactly the buckets it got
  // before. The browser opts in by sending one, which is the right way round —
  // the server does not know who is reading, and the client does.
  const lang = definition?.lang === 'ar' ? 'ar' : 'en';
  const grouping = typeof found.sql === 'function' ? { ...found, sql: found.sql(lang) } : found;

  const measureKey = String(definition?.measure ?? 'count');
  const measure = MEASURES[moduleKey]?.[measureKey];
  if (!measure) throw badRequest('measure_not_allowed');
  if (
    ['cost', 'billable_amount'].includes(measureKey) &&
    !(context ? may(context, 'rate.view') : false)
  ) {
    throw forbidden('rate.view');
  }

  // Membership decides the universe before anything else narrows it.
  const projectIds = context
    ? [context.project.id]
    : await visibleProjectIds(user, { includeArchived: Boolean(definition?.includeArchived) });
  if (projectIds.length === 0) return { rows: [], total: 0, groupBy: definition.groupBy, measure: measureKey };

  const params = [projectIds];
  const conditions = [];

  const built = buildFrom(moduleKey, grouping, params, conditions, context);

  // Date range, resolved now rather than stored — a saved "last 7 days" has to
  // keep meaning that.
  const dateColumn = DATE_FIELDS[moduleKey]?.[definition?.dateField];
  if (dateColumn && definition?.dateRange) {
    const range = Array.isArray(definition.dateRange)
      ? definition.dateRange
      : resolveRange(definition.dateRange);
    if (range) {
      const [from, to] = range;
      if (from) {
        params.push(from);
        conditions.push(`${dateColumn} >= $${params.length}`);
      }
      if (to) {
        params.push(to);
        conditions.push(`${dateColumn} <= $${params.length}`);
      }
    }
  }

  const where = [built.baseWhere, ...conditions].filter(Boolean).join(' AND ');

  const results = await rows(
    `SELECT ${grouping.sql} AS bucket, ${measure} AS value
       FROM ${built.from}
      WHERE ${where}
      GROUP BY 1
      ORDER BY 2 DESC, 1
      LIMIT 200`,
    params
  );

  return {
    groupBy: definition.groupBy,
    measure: measureKey,
    rows: results.map((record) => ({ bucket: record.bucket, value: Number(record.value) })),
    total: results.reduce((sum, record) => sum + Number(record.value), 0),
  };
}

/**
 * The FROM clause for a module, with only the joins the grouping needs.
 *
 * Joining everything unconditionally would make a count of tasks by priority
 * pay for a join to assignees — and a task with three assignees would then be
 * counted three times, which is the classic way a report quietly lies.
 */
function buildFrom(moduleKey, grouping, params, conditions, context) {
  const needs = grouping.join;

  if (moduleKey === 'task') {
    const joins = [
      'qodo_projects.project_task_extensions t',
      "LEFT JOIN qodo_projects.statuses s ON s.id = t.status_id",
    ];
    if (needs === 'phase') joins.push('LEFT JOIN qodo_projects.phases ph ON ph.id = t.phase_id');
    if (needs === 'list') joins.push('LEFT JOIN qodo_projects.task_lists tl ON tl.id = t.task_list_id');
    if (needs === 'project') joins.push('JOIN qodo_projects.projects p ON p.id = t.project_id');
    if (needs === 'assignee') {
      joins.push(
        "LEFT JOIN qodo_projects.task_assignees a ON a.task_id = t.task_id AND a.kind = 'assignee'"
      );
    }
    // A client never sees tasks in an internal list, in a report either.
    if (context?.isClient) {
      joins.push(
        'JOIN qodo_projects.task_lists ctl ON ctl.id = t.task_list_id AND ctl.is_external = true'
      );
    }

    return {
      from: joins.join(' '),
      baseWhere: 't.project_id = ANY($1::uuid[]) AND t.deleted_at IS NULL',
    };
  }

  if (moduleKey === 'issue') {
    const joins = [
      'qodo_projects.issues i',
      'LEFT JOIN qodo_projects.statuses s ON s.id = i.status_id',
    ];
    if (needs === 'project') joins.push('JOIN qodo_projects.projects p ON p.id = i.project_id');
    return {
      from: joins.join(' '),
      baseWhere:
        'i.project_id = ANY($1::uuid[]) AND i.deleted_at IS NULL' +
        (context?.isClient ? ' AND i.is_external = true' : ''),
    };
  }

  const joins = ['qodo_projects.time_entries e'];
  if (needs === 'project') joins.push('JOIN qodo_projects.projects p ON p.id = e.project_id');
  return { from: joins.join(' '), baseWhere: 'e.project_id = ANY($1::uuid[])' };
}

/* ------------------------------------------------------------------ */
/* Fixed reports                                                        */
/* ------------------------------------------------------------------ */

/**
 * The portfolio: every project this person may see, with the numbers that say
 * whether it is alright.
 *
 * One query with lateral aggregates rather than N+1 per project — a portfolio
 * of forty projects must not be forty-one round trips.
 */
export async function portfolio(user, options = {}) {
  const projectIds = await visibleProjectIds(user, { includeArchived: Boolean(options.includeArchived) });
  if (projectIds.length === 0) {
    return { projects: [], summary: { total: 0, atRisk: 0, delayed: 0, overdueTasks: 0 } };
  }

  const found = await rows(
    `SELECT p.id, p.key, p.name, p.owner_id, p.start_date, p.end_date, p.currency,
            s.label_en AS status, s.label_ar AS status_label_ar, s.label_en AS status_label_en,
            s.category AS status_category, s.color AS status_color,
            c.name AS customer_name,
            work.task_count, work.done_count, work.overdue_count, work.progress,
            spend.actual_hours, spend.actual_cost,
            plan.budget_hours, plan.budget_amount
       FROM qodo_projects.projects p
       LEFT JOIN qodo_projects.statuses s ON s.id = p.status_id
       LEFT JOIN qodo_projects.customers c ON c.id = p.customer_id
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS task_count,
                count(*) FILTER (WHERE ts.category = 'done')::int AS done_count,
                count(*) FILTER (
                  WHERE t.end_date < CURRENT_DATE AND COALESCE(ts.category, 'active') <> 'done'
                )::int AS overdue_count,
                COALESCE(round(avg(t.progress)), 0)::int AS progress
           FROM qodo_projects.project_task_extensions t
           LEFT JOIN qodo_projects.statuses ts ON ts.id = t.status_id
          WHERE t.project_id = p.id AND t.deleted_at IS NULL
       ) work ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(sum(hours), 0) AS actual_hours,
                COALESCE(sum(hours * COALESCE(cost_rate, 0)), 0) AS actual_cost
           FROM qodo_projects.time_entries WHERE project_id = p.id
       ) spend ON true
       LEFT JOIN LATERAL (
         SELECT max(hours) AS budget_hours, max(amount) AS budget_amount
           FROM qodo_projects.budgets WHERE project_id = p.id AND phase_id IS NULL
       ) plan ON true
      WHERE p.id = ANY($1::uuid[]) AND p.deleted_at IS NULL
      ORDER BY p.updated_at DESC`,
    [projectIds]
  );

  const shaped = found.map((record) => {
    const budgetHours = record.budget_hours === null ? null : Number(record.budget_hours);
    const actualHours = Number(record.actual_hours ?? 0);
    const overdue = Number(record.overdue_count ?? 0);

    // "Delayed" is a fact about the calendar; "at risk" is a judgement, and it
    // is stated here rather than left implicit so the same words mean the same
    // thing on every screen.
    const delayed = Boolean(
      record.end_date &&
        record.status_category !== 'done' &&
        String(record.end_date) < new Date().toISOString().slice(0, 10)
    );
    const overBudget = budgetHours !== null && budgetHours > 0 && actualHours > budgetHours;

    return {
      id: record.id,
      key: record.key,
      name: record.name,
      ownerId: record.owner_id,
      customerName: record.customer_name,
      // `status` stays the English string it has always been so nothing that
      // reads this endpoint breaks. `statusLabel` is the pair the interface
      // should render: the portfolio table was printing `label_en` into an
      // Arabic-first screen, so every row said "On hold" and "Completed" in the
      // middle of Arabic text.
      status: record.status,
      statusLabel: record.status_label_ar
        ? { ar: record.status_label_ar, en: record.status_label_en }
        : null,
      statusCategory: record.status_category,
      statusColor: record.status_color,
      startDate: record.start_date,
      endDate: record.end_date,
      taskCount: Number(record.task_count ?? 0),
      doneCount: Number(record.done_count ?? 0),
      overdueTasks: overdue,
      progress: Number(record.progress ?? 0),
      actualHours,
      // Null rather than zero when nothing has been measured — the same rule
      // the budget service follows.
      budgetHours,
      actualCost: Number(record.actual_cost ?? 0) || null,
      budgetAmount: record.budget_amount === null ? null : Number(record.budget_amount),
      delayed,
      atRisk: delayed || overBudget || overdue > 0,
    };
  });

  return {
    projects: shaped,
    summary: {
      total: shaped.length,
      atRisk: shaped.filter((project) => project.atRisk).length,
      delayed: shaped.filter((project) => project.delayed).length,
      overdueTasks: shaped.reduce((sum, project) => sum + project.overdueTasks, 0),
    },
  };
}

/**
 * Who is carrying how much, and against what capacity.
 *
 * §53 is explicit that a task count is not capacity. This measures assigned
 * *hours* against working hours in the window, and reports `null` capacity when
 * there is no calendar to measure against rather than inventing one.
 */
export async function workload(user, { from, to }) {
  const projectIds = await visibleProjectIds(user);
  if (projectIds.length === 0) return { people: [], from, to };

  const assigned = await rows(
    `SELECT a.user_id,
            count(*)::int AS task_count,
            COALESCE(sum(t.estimated_hours), 0) AS assigned_hours,
            count(*) FILTER (
              WHERE t.end_date < CURRENT_DATE AND COALESCE(s.category, 'active') <> 'done'
            )::int AS overdue_count
       FROM qodo_projects.task_assignees a
       JOIN qodo_projects.project_task_extensions t ON t.task_id = a.task_id
       LEFT JOIN qodo_projects.statuses s ON s.id = t.status_id
      WHERE t.project_id = ANY($1::uuid[])
        AND t.deleted_at IS NULL
        AND a.kind IN ('assignee', 'contributor')
        AND COALESCE(s.category, 'active') NOT IN ('done', 'cancelled')
        AND ($2::date IS NULL OR t.end_date >= $2)
        AND ($3::date IS NULL OR t.start_date <= $3)
      GROUP BY a.user_id
      ORDER BY 3 DESC`,
    [projectIds, from ?? null, to ?? null]
  );

  const logged = await rows(
    `SELECT user_id, COALESCE(sum(hours), 0) AS logged_hours
       FROM qodo_projects.time_entries
      WHERE project_id = ANY($1::uuid[])
        AND ($2::date IS NULL OR log_date >= $2)
        AND ($3::date IS NULL OR log_date <= $3)
      GROUP BY user_id`,
    [projectIds, from ?? null, to ?? null]
  );

  const loggedBy = new Map(logged.map((record) => [record.user_id, Number(record.logged_hours)]));

  /**
   * A workload chart needs names.
   *
   * It used to return `userId` alone and the browser rendered it, so the chart
   * was five bars labelled with truncated uuids — technically a workload
   * report, practically unreadable. Resolved here rather than in the browser
   * for the same reason the members list is: looking a person up from the
   * client would need `users.view`, and seeing who is busy on your own projects
   * should not require permission to read the staff directory.
   */
  const people = await find('users', (person) =>
    assigned.some((record) => record.user_id === person.id)
  );
  const byId = new Map(people.map((person) => [person.id, person]));

  return {
    from: from ?? null,
    to: to ?? null,
    people: assigned.map((record) => {
      const person = byId.get(record.user_id);
      return {
        userId: record.user_id,
        // Null for somebody whose account has since been removed — their hours
        // are still part of the history even when they are not.
        name: person?.name ?? null,
        title: person?.title ?? null,
        avatarColor: person?.avatarColor ?? null,
        taskCount: record.task_count,
        assignedHours: Number(record.assigned_hours) || null,
        loggedHours: loggedBy.get(record.user_id) ?? 0,
        overdueTasks: record.overdue_count,
      };
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Saved reports                                                        */
/* ------------------------------------------------------------------ */

export async function saved(user, organizationId, options = {}) {
  const found = await rows(
    `SELECT r.*, f.name AS folder_name
       FROM qodo_projects.saved_reports r
       LEFT JOIN qodo_projects.report_folders f ON f.id = r.folder_id
      WHERE r.organization_id = $1
        AND (r.owner_id = $2
             OR r.visibility = 'organization'
             OR (r.visibility = 'shared' AND r.shared_with @> $3::jsonb))
        ${options.moduleKey ? 'AND r.module_key = $4' : ''}
      ORDER BY f.name NULLS FIRST, r.name`,
    options.moduleKey
      ? [organizationId, user.id, JSON.stringify([user.id]), options.moduleKey]
      : [organizationId, user.id, JSON.stringify([user.id])]
  );

  return found.map((record) => ({
    id: record.id,
    name: record.name,
    description: record.description,
    moduleKey: record.module_key,
    folderId: record.folder_id,
    folderName: record.folder_name,
    definition: record.definition,
    visibility: record.visibility,
    ownerId: record.owner_id,
    isMine: record.owner_id === user.id,
  }));
}

export async function save(user, organizationId, input) {
  const name = String(input?.name ?? '').trim();
  if (!name) throw badRequest('name_required');

  const moduleKey = String(input?.module ?? input?.definition?.module ?? 'task');
  if (!GROUPINGS[moduleKey]) throw badRequest('module_not_reportable');

  // Validated at save time so a broken report is refused where it was written,
  // not discovered when somebody opens it in front of a client.
  const definition = input?.definition ?? {};
  if (!GROUPINGS[moduleKey][definition.groupBy]) throw badRequest('group_by_not_allowed');
  if (!MEASURES[moduleKey]?.[definition.measure ?? 'count']) throw badRequest('measure_not_allowed');

  const created = await row(
    `INSERT INTO qodo_projects.saved_reports
       (organization_id, folder_id, project_id, name, description, module_key,
        definition, visibility, shared_with, owner_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      organizationId,
      input?.folderId ?? null,
      input?.projectId ?? null,
      name,
      String(input?.description ?? ''),
      moduleKey,
      JSON.stringify({ ...definition, module: moduleKey }),
      ['private', 'shared', 'project', 'organization'].includes(input?.visibility)
        ? input.visibility
        : 'private',
      JSON.stringify(input?.sharedWith ?? []),
      user.id,
    ]
  );

  return { id: created.id, name: created.name, moduleKey: created.module_key };
}

export async function getSaved(user, organizationId, reportId) {
  const found = await row(
    `SELECT * FROM qodo_projects.saved_reports
      WHERE id = $1 AND organization_id = $2
        AND (owner_id = $3 OR visibility = 'organization'
             OR (visibility = 'shared' AND shared_with @> $4::jsonb))`,
    [reportId, organizationId, user.id, JSON.stringify([user.id])]
  );
  return found ? { id: found.id, name: found.name, definition: found.definition } : null;
}

function badRequest(code) {
  return Object.assign(new Error(code), { status: 400, body: { error: code } });
}
function forbidden(permission) {
  return Object.assign(new Error('forbidden'), {
    status: 403,
    body: { error: 'forbidden', missing: permission },
  });
}
