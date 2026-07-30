/**
 * Roles and permissions — the single definition, imported by both the Express
 * API (as the enforcement point) and the React app (to hide what you can't do).
 *
 * The server always re-checks. The client copy is for the UI only.
 */

/** Every permission the workspace understands. */
export const PERMISSIONS = {
  APPS_VIEW: 'apps.view',
  APPS_MANAGE: 'apps.manage',
  TASKS_VIEW: 'tasks.view',
  TASKS_VIEW_TEAM: 'tasks.view_team',
  TASKS_VIEW_ALL: 'tasks.view_all',
  TASKS_CREATE: 'tasks.create',
  TASKS_EDIT_ANY: 'tasks.edit_any',
  TASKS_DELETE_ANY: 'tasks.delete_any',
  TASKS_EXPORT: 'tasks.export',
  USERS_VIEW: 'users.view',
  USERS_MANAGE: 'users.manage',
  SETTINGS_MANAGE: 'settings.manage',
};

export const ALL_PERMISSIONS = Object.values(PERMISSIONS);

export const ROLES = {
  admin: {
    id: 'admin',
    nameAr: 'مدير النظام',
    nameEn: 'Administrator',
    descAr: 'صلاحية كاملة: المستخدمين، التطبيقات، الإعدادات، وكل المهام.',
    permissions: ALL_PERMISSIONS,
  },
  manager: {
    id: 'manager',
    nameAr: 'مدير',
    nameEn: 'Manager',
    descAr: 'يرى مهام قسمه ويعدّلها، ويتابع أداء فريقه ويصدّر تقاريره.',
    permissions: [
      PERMISSIONS.APPS_VIEW,
      PERMISSIONS.TASKS_VIEW,
      PERMISSIONS.TASKS_VIEW_TEAM,
      PERMISSIONS.TASKS_CREATE,
      PERMISSIONS.TASKS_EDIT_ANY,
      PERMISSIONS.TASKS_DELETE_ANY,
      PERMISSIONS.TASKS_EXPORT,
      PERMISSIONS.USERS_VIEW,
    ],
  },
  member: {
    id: 'member',
    nameAr: 'موظف',
    nameEn: 'Member',
    descAr: 'يرى لوحة قسمه، ويعدّل مهامه، ويرى أداءه هو فقط.',
    permissions: [
      PERMISSIONS.APPS_VIEW,
      PERMISSIONS.TASKS_VIEW,
      PERMISSIONS.TASKS_VIEW_TEAM,
      PERMISSIONS.TASKS_CREATE,
    ],
  },
  viewer: {
    id: 'viewer',
    nameAr: 'مشاهدة فقط',
    nameEn: 'Viewer',
    descAr: 'يفتح التطبيقات المسموح بها ويقرأ لوحة قسمه دون تعديل.',
    permissions: [PERMISSIONS.APPS_VIEW, PERMISSIONS.TASKS_VIEW, PERMISSIONS.TASKS_VIEW_TEAM],
  },
};

export const ROLE_IDS = Object.keys(ROLES);

/**
 * Account states.
 *
 * `pending` is someone who signed up through an invite link and is waiting for
 * an administrator to let them in. They have a password and a row, but no
 * session and no permissions — deliberately indistinguishable from `disabled`
 * everywhere except the Users page, where an admin can approve them.
 */
export const USER_STATUSES = ['active', 'pending', 'disabled'];

export function isActiveUser(user) {
  // Legacy rows predate the field; absent means active.
  return Boolean(user) && (user.status ?? 'active') === 'active';
}

/**
 * How wide a person's task view reaches, narrowest first. The order is
 * meaningful — `visibilityFor` compares indexes to cap a request against what
 * the permissions actually allow.
 */
export const VISIBILITY_SCOPES = ['own', 'subteam', 'department', 'all'];

export const VISIBILITY_LABELS = {
  own: { ar: 'مهامه هو فقط', en: 'Only their own tasks' },
  subteam: { ar: 'فريقه الفرعي', en: 'Their sub-team' },
  department: { ar: 'القسم كله', en: 'The whole department' },
  all: { ar: 'كل الأقسام', en: 'Every department' },
};

/**
 * A user's effective permissions.
 *
 * `user.permissions` is an explicit override — when an admin ticks individual
 * boxes it is stored verbatim and the role defaults stop applying. Leaving it
 * null (the normal case) keeps the user tracking their role.
 */
export function permissionsFor(user) {
  if (!user) return [];
  if (Array.isArray(user.permissions)) return user.permissions;
  return ROLES[user.role]?.permissions ?? [];
}

export function can(user, permission) {
  if (!isActiveUser(user)) return false;
  return permissionsFor(user).includes(permission);
}

/**
 * The widest scope this user's permissions could ever justify. `visibilityScope`
 * is only allowed to narrow it, never to widen it — otherwise ticking a dropdown
 * in the user form would be a way to hand out `tasks.view_all` without the
 * permission that is supposed to gate it.
 */
export function visibilityCeiling(user) {
  if (can(user, PERMISSIONS.TASKS_VIEW_ALL)) return 'all';
  if (can(user, PERMISSIONS.TASKS_VIEW_TEAM)) return 'department';
  return 'own';
}

/**
 * The scope actually applied to a request.
 *
 * `null` (the default, and every user who existed before this field) means
 * "follow the role" — so adding the field changed nobody's view. An explicit
 * value narrows: a designer set to `subteam` stops seeing the media buyers'
 * board without losing anything else the member role grants.
 */
export function visibilityFor(user) {
  const ceiling = visibilityCeiling(user);
  const requested = user?.visibilityScope;
  if (!requested || !VISIBILITY_SCOPES.includes(requested)) return ceiling;
  return VISIBILITY_SCOPES.indexOf(requested) < VISIBILITY_SCOPES.indexOf(ceiling)
    ? requested
    : ceiling;
}

/** Scopes an admin may pick for this user — anything wider is not offered. */
export function availableScopes(user) {
  const ceiling = visibilityCeiling(user);
  return VISIBILITY_SCOPES.slice(0, VISIBILITY_SCOPES.indexOf(ceiling) + 1);
}

/**
 * App-tile visibility.
 *
 * `user.appIds === null` means "everything" — the default, so adding a new app
 * doesn't require touching every user. An array restricts to exactly that list.
 * Admins always see everything, otherwise they could lock themselves out of the
 * admin tiles.
 */
export function canOpenApp(user, appId) {
  if (!isActiveUser(user)) return false;
  if (user.role === 'admin') return true;
  if (!Array.isArray(user.appIds)) return true;
  return user.appIds.includes(appId);
}

/** Strip everything the browser has no business seeing. */
export function publicUser(user) {
  if (!user) return null;
  const { passwordHash: _ignored, ...rest } = user;
  return {
    ...rest,
    effectivePermissions: permissionsFor(user),
    effectiveVisibility: visibilityFor(user),
  };
}
