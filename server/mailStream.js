/**
 * Live hints for Qodo Mail.
 *
 * Messages are durable in the store before anything is published here. The
 * event only tells an open tab which conversation changed; the tab reloads it
 * through the authenticated API. Polling remains the multi-instance fallback.
 */

const listeners = new Map();

export function subscribeToMail(userId, response) {
  const mine = listeners.get(userId) ?? new Set();
  mine.add(response);
  listeners.set(userId, mine);

  return () => {
    mine.delete(response);
    if (mine.size === 0) listeners.delete(userId);
  };
}

export function publishMail(userId, conversationId, messageId) {
  const mine = listeners.get(userId);
  if (!mine?.size) return;

  const event = `event: message\ndata: ${JSON.stringify({ conversationId, messageId })}\n\n`;
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
