/**
 * Tiny same-process notification signal bus.
 *
 * The durable notification is still written to the store first; this channel
 * only tells an open browser to fetch it immediately instead of waiting for the
 * polling fallback. If Railway ever runs more than one instance, clients on a
 * different instance still catch up through the normal poll.
 */

const listeners = new Map();

export function subscribeToNotifications(userId, response) {
  const mine = listeners.get(userId) ?? new Set();
  mine.add(response);
  listeners.set(userId, mine);

  return () => {
    mine.delete(response);
    if (mine.size === 0) listeners.delete(userId);
  };
}

export function publishNotification(userId, notificationId) {
  const mine = listeners.get(userId);
  if (!mine?.size) return;

  const event = `event: notification\ndata: ${JSON.stringify({ id: notificationId })}\n\n`;
  for (const response of mine) {
    if (response.writableEnded || response.destroyed) {
      mine.delete(response);
      continue;
    }
    try {
      response.write(event);
    } catch {
      mine.delete(response);
    }
  }
  if (mine.size === 0) listeners.delete(userId);
}
