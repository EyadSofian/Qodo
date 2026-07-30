/**
 * Invite links — how a new employee gets an account without an administrator
 * typing their password for them.
 *
 * An administrator creates a link. Whoever opens it fills in their own name,
 * email and password, and picks where they sit in the department tree. The
 * account is created immediately but lands in `pending`: it has no session and
 * no permissions until an administrator approves it from the Users page. That
 * is the whole point of the design — a leaked link costs an administrator one
 * click to reject, not an unknown person inside the workspace.
 *
 * What the link *cannot* do is grant privilege. Role, permissions, allowed apps
 * and visibility scope are decided by the administrator when the link is made
 * and are never read from the join form, so the only thing the person joining
 * controls is who they say they are.
 */

import crypto from 'node:crypto';
import { Router } from 'express';
import { create, find, findOne, getStore } from '../store.js';
import { hashPassword, logActivity, requirePermission } from '../auth.js';
import { notifyUser } from '../push.js';
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  VISIBILITY_SCOPES,
  can,
  isActiveUser,
} from '../../shared/permissions.js';
import {
  DEPARTMENTS,
  DEPARTMENT_IDS,
  getJobRole,
  getSubteam,
  getSubteams,
} from '../../shared/departments.js';
import { canUseDepartment } from '../taskAccess.js';
import { organizationOf } from '../../shared/organization.js';

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_USES_LIMIT = 500;
const DEFAULT_TTL_DAYS = 14;

/**
 * A link can only ever create these. Handing out `admin` through a URL is not a
 * feature anyone asked for, and `manager` carries review and scoring authority
 * — both stay a deliberate promotion an administrator performs on a real person.
 */
const INVITABLE_ROLES = ['member', 'viewer'];

/* ── admin side ──────────────────────────────────────────────────── */

router.get('/', requirePermission(PERMISSIONS.USERS_MANAGE), async (req, res) => {
  const invites = (
    await find('invites', (invite) => organizationOf(invite) === organizationOf(req.user))
  ).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const users = await find('users');
  res.json({
    invites: invites.map((invite) => ({
      ...invite,
      state: inviteState(invite),
      // How many accounts actually came through this link, including ones still
      // waiting — the counter alone can't tell you that.
      joined: users.filter((user) => user.inviteId === invite.id).length,
      pending: users.filter((user) => user.inviteId === invite.id && user.status === 'pending')
        .length,
    })),
    roles: INVITABLE_ROLES,
  });
});

router.post('/', requirePermission(PERMISSIONS.USERS_MANAGE), async (req, res) => {
  const label = String(req.body?.label || '').trim().slice(0, 120);
  const role = String(req.body?.role || 'member');
  if (!INVITABLE_ROLES.includes(role)) return res.status(400).json({ error: 'role_not_invitable' });

  // An empty department list means "let them choose any" — a single id pins the
  // link to one team and the join form stops asking.
  const departments = normaliseDepartments(req.body?.departments);
  if (departments === null) return res.status(400).json({ error: 'invalid_department' });
  for (const department of departments) {
    if (!canUseDepartment(req.user, department)) {
      return res.status(403).json({ error: 'forbidden_team' });
    }
  }

  const emailDomain = String(req.body?.emailDomain || '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '');
  if (emailDomain && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(emailDomain)) {
    return res.status(400).json({ error: 'invalid_domain' });
  }

  const maxUses = normaliseMaxUses(req.body?.maxUses);
  if (maxUses === null) return res.status(400).json({ error: 'invalid_max_uses' });

  const days = Number(req.body?.expiresInDays ?? DEFAULT_TTL_DAYS);
  if (!Number.isFinite(days) || days < 1 || days > 365) {
    return res.status(400).json({ error: 'invalid_expiry' });
  }

  const invite = await create('invites', {
    // 32 random bytes: this is the only secret standing between the internet
    // and a pending row, so it is not a guessable id.
    token: crypto.randomBytes(32).toString('base64url'),
    organizationId: organizationOf(req.user),
    label,
    role,
    departments,
    emailDomain: emailDomain || null,
    permissions: normalisePermissions(req.body?.permissions),
    appIds: normaliseAppIds(req.body?.appIds),
    visibilityScope: VISIBILITY_SCOPES.includes(req.body?.visibilityScope)
      ? req.body.visibilityScope
      : null,
    maxUses,
    useCount: 0,
    expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(),
    revokedAt: null,
    createdBy: req.user.id,
  });

  await logActivity({
    actorId: req.user.id,
    action: 'invite.create',
    subject: 'invite',
    subjectId: invite.id,
    meta: { label, role, departments, maxUses },
  });
  res.status(201).json({ invite: { ...invite, state: 'active', joined: 0, pending: 0 } });
});

router.post(
  '/:id/revoke',
  requirePermission(PERMISSIONS.USERS_MANAGE),
  async (req, res) => {
    const store = await getStore();
    const invite = await findOne('invites', (item) => item.id === req.params.id);
    if (!invite || organizationOf(invite) !== organizationOf(req.user)) {
      return res.status(404).json({ error: 'not_found' });
    }
    const updated = await store.update('invites', invite.id, {
      revokedAt: invite.revokedAt ?? new Date().toISOString(),
    });
    await logActivity({
      actorId: req.user.id,
      action: 'invite.revoke',
      subject: 'invite',
      subjectId: invite.id,
      meta: { label: invite.label },
    });
    res.json({ invite: { ...updated, state: 'revoked' } });
  }
);

router.delete(
  '/:id',
  requirePermission(PERMISSIONS.USERS_MANAGE),
  async (req, res) => {
    const store = await getStore();
    const invite = await findOne('invites', (item) => item.id === req.params.id);
    if (!invite || organizationOf(invite) !== organizationOf(req.user)) {
      return res.status(404).json({ error: 'not_found' });
    }
    await store.remove('invites', invite.id);
    await logActivity({
      actorId: req.user.id,
      action: 'invite.delete',
      subject: 'invite',
      subjectId: invite.id,
      meta: { label: invite.label },
    });
    res.json({ ok: true });
  }
);

/* ── public side ─────────────────────────────────────────────────── */

/**
 * Both public endpoints are throttled per IP. The token is unguessable, so this
 * is not really about brute force — it is about one script being unable to fill
 * the Users page with hundreds of pending rows from a link that did leak.
 */
const publicHits = new Map();
const PUBLIC_WINDOW_MS = 10 * 60 * 1000;
const PUBLIC_MAX = 20;

function throttled(req) {
  const key = req.ip;
  const entry = publicHits.get(key);
  if (!entry || Date.now() - entry.first > PUBLIC_WINDOW_MS) {
    publicHits.set(key, { count: 1, first: Date.now() });
    return false;
  }
  entry.count += 1;
  return entry.count > PUBLIC_MAX;
}

/**
 * What the join page is allowed to know. Deliberately not the invite document:
 * role, permissions and allowed apps are none of the visitor's business, and
 * echoing them back would turn a leaked link into a map of the workspace.
 */
router.get('/token/:token', async (req, res) => {
  if (throttled(req)) return res.status(429).json({ error: 'too_many_attempts' });

  const invite = await findOne('invites', (item) => item.token === req.params.token);
  const state = invite ? inviteState(invite) : 'invalid';
  if (state !== 'active') return res.status(404).json({ error: `invite_${state}` });

  const allowed = invite.departments?.length ? invite.departments : DEPARTMENT_IDS;
  res.json({
    invite: {
      label: invite.label,
      emailDomain: invite.emailDomain,
      // Approval is always required — stated here so the form can say so before
      // anyone types a password, not after.
      requiresApproval: true,
      departments: DEPARTMENTS.filter((department) => allowed.includes(department.id)).map(
        (department) => ({
          id: department.id,
          ar: department.ar,
          en: department.en,
          color: department.color,
          icon: department.icon,
          subteams: getSubteams(department.id).map((team) => ({
            id: team.id,
            ar: team.ar,
            en: team.en,
            roles: team.roles,
          })),
        })
      ),
    },
  });
});

/**
 * Accepting is the one write in this file that races with itself: two people
 * submitting the same email at the same moment would both pass the duplicate
 * check before either insert lands, because the document store has no unique
 * index to lean on. Serialising the whole accept path is the honest fix at this
 * scale — the API is a single process, and the section is short.
 */
let acceptQueue = Promise.resolve();
const serialise = (work) => {
  const run = acceptQueue.then(work, work);
  acceptQueue = run.then(
    () => {},
    () => {}
  );
  return run;
};

router.post('/token/:token/accept', async (req, res) => {
  if (throttled(req)) return res.status(429).json({ error: 'too_many_attempts' });

  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!name) return res.status(400).json({ error: 'name_required' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'invalid_email' });
  if (password.length < 8) return res.status(400).json({ error: 'weak_password', minLength: 8 });

  try {
    const result = await serialise(async () => {
      const invite = await findOne('invites', (item) => item.token === req.params.token);
      const state = invite ? inviteState(invite) : 'invalid';
      if (state !== 'active') return { status: 404, body: { error: `invite_${state}` } };

      if (invite.emailDomain && !email.endsWith(`@${invite.emailDomain}`)) {
        return { status: 400, body: { error: 'email_domain_mismatch', domain: invite.emailDomain } };
      }

      // The same rule the admin form uses, checked inside the lock so two
      // simultaneous sign-ups cannot both win it.
      if (await findOne('users', (user) => user.email === email)) {
        return { status: 409, body: { error: 'email_taken' } };
      }

      const allowed = invite.departments?.length ? invite.departments : DEPARTMENT_IDS;
      const requested = req.body?.department ? String(req.body.department) : null;
      // A link pinned to one department fills the field in for a form that
      // never showed it — but an explicit department that the link does not
      // offer is rejected, not quietly rewritten to the one it does.
      const department = requested ?? (allowed.length === 1 ? allowed[0] : null);
      if (!department || !allowed.includes(department)) {
        return { status: 400, body: { error: 'invalid_department' } };
      }

      const subteam = req.body?.subteam ? String(req.body.subteam) : null;
      const jobRole = req.body?.jobRole ? String(req.body.jobRole) : null;
      if (subteam && !getSubteam(department, subteam)) {
        return { status: 400, body: { error: 'invalid_subteam' } };
      }
      if (jobRole && !getJobRole(department, subteam, jobRole)) {
        return { status: 400, body: { error: 'invalid_job_role' } };
      }
      // A department that has a tree needs a branch, or the person lands in a
      // marketing board with no place in it.
      if (!subteam && getSubteams(department).length > 0) {
        return { status: 400, body: { error: 'subteam_required' } };
      }

      const user = await create('users', {
        name,
        email,
        passwordHash: await hashPassword(password),
        // Everything below comes from the invite, never from the request body.
        role: INVITABLE_ROLES.includes(invite.role) ? invite.role : 'member',
        organizationId: organizationOf(invite),
        status: 'pending',
        permissions: invite.permissions ?? null,
        appIds: invite.appIds ?? null,
        visibilityScope: invite.visibilityScope ?? null,
        department,
        subteam,
        jobRole,
        title: null,
        avatarColor: pickAvatarColor(name),
        lastLoginAt: null,
        inviteId: invite.id,
      });

      const store = await getStore();
      await store.update('invites', invite.id, { useCount: (invite.useCount ?? 0) + 1 });
      return { status: 201, user, invite };
    });

    if (result.status !== 201) return res.status(result.status).json(result.body);

    await logActivity({
      organizationId: organizationOf(result.invite),
      actorId: result.user.id,
      action: 'invite.accept',
      subject: 'user',
      subjectId: result.user.id,
      meta: { inviteId: result.invite.id, department: result.user.department },
    });
    await alertApprovers(result.user);

    res.status(201).json({ status: 'pending_approval', name: result.user.name });
  } catch (error) {
    console.error('[invites] accept failed', error);
    res.status(500).json({ error: 'server_error' });
  }
});

/* ── helpers ─────────────────────────────────────────────────────── */

function inviteState(invite) {
  if (invite.revokedAt) return 'revoked';
  if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) return 'expired';
  if (invite.maxUses && (invite.useCount ?? 0) >= invite.maxUses) return 'exhausted';
  return 'active';
}

/** Everyone who can actually act on the request gets told about it. */
async function alertApprovers(newUser) {
  const admins = await find(
    'users',
    (user) =>
      isActiveUser(user) &&
      organizationOf(user) === organizationOf(newUser) &&
      can(user, PERMISSIONS.USERS_MANAGE)
  );

  const title = {
    ar: `طلب انضمام جديد: ${newUser.name}`,
    en: `New join request: ${newUser.name}`,
  };
  const body = {
    ar: 'الحساب في انتظار موافقتك من صفحة المستخدمين.',
    en: 'The account is waiting for your approval on the Users page.',
  };

  for (const admin of admins) {
    await create('notifications', {
      userId: admin.id,
      actorId: newUser.id,
      type: 'user.join_request',
      title,
      body: body.ar,
      link: `/users?user=${newUser.id}`,
      read: false,
    });
    await notifyUser(admin.id, { title, body, link: `/users?user=${newUser.id}` });
  }
}

function normaliseDepartments(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const clean = [...new Set(value.map(String))];
  if (clean.some((id) => !DEPARTMENT_IDS.includes(id))) return null;
  return clean;
}

/** `0` means unlimited, `null` means the caller sent something invalid. */
function normaliseMaxUses(value) {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_USES_LIMIT) return null;
  return parsed;
}

function normalisePermissions(value) {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.filter((permission) => ALL_PERMISSIONS.includes(permission)))];
}

function normaliseAppIds(value) {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.map(String))];
}

const AVATAR_COLORS = ['#1D6FB8', '#F5821F', '#0EA5A5', '#6366F1', '#16A34A', '#7C3AED', '#0B2545'];
function pickAvatarColor(seed) {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export { INVITABLE_ROLES };
export default router;
