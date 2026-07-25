import { Router } from 'express';
import { create, find, findOne, getStore } from '../store.js';
import { logActivity, requireAuth, requirePermission } from '../auth.js';
import { PERMISSIONS, can } from '../../shared/permissions.js';
import {
  DEFAULT_DEPARTMENT,
  DEPARTMENT_IDS,
  firstStage,
  getStage,
  isDoneStage,
  translateStage,
} from '../../shared/departments.js';
import { notifyUser } from '../push.js';

const router = Router();

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

router.use(requireAuth);

/**
 * Without `tasks.view_all` you see the work that is yours: assigned to you, or
 * raised by you. Managers and admins see the whole board.
 */
function visibleTo(user) {
  if (can(user, PERMISSIONS.TASKS_VIEW_ALL)) return () => true;
  return (t) => t.assigneeId === user.id || t.createdBy === user.id;
}

function mayEdit(user, task) {
  if (can(user, PERMISSIONS.TASKS_EDIT_ANY)) return true;
  return task.createdBy === user.id || task.assigneeId === user.id;
}

router.get('/', async (req, res) => {
  if (!can(req.user, PERMISSIONS.TASKS_VIEW)) {
    return res.status(403).json({ error: 'forbidden', missing: PERMISSIONS.TASKS_VIEW });
  }
  const tasks = (await find('tasks', visibleTo(req.user))).sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
  );
  res.json({ tasks, priorities: PRIORITIES });
});

router.post('/', requirePermission(PERMISSIONS.TASKS_CREATE), async (req, res) => {
  const parsed = await parseTaskInput(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const department = parsed.value.department ?? req.user.department ?? DEFAULT_DEPARTMENT;
  const stage = parsed.value.stage ?? firstStage(department);
  const siblings = await find('tasks', (t) => t.department === department && t.stage === stage);

  const task = await create('tasks', {
    priority: 'normal',
    assigneeId: null,
    dueDate: null,
    appId: null,
    labels: [],
    description: '',
    completedAt: null,
    ...parsed.value,
    department,
    stage,
    createdBy: req.user.id,
    order: Math.min(0, ...siblings.map((t) => t.order ?? 0)) - 1,
  });

  if (task.assigneeId && task.assigneeId !== req.user.id) {
    await notify(task.assigneeId, req.user.id, {
      type: 'task.assigned',
      title: { ar: 'مهمة جديدة مُسندة إليك', en: 'A new task is assigned to you' },
      body: task.title,
      link: `/tasks?task=${task.id}`,
    });
  }

  await logActivity({
    actorId: req.user.id,
    action: 'task.create',
    subject: 'task',
    subjectId: task.id,
    meta: { title: task.title },
  });
  res.status(201).json({ task });
});

router.patch('/:id', async (req, res) => {
  const store = await getStore();
  const task = await findOne('tasks', (t) => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'not_found' });
  if (!visibleTo(req.user)(task)) return res.status(404).json({ error: 'not_found' });
  if (!mayEdit(req.user, task)) return res.status(403).json({ error: 'forbidden' });

  const parsed = await parseTaskInput(req.body, { partial: true, current: task });
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const patch = { ...parsed.value };
  if (req.body?.order !== undefined) patch.order = Number(req.body.order) || 0;

  // Reaching (or leaving) a `done`-type stage maintains the completion stamp,
  // which is what "finished this week" counts.
  const nextDepartment = patch.department ?? task.department;
  const nextStage = patch.stage ?? task.stage;
  const wasDone = isDoneStage(task.department, task.stage);
  const nowDone = isDoneStage(nextDepartment, nextStage);
  if (wasDone !== nowDone) patch.completedAt = nowDone ? new Date().toISOString() : null;

  const updated = await store.update('tasks', task.id, patch);

  if (patch.assigneeId && patch.assigneeId !== task.assigneeId && patch.assigneeId !== req.user.id) {
    await notify(patch.assigneeId, req.user.id, {
      type: 'task.assigned',
      title: { ar: 'مهمة أُسندت إليك', en: 'A task was assigned to you' },
      body: updated.title,
      link: `/tasks?task=${updated.id}`,
    });
  }
  if (nowDone && !wasDone && task.createdBy !== req.user.id) {
    await notify(task.createdBy, req.user.id, {
      type: 'task.completed',
      title: { ar: 'اكتملت مهمة', en: 'A task was completed' },
      body: updated.title,
      link: `/tasks?task=${updated.id}`,
    });
  }

  await logActivity({
    actorId: req.user.id,
    action: 'task.update',
    subject: 'task',
    subjectId: task.id,
    meta: { fields: Object.keys(patch) },
  });
  res.json({ task: updated });
});

router.delete('/:id', async (req, res) => {
  const store = await getStore();
  const task = await findOne('tasks', (t) => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'not_found' });

  const mayDelete =
    can(req.user, PERMISSIONS.TASKS_DELETE_ANY) || task.createdBy === req.user.id;
  if (!mayDelete) return res.status(403).json({ error: 'forbidden' });

  const comments = await find('comments', (c) => c.taskId === task.id);
  for (const comment of comments) await store.remove('comments', comment.id);
  await store.remove('tasks', task.id);

  await logActivity({
    actorId: req.user.id,
    action: 'task.delete',
    subject: 'task',
    subjectId: task.id,
    meta: { title: task.title },
  });
  res.json({ ok: true });
});

/* ── comments ────────────────────────────────────────────────────── */

router.get('/:id/comments', async (req, res) => {
  const task = await findOne('tasks', (t) => t.id === req.params.id);
  if (!task || !visibleTo(req.user)(task)) return res.status(404).json({ error: 'not_found' });
  const comments = (await find('comments', (c) => c.taskId === task.id)).sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : 1
  );
  res.json({ comments });
});

router.post('/:id/comments', async (req, res) => {
  const task = await findOne('tasks', (t) => t.id === req.params.id);
  if (!task || !visibleTo(req.user)(task)) return res.status(404).json({ error: 'not_found' });

  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'empty_comment' });

  const comment = await create('comments', { taskId: task.id, userId: req.user.id, body });

  // Tell the other side of the task — never yourself.
  const audience = new Set([task.assigneeId, task.createdBy].filter(Boolean));
  audience.delete(req.user.id);
  for (const userId of audience) {
    await notify(userId, req.user.id, {
      type: 'task.comment',
      title: { ar: 'تعليق جديد على مهمة', en: 'New comment on a task' },
      body: `${task.title} — ${body.slice(0, 80)}`,
      link: `/tasks?task=${task.id}`,
    });
  }

  res.status(201).json({ comment });
});

/* ── helpers ─────────────────────────────────────────────────────── */

/**
 * Bilingual notification titles: the workspace runs in two languages and the
 * recipient's choice isn't known at write time, so both are stored and the UI
 * picks. Push delivery does the same at send time.
 */
async function notify(userId, actorId, { type, title, body, link }) {
  await create('notifications', { userId, actorId, type, title, body, link, read: false });
  await notifyUser(userId, { title, body, link });
}

async function parseTaskInput(body, { partial = false, current = null } = {}) {
  const value = {};

  if (body?.title !== undefined || !partial) {
    const title = String(body?.title || '').trim();
    if (!title) return { error: 'title_required' };
    if (title.length > 200) return { error: 'title_too_long' };
    value.title = title;
  }
  if (body?.description !== undefined) value.description = String(body.description || '').trim();

  if (body?.department !== undefined) {
    if (!DEPARTMENT_IDS.includes(body.department)) return { error: 'invalid_department' };
    value.department = body.department;
  }

  if (body?.stage !== undefined) {
    // A stage only means anything inside its department, so validate it against
    // whichever department this write lands the task in.
    const department = value.department ?? current?.department ?? DEFAULT_DEPARTMENT;
    const stage = getStage(department, body.stage);
    if (stage.id !== body.stage) return { error: 'invalid_stage' };
    value.stage = stage.id;
  } else if (value.department && current && value.department !== current.department) {
    // Department changed without an explicit stage — carry the task across to
    // the nearest equivalent rather than silently resetting it to the start.
    value.stage = translateStage(current.department, current.stage, value.department);
  }

  if (body?.priority !== undefined) {
    if (!PRIORITIES.includes(body.priority)) return { error: 'invalid_priority' };
    value.priority = body.priority;
  }

  if (body?.assigneeId !== undefined) {
    if (body.assigneeId === null || body.assigneeId === '') {
      value.assigneeId = null;
    } else {
      const user = await findOne('users', (u) => u.id === body.assigneeId);
      if (!user) return { error: 'unknown_assignee' };
      value.assigneeId = user.id;
    }
  }

  if (body?.appId !== undefined) {
    if (body.appId === null || body.appId === '') {
      value.appId = null;
    } else {
      const app = await findOne('apps', (a) => a.id === body.appId);
      if (!app) return { error: 'unknown_app' };
      value.appId = app.id;
    }
  }

  if (body?.dueDate !== undefined) {
    if (!body.dueDate) {
      value.dueDate = null;
    } else {
      const date = new Date(body.dueDate);
      if (Number.isNaN(date.getTime())) return { error: 'invalid_due_date' };
      value.dueDate = date.toISOString().slice(0, 10);
    }
  }

  if (body?.labels !== undefined) {
    value.labels = Array.isArray(body.labels)
      ? [...new Set(body.labels.map((l) => String(l).trim()).filter(Boolean))].slice(0, 8)
      : [];
  }

  return { value };
}

export default router;
