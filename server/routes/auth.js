import { Router } from 'express';
import { find, findOne, getStore } from '../store.js';
import {
  clearSession,
  hashPassword,
  issueSession,
  issueSsoToken,
  logActivity,
  requireAuth,
  verifyPassword,
  verifySsoToken,
} from '../auth.js';
import { canOpenApp, publicUser } from '../../shared/permissions.js';
import { visiblePeople } from '../taskAccess.js';

const router = Router();

/**
 * Failed logins are throttled per email+IP. Small in-memory window — enough to
 * stop credential stuffing against a workspace this size without dragging in
 * Redis. Restarting clears it, which is acceptable.
 */
const attempts = new Map();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;

function throttleKey(req, email) {
  return `${req.ip}|${email}`;
}

function tooManyAttempts(key) {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailure(key) {
  const entry = attempts.get(key);
  if (!entry || Date.now() - entry.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: Date.now() });
  } else {
    entry.count += 1;
  }
}

router.post('/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!email || !password) {
    return res.status(400).json({ error: 'missing_credentials' });
  }

  const key = throttleKey(req, email);
  if (tooManyAttempts(key)) {
    return res.status(429).json({ error: 'too_many_attempts' });
  }

  const user = await findOne('users', (u) => u.email === email);
  const ok = user && (await verifyPassword(password, user.passwordHash));

  // Same response for "no such user" and "wrong password" — don't leak which.
  if (!ok) {
    recordFailure(key);
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  if (user.status === 'disabled') {
    return res.status(403).json({ error: 'account_disabled' });
  }

  attempts.delete(key);
  const store = await getStore();
  await store.update('users', user.id, { lastLoginAt: new Date().toISOString() });
  await issueSession(res, user);
  await logActivity({ actorId: user.id, action: 'login', subject: 'session', subjectId: user.id });

  const fresh = await findOne('users', (u) => u.id === user.id);
  res.json({ user: publicUser(fresh) });
});

router.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.post('/password', requireAuth, async (req, res) => {
  const current = String(req.body?.currentPassword || '');
  const next = String(req.body?.newPassword || '');
  if (next.length < 8) {
    return res.status(400).json({ error: 'weak_password', minLength: 8 });
  }
  if (!(await verifyPassword(current, req.user.passwordHash))) {
    return res.status(403).json({ error: 'wrong_password' });
  }
  const store = await getStore();
  await store.update('users', req.user.id, { passwordHash: await hashPassword(next) });
  await logActivity({
    actorId: req.user.id,
    action: 'password.change',
    subject: 'user',
    subjectId: req.user.id,
  });
  res.json({ ok: true });
});

/**
 * SSO — the hub hands a short-lived, audience-scoped token to a sibling app.
 *
 * The token is returned in the response body, never in a URL: query strings end
 * up in browser history, proxy logs and Referer headers. Callers pass it in an
 * Authorization header or a postMessage handshake. See docs/SSO.md.
 */
router.post('/sso/token', requireAuth, async (req, res) => {
  const appId = String(req.body?.appId || '');
  const app = await findOne('apps', (a) => a.id === appId);
  if (!app) return res.status(404).json({ error: 'unknown_app' });
  if (!canOpenApp(req.user, app.id)) return res.status(403).json({ error: 'app_not_allowed' });

  const token = await issueSsoToken(req.user, app.id);
  res.json({ token, expiresIn: 300, audience: app.id });
});

/** Sibling apps that would rather not carry the JWT library call this. */
router.post('/sso/verify', async (req, res) => {
  const token = String(req.body?.token || '');
  const audience = req.body?.audience ? String(req.body.audience) : undefined;
  try {
    const payload = await verifySsoToken(token, audience);
    res.json({ valid: true, user: payload });
  } catch (err) {
    res.status(401).json({ valid: false, error: err.code || 'invalid_token' });
  }
});

/** Who else is in the workspace — used by task assignment pickers. */
router.get('/directory', requireAuth, async (req, res) => {
  const users = visiblePeople(
    req.user,
    await find('users', (u) => u.status !== 'disabled')
  );
  res.json({
    users: users
      .map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        title: u.title ?? null,
        avatarColor: u.avatarColor ?? '#1D6FB8',
        department: u.department ?? 'general',
        subteam: u.subteam ?? null,
        jobRole: u.jobRole ?? null,
        role: u.role,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ar')),
  });
});

export default router;
