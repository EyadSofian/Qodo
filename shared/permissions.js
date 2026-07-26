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
  if (!user || user.status === 'disabled') return false;
  return permissionsFor(user).includes(permission);
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
  if (!user || user.status === 'disabled') return false;
  if (user.role === 'admin') return true;
  if (!Array.isArray(user.appIds)) return true;
  return user.appIds.includes(appId);
}

/** Strip everything the browser has no business seeing. */
export function publicUser(user) {
  if (!user) return null;
  const { passwordHash: _ignored, ...rest } = user;
  return { ...rest, effectivePermissions: permissionsFor(user) };
}
