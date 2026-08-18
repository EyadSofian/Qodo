/**
 * Live hints for Qodo Mail.
 *
 * Messages are durable in the store before anything is published here. The
 * event only tells an open tab which conversation changed; the tab reloads it
 * through the authenticated API. Polling remains the multi-instance fallback.
 *
 * The same connections answer "who is online". Presence is derived from them
 * rather than declared by the client: somebody is present exactly while a tab
 * of theirs holds a stream open, which is a fact this process already has and
 * cannot be lied to about. It is per-process like the publishing above — a
 * second server instance would need Redis behind both, not behind one.
 */

import { organizationOf } from '../shared/organization.js';

/** userId → { organizationId, responses }. The org is kept so presence never
 *  crosses a tenant boundary, the one thing a broadcast could get wrong. */
const listeners = new Map();

export function subscribeToMail(user, response) {
  const entry = listeners.get(user.id) ?? {
    organizationId: organizationOf(user),
    responses: new Set(),
  };
  entry.responses.add(response);
  listeners.set(user.id, entry);
  if (entry.responses.size === 1) publishPresence(user.id, entry.organizationId, true);

  return () => {
    entry.responses.delete(response);
    if (entry.responses.size > 0) return;
    // A reconnect can install a new entry before this one is torn down; only
    // the entry that is still the live one may be dropped.
    if (listeners.get(user.id) !== entry) return;
    listeners.delete(user.id);
    publishPresence(user.id, entry.organizationId, false);
  };
}

function send(entry, name, data) {
  const frame = `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const response of entry.responses) {
    if (response.writableEnded || response.destroyed) {
      entry.responses.delete(response);
      continue;
    }
    try {
      response.write(frame);
    } catch {
      entry.responses.delete(response);
    }
  }
}

export function publishMail(userId, conversationId, messageId) {
  const entry = listeners.get(userId);
  if (!entry?.responses.size) return;
  send(entry, 'message', { conversationId, messageId });
  if (entry.responses.size === 0) listeners.delete(userId);
}

function publishPresence(userId, organizationId, online) {
  for (const [id, entry] of listeners) {
    if (id === userId || entry.organizationId !== organizationId) continue;
    send(entry, 'presence', { userId, online });
  }
}

/** Who has a tab open right now, inside one organisation. */
export function onlineUserIds(organizationId) {
  const ids = [];
  for (const [id, entry] of listeners) {
    if (entry.organizationId === organizationId && entry.responses.size > 0) ids.push(id);
  }
  return ids;
}
