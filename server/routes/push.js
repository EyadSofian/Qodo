import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { hasSubscription, publicKey, pushConfigured, removeSubscription, saveSubscription } from '../push.js';

const router = Router();
router.use(requireAuth);

/** The browser needs the public VAPID key before it can subscribe. */
router.get('/key', async (req, res) => {
  res.json({
    configured: pushConfigured(),
    publicKey: publicKey(),
    subscribed: await hasSubscription(req.user.id),
  });
});

router.post('/subscribe', async (req, res) => {
  if (!pushConfigured()) return res.status(503).json({ error: 'push_not_configured' });

  const subscription = req.body?.subscription;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return res.status(400).json({ error: 'invalid_subscription' });
  }

  await saveSubscription(req.user.id, {
    endpoint: String(subscription.endpoint),
    keys: { p256dh: String(subscription.keys.p256dh), auth: String(subscription.keys.auth) },
    userAgent: String(req.get('user-agent') || '').slice(0, 200),
  });

  res.json({ ok: true });
});

router.post('/unsubscribe', async (req, res) => {
  const endpoint = String(req.body?.endpoint || '');
  if (!endpoint) return res.status(400).json({ error: 'missing_endpoint' });
  const removed = await removeSubscription(endpoint);
  res.json({ ok: true, removed });
});

export default router;
