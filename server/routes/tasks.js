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
import {
  canReopen,
  canReview,
  canStart,
  canSubmit,
  isReviewer,
  scoreBand,
  stageForReturn,
  stageForState,
  stageWriteVerdict,
  taskState,
} from '../../shared/workflow.js';
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
import attachmentRoutes, { syncAttachmentCount } from './taskFiles.js';

const router = Router();

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

router.use(requireAuth);

/** Deliverables hang off a task, so they are the same resource, one level down. */
router.use('/:id/attachments', attachmentRoutes);

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
      ? [
          'Date', 'Team', 'Sub-team', 'Assigned to', 'Task', 'Description', 'Due date', 'Notes',
          'Status', 'Deliverables', 'Submitted on', 'Reviewed on', 'Reviewed by', 'Times returned',
          'Score', 'Rating',
        ]
      : [
          'التاريخ', 'الفريق', 'الفريق الفرعي', 'مسندة إلى', 'المهمة', 'الوصف', 'تاريخ التسليم',
          'الملاحظات', 'الحالة', 'المرفقات', 'تاريخ التسليم الفعلي', 'تاريخ المراجعة', 'راجعها',
          'مرات الإعادة', 'التقييم', 'التقدير',
        ];
  const rows = tasks.map((task) => {
    const department = task.department ?? DEFAULT_DEPARTMENT;
    const band = scoreBand(task.score);
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
      task.attachmentCount ?? 0,
      task.submittedAt?.slice(0, 10) ?? '',
      task.reviewedAt?.slice(0, 10) ?? '',
      names.get(task.reviewedBy) ?? '',
      task.reworkCount ?? 0,
      task.score ?? '',
      band ? band[lang] : '',
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
  // A score is the result of reviewing delivered work, so a task cannot be born
  // with one. This is the rule that keeps the creation form free of it.
  if (req.body?.score !== undefined && req.body.score !== null && req.body.score !== '') {
    return res.status(400).json({ error: 'score_before_review' });
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
    ...blankLifecycle(),
    completedAt: isDoneStage(department, stage) ? new Date().toISOString() : null,
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
  res.status(201).json({ task: taskForUser(req.user, task) });
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

  const nextDepartment = patch.department ?? task.department;
  const nextStage = patch.stage ?? task.stage;
  if (!canUseDepartment(req.user, nextDepartment)) {
    return res.status(403).json({ error: 'forbidden_team' });
  }
  const nextAssignee = patch.assigneeId !== undefined ? patch.assigneeId : task.assigneeId;
  if (nextAssignee && !(await validAssignee(req.user, nextAssignee, nextDepartment))) {
    return res.status(400).json({ error: 'assignee_team_mismatch' });
  }

  /*
   * The two gates are actions, not fields. A plain stage write that would push
   * a task into review or into done is refused and pointed at the endpoint that
   * enforces what those transitions require — a deliverable, or a score. Pulling
   * work back out of either one is a manager's correction, not an employee's undo.
   */
  const verdict = stageWriteVerdict(req.user, task, nextDepartment, nextStage);
  if (verdict === 'submit') return res.status(409).json({ error: 'submit_required' });
  if (verdict === 'review') return res.status(409).json({ error: 'review_required' });
  if (verdict === 'forbidden') return res.status(403).json({ error: 'review_required' });

  const wasState = taskState(task);
  const nowState = taskState({ ...task, department: nextDepartment, stage: nextStage });
  const steppedBack = wasState !== nowState && (wasState === 'submitted' || wasState === 'approved');
  if (steppedBack && wasState === 'submitted') {
    // A card dragged out of the review column is a return, so it counts as one.
    Object.assign(patch, {
      reviewDecision: 'changes_requested',
      reviewedAt: new Date().toISOString(),
      reviewedBy: req.user.id,
      reworkCount: (task.reworkCount ?? 0) + 1,
      submittedAt: null,
    });
  } else if (steppedBack) {
    // Dragged back out of done — the same thing /reopen does. The verdict no
    // longer applies, so it stops being shown; the score stays as the record of
    // what was actually awarded.
    patch.reviewDecision = null;
  }

  if (req.body?.score !== undefined) {
    if (!canManagePerformance(req.user)) return res.status(403).json({ error: 'score_forbidden' });
    if (nowState !== 'submitted' && nowState !== 'approved') {
      return res.status(400).json({ error: 'score_before_review' });
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
  if (steppedBack && wasState === 'submitted' && task.assigneeId !== req.user.id) {
    await notify(task.assigneeId, req.user.id, {
      type: 'task.returned',
      title: { ar: 'مهمة رجعت إليك للتعديل', en: 'A task was sent back to you' },
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
  const attachments = await find('attachments', (a) => a.taskId === task.id);
  for (const attachment of attachments) {
    await store.remove('attachments', attachment.id);
    await store.removeBlob(attachment.id);
  }
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

/* ── the lifecycle gates ─────────────────────────────────────────── */

/**
 * Start work. Nothing more than a stage move, but having it as an action means
 * the button says what it does and the board does not have to be dragged to
 * record that somebody picked the task up.
 */
router.post('/:id/start', async (req, res) => {
  const store = await getStore();
  const task = await loadVisible(req, res);
  if (!task) return;
  if (!canStart(req.user, task)) return res.status(403).json({ error: 'forbidden' });

  const department = task.department ?? DEFAULT_DEPARTMENT;
  const updated = await store.update('tasks', task.id, {
    stage: stageForState(department, 'working', task.stage),
    startedAt: task.startedAt ?? new Date().toISOString(),
  });

  await logActivity({
    actorId: req.user.id,
    action: 'task.start',
    subject: 'task',
    subjectId: task.id,
    meta: { title: task.title },
  });
  res.json({ task: taskForUser(req.user, updated) });
});

/**
 * Hand the work in. This is the gate the whole redesign exists for: the person
 * who did the work attaches what they produced, writes what they did, and the
 * task moves into the review column — it does not move itself, and it cannot
 * skip to done.
 */
router.post('/:id/submit', async (req, res) => {
  const store = await getStore();
  const task = await loadVisible(req, res);
  if (!task) return;
  if (!canSubmit(req.user, task)) return res.status(403).json({ error: 'forbidden' });

  // Keep the count honest even if an older row drifted, then insist on proof.
  const count = await syncAttachmentCount(task.id);
  if (count === 0) return res.status(400).json({ error: 'deliverable_required' });

  const department = task.department ?? DEFAULT_DEPARTMENT;
  const note = String(req.body?.note || '').trim().slice(0, 2000);
  const updated = await store.update('tasks', task.id, {
    stage: stageForState(department, 'submitted', task.stage),
    submittedAt: new Date().toISOString(),
    submittedBy: req.user.id,
    submissionNote: note,
    // A resubmission answers the last review, so the old verdict stops applying.
    reviewDecision: null,
    completedAt: null,
  });

  for (const userId of await reviewAudience(task, req.user.id)) {
    await notify(userId, req.user.id, {
      type: 'task.submitted',
      title: { ar: 'مهمة بانتظار مراجعتك', en: 'A task is waiting for your review' },
      body: `${updated.title} — ${req.user.name}`,
      link: `/tasks?task=${updated.id}`,
    });
  }

  await logActivity({
    actorId: req.user.id,
    action: 'task.submit',
    subject: 'task',
    subjectId: task.id,
    meta: { title: task.title, attachments: count },
  });
  res.json({ task: taskForUser(req.user, updated) });
});

/**
 * The manager's verdict. Approving closes the task and must carry a score;
 * returning it must carry a reason, because "do it again" without one is the
 * single most common way a review loop wastes a day.
 */
router.post('/:id/review', async (req, res) => {
  const store = await getStore();
  const task = await loadVisible(req, res);
  if (!task) return;
  if (!isReviewer(req.user)) return res.status(403).json({ error: 'score_forbidden' });
  if (!canReview(req.user, task)) return res.status(409).json({ error: 'not_submitted' });

  const decision = req.body?.decision;
  const note = String(req.body?.note || '').trim().slice(0, 2000);
  const department = task.department ?? DEFAULT_DEPARTMENT;
  const stamp = new Date().toISOString();

  if (decision === 'approved') {
    const score = Number(req.body?.score);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      return res.status(400).json({ error: 'invalid_score' });
    }
    const updated = await store.update('tasks', task.id, {
      stage: stageForState(department, 'approved', task.stage),
      score: Math.round(score * 10) / 10,
      scoreBy: req.user.id,
      scoredAt: stamp,
      reviewDecision: 'approved',
      reviewedAt: stamp,
      reviewedBy: req.user.id,
      reviewNote: note,
      completedAt: stamp,
    });

    if (task.assigneeId && task.assigneeId !== req.user.id) {
      await notify(task.assigneeId, req.user.id, {
        type: 'task.approved',
        title: { ar: 'تم اعتماد مهمتك', en: 'Your task was approved' },
        body: `${updated.title} — ${updated.score}/100`,
        link: `/tasks?task=${updated.id}`,
      });
    }
    await logActivity({
      actorId: req.user.id,
      action: 'task.approve',
      subject: 'task',
      subjectId: task.id,
      meta: { title: task.title, score: updated.score },
    });
    return res.json({ task: taskForUser(req.user, updated) });
  }

  if (decision !== 'changes_requested') return res.status(400).json({ error: 'invalid_decision' });
  if (!note) return res.status(400).json({ error: 'review_note_required' });

  const updated = await store.update('tasks', task.id, {
    stage: stageForReturn(department, task.stage),
    reviewDecision: 'changes_requested',
    reviewedAt: stamp,
    reviewedBy: req.user.id,
    reviewNote: note,
    reworkCount: (task.reworkCount ?? 0) + 1,
    submittedAt: null,
    completedAt: null,
  });

  if (task.assigneeId && task.assigneeId !== req.user.id) {
    await notify(task.assigneeId, req.user.id, {
      type: 'task.returned',
      title: { ar: 'مهمة رجعت إليك للتعديل', en: 'A task was sent back to you' },
      body: `${updated.title} — ${note.slice(0, 80)}`,
      link: `/tasks?task=${updated.id}`,
    });
  }
  await logActivity({
    actorId: req.user.id,
    action: 'task.return',
    subject: 'task',
    subjectId: task.id,
    meta: { title: task.title },
  });
  res.json({ task: taskForUser(req.user, updated) });
});

/** Undo an approval — a manager correcting their own call, never an employee's. */
router.post('/:id/reopen', async (req, res) => {
  const store = await getStore();
  const task = await loadVisible(req, res);
  if (!task) return;
  if (!canReopen(req.user, task)) return res.status(403).json({ error: 'forbidden' });

  const department = task.department ?? DEFAULT_DEPARTMENT;
  const updated = await store.update('tasks', task.id, {
    stage: stageForState(department, 'working', task.stage),
    reviewDecision: null,
    completedAt: null,
  });

  if (task.assigneeId && task.assigneeId !== req.user.id) {
    await notify(task.assigneeId, req.user.id, {
      type: 'task.returned',
      title: { ar: 'أُعيد فتح مهمة', en: 'A task was reopened' },
      body: updated.title,
      link: `/tasks?task=${updated.id}`,
    });
  }
  await logActivity({
    actorId: req.user.id,
    action: 'task.reopen',
    subject: 'task',
    subjectId: task.id,
    meta: { title: task.title },
  });
  res.json({ task: taskForUser(req.user, updated) });
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

async function loadVisible(req, res) {
  const task = await findOne('tasks', (t) => t.id === req.params.id);
  if (!task || !taskPredicate(req.user)(task)) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  return task;
}

/** The lifecycle fields a brand-new task starts with — nothing has happened yet. */
function blankLifecycle() {
  return {
    startedAt: null,
    submittedAt: null,
    submittedBy: null,
    submissionNote: '',
    reviewedAt: null,
    reviewedBy: null,
    reviewNote: '',
    reviewDecision: null,
    reworkCount: 0,
    attachmentCount: 0,
    score: null,
    scoreBy: null,
    scoredAt: null,
  };
}

/**
 * Who should hear that work is waiting. Whoever filed the task, plus every
 * manager who can act on that department — so a submission never sits unseen
 * because one person is away.
 */
async function reviewAudience(task, actorId) {
  const department = task.department ?? DEFAULT_DEPARTMENT;
  const people = await find('users', (user) => user.status !== 'disabled');
  const audience = new Set();
  for (const person of people) {
    if (!isReviewer(person)) continue;
    const reachesTask =
      can(person, PERMISSIONS.TASKS_VIEW_ALL) ||
      (person.department ?? DEFAULT_DEPARTMENT) === department;
    if (reachesTask) audience.add(person.id);
  }
  if (task.createdBy) audience.add(task.createdBy);
  audience.delete(actorId);
  return [...audience];
}

/**
 * Bilingual notification titles: the workspace runs in two languages and the
 * recipient's choice isn't known at write time, so both are stored and the UI
 * picks. Push delivery does the same at send time.
 */
async function notify(userId, actorId, { type, title, body, link }) {
  if (!userId) return;
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
  const onTime = withDeadline.filter((task) => task.completedAt.slice(0, 10) <= task.dueDate);
  const awaitingReview = tasks.filter((task) => taskState(task) === 'submitted');
  // Approved without ever being sent back. A low rate usually means the brief
  // was unclear, not that the person is weak — which is why it is its own number.
  const firstPass = completed.filter((task) => (task.reworkCount ?? 0) === 0);

  return {
    total: tasks.length,
    completed: completed.length,
    active: tasks.length - completed.length,
    overdue: overdue.length,
    awaitingReview: awaitingReview.length,
    returned: tasks.filter((task) => (task.reworkCount ?? 0) > 0).length,
    completionRate: percentage(completed.length, tasks.length),
    onTimeRate: percentage(onTime.length, withDeadline.length),
    firstPassRate: percentage(firstPass.length, completed.length),
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
