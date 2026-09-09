import { Router } from "express";
import { requireAuth } from "../auth.js";
import {
  hasSubscription,
  publicKey,
  pushConfigured,
  removeSubscription,
  saveSubscription,
} from "../push.js";
import { notify } from "../notify.js";

const router = Router();
router.use(requireAuth);

/** The browser needs the public VAPID key before it can subscribe. */
router.get("/key", async (req, res) => {
  res.json({
    configured: pushConfigured(),
    publicKey: publicKey(),
    subscribed: await hasSubscription(req.user.id),
  });
});

router.post("/subscribe", async (req, res) => {
  if (!pushConfigured())
    return res.status(503).json({ error: "push_not_configured" });

  const subscription = req.body?.subscription;
  if (
    !subscription?.endpoint ||
    !subscription?.keys?.p256dh ||
    !subscription?.keys?.auth
  ) {
    return res.status(400).json({ error: "invalid_subscription" });
  }

  await saveSubscription(req.user.id, {
    endpoint: String(subscription.endpoint),
    keys: {
      p256dh: String(subscription.keys.p256dh),
      auth: String(subscription.keys.auth),
    },
    userAgent: String(req.get("user-agent") || "").slice(0, 200),
  });

  res.json({ ok: true });
});

/**
 * Sends a notification to the person asking for it.
 *
 * Worth its own endpoint because the normal notifications deliberately skip the
 * person who caused them — assigning yourself a task tells you nothing you did
 * not just do. That is correct behaviour, but it leaves no way to answer "is
 * this even switched on?" except waiting for a colleague to act.
 */
router.post("/test", async (req, res) => {
  if (!pushConfigured())
    return res.status(503).json({ error: "push_not_configured" });
  if (!(await hasSubscription(req.user.id))) {
    return res.status(409).json({ error: "not_subscribed" });
  }

  const notification = await notify(req.user.id, null, {
    type: "system.push_test",
    title: { ar: "الإشعارات تعمل ✅", en: "Notifications are working ✅" },
    body: {
      ar: "دي رسالة تجريبية محفوظة في الجرس. التنبيهات الحقيقية هتظهر بنفس الشكل عند وصولها.",
      en: "This test is saved in the bell. Real alerts will appear in the same way when they arrive.",
    },
    link: "/settings",
  });

  res.json({
    ok: true,
    notificationId: notification?.id ?? null,
    notification,
  });
});

router.post("/unsubscribe", async (req, res) => {
  const endpoint = String(req.body?.endpoint || "");
  if (!endpoint) return res.status(400).json({ error: "missing_endpoint" });
  const removed = await removeSubscription(req.user.id, endpoint);
  res.json({ ok: true, removed });
});

export default router;
