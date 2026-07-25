/* Engosoft Workspace — service worker.
 *
 * Deliberately minimal: it exists to receive push notifications, not to cache
 * the app. An offline cache here would serve a stale bundle after every deploy
 * and is not worth the failure mode for an internal tool that is always online.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }

  // Titles arrive as {ar, en} — the sender can't know which language this
  // device runs in, so the choice happens here.
  const lang = (self.navigator.language || 'ar').toLowerCase().startsWith('en') ? 'en' : 'ar';
  const title =
    typeof payload.title === 'string'
      ? payload.title
      : payload.title?.[lang] || payload.title?.ar || 'إنجوسوفت';

  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      icon: '/logo.png',
      dir: lang === 'en' ? 'ltr' : 'rtl',
      lang,
      data: { link: payload.link || '/' },
      // Same tag replaces an unread notification rather than stacking a second
      // copy of the same task on the lock screen.
      tag: payload.link || 'engosoft',
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || '/';

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Focus an open workspace tab and navigate it, rather than opening a
      // third copy of the app every time a notification is tapped.
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ('navigate' in client) await client.navigate(link);
          return;
        }
      }
      await self.clients.openWindow(link);
    })()
  );
});
