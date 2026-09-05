/**
 * Qodo Projects — the permission catalogue.
 *
 * Imported by the Express API (the enforcement point) and by React (to hide
 * what you cannot do). Exactly the arrangement `shared/permissions.js` already
 * uses for the workspace, and for the same reason: one definition, two readers,
 * and the server always re-checks.
 *
 * Two layers decide a Projects request, and conflating them is the mistake this
 * file exists to prevent:
 *
 *   1. **Portal layer** — a permission set (Zoho calls these "permission sets";
 *      they were "profiles" until May 2025) says what a person may do *in this
 *      organization at all*: create projects, edit automation, see rates.
 *   2. **Project layer** — membership in a specific project says *which*
 *      projects those powers reach. Holding `task.edit` does not let you edit a
 *      task in a project you are not a member of.
 *
 * Both must pass. A portal permission is a ceiling, never a grant, and the
 * absence of either is a denial — see `deny by default` in `canInProject`.
 */

/* ------------------------------------------------------------------ */
/* The catalogue                                                        */
/* ------------------------------------------------------------------ */

/**
 * Every permission Qodo Projects understands.
 *
 * Grouped by module, and deliberately fine-grained: the workspace already
 * learned this lesson once — `shared/permissions.js` documents how a single
 * `tasks.edit_any` key meant "edit", "review", "approve" and "score" all at
 * once, and how there was consequently no way to appoint a reviewer who is not
 * also a planner. Projects starts split.
 */
export const PROJECT_PERMISSIONS = {
  /* ── projects ─────────────────────────────────────────────── */
  PROJECT_VIEW: 'project.view',
  PROJECT_CREATE: 'project.create',
  PROJECT_EDIT: 'project.edit',
  PROJECT_ARCHIVE: 'project.archive',
  PROJECT_DELETE: 'project.delete',
  PROJECT_PURGE: 'project.purge',
  PROJECT_MANAGE_MEMBERS: 'project.manage_members',
  PROJECT_MANAGE_GROUPS: 'project.manage_groups',
  PROJECT_CLONE: 'project.clone',

  /* ── work breakdown ───────────────────────────────────────── */
  PHASE_VIEW: 'phase.view',
  PHASE_CREATE: 'phase.create',
  PHASE_EDIT: 'phase.edit',
  PHASE_DELETE: 'phase.delete',

  TASKLIST_VIEW: 'tasklist.view',
  TASKLIST_CREATE: 'tasklist.create',
  TASKLIST_EDIT: 'tasklist.edit',
  TASKLIST_DELETE: 'tasklist.delete',

  TASK_VIEW: 'task.view',
  TASK_CREATE: 'task.create',
  TASK_EDIT: 'task.edit',
  /** Moving a bar on the Gantt or a due date in the form — the same key. */
  TASK_EDIT_SCHEDULE: 'task.edit_schedule',
  /** Dragging a Kanban card is this permission, not a UI affordance. */
  TASK_EDIT_STATUS: 'task.edit_status',
  TASK_ASSIGN: 'task.assign',
  TASK_DELETE: 'task.delete',

  /* ── issues ───────────────────────────────────────────────── */
  ISSUE_VIEW: 'issue.view',
  ISSUE_CREATE: 'issue.create',
  ISSUE_EDIT: 'issue.edit',
  ISSUE_ASSIGN: 'issue.assign',
  ISSUE_DELETE: 'issue.delete',
  SLA_MANAGE: 'sla.manage',

  /* ── time ─────────────────────────────────────────────────── */
  TIME_VIEW: 'time.view',
  /** Logging *your own* time. Logging somebody else's is `time.log_others`. */
  TIME_LOG: 'time.log',
  TIME_LOG_OTHERS: 'time.log_others',
  TIME_EDIT_ANY: 'time.edit_any',
  TIMESHEET_SUBMIT: 'timesheet.submit',
  TIMESHEET_APPROVE: 'timesheet.approve',

  /* ── money ────────────────────────────────────────────────── */
  BUDGET_VIEW: 'budget.view',
  BUDGET_MANAGE: 'budget.manage',
  /**
   * What somebody costs per hour and what they are billed at. Split from
   * `budget.view` on purpose: a project manager needs to know the project is
   * over budget without being handed every colleague's salary band.
   */
  RATE_VIEW: 'rate.view',
  RATE_MANAGE: 'rate.manage',
  BILLING_MANAGE: 'billing.manage',

  /* ── collaboration ────────────────────────────────────────── */
  COMMENT_CREATE: 'comment.create',
  COMMENT_EDIT_ANY: 'comment.edit_any',
  COMMENT_DELETE_ANY: 'comment.delete_any',
  /** Writing a comment clients must never see. Absent from every client set. */
  COMMENT_INTERNAL: 'comment.internal',
  FORUM_VIEW: 'forum.view',
  FORUM_POST: 'forum.post',
  FORUM_MODERATE: 'forum.moderate',
  PAGE_VIEW: 'page.view',
  PAGE_EDIT: 'page.edit',
  DOCUMENT_VIEW: 'document.view',
  DOCUMENT_UPLOAD: 'document.upload',
  DOCUMENT_DELETE: 'document.delete',

  /* ── reporting ────────────────────────────────────────────── */
  REPORTS_VIEW: 'reports.view',
  REPORTS_TIME: 'reports.time',
  REPORTS_FINANCE: 'reports.finance',
  REPORTS_RESOURCE: 'reports.resource',
  REPORTS_PORTFOLIO: 'reports.portfolio',
  REPORTS_MANAGE: 'reports.manage',
  DASHBOARD_VIEW: 'dashboard.view',
  DASHBOARD_MANAGE: 'dashboard.manage',

  /* ── administration ───────────────────────────────────────── */
  CUSTOMIZATION_MANAGE: 'customization.manage',
  AUTOMATION_MANAGE: 'automation.manage',
  BLUEPRINT_MANAGE: 'blueprint.manage',
  TEMPLATE_MANAGE: 'template.manage',
  VIEW_MANAGE: 'view.manage',
  TAG_MANAGE: 'tag.manage',
  INTEGRATION_MANAGE: 'integration.manage',
  /** The sandboxed script runner. Belongs to no set by default — see below. */
  DEVELOPER_MANAGE: 'developer.manage',
  PERMISSIONS_MANAGE: 'permissions.manage',
  CLIENT_MANAGE: 'client.manage',
  BASELINE_CREATE: 'baseline.create',
  BASELINE_EDIT: 'baseline.edit',
  BASELINE_DELETE: 'baseline.delete',
  AUDIT_VIEW: 'audit.view',
  RECYCLEBIN_VIEW: 'recyclebin.view',
  RECYCLEBIN_PURGE: 'recyclebin.purge',
  DATA_IMPORT: 'data.import',
  DATA_EXPORT: 'data.export',
};

export const ALL_PROJECT_PERMISSIONS = Object.values(PROJECT_PERMISSIONS);

const P = PROJECT_PERMISSIONS;

/* ------------------------------------------------------------------ */
/* Permission sets                                                      */
/* ------------------------------------------------------------------ */

/**
 * The read-only half of every set, listed once because five sets share it and
 * a copy that drifts is how a viewer silently loses the ability to open a task.
 */
const READ_ONLY = [
  P.PROJECT_VIEW,
  P.PHASE_VIEW,
  P.TASKLIST_VIEW,
  P.TASK_VIEW,
  P.ISSUE_VIEW,
  P.DOCUMENT_VIEW,
  P.FORUM_VIEW,
  P.PAGE_VIEW,
  P.DASHBOARD_VIEW,
  P.REPORTS_VIEW,
];

/**
 * What somebody executing work may do: their own tasks, their own time, and
 * conversation. Notably absent — assigning, approving, budgets, rates.
 */
const CONTRIBUTOR = [
  ...READ_ONLY,
  P.TASK_CREATE,
  P.TASK_EDIT,
  P.TASK_EDIT_STATUS,
  P.ISSUE_CREATE,
  P.ISSUE_EDIT,
  P.TIME_VIEW,
  P.TIME_LOG,
  P.TIMESHEET_SUBMIT,
  P.COMMENT_CREATE,
  P.COMMENT_INTERNAL,
  P.FORUM_POST,
  P.DOCUMENT_UPLOAD,
  P.PAGE_EDIT,
];

/**
 * Built-in permission sets.
 *
 * `admin` is derived rather than listed: it holds `ALL_PROJECT_PERMISSIONS`, so
 * a key added to the catalogue reaches administrators without anyone
 * remembering to tick a box — the same arrangement `ROLES.admin` uses in
 * `shared/permissions.js`.
 *
 * Three keys are deliberately in **no** set except admin:
 *
 *   • `developer.manage` runs customer-authored scripts on our server.
 *   • `permissions.manage` can grant every other key, including itself.
 *   • `project.purge` destroys data the recycle bin exists to protect.
 *
 * That mirrors how the workspace already treats `management.view` and
 * `calendar.booking`: not a question of seniority, so no role expresses it, and
 * an administrator grants it one person at a time.
 */
export const PERMISSION_SETS = {
  admin: {
    id: 'admin',
    nameAr: 'مدير المشاريع',
    nameEn: 'Projects Administrator',
    descAr: 'صلاحية كاملة على المشاريع والإعدادات والأتمتة والتخصيص.',
    descEn: 'Full authority over projects, settings, automation and customization.',
    isClient: false,
    permissions: ALL_PROJECT_PERMISSIONS,
  },

  manager: {
    id: 'manager',
    nameAr: 'مدير مشروع',
    nameEn: 'Project Manager',
    descAr: 'يخطّط المشاريع ويكلّف الفريق ويعتمد الوقت ويتابع الميزانية.',
    descEn: 'Plans projects, assigns the team, approves time and watches the budget.',
    isClient: false,
    permissions: [
      ...CONTRIBUTOR,
      P.PROJECT_CREATE,
      P.PROJECT_EDIT,
      P.PROJECT_ARCHIVE,
      P.PROJECT_CLONE,
      P.PROJECT_MANAGE_MEMBERS,
      P.PHASE_CREATE,
      P.PHASE_EDIT,
      P.PHASE_DELETE,
      P.TASKLIST_CREATE,
      P.TASKLIST_EDIT,
      P.TASKLIST_DELETE,
      P.TASK_EDIT_SCHEDULE,
      P.TASK_ASSIGN,
      P.TASK_DELETE,
      P.ISSUE_ASSIGN,
      P.ISSUE_DELETE,
      P.TIME_LOG_OTHERS,
      P.TIME_EDIT_ANY,
      P.TIMESHEET_APPROVE,
      P.BUDGET_VIEW,
      P.BUDGET_MANAGE,
      P.COMMENT_EDIT_ANY,
      P.COMMENT_DELETE_ANY,
      P.FORUM_MODERATE,
      P.DOCUMENT_DELETE,
      P.REPORTS_TIME,
      P.REPORTS_FINANCE,
      P.REPORTS_RESOURCE,
      P.REPORTS_PORTFOLIO,
      P.REPORTS_MANAGE,
      P.DASHBOARD_MANAGE,
      P.VIEW_MANAGE,
      P.TAG_MANAGE,
      P.TEMPLATE_MANAGE,
      P.BASELINE_CREATE,
      P.BASELINE_EDIT,
      P.DATA_EXPORT,
    ],
  },

  employee: {
    id: 'employee',
    nameAr: 'موظف',
    nameEn: 'Employee',
    descAr: 'ينفّذ المهام المسندة إليه، ويسجّل وقته، ويشارك في النقاش.',
    descEn: 'Works assigned tasks, logs their time and joins the discussion.',
    isClient: false,
    permissions: CONTRIBUTOR,
  },

  /**
   * A contractor is an employee who is not part of the conversation about the
   * company: no internal comments, no forums, no reports. The distinction is
   * the reason this is a set rather than "employee with a flag".
   */
  contractor: {
    id: 'contractor',
    nameAr: 'متعاون خارجي',
    nameEn: 'Contractor',
    descAr: 'ينفّذ المهام المسندة إليه ويسجّل وقته، دون الوصول للنقاش الداخلي.',
    descEn: 'Works assigned tasks and logs time, with no access to internal discussion.',
    isClient: false,
    permissions: [
      P.PROJECT_VIEW,
      P.PHASE_VIEW,
      P.TASKLIST_VIEW,
      P.TASK_VIEW,
      P.TASK_EDIT,
      P.TASK_EDIT_STATUS,
      P.ISSUE_VIEW,
      P.ISSUE_CREATE,
      P.DOCUMENT_VIEW,
      P.DOCUMENT_UPLOAD,
      P.TIME_VIEW,
      P.TIME_LOG,
      P.TIMESHEET_SUBMIT,
      P.COMMENT_CREATE,
    ],
  },

  /**
   * The customer.
   *
   * This list is short on purpose and every omission is deliberate: no
   * `comment.internal`, no `time.*`, no `budget.*`, no `rate.*`, no reports, no
   * customization. `isClient` additionally makes `canInProject` refuse anything
   * marked internal, so even if somebody one day ticks a box that widens this
   * list, an internal task list still does not become readable — the flag is
   * the second lock, and it is not a permission anyone can grant.
   */
  client: {
    id: 'client',
    nameAr: 'عميل',
    nameEn: 'Client',
    descAr: 'يتابع تقدّم المشروع ويعلّق على ما هو مُشارَك معه فقط.',
    descEn: 'Follows progress and comments on what has been shared with them.',
    isClient: true,
    permissions: [
      P.PROJECT_VIEW,
      P.PHASE_VIEW,
      P.TASKLIST_VIEW,
      P.TASK_VIEW,
      P.ISSUE_VIEW,
      P.ISSUE_CREATE,
      P.DOCUMENT_VIEW,
      P.FORUM_VIEW,
      P.FORUM_POST,
      P.COMMENT_CREATE,
    ],
  },
};

export const PERMISSION_SET_IDS = Object.keys(PERMISSION_SETS);

/* ------------------------------------------------------------------ */
/* Project roles                                                        */
/* ------------------------------------------------------------------ */

/**
 * A person's role *inside one project*, which is not the same thing as their
 * permission set.
 *
 * The set says "this person is allowed to approve timesheets somewhere"; the
 * role says "in this project they are a member, not the manager". Zoho keeps
 * the same separation, and it is what lets one employee be a project manager on
 * their own project and an ordinary contributor on somebody else's without two
 * accounts.
 */
export const PROJECT_ROLES = {
  owner: { id: 'owner', nameAr: 'مالك المشروع', nameEn: 'Project Owner', isClient: false, rank: 3 },
  manager: { id: 'manager', nameAr: 'مدير المشروع', nameEn: 'Project Manager', isClient: false, rank: 2 },
  member: { id: 'member', nameAr: 'عضو', nameEn: 'Member', isClient: false, rank: 1 },
  viewer: { id: 'viewer', nameAr: 'مشاهد', nameEn: 'Viewer', isClient: false, rank: 0 },
  client: { id: 'client', nameAr: 'عميل', nameEn: 'Client', isClient: true, rank: 0 },
};

export const PROJECT_ROLE_IDS = Object.keys(PROJECT_ROLES);

/**
 * Roles that only ever read. A viewer or a client who somehow carries
 * `task.edit` still cannot write, because `canInProject` consults this before
 * it consults the permission list.
 */
const READ_ONLY_ROLES = new Set(['viewer', 'client']);

/**
 * The permissions a role withholds regardless of the permission set.
 *
 * This is the "role narrows, never widens" rule, and it is the mirror image of
 * `visibilityCeiling` in `shared/permissions.js`: there a dropdown may not hand
 * out reach the permissions do not justify, and here a permission set may not
 * hand out authority the project role does not justify. Being a `member` of a
 * project does not make you its manager, however senior you are elsewhere.
 */
const ROLE_WITHHOLDS = {
  member: new Set([
    P.PROJECT_EDIT,
    P.PROJECT_ARCHIVE,
    P.PROJECT_DELETE,
    P.PROJECT_MANAGE_MEMBERS,
    P.TIMESHEET_APPROVE,
    P.BUDGET_MANAGE,
    P.RATE_VIEW,
    P.RATE_MANAGE,
    P.BASELINE_CREATE,
    P.BASELINE_EDIT,
    P.BASELINE_DELETE,
  ]),
};

/* ------------------------------------------------------------------ */
/* Resolution                                                           */
/* ------------------------------------------------------------------ */

/**
 * Which keys this permission set actually carries.
 *
 * An explicit `permissions` array on the set row wins — that is an
 * administrator having ticked individual boxes, and once they have, the
 * built-in template stops applying to them. Same contract as `permissionsFor`
 * in `shared/permissions.js`, deliberately, so there is one thing to learn.
 */
export function permissionsOfSet(set) {
  if (!set) return [];
  if (Array.isArray(set.permissions)) return set.permissions;
  return PERMISSION_SETS[set.id]?.permissions ?? [];
}

export function isClientSet(set) {
  if (!set) return false;
  if (typeof set.isClient === 'boolean') return set.isClient;
  return PERMISSION_SETS[set.id]?.isClient ?? false;
}

/**
 * The one authorization question, asked the same way everywhere.
 *
 * `context` is `{ permissionSet, membership }`, both already loaded and both
 * already proven to belong to this organization. Returning `false` is the
 * default for every path that is not an explicit yes — that is what §60's "deny
 * by default" means in code, and it is why this function has no `else`.
 *
 * Callers must still decide *which* record the answer applies to. This says
 * "may this person edit tasks in this project"; it does not know whether the
 * task is theirs. Record-level rules live in the services.
 */
export function canInProject(context, permission) {
  const { permissionSet, membership } = context ?? {};

  // Not a member is not a weaker member — it is not a participant. The route
  // turns this into a 404 rather than a 403, because a 403 confirms the project
  // exists to somebody who should not know that.
  if (!membership) return false;

  const role = PROJECT_ROLES[membership.role] ? membership.role : 'viewer';

  // A client's membership and a client's permission set have to agree. If they
  // ever disagree the safe reading is "client", because the failure mode in the
  // other direction hands a customer an internal view.
  const clientSide = Boolean(membership.isClient) || isClientSet(permissionSet);
  if (clientSide && !CLIENT_SAFE.has(permission)) return false;

  if (READ_ONLY_ROLES.has(role) && !READ_PERMISSIONS.has(permission)) return false;

  if (ROLE_WITHHOLDS[role]?.has(permission)) return false;

  return permissionsOfSet(permissionSet).includes(permission);
}

/**
 * The keys a client user may ever hold, whatever their permission set says.
 *
 * Derived from the built-in client set rather than typed out again, so widening
 * the client set is one decision in one place — and narrowing it cannot leave a
 * stale duplicate behind that keeps granting the key.
 */
const CLIENT_SAFE = new Set(PERMISSION_SETS.client.permissions);

/**
 * Every key that only reads. Anything not in here is a write, and a viewer or a
 * client role is refused it.
 *
 * Built by matching the `.view` suffix plus the handful of read keys that do
 * not follow the naming — a list, rather than a regular expression alone,
 * because `reports.time` reads and `tag.manage` does not, and neither is
 * obvious from the name.
 */
const READ_PERMISSIONS = new Set([
  ...ALL_PROJECT_PERMISSIONS.filter((key) => key.endsWith('.view')),
  P.REPORTS_TIME,
  P.REPORTS_FINANCE,
  P.REPORTS_RESOURCE,
  P.REPORTS_PORTFOLIO,
]);

/** Exported for the tests that assert the client boundary has not widened. */
export const CLIENT_SAFE_PERMISSIONS = [...CLIENT_SAFE];
export const READ_ONLY_PERMISSIONS = [...READ_PERMISSIONS];

/**
 * Is this record something a client user may be shown at all?
 *
 * Phases, task lists, folders and comments each carry their own internal flag,
 * and the naming is not consistent across them — `is_external` on a task list,
 * `is_internal` on a comment — because each reads naturally in its own context.
 * This function is where that inconsistency is absorbed, so no call site has to
 * remember which way round a given table stores it.
 */
export function visibleToClient(record) {
  if (!record) return false;
  if (record.isInternal === true) return false;
  if (record.isExternal === false) return false;
  return true;
}
