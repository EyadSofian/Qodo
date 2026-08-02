/**
 * Web push — notifications that reach the phone with the workspace closed.
 *
 * Same standard behind browser notifications on Android and, since iOS 16.4,
 * on iPhone too — with one condition Apple enforces: the site has to be
 * installed to the home screen first. Safari in a normal tab cannot subscribe.
 * The UI says so rather than failing silently.
 *
 * Entirely optional: without VAPID keys `notifyUser` is a no-op, and everything
 * else in the workspace behaves exactly the same.
 */

import { create, find, getStore } from './store.js';

let webpush = null;
let configured = false;

export async function initPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    console.log('[push] VAPID keys not set — phone notifications are off');
    return false;
  }
  try {
    const mod = await import('web-push');
    webpush = mod.default ?? mod;
    // The subject must be a contact URL or mailto: — push services reject
    // anything else, and they reject it at send time, not at setup.
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:admin@engosoft.com',
      publicKey,
      privateKey
    );
    configured = true;
    console.log('[push] enabled');
    return true;
  } catch (err) {
    console.error('[push] failed to initialise:', err.message);
    return false;
  }
}

export const pushConfigured = () => configured;
export const publicKey = () => process.env.VAPID_PUBLIC_KEY ?? null;

export async function saveSubscription(userId, subscription) {
  if (!subscription?.endpoint) return null;
  const store = await getStore();

  // One row per endpoint: a browser re-subscribing with the same endpoint must
  // update, not accumulate duplicates that each fire their own notification.
  const existing = await find('pushSubscriptions', (s) => s.endpoint === subscription.endpoint);
  for (const row of existing) await store.remove('pushSubscriptions', row.id);

  return create('pushSubscriptions', {
    userId,
    endpoint: subscription.endpoint,
    keys: subscription.keys ?? null,
    userAgent: subscription.userAgent ?? null,
  });
}

export async function removeSubscription(userId, endpoint) {
  const store = await getStore();
  const rows = await find(
    'pushSubscriptions',
    (s) => s.userId === userId && s.endpoint === endpoint
  );
  for (const row of rows) await store.remove('pushSubscriptions', row.id);
  return rows.length;
}

export async function hasSubscription(userId) {
  const rows = await find('pushSubscriptions', (s) => s.userId === userId);
  return rows.length > 0;
}

/**
 * Titles arrive as `{ar, en}` because the recipient's language isn't known when
 * the task is written. Both are sent; the service worker picks per device.
 */
export async function notifyUser(userId, { title, body, link }) {
  if (!configured || !webpush) return;

  const subscriptions = await find('pushSubscriptions', (s) => s.userId === userId);
  if (subscriptions.length === 0) return;

  const payload = JSON.stringify({
    title: typeof title === 'string' ? { ar: title, en: title } : title,
    body: typeof body === 'string' ? { ar: body, en: body } : body,
    link: link ?? '/',
  });

  const store = await getStore();
  await Promise.all(
    subscriptions.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: row.keys },
          payload,
          { TTL: 24 * 60 * 60 }
        );
      } catch (err) {
        // 404/410 mean the browser threw the subscription away (app deleted,
        // permission revoked). Anything else is transient — keep the row.
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await store.remove('pushSubscriptions', row.id);
        } else {
          console.warn('[push] send failed:', err?.statusCode ?? err?.message);
        }
      }
    })
  );
}
