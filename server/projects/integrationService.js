/**
 * Qodo Projects — the connector framework.
 *
 * One table, one adapter interface, one settings page. The rule §68 states and
 * this file keeps: **an integration is not operational until a real credential
 * exists.** An adapter with none reports `not_configured` and its endpoints
 * answer 409 — the failure this prevents is a settings page full of logos that
 * do nothing, which is worse than an empty page because somebody plans around
 * it.
 *
 * Credentials are encrypted at rest and never returned. There is no reveal
 * route, for the same reason there is none for a webhook secret.
 */

import crypto from 'node:crypto';
import { query, rows, row } from './db.js';
import * as audit from './auditService.js';

/** What the API returns in place of a credential. */
export const CREDENTIAL_MASK = '••••••••';

/**
 * The providers the framework knows about.
 *
 * First-party ones are Qodo's own modules and need no credential — they are
 * connected because the workspace is. Everything else is an adapter that is
 * inert until somebody configures it, and says so.
 */
export const PROVIDERS = {
  /* ── first-party: already inside the workspace ─────────────── */
  qodo_mail: { kind: 'first_party', label: 'Qodo Mail', capabilities: ['discussion', 'email_to_work'] },
  qodo_calendar: { kind: 'first_party', label: 'Qodo Calendar', capabilities: ['events', 'deadlines'] },
  qodo_hr: { kind: 'first_party', label: 'Qodo HR', capabilities: ['leave', 'working_hours', 'capacity'] },
  qodo_assistant: { kind: 'first_party', label: 'Qodo Assistant', capabilities: ['questions', 'summaries'] },
  odoo: { kind: 'first_party', label: 'Odoo', capabilities: ['invoices', 'customers'], needsCredentials: true },

  /* ── adapters: real interfaces, inert without credentials ──── */
  google_calendar: { kind: 'adapter', label: 'Google Calendar', capabilities: ['events'], needsCredentials: true },
  google_drive: { kind: 'adapter', label: 'Google Drive', capabilities: ['documents'], needsCredentials: true },
  microsoft_outlook: { kind: 'adapter', label: 'Outlook Calendar', capabilities: ['events'], needsCredentials: true },
  microsoft_onedrive: { kind: 'adapter', label: 'OneDrive', capabilities: ['documents'], needsCredentials: true },
  microsoft_teams: { kind: 'adapter', label: 'Microsoft Teams', capabilities: ['notifications'], needsCredentials: true },
  github: { kind: 'adapter', label: 'GitHub', capabilities: ['commits', 'issues'], needsCredentials: true },
  gitlab: { kind: 'adapter', label: 'GitLab', capabilities: ['commits', 'issues'], needsCredentials: true },
  gitea: { kind: 'adapter', label: 'Gitea', capabilities: ['commits'], needsCredentials: true },
  bitbucket: { kind: 'adapter', label: 'Bitbucket', capabilities: ['commits'], needsCredentials: true },
  slack: { kind: 'adapter', label: 'Slack', capabilities: ['notifications'], needsCredentials: true },
  whatsapp: { kind: 'adapter', label: 'WhatsApp', capabilities: ['notifications'], needsCredentials: true },
  jira: { kind: 'adapter', label: 'Jira', capabilities: ['import'], needsCredentials: true },
  basecamp: { kind: 'adapter', label: 'Basecamp', capabilities: ['import'], needsCredentials: true },
};

/* ------------------------------------------------------------------ */
/* Credentials at rest                                                  */
/* ------------------------------------------------------------------ */

function encryptionKey() {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 16) return crypto.createHash('sha256').update(secret).digest();
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET is required to store integration credentials.');
  }
  // A per-boot dev key, matching how `server/auth.js` handles the same problem:
  // credentials stop working on restart rather than requiring configuration to
  // run locally.
  if (!globalThis.__qodoProjectsIntegrationKey) {
    globalThis.__qodoProjectsIntegrationKey = crypto.randomBytes(32);
  }
  return globalThis.__qodoProjectsIntegrationKey;
}

/**
 * AES-256-GCM, so a tampered ciphertext fails to decrypt rather than decrypting
 * into something else. The IV travels with the value; it is not a secret.
 */
export function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decrypt(stored) {
  const [iv, tag, payload] = String(stored ?? '').split('.');
  if (!iv || !tag || !payload) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(payload, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    // A key that has rotated, or a value somebody edited. Either way it is not
    // a credential any more.
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Connections                                                          */
/* ------------------------------------------------------------------ */

/**
 * Every provider, with whether it is actually connected.
 *
 * The list is the catalogue joined to the configuration, so a provider nobody
 * has set up appears as `not_configured` rather than being absent — somebody
 * has to be able to find it in order to configure it.
 */
export async function catalogue(organizationId) {
  const configured = await rows(
    `SELECT provider, name, status, last_sync_at, last_error, scopes, settings
       FROM qodo_projects.integration_connections
      WHERE organization_id = $1`,
    [organizationId]
  );
  const byProvider = new Map(configured.map((connection) => [connection.provider, connection]));

  return Object.entries(PROVIDERS).map(([key, definition]) => {
    const connection = byProvider.get(key);
    return {
      provider: key,
      label: definition.label,
      kind: definition.kind,
      capabilities: definition.capabilities,
      needsCredentials: Boolean(definition.needsCredentials),
      // First-party modules with no credential requirement are connected
      // because the workspace is. Everything else is honest about its state.
      status: connection?.status ?? (definition.needsCredentials ? 'not_configured' : 'connected'),
      lastSyncAt: connection?.last_sync_at ?? null,
      lastError: connection?.last_error ?? null,
      // Present so the UI can show that a credential exists, never its value.
      credential: connection?.status === 'connected' ? CREDENTIAL_MASK : null,
    };
  });
}

export async function connect(user, organizationId, input) {
  const provider = String(input?.provider ?? '');
  const definition = PROVIDERS[provider];
  if (!definition) throw badRequest('provider_unknown');

  if (definition.needsCredentials && !String(input?.credentials ?? '').trim()) {
    // Refused rather than stored as "connected" with nothing behind it — the
    // whole point of §68.
    throw badRequest('credentials_required');
  }

  const saved = await row(
    `INSERT INTO qodo_projects.integration_connections
       (organization_id, provider, name, credentials, scopes, settings, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'connected',$7)
     ON CONFLICT (organization_id, provider, name)
       DO UPDATE SET credentials = EXCLUDED.credentials,
                     scopes = EXCLUDED.scopes,
                     settings = EXCLUDED.settings,
                     status = 'connected',
                     last_error = NULL
     RETURNING id, provider, status`,
    [
      organizationId,
      provider,
      String(input?.name ?? definition.label),
      input?.credentials ? encrypt(input.credentials) : null,
      JSON.stringify(input?.scopes ?? []),
      JSON.stringify(input?.settings ?? {}),
      user.id,
    ]
  );

  await audit.record({
    actor: user,
    organizationId,
    entityType: 'integration',
    entityId: saved.id,
    action: 'integration.connect',
    // The credential is not passed here at all. The safest handling of a secret
    // is not to give it to something that has to remember to hide it.
    after: { provider, scopes: input?.scopes ?? [] },
  });

  return { id: saved.id, provider: saved.provider, status: saved.status };
}

export async function disconnect(user, organizationId, provider) {
  const { rowCount } = await query(
    `UPDATE qodo_projects.integration_connections
        SET status = 'disabled', credentials = NULL
      WHERE organization_id = $1 AND provider = $2`,
    [organizationId, provider]
  );
  if (rowCount === 0) return false;

  await audit.record({
    actor: user,
    organizationId,
    entityType: 'integration',
    entityId: provider,
    action: 'integration.disconnect',
    after: { provider },
  });

  return true;
}

/**
 * The credential for a provider, for an adapter that is about to make a call.
 *
 * Throws rather than returning null when there is none, so an adapter cannot
 * accidentally proceed with an empty string and report a confusing failure from
 * the far end.
 */
export async function credentialFor(organizationId, provider) {
  const connection = await row(
    `SELECT credentials, status FROM qodo_projects.integration_connections
      WHERE organization_id = $1 AND provider = $2 AND status = 'connected'`,
    [organizationId, provider]
  );

  if (!connection?.credentials) {
    throw Object.assign(new Error('integration_not_configured'), {
      status: 409,
      body: { error: 'integration_not_configured', provider },
    });
  }

  const decrypted = decrypt(connection.credentials);
  if (!decrypted) {
    throw Object.assign(new Error('integration_credential_unreadable'), {
      status: 409,
      body: { error: 'integration_credential_unreadable', provider },
    });
  }

  return decrypted;
}

/** Record that a sync failed, so the settings page can say so. */
export async function recordFailure(organizationId, provider, message) {
  await query(
    `UPDATE qodo_projects.integration_connections
        SET status = 'error', last_error = $3
      WHERE organization_id = $1 AND provider = $2`,
    [organizationId, provider, String(message).slice(0, 500)]
  );
}

export async function recordSync(organizationId, provider) {
  await query(
    `UPDATE qodo_projects.integration_connections
        SET last_sync_at = now(), last_error = NULL, status = 'connected'
      WHERE organization_id = $1 AND provider = $2`,
    [organizationId, provider]
  );
}

function badRequest(code) {
  return Object.assign(new Error(code), { status: 400, body: { error: code } });
}
