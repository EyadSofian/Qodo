/**
 * Who may see, answer and change a calendar entry.
 *
 * The rule that shapes everything here is the one Qodo Mail already settled: a
 * manager does not out-rank privacy. An appointment somebody put in their own
 * diary is theirs, and an administrator holding every permission in the
 * workspace still is not on the invite list. What an administrator *can* see is
 * an entry deliberately published to a department or to the organization —
 * because publishing it is the act that made it everybody's business.
 *
 * Busy time is the deliberate exception, and it lives in `server/calendar.js`:
 * planning a meeting needs to know that an hour is taken without being told by
 * whom or for what.
 */

import { create, find, findOne } from './store.js';
import { isActiveUser } from '../shared/permissions.js';
import { organizationOf } from '../shared/organization.js';

/** A meeting has other people in it; an appointment is one person's commitment. */
export const CALENDAR_KINDS = ['meeting', 'appointment'];

/**
 * How wide the entry reaches, narrowest first.
 *
 * `invitees` is the default and the private one — nobody outside the organizer
 * and the invite list learns it exists.
 */
export const CALENDAR_VISIBILITIES = ['invitees', 'department', 'organization'];

export const INVITE_RESPONSES = ['needs_action', 'accepted', 'tentative', 'declined'];

export function isCancelled(event) {
  return event?.status === 'cancelled';
}

/** Everyone personally attached to the entry, organizer included. */
export function participantIds(event) {
  return [...new Set([event?.organizerId, ...(event?.inviteeIds ?? [])].filter(Boolean))];
}

export function isParticipant(user, event) {
  return Boolean(user) && participantIds(event).includes(user.id);
}

export function canAccessEvent(user, event) {
  if (!user || !event) return false;
  if (organizationOf(user) !== organizationOf(event)) return false;
  if (isParticipant(user, event)) return true;

  // Cancelled entries stop being announcements. The people who were going still
  // need to see that it is off, and they are covered by the check above.
  if (isCancelled(event)) return false;

  if (event.visibility === 'organization') return true;
  if (event.visibility === 'department') {
    return Boolean(event.department) && user.department === event.department;
  }
  return false;
}

/**
 * Editing is the organizer's alone.
 *
 * Not the administrator's: an entry that an admin can rewrite is an entry no
 * attendee can trust, and there is no workspace question that needs answering
 * by moving somebody else's meeting rather than by asking them to move it.
 */
export function canManageEvent(user, event) {
  return Boolean(user) && Boolean(event) && event.organizerId === user.id;
}

/** May this person record an attendance answer? Only somebody who was invited. */
export function canRespondToEvent(user, event) {
  if (!user || !event || isCancelled(event)) return false;
  return (event.inviteeIds ?? []).includes(user.id);
}

export async function activeOrganizationUsers(organizationId) {
  return find(
    'users',
    (user) => isActiveUser(user) && organizationOf(user) === organizationOf({ organizationId })
  );
}

/** Everybody the entry is visible to — used for notifications and for reach. */
export async function audienceForEvent(event) {
  const users = await activeOrganizationUsers(organizationOf(event));
  return users.filter((user) => canAccessEvent(user, event));
}

/**
 * The invite row, created on demand.
 *
 * The id is derived rather than random so that re-inviting somebody who is
 * already on the list is a no-op on both storage backends instead of a second
 * row that disagrees with the first about whether they accepted.
 */
export async function ensureInvite(event, userId) {
  const id = `${event.id}:${userId}`;
  const existing = await findOne('calendarInvites', (row) => row.id === id);
  if (existing) return existing;
  return create('calendarInvites', {
    id,
    organizationId: organizationOf(event),
    eventId: event.id,
    userId,
    response: userId === event.organizerId ? 'accepted' : 'needs_action',
    respondedAt: userId === event.organizerId ? new Date().toISOString() : null,
  });
}

export async function invitesForEvent(eventId) {
  return find('calendarInvites', (row) => row.eventId === eventId);
}
