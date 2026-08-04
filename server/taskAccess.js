import { PERMISSIONS, can, visibilityFor } from '../shared/permissions.js';
import { DEFAULT_DEPARTMENT } from '../shared/departments.js';
import { organizationOf, sameOrganization } from '../shared/organization.js';

export const departmentOf = (record) => record?.department ?? DEFAULT_DEPARTMENT;
export const subteamOf = (record) => record?.subteam ?? null;

export function sameDepartment(user, record) {
  return sameOrganization(user, record) && departmentOf(user) === departmentOf(record);
}

/**
 * Sub-team membership only means something inside a shared department, and only
 * when both sides actually declare one. A person with no sub-team, or a task
 * filed against the department as a whole, is nobody's sub-team business — the
 * `own` fallback in `canViewTask` still lets them at their own work.
 */
export function sameSubteam(user, record) {
  if (!sameDepartment(user, record)) return false;
  const mine = subteamOf(user);
  return Boolean(mine) && mine === subteamOf(record);
}

export const isOwnTask = (user, task) =>
  task.assigneeId === user.id || task.createdBy === user.id;

/**
 * Task visibility has four explicit scopes, from `shared/permissions.js`:
 *   all        → administrators with tasks.view_all
 *   department → people with tasks.view_team, limited to their department
 *   subteam    → the same, narrowed to their branch of the department tree
 *   own        → assigned to or created by the current person
 *
 * The scope is capped by permissions before it gets here, so a narrower setting
 * on a user document can only ever remove rows, never add them. Work a person
 * is assigned to or filed themselves is always visible whatever the scope —
 * hiding someone's own task from them is a bug, not a policy.
 */
export function canViewTask(user, task) {
  if (!can(user, PERMISSIONS.TASKS_VIEW)) return false;
  if (!sameOrganization(user, task)) return false;
  if (isOwnTask(user, task)) return true;

  switch (visibilityFor(user)) {
    case 'all':
      return true;
    case 'department':
      return sameDepartment(user, task);
    case 'subteam':
      return sameSubteam(user, task);
    default:
      return false;
  }
}

export function taskPredicate(user) {
  return (task) => canViewTask(user, task);
}

export const isArchived = (task) => Boolean(task?.archivedAt);

/**
 * What a board, a badge count or a performance table is made of: visible *and*
 * still live.
 *
 * Archiving is the answer to "this task should not have been filed" — it takes
 * the card off the board without taking the history with it, which is the whole
 * reason it exists in place of the old permanent delete. So archived work is
 * excluded from every listing but stays reachable by id, because restoring it
 * means being able to load it first.
 */
export function livePredicate(user) {
  const visible = taskPredicate(user);
  return (task) => visible(task) && !isArchived(task);
}

/**
 * Taking a task off the board. A supervisor's correction, never the doer's
 * undo: an assignee who could archive their own work could make a task that
 * went badly stop counting against them.
 */
export function canArchiveTask(user, task) {
  if (!canViewTask(user, task)) return false;
  if (!can(user, PERMISSIONS.TASKS_ARCHIVE)) return false;
  return can(user, PERMISSIONS.TASKS_VIEW_ALL) || sameDepartment(user, task);
}

/**
 * Editing the *content* of a task — progress, notes, labels. The assignee is
 * included because that is the work itself; the brief and the plan are a
 * separate authority and go through `canManageTaskPlan`.
 */
export function canEditTask(user, task) {
  if (!canViewTask(user, task)) return false;
  if (can(user, PERMISSIONS.TASKS_VIEW_ALL) && can(user, PERMISSIONS.TASKS_EDIT_ANY)) return true;
  if (sameDepartment(user, task) && can(user, PERMISSIONS.TASKS_EDIT_ANY)) return true;
  return task.createdBy === user.id || task.assigneeId === user.id;
}

/**
 * The permanent purge — it takes the comments and the deliverables with it and
 * nothing brings them back. It is not the way to clear a board (that is
 * `canArchiveTask`) and not something the person being measured by the task may
 * do: filing a task deliberately grants no right to unfile it, because that was
 * how a task that went badly could be made to disappear from the record.
 *
 * Deliberately administrator-only. A department manager can take any of their
 * team's work off the board, but destroying the record of it is a retention
 * decision that belongs one level up.
 */
export function canDeleteTask(user, task) {
  if (!canViewTask(user, task)) return false;
  return can(user, PERMISSIONS.TASKS_DELETE_ANY) && can(user, PERMISSIONS.TASKS_VIEW_ALL);
}

/**
 * The brief and the plan — who owns the work, which team it belongs to, what
 * it asks for and when it is due. This is the commissioning half of the
 * contract and needs `tasks.assign`, never merely having filed the task.
 *
 * The due date is the reason this matters most: `performanceSummary` measures
 * `onTimeRate` and `overdue` against it, so anyone who can set their own due
 * date is writing the metric they are judged by.
 */
export function canManageTaskPlan(user, task) {
  if (!canViewTask(user, task)) return false;
  if (!can(user, PERMISSIONS.TASKS_ASSIGN)) return false;
  return can(user, PERMISSIONS.TASKS_VIEW_ALL) || sameDepartment(user, task);
}

/** Reading the team's scores, as opposed to only one's own. */
export function canManagePerformance(user) {
  return can(user, PERMISSIONS.TASKS_SCORE);
}

export function canUseDepartment(user, department) {
  return can(user, PERMISSIONS.TASKS_VIEW_ALL) || department === departmentOf(user);
}

export function canAssignUser(actor, assignee, department) {
  if (!assignee || assignee.status !== 'active') return false;
  if (!sameOrganization(actor, assignee)) return false;
  if (!can(actor, PERMISSIONS.TASKS_ASSIGN)) return false;
  if (departmentOf(assignee) !== department) return false;
  if (can(actor, PERMISSIONS.TASKS_VIEW_ALL)) return true;
  if (department !== departmentOf(actor)) return false;
  // Someone who can only see their branch of the tree can only staff it too.
  if (visibilityFor(actor) === 'subteam') return subteamOf(assignee) === subteamOf(actor);
  return true;
}

/**
 * The people a user is allowed to know about — the assignment picker, the
 * directory and every performance table read from this.
 */
export function visiblePeople(user, people) {
  const sameTenant = people.filter((person) => organizationOf(person) === organizationOf(user));
  switch (visibilityFor(user)) {
    case 'all':
      return sameTenant;
    case 'department':
      return sameTenant.filter((person) => sameDepartment(user, person));
    case 'subteam':
      return sameTenant.filter(
        (person) => person.id === user.id || sameSubteam(user, person)
      );
    default:
      return sameTenant.filter((person) => person.id === user.id);
  }
}

/**
 * Scores and the manager's written verdict are performance data — feedback for
 * one person, not team news. A manager sees the team's; an employee sees only
 * their own. Everything else about the task stays visible so the team can still
 * work together on it.
 */
export function taskForUser(user, task) {
  if (canManagePerformance(user) || task.assigneeId === user.id) return task;
  return { ...task, score: null, scoreBy: null, scoredAt: null, reviewNote: '' };
}
