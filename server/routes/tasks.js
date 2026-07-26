import { Router } from 'express';
import { create, find, findOne, getStore } from '../store.js';
import { logActivity, requireAuth, requirePermission } from '../auth.js';
import { PERMISSIONS, can } from '../../shared/permissions.js';
import {
  DEFAULT_DEPARTMENT,
  DEPARTMENT_IDS,
  departmentLabel,
  firstStage,
  getSubteam,
  getStage,
  isDoneStage,
  stageLabel,
  subteamLabel,
  translateStage,
} from '../../shared/departments.js';
import { notifyUser } from '../push.js';
import {
  canAssignUser,
  canDeleteTask,
  canEditTask,
  canManagePerformance,
  canUseDepartment,
  taskForUser,
  taskPredicate,
  visiblePeople,
} from '../taskAccess.js';

const router = Router();

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

router.use(requireAuth);

router.get('/', async (req, res) => {
  if (!can(req.user, PERMISSIONS.TASKS_VIEW)) {
    return res.status(403).json({ error: 'forbidden', missing: PERMISSIONS.TASKS_VIEW });
  }
  const tasks = (await find('tasks', taskPredicate(req.user))).sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
  );
  res.json({ tasks: tasks.map((task) => taskForUser(req.user, task)), priorities: PRIORITIES });
});

router.get('/overview', async (req, res) => {
  if (!can(req.user, PERMISSIONS.TASKS_VIEW)) {
    return res.status(403).json({ error: 'forbidden', missing: PERMISSIONS.TASKS_VIEW });
  }

  const managesTeam = canManagePerformance(req.user);
  let tasks = await find('tasks', taskPredicate(req.user));
  let people = visiblePeople(
    req.user,
    await find('users', (user) => user.status !== 'disabled')
  );

  // Performance is more private than the team task table: employees get only
  // their own figures even when the team's work is visible for collaboration.
  if (!managesTeam) {
    tasks = tasks.filter((task) => task.assigneeId === req.user.id);
    people = people.filter((person) => person.id === req.user.id);
  }

  const requestedDepartment = String(req.query.department || '');
  if (requestedDepartment) {
    if (!DEPARTMENT_IDS.includes(requestedDepartment)) {
      return res.status(400).json({ error: 'invalid_department' });
    }
    if (!canUseDepartment(req.user, requestedDepartment)) {
      return res.status(403).json({ error: 'forbidden_team' });
    }
    tasks = tasks.filter((task) => (task.department ?? DEFAULT_DEPARTMENT) === requestedDepartment);
    people = people.filter(
      (person) => (person.department ?? DEFAULT_DEPARTMENT) === requestedDepartment
    );
  }

  const rows = people.map((person) => performanceFor(person, tasks));
  res.json({
    scope: managesTeam ? 'team' : 'self',
    summary: performanceSummary(tasks),
    people: rows,
    statuses: statusBreakdown(tasks),
  });
});

router.get('/export.csv', requirePermission(PERMISSIONS.TASKS_EXPORT), async (req, res) => {
  let tasks = await find('tasks', taskPredicate(req.user));
  const requestedDepartment = String(req.query.department || '');
  if (requestedDepartment) {
    if (!DEPARTMENT_IDS.includes(requestedDepartment)) {
      return res.status(400).json({ error: 'invalid_department' });
    }
    if (!canUseDepartment(req.user, requestedDepartment)) {
      return res.status(403).json({ error: 'forbidden_team' });
    }
    tasks = tasks.filter((task) => (task.department ?? DEFAULT_DEPARTMENT) === requestedDepartment);
  }

  const users = await find('users');
  const names = new Map(users.map((user) => [user.id, user.name]));
  const lang = req.query.lang === 'en' ? 'en' : 'ar';
  const headers =
    lang === 'en'
      ? ['Date', 'Team', 'Sub-team', 'Assigned to', 'Task', 'Description', 'Due date', 'Notes', 'Status', 'Score']
      : ['التاريخ', 'الفريق', 'الفريق الفرعي', 'مسندة إلى', 'المهمة', 'الوصف', 'تاريخ التسليم', 'الملاحظات', 'الحالة', 'التقييم'];
  const rows = tasks.map((task) => {
    const department = task.department ?? DEFAULT_DEPARTMENT;
    return [
      task.taskDate ?? task.createdAt?.slice(0, 10) ?? '',
      departmentLabel(department, lang),
      subteamLabel(department, task.subteam, lang),
      names.get(task.assigneeId) ?? '',
      task.title,
      task.description ?? '',
      task.dueDate ?? '',
      task.notes ?? '',
      stageLabel(department, task.stage, lang),
      task.score ?? '',
    ];
  });
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  const stamp = new Date().toISOString().slice(0, 10);
  res
    .set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="tasks-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    })
    .send(`\uFEFF${csv}`);
});

router.post('/', requirePermission(PERMISSIONS.TASKS_CREATE), async (req, res) => {
  const requestedDepartment = req.body?.department ?? req.user.department ?? DEFAULT_DEPARTMENT;
  if (!canUseDepartment(req.user, requestedDepartment)) {
    return res.status(403).json({ error: 'forbidden_team' });
  }
  const parsed = await parseTaskInput(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const department = parsed.value.department ?? req.user.department ?? DEFAULT_DEPARTMENT;
  if (
    parsed.value.assigneeId &&
    !(await validAssignee(req.user, parsed.value.assigneeId, department))
  ) {
    return res.status(400).json({ error: 'assignee_team_mismatch' });
  }
  if (req.body?.score !== undefined && !canManagePerformance(req.user)) {
    return res.status(403).json({ error: 'score_forbidden' });
  }
  const stage = parsed.value.stage ?? firstStage(department);
  const siblings = await find('tasks', (t) => t.department === department && t.stage === stage);

  const task = await create('tasks', {
    priority: 'normal',
    assigneeId: null,
    dueDate: null,
    appId: null,
    labels: [],
    description: '',
    notes: '',
    taskDate: new Date().toISOString().slice(0, 10),
    subteam: req.user.department === department ? (req.user.subteam ?? null) : null,
    score: null,
    scoreBy: null,
    scoredAt: null,
    completedAt: isDoneStage(department, stage) ? new Date().toISOString() : null,
    ...parsed.value,
    department,
    stage,
    createdBy: req.user.id,
    order: Math.min(0, ...siblings.map((t) => t.order ?? 0)) - 1,
    ...(parsed.value.score !== undefined && parsed.value.score !== null
      ? {
          scoreBy: req.user.id,
          scoredAt: new Date().toISOString(),
        }
      : {}),
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
  if (!taskPredicate(req.user)(task)) return res.status(404).json({ error: 'not_found' });
  if (!canEditTask(req.user, task)) return res.status(403).json({ error: 'forbidden' });

  const parsed = await parseTaskInput(req.body, { partial: true, current: task });
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const patch = { ...parsed.value };
  if (req.body?.order !== undefined) patch.order = Number(req.body.order) || 0;

  // Reaching (or leaving) a `done`-type stage maintains the completion stamp,
  // which is what "finished this week" counts.
  const nextDepartment = patch.department ?? task.department;
  const nextStage = patch.stage ?? task.stage;
  if (!canUseDepartment(req.user, nextDepartment)) {
    return res.status(403).json({ error: 'forbidden_team' });
  }
  const nextAssignee =
    patch.assigneeId !== undefined ? patch.assigneeId : task.assigneeId;
  if (nextAssignee && !(await validAssignee(req.user, nextAssignee, nextDepartment))) {
    return res.status(400).json({ error: 'assignee_team_mismatch' });
  }
  if (req.body?.score !== undefined) {
    if (!canManagePerformance(req.user)) {
      return res.status(403).json({ error: 'score_forbidden' });
    }
    patch.scoreBy = patch.score === null ? null : req.user.id;
    patch.scoredAt = patch.score === null ? null : new Date().toISOString();
  }

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
  res.json({ task: taskForUser(req.user, updated) });
});

router.delete('/:id', async (req, res) => {
  const store = await getStore();
  const task = await findOne('tasks', (t) => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'not_found' });
  if (!taskPredicate(req.user)(task)) return res.status(404).json({ error: 'not_found' });

  if (!canDeleteTask(req.user, task)) return res.status(403).json({ error: 'forbidden' });

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
  if (!task || !taskPredicate(req.user)(task)) return res.status(404).json({ error: 'not_found' });
  const comments = (await find('comments', (c) => c.taskId === task.id)).sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : 1
  );
  res.json({ comments });
});

router.post('/:id/comments', async (req, res) => {
  const task = await findOne('tasks', (t) => t.id === req.params.id);
  if (!task || !taskPredicate(req.user)(task)) return res.status(404).json({ error: 'not_found' });

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
  if (body?.notes !== undefined) value.notes = String(body.notes || '').trim().slice(0, 5000);

  if (body?.department !== undefined) {
    if (!DEPARTMENT_IDS.includes(body.department)) return { error: 'invalid_department' };
    value.department = body.department;
  }

  if (body?.subteam !== undefined) {
    const department = value.department ?? current?.department ?? DEFAULT_DEPARTMENT;
    if (body.subteam === null || body.subteam === '') {
      value.subteam = null;
    } else if (!getSubteam(department, body.subteam)) {
      return { error: 'invalid_subteam' };
    } else {
      value.subteam = body.subteam;
    }
  } else if (value.department && current && value.department !== current.department) {
    value.subteam = null;
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
    const parsedDate = parseDate(body.dueDate);
    if (parsedDate === false) return { error: 'invalid_due_date' };
    value.dueDate = parsedDate;
  }

  if (body?.taskDate !== undefined) {
    const parsedDate = parseDate(body.taskDate);
    if (parsedDate === false || parsedDate === null) return { error: 'invalid_task_date' };
    value.taskDate = parsedDate;
  }

  if (body?.score !== undefined) {
    if (body.score === null || body.score === '') {
      value.score = null;
    } else {
      const score = Number(body.score);
      if (!Number.isFinite(score) || score < 0 || score > 100) {
        return { error: 'invalid_score' };
      }
      value.score = Math.round(score * 10) / 10;
    }
  }

  if (body?.labels !== undefined) {
    value.labels = Array.isArray(body.labels)
      ? [...new Set(body.labels.map((l) => String(l).trim()).filter(Boolean))].slice(0, 8)
      : [];
  }

  return { value };
}

function parseDate(input) {
  if (input === null || input === '') return null;
  const text = String(input);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) return false;
  return text;
}

async function validAssignee(actor, assigneeId, department) {
  const assignee = await findOne('users', (user) => user.id === assigneeId);
  return canAssignUser(actor, assignee, department);
}

function performanceFor(person, tasks) {
  const assigned = tasks.filter((task) => task.assigneeId === person.id);
  return {
    user: {
      id: person.id,
      name: person.name,
      avatarColor: person.avatarColor,
      department: person.department ?? DEFAULT_DEPARTMENT,
      subteam: person.subteam ?? null,
      jobRole: person.jobRole ?? null,
    },
    ...performanceSummary(assigned),
  };
}

function performanceSummary(tasks) {
  const completed = tasks.filter((task) =>
    isDoneStage(task.department ?? DEFAULT_DEPARTMENT, task.stage)
  );
  const today = new Date().toISOString().slice(0, 10);
  const overdue = tasks.filter(
    (task) =>
      task.dueDate &&
      task.dueDate < today &&
      !isDoneStage(task.department ?? DEFAULT_DEPARTMENT, task.stage)
  );
  const scored = tasks.filter((task) => Number.isFinite(task.score));
  const withDeadline = completed.filter((task) => task.dueDate && task.completedAt);
  const onTime = withDeadline.filter(
    (task) => task.completedAt.slice(0, 10) <= task.dueDate
  );
  return {
    total: tasks.length,
    completed: completed.length,
    active: tasks.length - completed.length,
    overdue: overdue.length,
    completionRate: percentage(completed.length, tasks.length),
    onTimeRate: percentage(onTime.length, withDeadline.length),
    averageScore: scored.length
      ? Math.round((scored.reduce((sum, task) => sum + task.score, 0) / scored.length) * 10) / 10
      : null,
    scoredTasks: scored.length,
  };
}

function percentage(value, total) {
  return total ? Math.round((value / total) * 100) : 0;
}

function statusBreakdown(tasks) {
  const groups = new Map();
  for (const task of tasks) {
    const department = task.department ?? DEFAULT_DEPARTMENT;
    const key = `${department}:${task.stage}`;
    const current = groups.get(key) ?? {
      id: key,
      department,
      stage: task.stage,
      labelAr: stageLabel(department, task.stage, 'ar'),
      labelEn: stageLabel(department, task.stage, 'en'),
      count: 0,
    };
    current.count += 1;
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

function csvCell(value) {
  let text = String(value ?? '');
  // Excel and Google Sheets may evaluate cells beginning with these characters
  // as formulas. Task text is user-authored, so neutralise it on export.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  text = text.replaceAll('"', '""');
  return `"${text}"`;
}

export default router;
