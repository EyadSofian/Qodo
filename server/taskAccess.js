import { PERMISSIONS, can } from '../shared/permissions.js';
import { DEFAULT_DEPARTMENT } from '../shared/departments.js';
import { organizationOf, sameOrganization } from '../shared/organization.js';

export const departmentOf = (record) => record?.department ?? DEFAULT_DEPARTMENT;

export function sameDepartment(user, record) {
  return sameOrganization(user, record) && departmentOf(user) === departmentOf(record);
}

/**
 * Task visibility has three explicit scopes:
 *   company → administrators with tasks.view_all
 *   team    → people with tasks.view_team, limited to their department
 *   own     → assigned or created by the current person
 */
export function canViewTask(user, task) {
  if (!can(user, PERMISSIONS.TASKS_VIEW)) return false;
  if (!sameOrganization(user, task)) return false;
  if (can(user, PERMISSIONS.TASKS_VIEW_ALL)) return true;
  if (!sameDepartment(user, task)) return false;
  if (can(user, PERMISSIONS.TASKS_VIEW_TEAM)) return true;
  return task.assigneeId === user.id || task.createdBy === user.id;
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
  if (!assignee || assignee.status === 'disabled') return false;
  if (!sameOrganization(actor, assignee)) return false;
  if (can(actor, PERMISSIONS.TASKS_VIEW_ALL)) return departmentOf(assignee) === department;
  return department === departmentOf(actor) && departmentOf(assignee) === department;
}

export function visiblePeople(user, people) {
  const sameTenant = people.filter((person) => organizationOf(person) === organizationOf(user));
  if (can(user, PERMISSIONS.TASKS_VIEW_ALL)) return sameTenant;
  return sameTenant.filter((person) => sameDepartment(user, person));
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

