/**
 * Qodo Projects — outbound webhooks.
 *
 * Every delivery is signed, logged, retried with backoff, and eventually given
 * up on. Three properties are worth stating because each one is a way this goes
 * wrong in practice:
 *
 * **The secret never leaves.** No read endpoint returns it and there is no
 * reveal route. A webhook secret in a settings page is a webhook secret in
 * somebody's browser history.
 *
 * **A failing endpoint is disabled, not retried for ever.** An integration
 * somebody deleted six months ago should not still be generating traffic and
 * log rows.
 *
 * **The URL is checked before it is called.** A webhook that can be pointed at
 * `http://169.254.169.254` is a way to read cloud credentials through our
 * server, and that is the whole of SSRF.
 */

import crypto from 'node:crypto';
import net from 'node:net';
import dns from 'node:dns/promises';
import { query, rows, row } from './db.js';
import * as audit from './auditService.js';

/** What the API returns instead of a secret. Never the secret. */
export const SECRET_MASK = '••••••••';

/* ------------------------------------------------------------------ */
/* SSRF                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Addresses a webhook may never reach.
 *
 * Loopback, link-local (which is where every cloud's metadata service lives)
 * and the private ranges. Without this, "add a webhook" is "make my server
 * fetch any URL on your internal network and tell me what it said".
 */
function isForbiddenAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    if (a === 127 || a === 0) return true;
    if (a === 10) return true;
    if (a === 169 && b === 254) return true; // cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  if (net.isIPv6(address)) {
    const normalised = address.toLowerCase();
    if (normalised === '::1' || normalised === '::') return true;
    if (normalised.startsWith('fc') || normalised.startsWith('fd')) return true; // unique local
    if (normalised.startsWith('fe80')) return true; // link local
    return false;
  }
  return true;
}

/**
 * Is this URL safe to call?
 *
 * Resolved rather than pattern-matched, because `internal.example.com` can
 * point at 127.0.0.1 and a hostname allowlist would never know. Returns a
 * reason so the message can say what was wrong.
 */
export async function checkUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    return { ok: false, reason: 'url_invalid' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: 'protocol_not_allowed' };
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    return { ok: false, reason: 'https_required' };
  }

  try {
    const resolved = await dns.lookup(url.hostname, { all: true });
    if (resolved.some((entry) => isForbiddenAddress(entry.address))) {
      return { ok: false, reason: 'address_not_allowed' };
    }
  } catch {
    return { ok: false, reason: 'host_unresolvable' };
  }

  return { ok: true, url };
}

/* ------------------------------------------------------------------ */
/* Endpoints                                                            */
/* ------------------------------------------------------------------ */

export async function endpoints(organizationId) {
  return (
    await rows(
      `SELECT id, name, url, method, headers, events, timeout_ms, max_retries,
              is_active, disabled_at, disabled_reason, created_at
         FROM qodo_projects.webhook_endpoints
        WHERE organization_id = $1
        ORDER BY created_at DESC`,
      [organizationId]
    )
  ).map((record) => ({
    id: record.id,
    name: record.name,
    url: record.url,
    method: record.method,
    headers: record.headers,
    events: record.events,
    timeoutMs: record.timeout_ms,
    maxRetries: record.max_retries,
    isActive: record.is_active,
    disabledAt: record.disabled_at,
    disabledReason: record.disabled_reason,
    // Present so the UI can show that a secret exists, and never its value.
    secret: SECRET_MASK,
  }));
}

export async function createEndpoint(user, organizationId, input) {
  const name = String(input?.name ?? '').trim();
  if (!name) throw badRequest('name_required');

  const check = await checkUrl(input?.url);
  if (!check.ok) throw badRequest(check.reason);

  // Generated here, shown to the caller exactly once, and never readable again.
  const secret = crypto.randomBytes(32).toString('base64url');

  const created = await row(
    `INSERT INTO qodo_projects.webhook_endpoints
       (organization_id, name, url, method, headers, secret, events, timeout_ms, max_retries, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, name, url`,
    [
      organizationId,
      name,
      check.url.toString(),
      ['POST', 'PUT', 'PATCH'].includes(input?.method) ? input.method : 'POST',
      JSON.stringify(sanitiseHeaders(input?.headers)),
      secret,
      JSON.stringify(Array.isArray(input?.events) ? input.events : []),
      Math.min(30000, Math.max(500, Number(input?.timeoutMs) || 5000)),
      Math.min(10, Math.max(0, Number(input?.maxRetries) ?? 3)),
      user.id,
    ]
  );

  await audit.record({
    actor: user,
    organizationId,
    entityType: 'webhook',
    entityId: created.id,
    action: 'webhook.create',
    // The secret is in the audit redaction list, but it is not passed here at
    // all — the safest handling of a secret is not to hand it to something that
    // has to remember to hide it.
    after: { name, url: created.url },
  });

  return { id: created.id, name: created.name, url: created.url, secret };
}

/**
 * Headers a caller may set.
 *
 * `Authorization` is allowed — many endpoints need one — but the signature
 * headers are ours and cannot be overridden, or a caller could forge the
 * signature their own receiver checks.
 */
function sanitiseHeaders(headers) {
  const reserved = new Set(['x-qodo-signature', 'x-qodo-timestamp', 'x-qodo-event', 'content-type']);
  const safe = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (reserved.has(String(key).toLowerCase())) continue;
    safe[String(key).slice(0, 64)] = String(value).slice(0, 512);
  }
  return safe;
}

/* ------------------------------------------------------------------ */
/* Delivery                                                             */
/* ------------------------------------------------------------------ */

/**
 * Sign a payload.
 *
 * The timestamp is inside the signed string, so a captured delivery cannot be
 * replayed later against a receiver that checks it — which is why the header is
 * sent separately as well.
 */
export function sign(secret, timestamp, body) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/**
 * Send one event to every endpoint subscribed to it.
 *
 * Deliberately does not throw: a webhook failing must not fail the business
 * change that produced it. The delivery log is where failures live.
 */
export async function dispatch(organizationId, event, payload) {
  const subscribers = await rows(
    `SELECT * FROM qodo_projects.webhook_endpoints
      WHERE organization_id = $1 AND is_active AND disabled_at IS NULL
        AND (events @> $2::jsonb OR events = '[]'::jsonb)`,
    [organizationId, JSON.stringify([event])]
  );

  const results = [];
  for (const endpoint of subscribers) {
    results.push(await deliver(endpoint, event, payload));
  }
  return results;
}

async function deliver(endpoint, event, payload, attempt = 1) {
  const body = JSON.stringify({ event, at: new Date().toISOString(), data: payload });
  const timestamp = Math.floor(Date.now() / 1000);
  const started = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), endpoint.timeout_ms);

  try {
    const response = await fetch(endpoint.url, {
      method: endpoint.method,
      headers: {
        'Content-Type': 'application/json',
        'X-Qodo-Event': event,
        'X-Qodo-Timestamp': String(timestamp),
        'X-Qodo-Signature': sign(endpoint.secret, timestamp, body),
        ...(endpoint.headers ?? {}),
      },
      body,
      signal: controller.signal,
      redirect: 'error',
    });

    // Only the first 2KB. A receiver that answers with a stack trace should not
    // be able to fill our database with it.
    const text = (await response.text().catch(() => '')).slice(0, 2000);

    await log(endpoint, event, payload, {
      attempt,
      status: response.status,
      body: text,
      durationMs: Date.now() - started,
      deliveredAt: response.ok ? new Date().toISOString() : null,
    });

    if (response.ok) return { ok: true, status: response.status };
    return retryOrGiveUp(endpoint, event, payload, attempt, `HTTP ${response.status}`);
  } catch (error) {
    await log(endpoint, event, payload, {
      attempt,
      error: error.name === 'AbortError' ? 'timeout' : error.message,
      durationMs: Date.now() - started,
    });
    return retryOrGiveUp(endpoint, event, payload, attempt, error.message);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Back off, then try again — or stop.
 *
 * An endpoint that has exhausted its retries is disabled and its owner is left
 * a reason on the row. Retrying a deleted integration for ever is how a webhook
 * table becomes the largest one in the database.
 */
async function retryOrGiveUp(endpoint, event, payload, attempt, reason) {
  if (attempt > endpoint.max_retries) {
    await query(
      `UPDATE qodo_projects.webhook_endpoints
          SET disabled_at = now(), disabled_reason = $2
        WHERE id = $1`,
      [endpoint.id, `gave up after ${attempt} attempts: ${String(reason).slice(0, 200)}`]
    );
    return { ok: false, gaveUp: true, reason };
  }

  // Exponential, capped. 1s, 2s, 4s, 8s…
  const backoff = Math.min(8000, 1000 * 2 ** (attempt - 1));
  await new Promise((resolve) => setTimeout(resolve, backoff));
  return deliver(endpoint, event, payload, attempt + 1);
}

async function log(endpoint, event, payload, result) {
  await query(
    `INSERT INTO qodo_projects.webhook_deliveries
       (endpoint_id, organization_id, event, payload, attempt, response_status,
        response_body, error, duration_ms, delivered_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      endpoint.id,
      endpoint.organization_id,
      event,
      JSON.stringify(payload),
      result.attempt,
      result.status ?? null,
      result.body ?? null,
      result.error ?? null,
      result.durationMs ?? null,
      result.deliveredAt ?? null,
    ]
  ).catch((error) => {
    // A logging failure must not turn into a delivery failure.
    console.error('[projects:webhook] could not log delivery:', error.message);
  });
}

export async function deliveries(organizationId, endpointId, limit = 50) {
  return rows(
    `SELECT id, event, attempt, response_status, error, duration_ms, delivered_at, created_at
       FROM qodo_projects.webhook_deliveries
      WHERE organization_id = $1 AND endpoint_id = $2
      ORDER BY created_at DESC LIMIT $3`,
    [organizationId, endpointId, Math.min(200, limit)]
  );
}

export async function setActive(user, organizationId, endpointId, isActive) {
  const updated = await row(
    `UPDATE qodo_projects.webhook_endpoints
        SET is_active = $3,
            disabled_at = CASE WHEN $3 THEN NULL ELSE disabled_at END,
            disabled_reason = CASE WHEN $3 THEN NULL ELSE disabled_reason END
      WHERE id = $1 AND organization_id = $2
      RETURNING id, is_active`,
    [endpointId, organizationId, Boolean(isActive)]
  );
  if (!updated) return null;

  await audit.record({
    actor: user,
    organizationId,
    entityType: 'webhook',
    entityId: endpointId,
    action: isActive ? 'webhook.enable' : 'webhook.disable',
    after: { isActive: updated.is_active },
  });

  return { id: updated.id, isActive: updated.is_active };
}

function badRequest(code) {
  return Object.assign(new Error(code), { status: 400, body: { error: code } });
}
