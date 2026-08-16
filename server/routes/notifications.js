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

/**
 * Workspace-wide activity — who touched what. Managers and admins only.
 *
 * `action` narrows to one family before the cap is applied, and that ordering
 * is the point: sending a message writes an entry, so on any working day the
 * newest hundred of everything are mail traffic and a deletion is buried by
 * the very conversation it happened in. Asking for `mail.message.delete` reads
 * the deletions themselves.
 *
 * The value matches a whole action or a prefix of one, so `mail` answers for
 * the module and `mail.message.delete` for the single question.
 */
router.get('/activity', async (req, res) => {
  if (!can(req.user, PERMISSIONS.USERS_VIEW)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const prefix =
    typeof req.query.action === 'string' ? req.query.action.trim().replace(/\.+$/, '') : '';
  const entries = (await find(
    'activity',
    (entry) =>
      organizationOf(entry) === organizationOf(req.user) &&
      (!prefix || entry.action === prefix || String(entry.action).startsWith(`${prefix}.`))
  ))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 100);

  const actorIds = [...new Set(entries.map((e) => e.actorId).filter(Boolean))];
  // The audited message has an author as well as a remover, and the log is
  // unreadable if one of the two is an opaque id.
  const subjectIds = entries
    .map((entry) => entry.meta?.authorId)
    .filter((id) => typeof id === 'string');
  const actors = {};
  for (const id of [...new Set([...actorIds, ...subjectIds])]) {
    const user = await findOne('users', (u) => u.id === id);
    if (user) actors[id] = { id: user.id, name: user.name, avatarColor: user.avatarColor };
  }

  res.json({ activity: entries, actors });
});

export default router;
