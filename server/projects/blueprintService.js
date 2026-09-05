/**
 * Qodo Projects — Blueprint.
 *
 * A state machine an administrator designs: which status may follow which, who
 * is allowed to make that move, and what has to be true first.
 *
 * Three rules make it a Blueprint rather than a UI convention, and all three
 * are enforced here rather than in a form:
 *
 * 1. **The API cannot bypass it.** A status change through `PATCH /tasks/:id`
 *    runs the same check as a Kanban drag. A drag is a request, not a
 *    permission.
 * 2. **Versions are immutable.** Publishing writes a new version; it never
 *    edits the one records are already governed by.
 * 3. **A record keeps the version it was created under.** Publishing a stricter
 *    blueprint must not retroactively make a task somebody closed last month
 *    illegal. Moving records onto a new version is an action somebody takes.
 */

import { query, rows, row, transaction } from './db.js';
import * as audit from './auditService.js';
import { matches } from './criteria.js';

/* ------------------------------------------------------------------ */
/* Definitions                                                          */
/* ------------------------------------------------------------------ */

export async function blueprints(organizationId, moduleKey) {
  const params = [organizationId];
  let filter = '';
  if (moduleKey) {
    params.push(moduleKey);
    filter = `AND b.module_key = $${params.length}`;
  }

  return (
    await rows(
      `SELECT b.*, v.version_no AS published_version, v.id AS published_version_id
         FROM qodo_projects.blueprints b
         LEFT JOIN qodo_projects.blueprint_versions v
                ON v.blueprint_id = b.id AND v.state = 'published'
        WHERE b.organization_id = $1 ${filter}
        ORDER BY b.module_key, b.name`,
      params
    )
  ).map((record) => ({
    id: record.id,
    moduleKey: record.module_key,
    name: record.name,
    description: record.description,
    isActive: record.is_active,
    publishedVersion: record.published_version,
    publishedVersionId: record.published_version_id,
  }));
}

/**
 * A transition, as an administrator writes one.
 *
 * Every field is data. `requiredFields` names fields; `conditions` uses the
 * shared criteria language; `beforeActions` and `afterActions` use the shared
 * action vocabulary. Nothing in a transition is code.
 */
function normaliseTransition(transition) {
  return {
    name: String(transition?.name ?? '').trim(),
    from: transition?.from ?? null,
    to: String(transition?.to ?? ''),
    allowedRoles: Array.isArray(transition?.allowedRoles) ? transition.allowedRoles : [],
    allowedPermissions: Array.isArray(transition?.allowedPermissions) ? transition.allowedPermissions : [],
    requiredFields: Array.isArray(transition?.requiredFields) ? transition.requiredFields : [],
    requiresComment: Boolean(transition?.requiresComment),
    conditions: Array.isArray(transition?.conditions) ? transition.conditions : [],
    match: transition?.match === 'any' ? 'any' : 'all',
    beforeActions: Array.isArray(transition?.beforeActions) ? transition.beforeActions : [],
    afterActions: Array.isArray(transition?.afterActions) ? transition.afterActions : [],
  };
}

/**
 * Write a draft.
 *
 * Drafts are versions too — that is what makes the sandbox work (ADR-9). A
 * draft can be edited by writing another draft; only publishing is
 * irreversible, and only for the version being replaced.
 */
export async function saveDraft(user, organizationId, blueprintId, definition) {
  const transitions = (Array.isArray(definition?.transitions) ? definition.transitions : []).map(
    normaliseTransition
  );

  if (transitions.length === 0) throw badRequest('transitions_required');
  const nameless = transitions.filter((transition) => !transition.name || !transition.to);
  if (nameless.length > 0) throw badRequest('transition_incomplete');

  return transaction(async (tx) => {
    const last = await tx.row(
      'SELECT COALESCE(max(version_no), 0) AS last FROM qodo_projects.blueprint_versions WHERE blueprint_id = $1',
      [blueprintId]
    );

    const created = await tx.row(
      `INSERT INTO qodo_projects.blueprint_versions
         (blueprint_id, organization_id, version_no, definition, state, created_by)
       VALUES ($1,$2,$3,$4,'draft',$5) RETURNING *`,
      [blueprintId, organizationId, Number(last.last) + 1, JSON.stringify({ transitions }), user.id]
    );

    return { id: created.id, versionNo: created.version_no, state: created.state };
  });
}

/**
 * Publish a draft.
 *
 * The version already in production is superseded, not deleted, and records
 * already attached to it stay attached. New records get the new one.
 */
export async function publish(user, organizationId, versionId) {
  return transaction(async (tx) => {
    const version = await tx.row(
      `SELECT * FROM qodo_projects.blueprint_versions
        WHERE id = $1 AND organization_id = $2 AND state = 'draft'`,
      [versionId, organizationId]
    );
    if (!version) return null;

    await tx.query(
      `UPDATE qodo_projects.blueprint_versions
          SET state = 'superseded'
        WHERE blueprint_id = $1 AND state = 'published'`,
      [version.blueprint_id]
    );

    const published = await tx.row(
      `UPDATE qodo_projects.blueprint_versions
          SET state = 'published', published_at = now(), published_by = $2
        WHERE id = $1 RETURNING *`,
      [versionId, user.id]
    );

    await tx.query('UPDATE qodo_projects.blueprints SET is_active = true WHERE id = $1', [
      version.blueprint_id,
    ]);

    await audit.record({
      actor: user,
      organizationId,
      entityType: 'blueprint',
      entityId: version.blueprint_id,
      action: 'blueprint.publish',
      after: { versionNo: published.version_no },
      tx,
    });

    return { id: published.id, versionNo: published.version_no, state: published.state };
  });
}

/* ------------------------------------------------------------------ */
/* Governance                                                           */
/* ------------------------------------------------------------------ */

/**
 * The version governing one record.
 *
 * A record that has never been attached to a version gets the currently
 * published one and is pinned to it from that moment — so the rules it obeys
 * stop moving the first time it is touched.
 */
export async function versionFor(organizationId, moduleKey, entityType, entityId) {
  const attached = await row(
    `SELECT v.* FROM qodo_projects.record_blueprint_versions r
       JOIN qodo_projects.blueprint_versions v ON v.id = r.version_id
      WHERE r.entity_type = $1 AND r.entity_id = $2 AND r.organization_id = $3`,
    [entityType, String(entityId), organizationId]
  );
  if (attached) return attached;

  const published = await row(
    `SELECT v.* FROM qodo_projects.blueprint_versions v
       JOIN qodo_projects.blueprints b ON b.id = v.blueprint_id
      WHERE b.organization_id = $1 AND b.module_key = $2 AND b.is_active AND v.state = 'published'
      LIMIT 1`,
    [organizationId, moduleKey]
  );
  if (!published) return null;

  await query(
    `INSERT INTO qodo_projects.record_blueprint_versions
       (organization_id, entity_type, entity_id, version_id)
     VALUES ($1,$2,$3,$4) ON CONFLICT (entity_type, entity_id) DO NOTHING`,
    [organizationId, entityType, String(entityId), published.id]
  );

  return published;
}

/**
 * May this person make this move, right now, on this record?
 *
 * Returns `{ allowed, reason, transition }` rather than throwing, so a caller
 * can also use it to decide which buttons to draw — and so the reason can be
 * shown rather than a bare refusal.
 *
 * **No blueprint means allowed.** An organization that has not configured one
 * has not asked for a restriction, and inventing one would break every project
 * on the day the feature shipped.
 */
export async function checkTransition({
  organizationId,
  moduleKey,
  entityType,
  entityId,
  record,
  fromStatusKey,
  toStatusKey,
  context,
  comment,
}) {
  const version = await versionFor(organizationId, moduleKey, entityType, entityId);
  if (!version) return { allowed: true, reason: 'no_blueprint', transition: null };

  const transitions = version.definition?.transitions ?? [];
  const candidates = transitions.filter(
    (transition) =>
      transition.to === toStatusKey &&
      (transition.from === null || transition.from === fromStatusKey)
  );

  if (candidates.length === 0) {
    return {
      allowed: false,
      reason: 'transition_not_defined',
      // Naming what *is* possible turns a refusal into instructions.
      available: transitions
        .filter((transition) => transition.from === null || transition.from === fromStatusKey)
        .map((transition) => ({ name: transition.name, to: transition.to })),
      transition: null,
    };
  }

  // Several transitions can lead to the same status by different routes; the
  // first one this person satisfies is the one they are taking.
  let lastReason = 'not_permitted';
  for (const transition of candidates) {
    const verdict = evaluate(transition, { record, context, comment });
    if (verdict.allowed) return { allowed: true, transition, reason: null };
    lastReason = verdict.reason;
    if (verdict.detail) lastReason = { reason: verdict.reason, detail: verdict.detail };
  }

  return { allowed: false, reason: lastReason, transition: null };
}

function evaluate(transition, { record, context, comment }) {
  // Who may move it. An empty list means anybody who can edit the record at all,
  // which is what "no restriction" should mean rather than "nobody".
  if (transition.allowedRoles.length > 0) {
    const role = context?.membership?.role;
    if (!transition.allowedRoles.includes(role)) return { allowed: false, reason: 'role_not_permitted' };
  }
  if (transition.allowedPermissions.length > 0) {
    const held = context?.permissions ?? [];
    if (!transition.allowedPermissions.some((permission) => held.includes(permission))) {
      return { allowed: false, reason: 'permission_not_held' };
    }
  }

  const missing = transition.requiredFields.filter((field) => {
    const value = record?.[field];
    return value === null || value === undefined || value === '' ||
      (Array.isArray(value) && value.length === 0);
  });
  if (missing.length > 0) return { allowed: false, reason: 'fields_required', detail: missing };

  if (transition.requiresComment && !String(comment ?? '').trim()) {
    return { allowed: false, reason: 'comment_required' };
  }

  if (!matches(record, transition.conditions, transition.match)) {
    return { allowed: false, reason: 'conditions_not_met' };
  }

  return { allowed: true };
}

/**
 * Refuse, loudly, in the shape the routes turn into HTTP.
 *
 * The thin wrapper exists so a service can write one line and be sure the
 * refusal carries the reason and the alternatives — a bare 403 on a blueprint
 * leaves somebody clicking the same button again.
 */
export async function enforceTransition(options) {
  const verdict = await checkTransition(options);
  if (verdict.allowed) return verdict;

  throw Object.assign(new Error('blueprint_transition_refused'), {
    status: 409,
    body: {
      error: 'blueprint_transition_refused',
      reason: verdict.reason,
      available: verdict.available ?? [],
    },
  });
}

/**
 * Move records onto the published version, deliberately.
 *
 * Never a side effect of publishing — §25. An administrator asks for this, and
 * the count comes back so they can see what it touched.
 */
export async function migrateRecords(user, organizationId, blueprintId) {
  const published = await row(
    `SELECT id FROM qodo_projects.blueprint_versions
      WHERE blueprint_id = $1 AND organization_id = $2 AND state = 'published'`,
    [blueprintId, organizationId]
  );
  if (!published) return null;

  const { rowCount } = await query(
    `UPDATE qodo_projects.record_blueprint_versions r
        SET version_id = $1, attached_at = now()
       FROM qodo_projects.blueprint_versions v
      WHERE r.version_id = v.id AND v.blueprint_id = $2 AND r.organization_id = $3
        AND r.version_id <> $1`,
    [published.id, blueprintId, organizationId]
  );

  await audit.record({
    actor: user,
    organizationId,
    entityType: 'blueprint',
    entityId: blueprintId,
    action: 'blueprint.migrate',
    after: { records: rowCount, toVersion: published.id },
  });

  return { migrated: rowCount };
}

export async function createBlueprint(user, organizationId, input) {
  const name = String(input?.name ?? '').trim();
  if (!name) throw badRequest('name_required');

  const created = await row(
    `INSERT INTO qodo_projects.blueprints (organization_id, module_key, name, description, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [organizationId, String(input?.moduleKey ?? 'task'), name, String(input?.description ?? ''), user.id]
  );

  return { id: created.id, name: created.name, moduleKey: created.module_key };
}

function badRequest(code) {
  return Object.assign(new Error(code), { status: 400, body: { error: code } });
}
