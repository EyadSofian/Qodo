/**
 * Qodo Projects — the automation engine.
 *
 * One engine for every module. Seven modules with the same
 * trigger → criteria → action shape is one engine parameterised by module, not
 * seven copies — `workflow_rules.module_key` is data, never a `switch`.
 *
 * Three properties this file exists to guarantee:
 *
 * **Idempotent.** Automation runs at least once, so it must be safe to run
 * twice. Every run computes a key from what caused it, and the unique index on
 * `automation_runs.idempotency_key` means a retry after a crash inserts nothing
 * and does nothing.
 *
 * **Bounded.** An action that re-triggers its own rule is the classic failure.
 * Runs carry a depth, and a chain past `MAX_DEPTH` is stopped and recorded as
 * an error rather than left to run until somebody notices the bill.
 *
 * **Not executable.** Actions are a closed vocabulary handled by named
 * functions. There is no template that reaches a function and no expression to
 * evaluate.
 */

import crypto from 'node:crypto';
import { query, rows, row } from './db.js';
import * as audit from './auditService.js';
import { matches, validate as validateCriteria } from './criteria.js';

/**
 * How far a chain of automations may go before it is treated as a loop.
 *
 * Four is enough for "status change → assign → notify → tag" and short enough
 * that a genuine cycle is caught within a second.
 */
export const MAX_DEPTH = 4;

/**
 * Every action the engine can take.
 *
 * A closed set, and each one is a named function below. Adding an action is a
 * deliberate change in three places — this list, the handler, and a test — which
 * is the friction that keeps `run_script` from quietly becoming `eval`.
 */
export const ACTION_TYPES = [
  'update_field',
  'assign',
  'add_tag',
  'remove_tag',
  'notify',
  'create_task',
  'create_issue',
  'webhook',
  'set_status',
];

/* ------------------------------------------------------------------ */
/* Rules                                                                */
/* ------------------------------------------------------------------ */

export async function rules(organizationId, moduleKey, trigger) {
  const params = [organizationId, moduleKey];
  let triggerFilter = '';
  if (trigger) {
    params.push(trigger);
    triggerFilter = `AND trigger = $${params.length}`;
  }

  return (
    await rows(
      `SELECT * FROM qodo_projects.workflow_rules
        WHERE organization_id = $1 AND module_key = $2 AND is_active ${triggerFilter}
        ORDER BY order_index, created_at`,
      params
    )
  ).map(toRule);
}

function toRule(record) {
  return {
    id: record.id,
    moduleKey: record.module_key,
    projectId: record.project_id,
    name: record.name,
    description: record.description,
    trigger: record.trigger,
    triggerField: record.trigger_field,
    criteria: record.criteria,
    match: record.match,
    actions: record.actions,
    schedule: record.schedule,
    isActive: record.is_active,
    orderIndex: record.order_index,
  };
}

/**
 * Save a rule, refusing one that cannot fire.
 *
 * The criteria and the actions are validated here so an administrator learns
 * about a typo when they make it, rather than the first time the rule silently
 * does nothing — which is the failure mode of every automation system that
 * accepts anything.
 */
export async function createRule(user, organizationId, input) {
  const name = String(input?.name ?? '').trim();
  if (!name) throw badRequest('name_required');

  const criteriaProblems = validateCriteria(input?.criteria);
  if (criteriaProblems.length > 0) {
    throw Object.assign(new Error('criteria_invalid'), {
      status: 400,
      body: { error: 'criteria_invalid', problems: criteriaProblems },
    });
  }

  const actions = Array.isArray(input?.actions) ? input.actions : [];
  const unknown = actions.filter((action) => !ACTION_TYPES.includes(action?.type));
  if (unknown.length > 0) {
    throw Object.assign(new Error('action_unknown'), {
      status: 400,
      body: { error: 'action_unknown', actions: unknown.map((action) => action?.type ?? null) },
    });
  }
  if (actions.length === 0) throw badRequest('actions_required');

  const created = await row(
    `INSERT INTO qodo_projects.workflow_rules
       (organization_id, module_key, project_id, name, description, trigger,
        trigger_field, criteria, match, actions, schedule, order_index, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [
      organizationId,
      String(input?.moduleKey ?? 'task'),
      input?.projectId ?? null,
      name,
      String(input?.description ?? ''),
      String(input?.trigger ?? 'update'),
      input?.triggerField ?? null,
      JSON.stringify(input?.criteria ?? []),
      input?.match === 'any' ? 'any' : 'all',
      JSON.stringify(actions),
      input?.schedule ? JSON.stringify(input.schedule) : null,
      Number(input?.orderIndex ?? 0),
      user.id,
    ]
  );

  await audit.record({
    actor: user,
    organizationId,
    entityType: 'workflow_rule',
    entityId: created.id,
    action: 'automation.rule.create',
    after: { name, trigger: created.trigger, module: created.module_key, actions: actions.length },
  });

  return toRule(created);
}

export async function setRuleActive(user, organizationId, ruleId, isActive) {
  const updated = await row(
    `UPDATE qodo_projects.workflow_rules SET is_active = $3
      WHERE id = $1 AND organization_id = $2 RETURNING *`,
    [ruleId, organizationId, Boolean(isActive)]
  );
  if (!updated) return null;

  await audit.record({
    actor: user,
    organizationId,
    entityType: 'workflow_rule',
    entityId: ruleId,
    action: isActive ? 'automation.rule.enable' : 'automation.rule.disable',
    after: { isActive: updated.is_active },
  });

  return toRule(updated);
}

/* ------------------------------------------------------------------ */
/* Running                                                              */
/* ------------------------------------------------------------------ */

/**
 * The key that makes a retry a no-op.
 *
 * Built from the rule, the record and what happened to it — not from the clock,
 * because a retry happens at a different moment and must still collide.
 */
export function idempotencyKey({ ruleId, entityType, entityId, trigger, fingerprint }) {
  return crypto
    .createHash('sha256')
    .update([ruleId, entityType, entityId, trigger, fingerprint ?? ''].join('|'))
    .digest('hex');
}

/**
 * Evaluate every rule for one event and apply what matches.
 *
 * `dryRun` returns what *would* happen without doing it — §26's test mode, and
 * the only sane way to write a rule against production data. `depth` is carried
 * through so an action that triggers another rule cannot recurse for ever.
 *
 * The `apply` callback is how this stays free of every service: the engine
 * decides what should happen, the caller knows how to do it. That is also what
 * makes the engine testable without a task, an issue or a database of them.
 */
export async function runFor({
  organizationId,
  projectId = null,
  moduleKey,
  trigger,
  record,
  previous = null,
  user,
  apply,
  depth = 0,
  dryRun = false,
}) {
  if (depth > MAX_DEPTH) {
    // Stopped, and *recorded* as stopped. An automation loop that silently
    // stops looks identical to one that finished, and the difference matters
    // when somebody asks why a field never updated.
    await record_run({
      organizationId,
      projectId,
      ruleType: 'workflow',
      ruleId: null,
      entityType: moduleKey,
      entityId: record?.id,
      trigger,
      status: 'failed',
      error: `automation depth limit (${MAX_DEPTH}) reached — a rule chain is looping`,
      depth,
      key: idempotencyKey({
        ruleId: 'depth-limit',
        entityType: moduleKey,
        entityId: record?.id,
        trigger,
        fingerprint: String(depth),
      }),
    });
    return { applied: [], stopped: 'depth_limit' };
  }

  const candidates = await rules(organizationId, moduleKey, trigger);
  const applied = [];

  for (const rule of candidates) {
    // A rule scoped to one project does not fire on another's records.
    if (rule.projectId && rule.projectId !== projectId) continue;
    if (rule.trigger === 'field_change' && rule.triggerField) {
      const before = previous?.[rule.triggerField];
      if (before === record?.[rule.triggerField]) continue;
    }
    if (!matches(record, rule.criteria, rule.match, previous)) continue;

    const key = idempotencyKey({
      ruleId: rule.id,
      entityType: moduleKey,
      entityId: record?.id,
      trigger,
      // What actually changed. Two different edits to the same record must not
      // collide, but the *same* edit retried must.
      fingerprint: fingerprintOf(record, previous),
    });

    if (dryRun) {
      applied.push({ ruleId: rule.id, ruleName: rule.name, actions: rule.actions, dryRun: true });
      continue;
    }

    const claimed = await claim(organizationId, key);
    if (!claimed) {
      // Somebody already ran this exact rule for this exact change.
      continue;
    }

    try {
      const performed = [];
      for (const action of rule.actions) {
        if (!ACTION_TYPES.includes(action?.type)) continue;
        const result = await apply(action, { record, previous, rule, depth: depth + 1, user });
        performed.push({ type: action.type, result: result ?? null });
      }

      await record_run({
        organizationId,
        projectId,
        ruleType: 'workflow',
        ruleId: rule.id,
        entityType: moduleKey,
        entityId: record?.id,
        trigger,
        status: 'applied',
        actionsApplied: performed,
        depth,
        key,
        claimed: true,
      });

      applied.push({ ruleId: rule.id, ruleName: rule.name, actions: performed });
    } catch (error) {
      await record_run({
        organizationId,
        projectId,
        ruleType: 'workflow',
        ruleId: rule.id,
        entityType: moduleKey,
        entityId: record?.id,
        trigger,
        status: 'failed',
        error: error.message,
        depth,
        key,
        claimed: true,
      });
      // One rule failing must not stop the rest. They are independent
      // statements about the same event, not a sequence.
      console.error('[projects:automation] rule failed', rule.name, error.message);
    }
  }

  return { applied, stopped: null };
}

/**
 * What changed, as a short stable string.
 *
 * Two different edits must produce different keys or the second one is
 * swallowed as a duplicate; the same edit retried must produce the same one.
 */
function fingerprintOf(record, previous) {
  if (!previous) return 'created';
  const changed = Object.keys(record ?? {})
    .filter((field) => JSON.stringify(record[field]) !== JSON.stringify(previous[field]))
    .sort();
  return changed.length === 0 ? 'nochange' : changed.join(',');
}

/**
 * Take the run, or discover somebody already has.
 *
 * `ON CONFLICT DO NOTHING` on the unique key is the whole mechanism: the first
 * caller inserts and proceeds, every retry inserts nothing and stops.
 */
async function claim(organizationId, key) {
  const { rowCount } = await query(
    `INSERT INTO qodo_projects.automation_runs
       (organization_id, rule_type, entity_type, entity_id, status, idempotency_key)
     VALUES ($1, 'workflow', 'pending', 'pending', 'skipped', $2)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [organizationId, key]
  );
  return rowCount > 0;
}

async function record_run({
  organizationId,
  projectId,
  ruleType,
  ruleId,
  entityType,
  entityId,
  trigger,
  status,
  actionsApplied = [],
  error = null,
  depth = 0,
  key,
  claimed = false,
}) {
  const values = [
    organizationId,
    projectId,
    ruleType,
    ruleId,
    entityType,
    String(entityId ?? ''),
    trigger ?? null,
    status,
    JSON.stringify(actionsApplied),
    error,
    depth,
    key,
  ];

  if (claimed) {
    // The row was inserted by `claim` as a placeholder; fill it in.
    await query(
      `UPDATE qodo_projects.automation_runs
          SET project_id = $2, rule_type = $3, rule_id = $4, entity_type = $5,
              entity_id = $6, trigger = $7, status = $8, actions_applied = $9,
              error = $10, depth = $11
        WHERE idempotency_key = $12 AND organization_id = $1`,
      values
    );
    return;
  }

  await query(
    `INSERT INTO qodo_projects.automation_runs
       (organization_id, project_id, rule_type, rule_id, entity_type, entity_id,
        trigger, status, actions_applied, error, depth, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    values
  );
}

export async function runHistory(organizationId, options = {}) {
  return rows(
    `SELECT id, project_id, rule_type, rule_id, entity_type, entity_id, trigger,
            status, actions_applied, error, depth, ran_at
       FROM qodo_projects.automation_runs
      WHERE organization_id = $1
        ${options.ruleId ? 'AND rule_id = $3' : ''}
      ORDER BY ran_at DESC
      LIMIT $2`,
    options.ruleId
      ? [organizationId, Math.min(200, Number(options.limit) || 50), options.ruleId]
      : [organizationId, Math.min(200, Number(options.limit) || 50)]
  );
}

/* ------------------------------------------------------------------ */
/* Business rules                                                       */
/* ------------------------------------------------------------------ */

/**
 * Ordered rules, evaluated top to bottom, any of which may stop the rest.
 *
 * Distinct from workflow rules and Zoho keeps them distinct for a reason: the
 * subtlety here is entirely in the ordering. "Blockers go to the lead" before
 * "everything goes to the queue", with the first stopping the second, is a
 * sentence that only means something if order is honoured.
 */
export async function businessRules(organizationId, moduleKey) {
  return (
    await rows(
      `SELECT * FROM qodo_projects.business_rules
        WHERE organization_id = $1 AND module_key = $2 AND is_active
        ORDER BY order_index, created_at`,
      [organizationId, moduleKey]
    )
  ).map((record) => ({
    id: record.id,
    name: record.name,
    criteria: record.criteria,
    match: record.match,
    actions: record.actions,
    stopProcessing: record.stop_processing,
    orderIndex: record.order_index,
  }));
}

export async function runBusinessRules({ organizationId, moduleKey, record, previous, apply, dryRun = false }) {
  const applied = [];

  for (const rule of await businessRules(organizationId, moduleKey)) {
    if (!matches(record, rule.criteria, rule.match, previous)) continue;

    if (!dryRun) {
      for (const action of rule.actions ?? []) {
        if (!ACTION_TYPES.includes(action?.type)) continue;
        await apply(action, { record, previous, rule });
      }
    }
    applied.push({ ruleId: rule.id, ruleName: rule.name, stopped: rule.stopProcessing });

    // The whole point of the ordering.
    if (rule.stopProcessing) break;
  }

  return applied;
}

export async function createBusinessRule(user, organizationId, input) {
  const name = String(input?.name ?? '').trim();
  if (!name) throw badRequest('name_required');

  const created = await row(
    `INSERT INTO qodo_projects.business_rules
       (organization_id, module_key, name, criteria, match, actions, stop_processing, order_index, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      organizationId,
      String(input?.moduleKey ?? 'issue'),
      name,
      JSON.stringify(input?.criteria ?? []),
      input?.match === 'any' ? 'any' : 'all',
      JSON.stringify(input?.actions ?? []),
      Boolean(input?.stopProcessing),
      Number(input?.orderIndex ?? 0),
      user.id,
    ]
  );

  return {
    id: created.id,
    name: created.name,
    stopProcessing: created.stop_processing,
    orderIndex: created.order_index,
  };
}

/**
 * Reorder them.
 *
 * The API takes the whole order rather than a swap, because a drag produces one
 * and applying it as N updates lets a concurrent insert land in the middle.
 */
export async function reorderBusinessRules(organizationId, orderedIds) {
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return [];
  await query(
    `UPDATE qodo_projects.business_rules AS b
        SET order_index = ordering.position
       FROM (SELECT id, ordinality - 1 AS position
               FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, ordinality)) AS ordering
      WHERE b.id = ordering.id AND b.organization_id = $2`,
    [orderedIds, organizationId]
  );
  return orderedIds;
}

/* ------------------------------------------------------------------ */
/* Quota                                                                */
/* ------------------------------------------------------------------ */

/**
 * Meter the runs.
 *
 * Not to bill anybody — this is an internal tool — but so that a rule chain
 * that escaped the depth guard still costs something finite. Returns whether
 * there was room, so the caller can stop rather than discovering the ceiling
 * from a graph next week.
 */
export async function consumeQuota(organizationId, count = 1) {
  const month = `${new Date().toISOString().slice(0, 7)}-01`;

  const updated = await row(
    `INSERT INTO qodo_projects.automation_quota (organization_id, period_month, runs_used)
     VALUES ($1, $2, $3)
     ON CONFLICT (organization_id, period_month)
       DO UPDATE SET runs_used = qodo_projects.automation_quota.runs_used + $3
     RETURNING runs_used, runs_allowed`,
    [organizationId, month, count]
  );

  return {
    used: updated.runs_used,
    allowed: updated.runs_allowed,
    exhausted: updated.runs_used > updated.runs_allowed,
  };
}

function badRequest(code) {
  return Object.assign(new Error(code), { status: 400, body: { error: code } });
}
