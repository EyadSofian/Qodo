/**
 * Workspace people, as this module needs them.
 *
 * Users live in the workspace store, not in this schema — the module stores a
 * user id and asks here for the name and colour to draw. Every response that
 * mentions people carries a `people` map, so the browser never needs a second
 * request or the company-wide directory to print a name.
 */

import { find } from '../store.js';
import { isActiveUser } from '../../shared/permissions.js';
import { organizationOf } from '../../shared/organization.js';
import { badRequest, validation } from './errors.js';

function toPerson(user) {
  return {
    id: user.id,
    name: user.name,
    avatarColor: user.avatarColor ?? '#1D6FB8',
    title: user.title ?? null,
    active: isActiveUser(user),
  };
}

/** `{ id: person }` for every id given. An id with no user is left out; the UI says "removed user". */
export async function peopleFor(ids) {
  const wanted = new Set([...ids].filter((id) => typeof id === 'string' && id));
  if (wanted.size === 0) return {};
  const users = await find('users', (user) => wanted.has(user.id));
  return Object.fromEntries(users.map((user) => [user.id, toPerson(user)]));
}

/** Every user id found in the given objects' `*UserId`, `*By` and `userId` fields. */
export function userIdsIn(records, extra = []) {
  const ids = new Set(extra.filter(Boolean));
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach(visit);
    for (const [key, field] of Object.entries(value)) {
      if (typeof field === 'string' && field && (key === 'userId' || /UserId$|By$/.test(key))) ids.add(field);
      else if (field && typeof field === 'object') visit(field);
    }
  };
  visit(records);
  return ids;
}

/** A user id from a request body: a short string, or null to clear. */
export function userIdField(value, field) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 120) throw validation(field, 'invalid');
  return value;
}

/** Refuses anybody who is not an active member of the caller's organization. */
export async function assertAssignable(actor, userId, field) {
  if (!userId) return null;
  const [user] = await find('users', (candidate) => candidate.id === userId);
  if (!user || !isActiveUser(user) || organizationOf(user) !== actor.organizationId) {
    throw badRequest('ASSIGNEE_INVALID', { field });
  }
  return user;
}

/** Active people in the caller's organization, for assignment and team pickers. */
export async function organizationPeople(actor, search = '') {
  const needle = String(search ?? '').trim().toLowerCase();
  const users = await find(
    'users',
    (user) =>
      isActiveUser(user) &&
      organizationOf(user) === actor.organizationId &&
      (!needle || String(user.name ?? '').toLowerCase().includes(needle) || String(user.email ?? '').toLowerCase().includes(needle))
  );
  return users
    .map((user) => ({ ...toPerson(user), department: user.department ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
    .slice(0, 300);
}
