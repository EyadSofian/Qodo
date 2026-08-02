import { Router } from 'express';
import { find, findOne, getStore } from '../store.js';
import { requireAuth } from '../auth.js';
import { PERMISSIONS, can } from '../../shared/permissions.js';
import { organizationOf } from '../../shared/organization.js';
import { subscribeToNotifications } from '../notificationStream.js';

const router = Router();
router.use(requireAuth);

/**
 * Live signal for open tabs. The payload only carries an id; the client then
 * reloads the authenticated notification list, so visibility and tenant rules
 * stay in the ordinary API instead of being duplicated in the stream.
 */
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write('event: ready\ndata: {}\n\n');

  const unsubscribe = subscribeToNotifications(req.user.id, res);
  const heartbeat = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) res.write(': keep-alive\n\n');
  }, 25_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

router.get('/', async (req, res) => {
  const mine = (await find('notifications', (n) => n.userId === req.user.id))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 50);

  // Names for the "who did this" line, resolved once per response.
  const actorIds = [...new Set(mine.map((n) => n.actorId).filter(Boolean))];
  const actors = {};
  for (const id of actorIds) {
    const user = await findOne('users', (u) => u.id === id);
    if (user) actors[id] = { id: user.id, name: user.name, avatarColor: user.avatarColor };
  }

  res.json({
    notifications: mine,
    actors,
    unread: mine.filter((n) => !n.read).length,
  });
});

router.post('/:id/read', async (req, res) => {
  const store = await getStore();
  const item = await findOne('notifications', (n) => n.id === req.params.id);
  if (!item || item.userId !== req.user.id) return res.status(404).json({ error: 'not_found' });
  const updated = await store.update('notifications', item.id, { read: true });
  res.json({ notification: updated });
});

router.post('/read-all', async (req, res) => {
  const store = await getStore();
  const mine = await find('notifications', (n) => n.userId === req.user.id && !n.read);
  for (const item of mine) await store.update('notifications', item.id, { read: true });
  res.json({ ok: true, marked: mine.length });
});

/** Workspace-wide activity — who touched what. Managers and admins only. */
router.get('/activity', async (req, res) => {
  if (!can(req.user, PERMISSIONS.USERS_VIEW)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const entries = (await find(
    'activity',
    (entry) => organizationOf(entry) === organizationOf(req.user)
  ))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 100);

  const actorIds = [...new Set(entries.map((e) => e.actorId).filter(Boolean))];
  const actors = {};
  for (const id of actorIds) {
    const user = await findOne('users', (u) => u.id === id);
    if (user) actors[id] = { id: user.id, name: user.name, avatarColor: user.avatarColor };
  }

  res.json({ activity: entries, actors });
});

export default router;
