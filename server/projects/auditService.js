/**
 * Qodo Projects — the audit log.
 *
 * §64 asks for an append-only record of who changed what. The workspace's
 * existing `activity` collection cannot be one: it is written through
 * `store.update()`, so anything already recorded can be rewritten. That is fine
 * for a notification feed, which is what it is, and not fine for the thing you
 * consult when somebody asks who moved a deadline.
 *
 * So Projects writes to `audit_events`, where the database itself refuses
 * UPDATE and DELETE (see migration 001). The guarantee does not depend on this
 * module being the only writer, or on future maintainers knowing that it should
 * be — a psql session cannot rewrite history either.
 *
 * What is recorded is the *diff*, not the whole record. A full snapshot of every
 * task on every edit turns the audit log into the largest table in the database
 * within a month, and answers the question worse: "what changed" is the
 * question, and a reader should not have to diff two blobs to find out.
 */

import { query, rows } from './db.js';
import { organizationOf } from '../../shared/organization.js';

/**
 * Fields that must never be written into an audit row.
 *
 * The audit log is read by more people than the records it describes — that is
 * its purpose — so a rate that is hidden from a project manager on the task
 * page must not reappear in the history of that page. Anything listed here is
 * recorded as "changed" without its values.
 */
const REDACTED = new Set([
  'bill_rate',
  'cost_rate',
  'billRate',
  'costRate',
  'hourlyRate',
  'hourly_rate',
  'password',
  'passwordHash',
  'secret',
  'secret_encrypted',
  'credentials_encrypted',
  'token',
]);

/**
 * What actually changed, as `{ field: [before, after] }`.
 *
 * Compared with `JSON.stringify` rather than `===` so that a date object and a
 * date string that mean the same instant do not read as a change — the most
 * common source of audit noise, and noise is what makes an audit log stop being
 * read.
 */
export function diff(before, after) {
  const changes = {};
  const fields = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);

  for (const field of fields) {
    const from = before?.[field];
    const to = after?.[field];
    if (JSON.stringify(from ?? null) === JSON.stringify(to ?? null)) continue;
    changes[field] = REDACTED.has(field) ? ['[redacted]', '[redacted]'] : [from ?? null, to ?? null];
  }

  return changes;
}

/**
 * Record one event.
 *
 * Deliberately does not throw. An audit write failing must not roll back the
 * business change that succeeded — losing the record of an edit is bad, and
 * refusing an edit because the log was full is worse. A failure is logged
 * loudly to the process output, which is what Railway surfaces.
 *
 * The one exception is when a caller passes a transaction in `tx`: inside a
 * transaction the audit row is part of the change, and a failure should take
 * the whole thing down, because a change that is not recorded did not happen.
 */
export async function record(event) {
  const {
    actor,
    organizationId,
    projectId = null,
    entityType,
    entityId,
    action,
    before = null,
    after = null,
    source = 'user',
    correlationId = null,
    ip = null,
    tx = null,
  } = event;

  const changes = before || after ? diff(before, after) : null;

  const sql = `
    INSERT INTO qodo_projects.audit_events
      (organization_id, project_id, actor_id, source, entity_type, entity_id,
       action, before_state, after_state, correlation_id, ip)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING id, occurred_at`;

  const params = [
    organizationId ?? organizationOf(actor),
    projectId,
    actor?.id ?? null,
    source,
    entityType,
    String(entityId),
    action,
    changes ? JSON.stringify(redact(before)) : null,
    changes ? JSON.stringify(redact(after)) : null,
    correlationId,
    ip,
  ];

  if (tx) return (await tx.query(sql, params)).rows[0];

  try {
    return (await query(sql, params)).rows[0];
  } catch (error) {
    console.error('[projects:audit] failed to record', action, entityType, entityId, error.message);
    return null;
  }
}

function redact(state) {
  if (!state) return null;
  const safe = {};
  for (const [field, value] of Object.entries(state)) {
    safe[field] = REDACTED.has(field) ? '[redacted]' : value;
  }
  return safe;
}

/**
 * The history of one record, newest first.
 *
 * Bounded, like every list in this module. An entity with ten thousand audit
 * rows is a real possibility for a long-running project, and "show me the
 * history" must not become the slowest request in the product.
 */
export async function historyOf({ organizationId, entityType, entityId, limit = 50, before = null }) {
  return rows(
    `SELECT id, actor_id, source, action, before_state, after_state, occurred_at
       FROM qodo_projects.audit_events
      WHERE organization_id = $1
        AND entity_type = $2
        AND entity_id = $3
        ${before ? 'AND occurred_at < $5' : ''}
      ORDER BY occurred_at DESC
      LIMIT $4`,
    before
      ? [organizationId, entityType, String(entityId), Math.min(200, limit), before]
      : [organizationId, entityType, String(entityId), Math.min(200, limit)]
  );
}

/**
 * Everything that happened in a project — the raw material for the activity
 * feed (§39).
 *
 * The feed is a *projection* of the audit log rather than a second table, which
 * is what keeps them from disagreeing. It does mean the feed inherits the
 * audit's redaction, and that is correct: a feed entry that reveals a rate is
 * the same leak as an audit entry that does.
 */
export async function feedFor({ organizationId, projectId, limit = 50, before = null }) {
  return rows(
    `SELECT id, actor_id, source, entity_type, entity_id, action,
            before_state, after_state, occurred_at
       FROM qodo_projects.audit_events
      WHERE organization_id = $1
        AND project_id = $2
        ${before ? 'AND occurred_at < $4' : ''}
      ORDER BY occurred_at DESC
      LIMIT $3`,
    before
      ? [organizationId, projectId, Math.min(200, limit), before]
      : [organizationId, projectId, Math.min(200, limit)]
  );
}

/** Exported for the test that asserts the redaction list has not shrunk. */
export const REDACTED_FIELDS = [...REDACTED];
