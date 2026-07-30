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

export function canEditTask(user, task) {
  if (!canViewTask(user, task)) return false;
  if (can(user, PERMISSIONS.TASKS_VIEW_ALL) && can(user, PERMISSIONS.TASKS_EDIT_ANY)) return true;
  if (sameDepartment(user, task) && can(user, PERMISSIONS.TASKS_EDIT_ANY)) return true;
  return task.createdBy === user.id || task.assigneeId === user.id;
}

export function canDeleteTask(user, task) {
  if (!canViewTask(user, task)) return false;
  if (can(user, PERMISSIONS.TASKS_VIEW_ALL) && can(user, PERMISSIONS.TASKS_DELETE_ANY)) return true;
  if (sameDepartment(user, task) && can(user, PERMISSIONS.TASKS_DELETE_ANY)) return true;
  return task.createdBy === user.id;
}

export function canManagePerformance(user) {
  return can(user, PERMISSIONS.TASKS_EDIT_ANY);
}

export function canUseDepartment(user, department) {
  return can(user, PERMISSIONS.TASKS_VIEW_ALL) || department === departmentOf(user);
}

export function canAssignUser(actor, assignee, department) {
  if (!assignee || assignee.status !== 'active') return false;
  if (!sameOrganization(actor, assignee)) return false;
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
