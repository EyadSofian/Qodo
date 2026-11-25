/**
 * Personal MCP keys: one per person or agent, each with its own scope, expiry
 * and a revoke switch.
 *
 * Only a SHA-256 hash of the key is stored; the key itself is shown once, when
 * it is created. Revoking or expiring a key stops it on the next request. The
 * NOD_MCP_TOKEN variable still works as the full-access master key, so
 * existing connections keep running until they are moved to a personal key.
 */
import crypto from 'node:crypto';
import { create, find, findOne, getStore, now } from './store.js';
import { cleanScopes, FULL_ACCESS } from './mcpScopes.js';

const PREFIX = 'qmk_';
const SEEN_EVERY_MS = 60_000;

const hash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

export function bearerOf(req) {
  return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
}

/** Public view of a key: never the hash. */
export function publicKey(key) {
  return {
    id: key.id,
    name: key.name,
    hint: key.hint,
    scopes: key.scopes,
    expiresAt: key.expiresAt ?? null,
    revokedAt: key.revokedAt ?? null,
    createdAt: key.createdAt,
    createdBy: key.createdBy ?? null,
    lastUsedAt: key.lastUsedAt ?? null,
    lastUsedIp: key.lastUsedIp ?? null,
    status: key.revokedAt ? 'revoked' : key.expiresAt && Date.parse(key.expiresAt) <= Date.now() ? 'expired' : 'active',
  };
}

export async function createKey({ name, scopes, expiresAt, createdBy, organizationId }) {
  const token = PREFIX + crypto.randomBytes(32).toString('base64url');
  const doc = await create('mcpKeys', {
    organizationId,
    name: String(name).trim().slice(0, 80),
    hint: `${token.slice(0, 8)}…${token.slice(-4)}`,
    tokenHash: hash(token),
    scopes: cleanScopes(scopes),
    expiresAt: expiresAt || null,
    revokedAt: null,
    createdBy,
    lastUsedAt: null,
  });
  return { key: publicKey(doc), token };
}

export async function listKeys(organizationId) {
  return (await find('mcpKeys', (key) => (key.organizationId ?? 'engosoft') === organizationId))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map(publicKey);
}

export async function revokeKey(id, organizationId, revokedBy) {
  const key = await findOne('mcpKeys', (k) => k.id === id && (k.organizationId ?? 'engosoft') === organizationId);
  if (!key) return null;
  if (key.revokedAt) return publicKey(key);
  const store = await getStore();
  return publicKey(await store.update('mcpKeys', key.id, { revokedAt: now(), revokedBy }));
}

const digest = (value) => crypto.createHash('sha256').update(value).digest();

/**
 * Who is calling: the master key, a live personal key, or nobody.
 * Returns `{ id, name, scopes, master }` or null.
 */
export async function authenticateKey(req) {
  const supplied = bearerOf(req);
  if (!supplied) return null;
  const master = String(process.env.NOD_MCP_TOKEN || '').trim();
  if (master && crypto.timingSafeEqual(digest(supplied), digest(master))) {
    return { id: 'master', name: 'NOD_MCP_TOKEN', scopes: FULL_ACCESS, master: true };
  }
  if (!supplied.startsWith(PREFIX)) return null;
  const wanted = hash(supplied);
  const key = await findOne('mcpKeys', (k) => k.tokenHash === wanted);
  if (!key || key.revokedAt) return null;
  if (key.expiresAt && Date.parse(key.expiresAt) <= Date.now()) return null;
  if (Date.now() - Date.parse(key.lastUsedAt || 0) > SEEN_EVERY_MS) {
    const store = await getStore();
    await store.update('mcpKeys', key.id, { lastUsedAt: now(), lastUsedIp: req.ip ?? null }).catch(() => {});
  }
  return { id: key.id, name: key.name, scopes: cleanScopes(key.scopes), master: false, organizationId: key.organizationId };
}

/** True when the endpoint can answer at all: a master key or at least one personal key exists. */
export async function anyKeyConfigured() {
  if (String(process.env.NOD_MCP_TOKEN || '').trim()) return true;
  return (await find('mcpKeys', (key) => !key.revokedAt)).length > 0;
}
