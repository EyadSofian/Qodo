import { api } from './api';

/**
 * Web push subscription.
 *
 * iOS is the awkward one: Safari has supported web push since 16.4, but only
 * for sites the user has added to the home screen. In a normal Safari tab
 * `PushManager` simply isn't there, so the check below reports it as
 * unsupported rather than letting the user press a button that cannot work.
 */

export type PushState = 'unsupported' | 'unconfigured' | 'off' | 'on' | 'denied';

export function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Standalone display mode is how you detect "installed to home screen" on iOS. */
export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // Non-standard, iOS Safari only.
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

export function isIos() {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

async function registration() {
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

export async function currentPushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';

  const info = await api
    .get<{ configured: boolean; publicKey: string | null; subscribed: boolean }>('/push/key')
    .catch(() => null);
  if (!info?.configured || !info.publicKey) return 'unconfigured';
  if (Notification.permission === 'denied') return 'denied';

  // Trust the browser over the server row: a subscription the server still has
  // but the browser has dropped would show as "on" and never deliver.
  try {
    const existing = await (await registration()).pushManager.getSubscription();
    return existing ? 'on' : 'off';
  } catch {
    return info.subscribed ? 'on' : 'off';
  }
}

export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';

  const info = await api.get<{ configured: boolean; publicKey: string | null }>('/push/key');
  if (!info.configured || !info.publicKey) return 'unconfigured';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';

  const reg = await registration();
  await navigator.serviceWorker.ready;

  const subscription =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      // Without this flag Chrome refuses to subscribe at all: it requires a
      // commitment that every push shows a visible notification.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(info.publicKey),
    }));

  await api.post('/push/subscribe', { subscription: subscription.toJSON() });
  return 'on';
}

/** Proves the whole chain works — subscription, VAPID keys, and delivery. */
export async function sendTestPush(lang: 'ar' | 'en') {
  await api.post('/push/test', { lang });
}

export async function disablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const subscription = await reg?.pushManager.getSubscription();
  if (subscription) {
    await api.post('/push/unsubscribe', { endpoint: subscription.endpoint }).catch(() => {});
    await subscription.unsubscribe().catch(() => {});
  }
  return 'off';
}

/** VAPID keys travel as base64url; `applicationServerKey` needs raw bytes. */
function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalised);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}
