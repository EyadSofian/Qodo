/**
 * Qodo Projects — service-level agreements.
 *
 * An SLA is a promise about how fast something is answered and fixed, and the
 * only honest way to measure one is in *working* time. A four-hour response
 * target agreed at four o'clock on a Thursday is not breached at nine on
 * Friday morning — Friday is not a working day here, and a clock that counts it
 * turns a kept promise into a broken one on a report.
 *
 * So every calculation in this file runs through the project's work calendar,
 * the same one the Gantt schedules against.
 */

import { rows, row, query } from './db.js';
import * as audit from './auditService.js';
import { DEFAULT_WORKDAYS, isWorkingDay, makeCalendar } from './schedulingService.js';

const MINUTE_MS = 60_000;

/* ------------------------------------------------------------------ */
/* Working-time arithmetic                                              */
/* ------------------------------------------------------------------ */

/**
 * Add working minutes to an instant.
 *
 * Walks day by day, spending whatever of each working day is left. Deliberately
 * simple: a minute-accurate walk over months would be slower and no more
 * correct, because the thing being modelled — "four working hours from now" —
 * only ever spans a handful of days in practice.
 */
export function addWorkingMinutes(fromMs, minutes, calendar, dayStart = 540, dayEnd = 1020) {
  const dayMinutes = dayEnd - dayStart;
  if (dayMinutes <= 0 || minutes <= 0) return fromMs;

  let remaining = minutes;
  let cursor = new Date(fromMs);

  // Where in the working day this instant sits. Before it starts counts as the
  // start; after it ends spills to the next working day.
  let minuteOfDay = cursor.getUTCHours() * 60 + cursor.getUTCMinutes();
  if (minuteOfDay < dayStart) minuteOfDay = dayStart;

  for (let guard = 0; guard < 2000 && remaining > 0; guard += 1) {
    const dayMs = Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate());

    if (!isWorkingDay(dayMs, calendar) || minuteOfDay >= dayEnd) {
      cursor = new Date(dayMs + 86_400_000);
      minuteOfDay = dayStart;
      continue;
    }

    const availableToday = dayEnd - minuteOfDay;
    if (remaining <= availableToday) {
      return dayMs + (minuteOfDay + remaining) * MINUTE_MS;
    }

    remaining -= availableToday;
    cursor = new Date(dayMs + 86_400_000);
    minuteOfDay = dayStart;
  }

  // A calendar with no working days for two thousand iterations is a
  // configuration error; returning the input is better than looping forever.
  return fromMs;
}

async function calendarOf(organizationId, calendarId) {
  const found = await row(
    `SELECT id, workdays, day_start_minutes, day_end_minutes
       FROM qodo_projects.work_calendars
      WHERE organization_id = $1 AND (id = $2 OR ($2 IS NULL AND is_default))
      LIMIT 1`,
    [organizationId, calendarId ?? null]
  );

  const holidays = found
    ? (await rows('SELECT holiday_on FROM qodo_projects.calendar_holidays WHERE calendar_id = $1', [found.id]))
        .map((r) => String(r.holiday_on).slice(0, 10))
    : [];

  return {
    calendar: makeCalendar({ workdays: found?.workdays ?? DEFAULT_WORKDAYS, holidays }),
    dayStart: found?.day_start_minutes ?? 540,
    dayEnd: found?.day_end_minutes ?? 1020,
  };
}

/* ------------------------------------------------------------------ */
/* Policies                                                            */
/* ------------------------------------------------------------------ */

export async function policies(organizationId) {
  return (
    await rows(
      `SELECT * FROM qodo_projects.sla_policies
        WHERE organization_id = $1 AND is_active
        ORDER BY order_index, created_at`,
      [organizationId]
    )
  ).map(toPolicy);
}

function toPolicy(record) {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    criteria: record.criteria,
    match: record.match,
    calendarId: record.calendar_id,
    responseMinutes: record.response_minutes,
    resolutionMinutes: record.resolution_minutes,
    escalations: record.escalations,
    orderIndex: record.order_index,
    isActive: record.is_active,
  };
}

export async function createPolicy(user, organizationId, input) {
  const name = String(input?.name ?? '').trim();
  if (!name) throw badRequest('name_required');
  if (!input?.responseMinutes && !input?.resolutionMinutes) throw badRequest('sla_target_required');

  const created = await row(
    `INSERT INTO qodo_projects.sla_policies
       (organization_id, name, description, criteria, match, calendar_id,
        response_minutes, resolution_minutes, escalations, order_index, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      organizationId,
      name,
      String(input?.description ?? ''),
      JSON.stringify(input?.criteria ?? []),
      input?.match === 'any' ? 'any' : 'all',
      input?.calendarId ?? null,
      input?.responseMinutes ?? null,
      input?.resolutionMinutes ?? null,
      JSON.stringify(input?.escalations ?? []),
      Number(input?.orderIndex ?? 0),
      user.id,
    ]
  );

  await audit.record({
    actor: user,
    organizationId,
    entityType: 'sla_policy',
    entityId: created.id,
    action: 'sla.policy.create',
    after: { name, responseMinutes: created.response_minutes, resolutionMinutes: created.resolution_minutes },
  });

  return toPolicy(created);
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

/**
 * Does this issue match a policy's criteria?
 *
 * A closed vocabulary of operators, evaluated by our own code. Nothing stored
 * in `criteria` is ever executed — the same rule the layout-rule and custom-view
 * engines follow, and the line that separates configuration from a scripting
 * hole.
 */
export function matches(issue, criteria, match = 'all') {
  const conditions = Array.isArray(criteria) ? criteria : [];
  if (conditions.length === 0) return true;

  const test = (condition) => {
    const actual = issue?.[condition.field];
    const expected = condition.value;
    switch (condition.operator) {
      case 'eq':
        return actual === expected;
      case 'ne':
        return actual !== expected;
      case 'in':
        return Array.isArray(expected) && expected.includes(actual);
      case 'not_in':
        return Array.isArray(expected) && !expected.includes(actual);
      case 'gte':
        return actual >= expected;
      case 'lte':
        return actual <= expected;
      case 'contains':
        return String(actual ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase());
      default:
        // An operator we do not understand must not silently match everything.
        return false;
    }
  };

  return match === 'any' ? conditions.some(test) : conditions.every(test);
}

/**
 * The first policy that applies, in order.
 *
 * First match wins, which is why `order_index` exists: an organization wants
 * "blockers get one hour" evaluated before "everything gets two days", and
 * ordering is how they say so.
 */
export async function policyFor(organizationId, issue) {
  for (const policy of await policies(organizationId)) {
    if (matches(issue, policy.criteria, policy.match)) return policy;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Clocks                                                              */
/* ------------------------------------------------------------------ */

/**
 * Start the clock on a newly reported issue.
 *
 * Does nothing when no policy matches — an issue with no SLA is the normal
 * case, and inventing a target for it would put a deadline on a report that
 * nobody promised anything about.
 */
export async function startClock(context, issue) {
  const policy = await policyFor(context.organizationId, issue);
  if (!policy) return null;

  const { calendar, dayStart, dayEnd } = await calendarOf(context.organizationId, policy.calendarId);
  const now = Date.now();

  const responseDue = policy.responseMinutes
    ? new Date(addWorkingMinutes(now, policy.responseMinutes, calendar, dayStart, dayEnd))
    : null;
  const resolutionDue = policy.resolutionMinutes
    ? new Date(addWorkingMinutes(now, policy.resolutionMinutes, calendar, dayStart, dayEnd))
    : null;

  const clock = await row(
    `INSERT INTO qodo_projects.sla_clocks
       (issue_id, organization_id, policy_id, response_due_at, resolution_due_at)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (issue_id) DO UPDATE
       SET policy_id = EXCLUDED.policy_id,
           response_due_at = EXCLUDED.response_due_at,
           resolution_due_at = EXCLUDED.resolution_due_at
     RETURNING *`,
    [issue.id, context.organizationId, policy.id, responseDue, resolutionDue]
  );

  return toClock(clock);
}

export async function clockFor(issueId) {
  const found = await row('SELECT * FROM qodo_projects.sla_clocks WHERE issue_id = $1', [issueId]);
  return found ? toClock(found) : null;
}

function toClock(record) {
  return {
    issueId: record.issue_id,
    policyId: record.policy_id,
    startedAt: record.started_at,
    pausedAt: record.paused_at,
    pausedMs: Number(record.paused_ms ?? 0),
    responseDueAt: record.response_due_at,
    resolutionDueAt: record.resolution_due_at,
    respondedAt: record.responded_at,
    resolvedAt: record.resolved_at,
    responseBreachedAt: record.response_breached_at,
    resolutionBreachedAt: record.resolution_breached_at,
    escalationLevel: record.escalation_level,
  };
}

/** The first reply stops the response clock. Only the first — that is the promise. */
export async function markResponded(issueId) {
  return row(
    `UPDATE qodo_projects.sla_clocks
        SET responded_at = COALESCE(responded_at, now())
      WHERE issue_id = $1 RETURNING *`,
    [issueId]
  );
}

export async function markResolved(issueId) {
  return row(
    `UPDATE qodo_projects.sla_clocks
        SET resolved_at = COALESCE(resolved_at, now()),
            responded_at = COALESCE(responded_at, now())
      WHERE issue_id = $1 RETURNING *`,
    [issueId]
  );
}

/**
 * Stop and restart the clock.
 *
 * "Waiting on the customer" must not count against us, so pausing banks the
 * elapsed time and resuming pushes both targets out by exactly that much.
 * Without this every SLA report is a measure of how quickly customers answer
 * email.
 */
export async function pauseClock(issueId) {
  return row(
    `UPDATE qodo_projects.sla_clocks
        SET paused_at = COALESCE(paused_at, now())
      WHERE issue_id = $1 AND resolved_at IS NULL RETURNING *`,
    [issueId]
  );
}

export async function resumeClock(issueId) {
  return row(
    `UPDATE qodo_projects.sla_clocks
        SET paused_ms = paused_ms + EXTRACT(EPOCH FROM (now() - paused_at)) * 1000,
            response_due_at = response_due_at + (now() - paused_at),
            resolution_due_at = resolution_due_at + (now() - paused_at),
            paused_at = NULL
      WHERE issue_id = $1 AND paused_at IS NOT NULL RETURNING *`,
    [issueId]
  );
}

/**
 * Everything that has gone past its target and not been recorded as breached.
 *
 * Called by the scheduler. Marking the breach is what makes it reportable and
 * what stops the same breach being announced every time the clock ticks.
 */
export async function sweepBreaches(organizationId) {
  const responses = await rows(
    `UPDATE qodo_projects.sla_clocks
        SET response_breached_at = now()
      WHERE organization_id = $1
        AND paused_at IS NULL
        AND responded_at IS NULL
        AND response_breached_at IS NULL
        AND response_due_at < now()
      RETURNING issue_id, policy_id`,
    [organizationId]
  );

  const resolutions = await rows(
    `UPDATE qodo_projects.sla_clocks
        SET resolution_breached_at = now()
      WHERE organization_id = $1
        AND paused_at IS NULL
        AND resolved_at IS NULL
        AND resolution_breached_at IS NULL
        AND resolution_due_at < now()
      RETURNING issue_id, policy_id`,
    [organizationId]
  );

  return { response: responses, resolution: resolutions };
}

/**
 * Move breached clocks up their escalation ladder.
 *
 * Returns who should be told, rather than telling them: notification is the
 * caller's job, and a service that both decides and notifies leaves nowhere to
 * ask "should this go out at 2am".
 */
export async function dueEscalations(organizationId) {
  const clocks = await rows(
    `SELECT c.*, p.escalations, i.title, i.key, i.project_id, i.assignee_id
       FROM qodo_projects.sla_clocks c
       JOIN qodo_projects.sla_policies p ON p.id = c.policy_id
       JOIN qodo_projects.issues i ON i.id = c.issue_id
      WHERE c.organization_id = $1
        AND c.resolved_at IS NULL
        AND c.paused_at IS NULL
        AND (c.response_breached_at IS NOT NULL OR c.resolution_breached_at IS NOT NULL)`,
    [organizationId]
  );

  const due = [];
  for (const clock of clocks) {
    const ladder = Array.isArray(clock.escalations) ? clock.escalations : [];
    const breachedAt = clock.resolution_breached_at ?? clock.response_breached_at;
    const minutesSince = (Date.now() - new Date(breachedAt).getTime()) / MINUTE_MS;

    const nextLevel = clock.escalation_level;
    const step = ladder[nextLevel];
    if (!step) continue;
    if (minutesSince < Number(step.afterMinutes ?? 0)) continue;

    due.push({
      issueId: clock.issue_id,
      issueKey: clock.key,
      title: clock.title,
      projectId: clock.project_id,
      level: nextLevel + 1,
      notify: step.notify ?? [],
      assignTo: step.assignTo ?? null,
    });
  }

  return due;
}

export async function recordEscalation(issueId, level) {
  await query(
    `UPDATE qodo_projects.sla_clocks
        SET escalation_level = $2, last_escalated_at = now()
      WHERE issue_id = $1`,
    [issueId, level]
  );
}

function badRequest(code) {
  return Object.assign(new Error(code), { status: 400, body: { error: code } });
}
