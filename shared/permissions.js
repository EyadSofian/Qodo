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
  TASKS_ASSIGN: 'tasks.assign',
  TASKS_EDIT_ANY: 'tasks.edit_any',
  TASKS_REVIEW: 'tasks.review',
  TASKS_APPROVE: 'tasks.approve',
  TASKS_SCORE: 'tasks.score',
  TASKS_PUBLISH: 'tasks.publish',
  TASKS_RESET_PENDING: 'tasks.reset_pending',
  TASKS_MOVE_ANY: 'tasks.move_any',
  TASKS_ARCHIVE: 'tasks.archive',
  TASKS_DELETE_ANY: 'tasks.delete_any',
  TASKS_EXPORT: 'tasks.export',
  MANAGEMENT_VIEW: 'management.view',
  MANAGEMENT_MANAGE: 'management.manage',
  // Reading the seating plan needs no key at all — see the note below.
  OFFICES_MANAGE: 'offices.manage',
  USERS_VIEW: 'users.view',
  USERS_MANAGE: 'users.manage',
  SETTINGS_MANAGE: 'settings.manage',
};

export const ALL_PERMISSIONS = Object.values(PERMISSIONS);

/**
 * The authority keys that used to hide inside `tasks.edit_any`.
 *
 * One key meant "edit someone else's task" *and* "review it", "approve it",
 * "score it" and "own its plan" — so there was no way to appoint a reviewer who
 * is not also a planner, and no way to let a team lead assign work without also
 * handing them the power to close it and score it. Splitting them is the whole
 * point of the four names below; `deriveLegacyAuthority` keeps the people who
 * already carry the old key from losing anything on the way.
 */
const AUTHORITY_PERMISSIONS = [
  PERMISSIONS.TASKS_ASSIGN,
  PERMISSIONS.TASKS_REVIEW,
  PERMISSIONS.TASKS_APPROVE,
  PERMISSIONS.TASKS_SCORE,
];

/**
 * The management desk is deliberately absent from every role below, including
 * `manager`.
 *
 * `management.view` and `management.manage` open the executive's own diary —
 * who the board is meeting, what was decided, what the owner owes this week.
 * That is not "what a manager does", it is "which particular people are on the
 * management desk", and no role can express that. So both keys are granted one
 * person at a time through the permission override, and only `admin` carries
 * them by virtue of holding everything.
 */

/**
 * The seating plan has a manage key and no view key, on purpose.
 *
 * Reading it is gated by nothing but a session, exactly as Qodo Calendar is: a
 * plan the staff cannot open does not answer "where does she sit". A view
 * permission would also have been born locked — `permissionsFor` freezes an
 * explicit `user.permissions` array on the day an administrator ticks the
 * boxes, so a key added to a role afterwards never reaches anybody carrying
 * one.
 *
 * `offices.manage` — moving a person from one desk to another — belongs to no
 * role for the same reason `management.view` does not: being a department
 * manager is not what makes somebody the person who runs the floor. It is
 * granted one person at a time, and `admin` holds it by holding everything.
 */

/**
 * A task is a contract between two people: one side commissions the work, the
 * other side does it. Nobody may play both parts, which is why creating,
 * assigning, planning, reviewing, approving and scoring all sit on the
 * commissioning side and none of them reach the `member` role by default.
 *
 * `defaultVisibility` is the scope the role starts at, and it is deliberately
 * *not* the same thing as the ceiling the permissions justify: an employee
 * starts at their own sub-team, but an administrator can still widen one
 * person to the whole department because `tasks.view_team` allows it. See
 * `visibilityFor`.
 */
export const ROLES = {
  admin: {
    id: 'admin',
    nameAr: 'مدير النظام',
    nameEn: 'Administrator',
    descAr: 'صلاحية كاملة: المستخدمين، التطبيقات، الإعدادات، وكل المهام.',
    permissions: ALL_PERMISSIONS,
    defaultVisibility: 'all',
  },
  manager: {
    id: 'manager',
    nameAr: 'مدير',
    nameEn: 'Manager',
    descAr: 'يكلّف فريقه بالمهام، ويراجعها ويعتمدها ويقيّمها، ويصدّر تقاريره.',
    permissions: [
      PERMISSIONS.APPS_VIEW,
      PERMISSIONS.TASKS_VIEW,
      PERMISSIONS.TASKS_VIEW_TEAM,
      PERMISSIONS.TASKS_CREATE,
      PERMISSIONS.TASKS_ASSIGN,
      PERMISSIONS.TASKS_EDIT_ANY,
      PERMISSIONS.TASKS_REVIEW,
      PERMISSIONS.TASKS_APPROVE,
      PERMISSIONS.TASKS_SCORE,
      PERMISSIONS.TASKS_ARCHIVE,
      PERMISSIONS.TASKS_EXPORT,
      PERMISSIONS.USERS_VIEW,
    ],
    defaultVisibility: 'department',
  },
  member: {
    id: 'member',
    nameAr: 'موظف',
    nameEn: 'Member',
    descAr: 'ينفّذ المهام المسندة إليه ويسلّمها للمراجعة، ويرى أداءه هو فقط.',
    permissions: [
      PERMISSIONS.APPS_VIEW,
      PERMISSIONS.TASKS_VIEW,
      PERMISSIONS.TASKS_VIEW_TEAM,
    ],
    defaultVisibility: 'subteam',
  },
  viewer: {
    id: 'viewer',
    nameAr: 'مشاهدة فقط',
    nameEn: 'Viewer',
    descAr: 'يفتح التطبيقات المسموح بها ويقرأ لوحة فريقه دون تعديل.',
    permissions: [PERMISSIONS.APPS_VIEW, PERMISSIONS.TASKS_VIEW, PERMISSIONS.TASKS_VIEW_TEAM],
    defaultVisibility: 'subteam',
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
  if (Array.isArray(user.permissions)) return deriveLegacyAuthority(user.permissions);
  return ROLES[user.role]?.permissions ?? [];
}

/**
 * Stored overrides are frozen copies of the permission list as it was the day
 * an administrator ticked the boxes, so splitting `tasks.edit_any` into four
 * keys would silently strip review, approval and scoring from every one of
 * them. An override that predates the split is recognised by carrying the old
 * key and none of the new ones, and is read as still meaning all four.
 *
 * The moment an administrator saves that user again the array is rewritten with
 * explicit keys and this branch stops applying to them.
 */
function deriveLegacyAuthority(permissions) {
  let derived = permissions;
  if (
    derived.includes(PERMISSIONS.TASKS_EDIT_ANY) &&
    !derived.some((permission) => AUTHORITY_PERMISSIONS.includes(permission))
  ) {
    derived = [...derived, ...AUTHORITY_PERMISSIONS];
  }
  // `tasks.delete_any` used to be the only way to take a task off a board, and
  // it now means the permanent purge. Reading it as archiving too is what keeps
  // a manager's override from ending up unable to remove anything at all.
  if (
    derived.includes(PERMISSIONS.TASKS_DELETE_ANY) &&
    !derived.includes(PERMISSIONS.TASKS_ARCHIVE)
  ) {
    derived = [...derived, PERMISSIONS.TASKS_ARCHIVE];
  }
  return derived;
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
 * `null` — the normal case, and every user who predates the field — means
 * "follow the role", which for an employee is their own sub-team: a designer
 * sees the creative board, not the media buyers'. An administrator may set an
 * explicit scope to move a single person up to the department or down to their
 * own work, and it is still capped by `visibilityCeiling` so the dropdown can
 * never hand out reach the permissions do not justify.
 *
 * A sub-team default only means something to somebody who is in one. Sales and
 * operations declare no sub-teams at all, so for their staff the default falls
 * through to the department — otherwise adding this default would have quietly
 * emptied every board outside marketing. An *explicit* `subteam` choice is
 * never widened this way: an administrator who picked it meant it.
 */
export function visibilityFor(user) {
  const ceiling = visibilityCeiling(user);
  const explicit = VISIBILITY_SCOPES.includes(user?.visibilityScope)
    ? user.visibilityScope
    : null;

  let scope = explicit ?? ROLES[user?.role]?.defaultVisibility ?? ceiling;
  if (!explicit && scope === 'subteam' && !user?.subteam) scope = 'department';

  return VISIBILITY_SCOPES.indexOf(scope) < VISIBILITY_SCOPES.indexOf(ceiling) ? scope : ceiling;
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
  const {
    passwordHash: _password,
    googleSub: _googleSub,
    googleLinkedAt: _googleLinkedAt,
    ...rest
  } = user;
  return {
    ...rest,
    effectivePermissions: permissionsFor(user),
    effectiveVisibility: visibilityFor(user),
  };
}
