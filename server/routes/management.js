/**
 * The management desk's HTTP surface.
 *
 * Two audiences with two completely different ways of proving who they are, and
 * keeping them apart is the whole shape of this file:
 *
 *   people   → a signed-in user carrying `management.view` / `management.manage`
 *   machines → the Telegram bot and n8n, carrying a shared webhook secret
 *
 * The webhook routes are mounted *before* `requireAuth` because a bot has no
 * session and never will. They are the only unauthenticated routes here, they
 * accept nothing but a message, and everything they write is quarantined behind
 * `needsReview` when the model was unsure.
 */

import { Router } from 'express';
import { logActivity, requireAuth, requirePermission } from '../auth.js';
import { PERMISSIONS, can } from '../../shared/permissions.js';
import { organizationOf } from '../../shared/organization.js';
import {
  ManagementError,
  agenda,
  agendaText,
  announceItem,
  checkWebhookSecret,
  createItem,
  deleteItem,
  handleTelegramUpdate,
  hasWebhookSecret,
  ingest,
  isAiEnabled,
  isTelegramEnabled,
  listInbox,
  listItems,
  updateItem,
} from '../management.js';

const router = Router();

function fail(res, err) {
  if (err instanceof ManagementError) {
    return res.status(err.status).json({ error: err.message, hint: err.hint || undefined });
  }
  console.error('[management]', err);
  return res.status(500).json({ error: 'حصلت مشكلة على السيرفر.' });
}

/* ── machines ────────────────────────────────────────────────────── */

/**
 * The organization inbound messages land in.
 *
 * A Telegram chat has no idea what a tenant is. Unset means the default
 * organization — the right answer on a single-company deployment, where it is
 * also what every signed-in user resolves to. A second tenant is the case that
 * needs an explicit answer rather than a guess, and this is where it goes.
 */
const WEBHOOK_ORGANIZATION = process.env.MANAGEMENT_ORGANIZATION_ID || null;

router.post('/telegram', async (req, res) => {
  try {
    checkWebhookSecret(req.headers, process.env.TELEGRAM_WEBHOOK_SECRET || process.env.MANAGEMENT_WEBHOOK_SECRET);
    // Always 200: an update we could not use is one to log, not one to have
    // Telegram redeliver every few seconds until it gives up.
    res.json(await handleTelegramUpdate(req.body, { organizationId: WEBHOOK_ORGANIZATION }));
  } catch (err) {
    fail(res, err);
  }
});

router.post('/ingest', async (req, res) => {
  try {
    checkWebhookSecret(req.headers);
    res.json(
      await ingest({
        text: req.body?.text ?? req.body?.message ?? '',
        sender: req.body?.sender ?? req.body?.from ?? '',
        chatId: req.body?.chat_id ?? req.body?.chatId ?? '',
        messageId: req.body?.message_id ?? req.body?.messageId ?? '',
        source: req.body?.source === 'api' ? 'api' : 'telegram',
        items: req.body?.items,
        organizationId: WEBHOOK_ORGANIZATION,
      })
    );
  } catch (err) {
    fail(res, err);
  }
});

/**
 * The agenda has two audiences and answers both on the same path.
 *
 * A bot asking «إيه أجندة النهاردة» has no session and never will, so a valid
 * shared secret is served here, before the auth wall, and gets `text` — the
 * whole thing rendered as one Arabic message, because a chat has no screen to
 * lay rows out on. Anything without the secret falls through to the signed-in
 * version below.
 *
 * `day_offset` is the parameter name the bot already sends; `day` is accepted
 * too so the board and the bot are not obliged to disagree.
 */
router.get('/agenda', async (req, res, next) => {
  if (!hasWebhookSecret(req.headers)) return next();
  try {
    const offset = Number(req.query.day_offset ?? req.query.day) || 0;
    const data = await agenda(WEBHOOK_ORGANIZATION, offset);
    res.json({ ...data, text: agendaText(data) });
  } catch (err) {
    fail(res, err);
  }
});

/* ── people ──────────────────────────────────────────────────────── */

router.use(requireAuth);
router.use(requirePermission(PERMISSIONS.MANAGEMENT_VIEW));

/** What the board needs to know before it draws anything. */
router.get('/meta', (req, res) => {
  res.json({
    canManage: can(req.user, PERMISSIONS.MANAGEMENT_MANAGE),
    aiEnabled: isAiEnabled(),
    telegramEnabled: isTelegramEnabled(),
  });
});

router.get('/items', async (req, res) => {
  try {
    res.json({ items: await listItems(organizationOf(req.user), req.query) });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/agenda', async (req, res) => {
  try {
    const offset = Number(req.query.day ?? req.query.day_offset) || 0;
    const data = await agenda(organizationOf(req.user), offset);
    res.json({ ...data, text: agendaText(data) });
  } catch (err) {
    fail(res, err);
  }
});

/**
 * The audit log of what arrived from chat, successes and failures alike. It is
 * behind the manage permission rather than view: it carries the raw text people
 * wrote, which is a wider thing to read than the tidy items that came out.
 */
router.get('/inbox', requirePermission(PERMISSIONS.MANAGEMENT_MANAGE), async (req, res) => {
  try {
    res.json({ entries: await listInbox(organizationOf(req.user), req.query) });
  } catch (err) {
    fail(res, err);
  }
});

router.use(requirePermission(PERMISSIONS.MANAGEMENT_MANAGE));

router.post('/items', async (req, res) => {
  try {
    const item = await createItem(req.body, {
      organizationId: organizationOf(req.user),
      actorId: req.user.id,
      reporter: req.user.name,
    });
    await announceItem(item, req.user.id);
    await logActivity({
      actorId: req.user.id,
      action: 'management.create',
      subject: 'managementItem',
      subjectId: item.id,
      meta: { kind: item.kind, title: item.title },
    });
    res.status(201).json({ item });
  } catch (err) {
    fail(res, err);
  }
});

router.patch('/items/:id', async (req, res) => {
  try {
    const item = await updateItem(req.params.id, req.body, organizationOf(req.user));
    await logActivity({
      actorId: req.user.id,
      action: 'management.update',
      subject: 'managementItem',
      subjectId: item.id,
      meta: { fields: Object.keys(req.body ?? {}) },
    });
    res.json({ item });
  } catch (err) {
    fail(res, err);
  }
});

router.delete('/items/:id', async (req, res) => {
  try {
    const result = await deleteItem(req.params.id, organizationOf(req.user));
    await logActivity({
      actorId: req.user.id,
      action: 'management.delete',
      subject: 'managementItem',
      subjectId: req.params.id,
    });
    res.json(result);
  } catch (err) {
    fail(res, err);
  }
});

export default router;
