import { Router } from 'express';
import { create, find, findOne, getStore } from '../store.js';
import { hashPassword, logActivity, requirePermission } from '../auth.js';
import { notifyUser } from '../push.js';
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  ROLE_IDS,
  USER_STATUSES,
  VISIBILITY_SCOPES,
  isActiveUser,
  permissionsFor,
  publicUser,
} from '../../shared/permissions.js';
import {
  DEFAULT_DEPARTMENT,
  DEPARTMENT_IDS,
  getJobRole,
  getSubteam,
} from '../../shared/departments.js';
import { canUseDepartment, visiblePeople } from '../taskAccess.js';
import { organizationOf } from '../../shared/organization.js';
import { assigneesOf, assignmentRows } from '../../shared/workflow.js';
import {
  TASK_WORKFLOW_ROLES,
  inferredMarketingWorkflowRoles,
} from '../../shared/marketingWorkflow.js';

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get('/', requirePermission(PERMISSIONS.USERS_VIEW), async (req, res) => {
  const users = visiblePeople(req.user, await find('users'));
  res.json({
    users: users
      .map(publicUser)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
  });
});

router.post('/', requirePermission(PERMISSIONS.USERS_MANAGE), async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const role = String(req.body?.role || 'member');

  if (!name) return res.status(400).json({ error: 'name_required' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'invalid_email' });
  if (password.length < 8) return res.status(400).json({ error: 'weak_password', minLength: 8 });
  if (!ROLE_IDS.includes(role)) return res.status(400).json({ error: 'unknown_role' });
  if (await findOne('users', (u) => u.email === email)) {
    return res.status(409).json({ error: 'email_taken' });
  }

  const department = DEPARTMENT_IDS.includes(req.body?.department)
    ? req.body.department
    : req.user.department ?? DEFAULT_DEPARTMENT;
  if (!canUseDepartment(req.user, department)) {
    return res.status(403).json({ error: 'forbidden_team' });
  }
  const organisation = parseOrganisation(req.body, department);
  if (organisation.error) return res.status(400).json({ error: organisation.error });

  const requestedPermissions = normalisePermissions(req.body?.permissions);
  const workflow = provisionMarketingWorkflow({
    name,
    department,
    role,
    status: 'active',
    permissions: requestedPermissions,
  });
  const user = await create('users', {
    name,
    email,
    passwordHash: await hashPassword(password),
    role,
    organizationId: organizationOf(req.user),
    status: 'active',
    // null on both = "inherit from role" / "every app". Explicit arrays override.
    permissions: workflow.permissions,
    appIds: normaliseAppIds(req.body?.appIds),
    department,
    subteam: organisation.subteam,
    jobRole: organisation.jobRole,
    // null = as wide as the role allows. Anything else narrows it.
    visibilityScope: workflow.visibilityScope ?? normaliseScope(req.body?.visibilityScope),
    taskWorkflowRoles: workflow.taskWorkflowRoles,
    title: req.body?.title ? String(req.body.title).trim() : null,
    avatarColor: pickAvatarColor(name),
    lastLoginAt: null,
  });

  await logActivity({
    actorId: req.user.id,
    action: 'user.create',
    subject: 'user',
    subjectId: user.id,
    meta: { name, role },
  });
  res.status(201).json({ user: publicUser(user) });
});

router.patch('/:id', requirePermission(PERMISSIONS.USERS_MANAGE), async (req, res) => {
  const store = await getStore();
  const target = await findOne('users', (u) => u.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'not_found' });
  if (!visiblePeople(req.user, [target]).length) {
    return res.status(404).json({ error: 'not_found' });
  }

  const patch = {};
  if (req.body?.name !== undefined) patch.name = String(req.body.name).trim();
  if (req.body?.title !== undefined) patch.title = String(req.body.title || '').trim() || null;

  if (req.body?.email !== undefined) {
    const email = String(req.body.email).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'invalid_email' });
    const clash = await findOne('users', (u) => u.email === email && u.id !== target.id);
    if (clash) return res.status(409).json({ error: 'email_taken' });
    patch.email = email;
  }

  if (req.body?.role !== undefined) {
    if (!ROLE_IDS.includes(req.body.role)) return res.status(400).json({ error: 'unknown_role' });
    patch.role = req.body.role;
  }

  if (req.body?.password) {
    if (String(req.body.password).length < 8) {
      return res.status(400).json({ error: 'weak_password', minLength: 8 });
    }
    patch.passwordHash = await hashPassword(String(req.body.password));
  }

  if (req.body?.department !== undefined) {
    if (!DEPARTMENT_IDS.includes(req.body.department)) {
      return res.status(400).json({ error: 'invalid_department' });
    }
    if (!canUseDepartment(req.user, req.body.department)) {
      return res.status(403).json({ error: 'forbidden_team' });
    }
    patch.department = req.body.department;
  }

  if (
    req.body?.subteam !== undefined ||
    req.body?.jobRole !== undefined ||
    (patch.department && patch.department !== target.department)
  ) {
    const department = patch.department ?? target.department ?? DEFAULT_DEPARTMENT;
    const organisation = parseOrganisation(
      {
        subteam:
          req.body?.subteam !== undefined
            ? req.body.subteam
            : patch.department !== undefined
              ? null
              : target.subteam,
        jobRole:
          req.body?.jobRole !== undefined
            ? req.body.jobRole
            : req.body?.subteam !== undefined || patch.department !== undefined
              ? null
              : target.jobRole,
      },
      department
    );
    if (organisation.error) return res.status(400).json({ error: organisation.error });
    patch.subteam = organisation.subteam;
    patch.jobRole = organisation.jobRole;
  }

  if (req.body?.permissions !== undefined) {
    patch.permissions = normalisePermissions(req.body.permissions);
  }
  if (req.body?.appIds !== undefined) patch.appIds = normaliseAppIds(req.body.appIds);
  if (req.body?.visibilityScope !== undefined) {
    patch.visibilityScope = normaliseScope(req.body.visibilityScope);
  }
  if (req.body?.status !== undefined) {
    if (!USER_STATUSES.includes(req.body.status)) {
      return res.status(400).json({ error: 'invalid_status' });
    }
    patch.status = req.body.status;
  }

  // An admin must not be able to demote or park the last way back in. A pending
  // admin is not a way back in either — they cannot sign in yet.
  const losingAdmin =
    (patch.role && patch.role !== 'admin' && target.role === 'admin') ||
    (patch.status && patch.status !== 'active' && target.role === 'admin');
  if (losingAdmin) {
    const admins = await find(
      'users',
      (u) => u.role === 'admin' && isActiveUser(u) && u.id !== target.id
    );
    if (admins.length === 0) return res.status(409).json({ error: 'last_admin' });
  }

  const approving = target.status === 'pending' && patch.status === 'active';
  const updated = await store.update('users', target.id, patch);
  await logActivity({
    actorId: req.user.id,
    action: approving ? 'user.approve' : 'user.update',
    subject: 'user',
    subjectId: target.id,
    meta: { fields: Object.keys(patch).filter((k) => k !== 'passwordHash') },
  });

  // They are already sitting on the "waiting for approval" screen, so the one
  // thing worth interrupting them for is that it is over.
  if (approving) {
    await create('notifications', {
      userId: target.id,
      actorId: req.user.id,
      type: 'account.approved',
      title: {
        ar: 'تم تفعيل حسابك',
        en: 'Your account is active',
      },
      body: '',
      link: '/',
      read: false,
    });
    await notifyUser(target.id, {
      title: { ar: 'تم تفعيل حسابك', en: 'Your account is active' },
      body: {
        ar: 'تقدر تسجّل الدخول لمساحة عمل إنجوسوفت دلوقتي.',
        en: 'You can sign in to the Engosoft workspace now.',
      },
      link: '/',
    });
  }

  res.json({ user: publicUser(updated) });
});

router.delete('/:id', requirePermission(PERMISSIONS.USERS_MANAGE), async (req, res) => {
  const store = await getStore();
  const target = await findOne('users', (u) => u.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'not_found' });
  if (!visiblePeople(req.user, [target]).length) {
    return res.status(404).json({ error: 'not_found' });
  }
  if (target.id === req.user.id) return res.status(409).json({ error: 'cannot_delete_self' });

  if (target.role === 'admin') {
    const admins = await find(
      'users',
      (u) => u.role === 'admin' && isActiveUser(u) && u.id !== target.id
    );
    if (admins.length === 0) return res.status(409).json({ error: 'last_admin' });
  }

  // Their tasks outlive them — unassign rather than cascade-delete work.
  const owned = await find(
    'tasks',
    (t) => assigneesOf(t).includes(target.id) && organizationOf(t) === organizationOf(target)
  );
  for (const task of owned) {
    // Only this person comes off. A task they shared stays with its other
    // partners rather than being emptied because one of them left.
    const remaining = assigneesOf(task).filter((id) => id !== target.id);
    await store.update('tasks', task.id, {
      assigneeIds: remaining,
      assignments: assignmentRows(task).filter((row) => row.userId !== target.id),
      assigneeId: null,
      ...(remaining.length === 0 ? { assignedAt: null, assignedBy: null } : {}),
    });
    await create('taskAssignments', {
      organizationId: organizationOf(task),
      taskId: task.id,
      actorId: req.user.id,
      action: 'unassigned',
      assigneeIds: remaining,
      meta: { previousAssigneeId: target.id, reason: 'user_deleted' },
    });
  }

  await store.remove('users', target.id);
  await logActivity({
    actorId: req.user.id,
    action: 'user.delete',
    subject: 'user',
    subjectId: target.id,
    meta: { name: target.name, unassignedTasks: owned.length },
  });
  res.json({ ok: true, unassignedTasks: owned.length });
});

router.get('/meta/permissions', requirePermission(PERMISSIONS.USERS_VIEW), (_req, res) => {
  res.json({ permissions: ALL_PERMISSIONS, roles: ROLE_IDS });
});

function normalisePermissions(value) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return null;
  const clean = [...new Set(value.filter((p) => ALL_PERMISSIONS.includes(p)))];
  return clean;
}

function provisionMarketingWorkflow(user) {
  const taskWorkflowRoles = inferredMarketingWorkflowRoles(user);
  let permissions = user.permissions;
  let visibilityScope = null;

  if (taskWorkflowRoles.includes(TASK_WORKFLOW_ROLES.MARKETING_REVIEWER)) {
    const access = [
      PERMISSIONS.APPS_VIEW,
      PERMISSIONS.TASKS_VIEW,
      PERMISSIONS.TASKS_VIEW_TEAM,
      PERMISSIONS.TASKS_REVIEW,
      PERMISSIONS.TASKS_APPROVE,
      PERMISSIONS.TASKS_SCORE,
    ];
    permissions = [...new Set([...permissionsFor(user), ...access])].filter(
      (permission) => permission !== PERMISSIONS.TASKS_PUBLISH
    );
    visibilityScope = 'department';
  }

  if (taskWorkflowRoles.includes(TASK_WORKFLOW_ROLES.MARKETING_FINAL_APPROVER)) {
    const access = [
      PERMISSIONS.APPS_VIEW,
      PERMISSIONS.TASKS_VIEW,
      PERMISSIONS.TASKS_VIEW_TEAM,
      PERMISSIONS.TASKS_PUBLISH,
      PERMISSIONS.TASKS_SCORE,
    ];
    permissions = [...new Set([...(permissions ?? permissionsFor(user)), ...access])];
    visibilityScope = 'department';
  }

  return { permissions, visibilityScope, taskWorkflowRoles };
}

function normaliseAppIds(value) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return null;
  return [...new Set(value.map(String))];
}

/**
 * An unrecognised scope becomes null rather than an error: null already means
 * "follow the role", which is the safe reading of a value we don't understand.
 * `visibilityFor` caps whatever survives against the user's permissions anyway.
 */
function normaliseScope(value) {
  return VISIBILITY_SCOPES.includes(value) ? value : null;
}

function parseOrganisation(body, department) {
  const subteam = body?.subteam ? String(body.subteam) : null;
  const jobRole = body?.jobRole ? String(body.jobRole) : null;
  if (subteam && !getSubteam(department, subteam)) return { error: 'invalid_subteam' };
  if (jobRole && !getJobRole(department, subteam, jobRole)) {
    return { error: 'invalid_job_role' };
  }
  return { subteam, jobRole };
}

const AVATAR_COLORS = ['#1D6FB8', '#F5821F', '#0EA5A5', '#6366F1', '#16A34A', '#7C3AED', '#0B2545'];
function pickAvatarColor(seed) {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export default router;
