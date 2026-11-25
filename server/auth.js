/**
 * Sessions, password hashing and the request guards.
 *
 * The hub is the identity provider for the whole workspace: it signs the
 * session cookie, and it signs the short-lived SSO tokens the other Engosoft
 * apps verify with the same secret. See docs/SSO.md.
 */

import nodeCrypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { SignJWT, createRemoteJWKSet, jwtVerify } from 'jose';
import { findOne, getStore } from './store.js';
import { can, isActiveUser, publicUser } from '../shared/permissions.js';
import { organizationOf } from '../shared/organization.js';
import { adoptLegacySession, getSession, isLive, openSession, pruneSessions, revokeSession, touchSession } from './sessions.js';
import { internalUserId } from './internalCaller.js';

const SESSION_COOKIE = 'engosoft_session';
const SSO_TTL = '5m';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

/**
 * In production the secret must come from the environment. Falling back to a
 * random per-boot key in dev keeps `npm run dev` zero-config; the cost is that
 * a restart signs everyone out, which is the correct trade for a dev machine.
 */
function secret(name, fallbackLabel) {
  const value = process.env[name];
  if (value && value.length >= 16) return new TextEncoder().encode(value);
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `${name} is missing or shorter than 16 characters. Set it before starting in production.`
    );
  }
  if (!globalThis.__engosoftDevSecrets) globalThis.__engosoftDevSecrets = {};
  if (!globalThis.__engosoftDevSecrets[name]) {
    globalThis.__engosoftDevSecrets[name] = new Uint8Array(nodeCrypto.randomBytes(32));
    console.warn(`[auth] ${name} not set — using a random dev key (${fallbackLabel}).`);
  }
  return globalThis.__engosoftDevSecrets[name];
}

const sessionSecret = () => secret('SESSION_SECRET', 'sessions reset on restart');
const ssoSecret = () => secret('SSO_SECRET', 'SSO tokens reset on restart');

export const hashPassword = (plain) => bcrypt.hash(plain, 10);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash || '');

/**
 * Google is an identity provider here, not a mailbox provider.
 *
 * The browser sends the one-time ID credential produced by Google Identity
 * Services. We verify its signature, issuer and audience against Google's
 * rotating public keys, then keep only the stable account id and verified
 * email. No Gmail access token or password ever reaches the workspace.
 */
export function googleClientId() {
  return String(process.env.GOOGLE_CLIENT_ID || '').trim();
}

export async function verifyGoogleCredential(credential) {
  const audience = googleClientId();
  if (!audience) {
    throw Object.assign(new Error('google_not_configured'), { code: 'google_not_configured' });
  }

  const { payload } = await jwtVerify(String(credential || ''), GOOGLE_JWKS, {
    audience,
    issuer: GOOGLE_ISSUERS,
  });

  const email = String(payload.email || '').trim().toLowerCase();
  if (!email || payload.email_verified !== true) {
    throw Object.assign(new Error('google_email_unverified'), { code: 'google_email_unverified' });
  }
  if (!payload.sub) {
    throw Object.assign(new Error('google_token_invalid'), { code: 'google_token_invalid' });
  }

  return {
    sub: String(payload.sub),
    email,
    name: String(payload.name || '').trim(),
    picture: typeof payload.picture === 'string' ? payload.picture : null,
  };
}

const SESSION_MS = 12 * 60 * 60 * 1000;

async function signSession(user, sid, expiresAtSeconds) {
  return new SignJWT({ role: user.role, sid })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer('engosoft-workspace')
    .setIssuedAt()
    .setExpirationTime(expiresAtSeconds)
    .sign(sessionSecret());
}

function setSessionCookie(res, token, expiresAtSeconds) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: Math.max(0, expiresAtSeconds * 1000 - Date.now()),
    path: '/',
  });
}

/** Signs a new session for this browser and records the device it came from. */
export async function issueSession(res, user, req) {
  const expiresAtSeconds = Math.floor((Date.now() + SESSION_MS) / 1000);
  const session = await openSession(user, req, new Date(expiresAtSeconds * 1000).toISOString());
  await pruneSessions(user.id).catch(() => {});
  const token = await signSession(user, session.id, expiresAtSeconds);
  setSessionCookie(res, token, expiresAtSeconds);
  return token;
}

/** Ends this browser's session: the cookie and, when it has one, its row. */
export async function clearSession(res, req) {
  const sid = req?.sessionId;
  if (sid) await revokeSession(sid, req.user?.id ?? null).catch(() => {});
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** A token one of the other Engosoft apps can verify to trust this user. */
export async function issueSsoToken(user, audience) {
  return new SignJWT({
    name: user.name,
    email: user.email,
    role: user.role,
    organizationId: organizationOf(user),
    department: user.department,
    subteam: user.subteam ?? null,
    jobRole: user.jobRole ?? null,
    permissions: publicUser(user).effectivePermissions,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer('engosoft-workspace')
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(SSO_TTL)
    .sign(ssoSecret());
}

export async function verifySsoToken(token, audience) {
  const { payload } = await jwtVerify(token, ssoSecret(), {
    issuer: 'engosoft-workspace',
    ...(audience ? { audience } : {}),
  });
  return payload;
}

/** Resolves req.user from the cookie. Never rejects — guards do that. */
export async function attachUser(req, res, next) {
  req.user = null;
  req.sessionId = null;
  // This server reading itself for the MCP endpoint (see internalCaller.js).
  const internalId = internalUserId(req);
  if (internalId) {
    const user = await findOne('users', (u) => u.id === internalId).catch(() => null);
    if (isActiveUser(user)) {
      req.user = user;
      req.internalCaller = true;
    }
    return next();
  }
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();
  try {
    const { payload } = await jwtVerify(token, sessionSecret(), { issuer: 'engosoft-workspace' });
    const user = await findOne('users', (u) => u.id === payload.sub);
    // Checked every request, not just at login: disabling or un-approving an
    // account has to end the session it already holds.
    if (!isActiveUser(user)) return next();
    if (payload.sid) {
      // Signed out from another device (or never ours): this cookie is over.
      const session = await getSession(payload.sid);
      if (!isLive(session, user.id)) {
        res.clearCookie(SESSION_COOKIE, { path: '/' });
        return next();
      }
      await touchSession(session, req).catch(() => {});
      req.sessionId = session.id;
    } else {
      // Signed before devices were recorded: record this browser now and keep
      // the original expiry, so nobody is signed out by the upgrade.
      const session = await adoptLegacySession(user, req, token, new Date(payload.exp * 1000).toISOString());
      // Signed out from another device before this browser got its new cookie.
      if (!isLive(session, user.id)) {
        res.clearCookie(SESSION_COOKIE, { path: '/' });
        return next();
      }
      setSessionCookie(res, await signSession(user, session.id, payload.exp), payload.exp);
      req.sessionId = session.id;
    }
    req.user = user;
  } catch {
    /* expired or tampered — treated as signed out */
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
  next();
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    if (!can(req.user, permission)) {
      return res.status(403).json({ error: 'forbidden', missing: permission });
    }
    next();
  };
}

/** Records who did what — powers the activity feed and the notification bell. */
export async function logActivity({ actorId, organizationId, action, subject, subjectId, meta }) {
  const store = await getStore();
  const actor = actorId ? await findOne('users', (user) => user.id === actorId) : null;
  await store.insert('activity', {
    id: nodeCrypto.randomUUID(),
    actorId,
    organizationId: organizationId ?? organizationOf(actor),
    action,
    subject,
    subjectId,
    meta: meta ?? null,
    createdAt: new Date().toISOString(),
  });
}
