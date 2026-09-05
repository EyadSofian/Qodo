/**
 * One notification path for the whole workspace.
 *
 * Extracted from `server/routes/tasks.js` when Qodo Projects needed to notify
 * people too. Copying it would have meant two definitions of "tell somebody",
 * drifting apart the first time one of them learned about a preference or a new
 * delivery channel — and the version that did not learn would be the one
 * quietly delivering nothing.
 */

import { create, findOne } from './store.js';
import { isActiveUser } from '../shared/permissions.js';
import { organizationOf } from '../shared/organization.js';
import { publishNotification } from './notificationStream.js';
import { notifyUser } from './push.js';

/**
 * Tell one person something.
 *
 * Titles are bilingual because the workspace runs in two languages and the
 * recipient's choice is not known at write time, so both are stored and the UI
 * picks. Push delivery does the same at send time.
 *
 * Silently does nothing for a missing or disabled account rather than throwing:
 * a notification is a side effect, and failing the business change because
 * somebody left the company last week would be the wrong trade.
 */
export async function notify(userId, actorId, { type, title, body, link }) {
  if (!userId) return null;

  const target = await findOne('users', (user) => user.id === userId);
  if (!target || !isActiveUser(target)) return null;

  const notification = await create('notifications', {
    organizationId: organizationOf(target),
    userId,
    actorId,
    type,
    title,
    body,
    link,
    read: false,
  });

  publishNotification(userId, notification.id);
  await notifyUser(userId, { title, body, link });
  return notification;
}

/**
 * Tell several people, never the person who caused it.
 *
 * Named because five copies of "if it is not me" were five chances to forget
 * the second recipient exists.
 */
export async function notifyEach(userIds, actorId, payload) {
  const seen = new Set();
  for (const userId of userIds ?? []) {
    if (!userId || userId === actorId || seen.has(userId)) continue;
    seen.add(userId);
    await notify(userId, actorId, payload);
  }
}
