import { Router } from 'express';
import { create, find, findOne, getStore } from '../store.js';
import { logActivity, requireAuth, requirePermission } from '../auth.js';
import { PERMISSIONS, can, isActiveUser } from '../../shared/permissions.js';
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
  ASSIGNMENT_ACTIONS,
  canApproveWork,
  canReopen,
  canRespondToAssignment,
  canReview,
  canScoreWork,
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
import { publishNotification } from '../notificationStream.js';
import {
  canArchiveTask,
  canAssignUser,
  canDeleteTask,
  canEditTask,
  canManagePerformance,
  canManageTaskPlan,
  canUseDepartment,
  canViewTask,
  isArchived,
  livePredicate,
  taskForUser,
  taskPredicate,
  visiblePeople,
} from '../taskAccess.js';
import attachmentRoutes, { syncAttachmentCount } from './taskFiles.js';
import { organizationOf } from '../../shared/organization.js';

const router = Router();

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
export const EFFORT_POINTS = [1, 2, 3, 5, 8, 13];

router.use(requireAuth);

/** Deliverables hang off a task, so they are the same resource, one level down. */
router.use('/:id/attachments', attachmentRoutes);

router.get('/', async (req, res) => {
  if (!can(req.user, PERMISSIONS.TASKS_VIEW)) {
    return res.status(403).json({ error: 'forbidden', missing: PERMISSIONS.TASKS_VIEW });
  }
  const tasks = (await find('tasks', livePredicate(req.user))).sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
  );
  res.json({ tasks: tasks.map((task) => taskForUser(req.user, task)), priorities: PRIORITIES });
});

/**
 * The numbers behind the nav badge and the sign-in summary.
 *
 * Deliberately separate from `/overview`: that endpoint builds per-person
 * performance tables and is heavy enough that the chrome should not poll it.
 * This one answers "how much is on my plate", which is what a badge means, and
 * stays a count of the caller's own work even for administrators — a badge that
 * shows the whole company's backlog is not actionable.
 */
router.get('/counts', async (req, res) => {
  if (!can(req.user, PERMISSIONS.TASKS_VIEW)) {
    return res.json({ mine: 0, overdue: 0, dueToday: 0, unanswered: 0, awaitingMyReview: 0 });
  }

  const visible = await find('tasks', livePredicate(req.user));
  const today = new Date().toISOString().slice(0, 10);
  const isOpen = (task) => !isDoneStage(task.department ?? DEFAULT_DEPARTMENT, task.stage);

  const mine = visible.filter((task) => task.assigneeId === req.user.id && isOpen(task));

  // What a reviewer needs to act on — theirs to clear, not theirs to do.
  const awaitingMyReview = isReviewer(req.user)
    ? visible.filter((task) => taskState(task) === 'submitted' && task.assigneeId !== req.user.id)
        .length
    : 0;

  res.json({
    mine: mine.length,
    overdue: mine.filter((task) => task.dueDate && task.dueDate < today).length,
    dueToday: mine.filter((task) => task.dueDate === today).length,
    // Assigned to them and never accepted or declined — the quietest way for
    // work to stall, so it gets its own number.
    unanswered: mine.filter((task) => task.assignmentStatus === 'pending').length,
    awaitingMyReview,
  });
});

router.get('/overview', async (req, res) => {
  if (!can(req.user, PERMISSIONS.TASKS_VIEW)) {
    return res.status(403).json({ error: 'forbidden', missing: PERMISSIONS.TASKS_VIEW });
  }

  const managesTeam = canManagePerformance(req.user);
  let tasks = await find('tasks', livePredicate(req.user));
  let people = visiblePeople(req.user, await find('users', isActiveUser));

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
  let tasks = await find('tasks', livePredicate(req.user));
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

  const users = visiblePeople(req.user, await find('users'));
  const names = new Map(users.map((user) => [user.id, user.name]));
  const lang = req.query.lang === 'en' ? 'en' : 'ar';
  const headers =
    lang === 'en'
      ? [
          'Reference', 'Date', 'Team', 'Sub-team', 'Assigned to', 'Task', 'Description',
          'Objective', 'Definition of done', 'Due date', 'Notes', 'Status', 'Progress',
          'Effort points', 'Estimated minutes', 'Deliverables', 'Submitted on', 'Reviewed on',
          'Reviewed by', 'Times returned', 'Score', 'Rating',
        ]
      : [
          'المرجع', 'التاريخ', 'الفريق', 'الفريق الفرعي', 'مسندة إلى', 'المهمة', 'الوصف',
          'الهدف', 'تعريف الإنجاز', 'تاريخ التسليم', 'الملاحظات', 'الحالة', 'التقدم',
          'نقاط الجهد', 'الدقائق المقدرة', 'المرفقات', 'تاريخ التسليم الفعلي',
          'تاريخ المراجعة', 'راجعها', 'مرات الإعادة', 'التقييم', 'التقدير',
        ];
  const rows = tasks.map((task) => {
    const department = task.department ?? DEFAULT_DEPARTMENT;
    const band = scoreBand(task.score);
    return [
      task.reference ?? '',
      task.taskDate ?? task.createdAt?.slice(0, 10) ?? '',
      departmentLabel(department, lang),
      subteamLabel(department, task.subteam, lang),
      names.get(task.assigneeId) ?? '',
      task.title,
      task.description ?? '',
      task.objective ?? '',
      task.definitionOfDone ?? '',
      task.dueDate ?? '',
      task.notes ?? '',
      stageLabel(department, task.stage, lang),
      task.progress ?? 0,
      task.effortPoints ?? '',
      task.estimatedMinutes ?? '',
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
  await logActivity({
    actorId: req.user.id,
    action: 'task.export',
    subject: 'task',
    subjectId: requestedDepartment || 'all',
    meta: { department: requestedDepartment || null, rows: rows.length, format: 'csv' },
  });
  res
    .set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="tasks-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    })
    .send(`\uFEFF${csv}`);
});

/**
 * Fetch one fresh task for notification/search deep links. The list endpoint is
 * still used for boards, but a direct link must not depend on the browser's
 * cached copy already containing a task that may have been assigned seconds ago.
 */
router.get('/:id', async (req, res) => {
  const task = await loadVisible(req, res);
  if (!task) return;
  res.json({ task: taskForUser(req.user, task) });
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
  const initialState = taskState({ department, stage });
  // Review and completion are events with evidence and a verdict. Accepting a
  // stage id for either one here would let API callers create work after those
  // gates without ever performing them.
  if (initialState === 'submitted') {
    return res.status(409).json({ error: 'submit_required' });
  }
  if (initialState === 'approved') {
    return res.status(409).json({ error: 'review_required' });
  }
  const siblings = await find(
    'tasks',
    (t) =>
      organizationOf(t) === organizationOf(req.user) &&
      t.department === department &&
      t.stage === stage
  );

  const task = await create('tasks', {
    reference: taskReference(),
    priority: 'normal',
    assigneeId: null,
    dueDate: null,
    appId: null,
    labels: [],
    description: '',
    objective: '',
    definitionOfDone: '',
    notes: '',
    effortPoints: null,
    estimatedMinutes: null,
    progress: 0,
    taskDate: new Date().toISOString().slice(0, 10),
    subteam: req.user.department === department ? (req.user.subteam ?? null) : null,
    ...blankLifecycle(),
    ...assignmentLifecycle(parsed.value.assigneeId ?? null, req.user.id),
    completedAt: isDoneStage(department, stage) ? new Date().toISOString() : null,
    ...parsed.value,
    organizationId: organizationOf(req.user),
    department,
    stage,
    createdBy: req.user.id,
    order: Math.min(0, ...siblings.map((t) => t.order ?? 0)) - 1,
  });

  if (task.assigneeId) {
    await recordAssignment(task, req.user, 'assigned', {
      assigneeId: task.assigneeId,
      assignedBy: req.user.id,
    });
  }

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
  if (isArchived(task)) return res.status(409).json({ error: 'task_archived' });
  if (!canEditTask(req.user, task)) return res.status(403).json({ error: 'forbidden' });
  // Scores are the outcome of the review action, never a generic editable task
  // property. Keeping this out of PATCH preserves the reviewer/timestamp trail.
  if (req.body?.score !== undefined) {
    return taskState(task) === 'assigned' || taskState(task) === 'working'
      ? res.status(400).json({ error: 'score_before_review' })
      : res.status(409).json({ error: 'review_required' });
  }

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
  // Only re-check the assignment when it is actually being decided: the person
  // is changing, or the team is moving under them. An assignee editing their own
  // progress is not assigning anybody, and asking them to prove they *could*
  // have assigned the person already on the card would fail every ordinary edit
  // now that assigning is a manager's authority.
  const assignmentDecided =
    nextAssignee !== (task.assigneeId ?? null) ||
    nextDepartment !== (task.department ?? DEFAULT_DEPARTMENT);
  if (
    nextAssignee &&
    assignmentDecided &&
    !(await validAssignee(req.user, nextAssignee, nextDepartment))
  ) {
    return res.status(400).json({ error: 'assignee_team_mismatch' });
  }

  if (changesPlan(patch, task) && !canManageTaskPlan(req.user, task)) {
    return res.status(403).json({ error: 'task_plan_forbidden' });
  }

  /* Workflow gates are actions, not fields. A plain stage write cannot bypass
   * assignment acceptance, picking the work up, submission evidence, manager
   * review or reopening. */
  const verdict = stageWriteVerdict(req.user, task, nextDepartment, nextStage);
  if (verdict === 'assignment') return res.status(409).json({ error: 'assignment_required' });
  if (verdict === 'start') return res.status(409).json({ error: 'start_required' });
  if (verdict === 'submit') return res.status(409).json({ error: 'submit_required' });
  if (verdict === 'review') return res.status(409).json({ error: 'review_required' });
  if (verdict === 'reopen') return res.status(409).json({ error: 'reopen_required' });
  if (verdict === 'forbidden') return res.status(403).json({ error: 'forbidden' });

  const assignmentChanged =
    Object.hasOwn(patch, 'assigneeId') && patch.assigneeId !== task.assigneeId;
  if (assignmentChanged) {
    Object.assign(patch, assignmentLifecycle(patch.assigneeId, req.user.id));
  } else if (
    Object.hasOwn(patch, 'dueDate') &&
    task.assignmentStatus === 'due_date_proposed' &&
    patch.dueDate === task.proposedDueDate
  ) {
    patch.assignmentStatus = 'accepted';
    patch.acceptedAt = new Date().toISOString();
  }

  const wasDone = isDoneStage(task.department, task.stage);
  const nowDone = isDoneStage(nextDepartment, nextStage);
  if (wasDone !== nowDone) patch.completedAt = nowDone ? new Date().toISOString() : null;

  const updated = await store.update('tasks', task.id, patch);

  if (assignmentChanged) {
    await recordAssignment(updated, req.user, patch.assigneeId ? 'assigned' : 'unassigned', {
      previousAssigneeId: task.assigneeId ?? null,
      assigneeId: patch.assigneeId ?? null,
    });
  } else if (
    task.assignmentStatus === 'due_date_proposed' &&
    updated.assignmentStatus === 'accepted'
  ) {
    await recordAssignment(updated, req.user, 'due_date_approved', {
      dueDate: updated.dueDate,
    });
  }

  if (patch.assigneeId && patch.assigneeId !== task.assigneeId && patch.assigneeId !== req.user.id) {
    await notify(patch.assigneeId, req.user.id, {
      type: 'task.assigned',
      title: { ar: 'مهمة أُسندت إليك', en: 'A task was assigned to you' },
      body: updated.title,
      link: `/tasks?task=${updated.id}`,
    });
  }
  if (assignmentChanged && task.assigneeId && task.assigneeId !== req.user.id) {
    await notify(task.assigneeId, req.user.id, {
      type: 'task.unassigned',
      title: { ar: 'تم تغيير إسناد مهمة', en: 'A task assignment changed' },
      body: updated.title,
      link: '/tasks',
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

/**
 * Take a task off the board without destroying it.
 *
 * This is what used to be DELETE. The record — who asked for the work, who did
 * it, what was handed in, what it scored — outlives the card, so a task that
 * went badly can be cleared away without also being erased.
 */
router.post('/:id/archive', async (req, res) => {
  const store = await getStore();
  const task = await loadLive(req, res);
  if (!task) return;
  if (!canArchiveTask(req.user, task)) return res.status(403).json({ error: 'archive_forbidden' });

  const reason = String(req.body?.reason || '').trim().slice(0, 500);
  const updated = await store.update('tasks', task.id, {
    archivedAt: new Date().toISOString(),
    archivedBy: req.user.id,
    archiveReason: reason,
  });

  // The person who was carrying the work needs to know it stopped being theirs.
  if (task.assigneeId && task.assigneeId !== req.user.id) {
    await notify(task.assigneeId, req.user.id, {
      type: 'task.archived',
      title: { ar: 'أُرشفت مهمة كانت لديك', en: 'A task of yours was archived' },
      body: task.title,
      link: '/tasks',
    });
  }

  await logActivity({
    actorId: req.user.id,
    action: 'task.archive',
    subject: 'task',
    subjectId: task.id,
    meta: { title: task.title, reason },
  });
  res.json({ task: taskForUser(req.user, updated) });
});

/** Put an archived task back on the board — the same authority, undone. */
router.post('/:id/restore', async (req, res) => {
  const store = await getStore();
  const task = await loadVisible(req, res);
  if (!task) return;
  if (!canArchiveTask(req.user, task)) return res.status(403).json({ error: 'archive_forbidden' });
  if (!isArchived(task)) return res.status(409).json({ error: 'not_archived' });

  const updated = await store.update('tasks', task.id, {
    archivedAt: null,
    archivedBy: null,
    archiveReason: '',
  });

  await logActivity({
    actorId: req.user.id,
    action: 'task.restore',
    subject: 'task',
    subjectId: task.id,
    meta: { title: task.title },
  });
  res.json({ task: taskForUser(req.user, updated) });
});

/**
 * The permanent purge, and the only operation in the app that destroys history:
 * the comments and the uploaded deliverables go with the task.
 *
 * Administrators only, and only for work that is already archived — so removing
 * a task is always two deliberate steps by two different kinds of authority,
 * with the archive standing in between as the chance to notice.
 */
router.delete('/:id', async (req, res) => {
  const store = await getStore();
  const task = await findOne('tasks', (t) => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'not_found' });
  if (!taskPredicate(req.user)(task)) return res.status(404).json({ error: 'not_found' });

  if (!canDeleteTask(req.user, task)) return res.status(403).json({ error: 'forbidden' });
  if (!isArchived(task)) return res.status(409).json({ error: 'archive_required' });

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
router.get('/:id/assignments', async (req, res) => {
  const task = await loadVisible(req, res);
  if (!task) return;
  const assignments = (await find('taskAssignments', (event) => event.taskId === task.id))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  res.json({ assignments });
});

/**
 * The assignee owns the response to an assignment. Decline and request actions
 * require a reason so the manager gets an actionable answer rather than a
 * silent state change.
 */
router.post('/:id/assignment', async (req, res) => {
  const store = await getStore();
  const task = await loadLive(req, res);
  if (!task) return;
  if (!canRespondToAssignment(req.user, task)) {
    return res.status(403).json({ error: 'assignment_response_forbidden' });
  }

  const action = String(req.body?.action || '');
  if (!ASSIGNMENT_ACTIONS.includes(action)) {
    return res.status(400).json({ error: 'invalid_assignment_action' });
  }
  const note = String(req.body?.note || '').trim().slice(0, 2000);
  const requiresReason = new Set([
    'decline',
    'request_clarification',
    'request_reassignment',
  ]);
  if (requiresReason.has(action) && !note) {
    return res.status(400).json({ error: 'assignment_reason_required' });
  }

  const stamp = new Date().toISOString();
  const patch = { assignmentNote: note };
  if (action === 'accept') {
    patch.assignmentStatus = 'accepted';
    patch.acceptedAt = stamp;
    patch.declinedAt = null;
    patch.proposedDueDate = null;
  } else if (action === 'decline') {
    patch.assignmentStatus = 'declined';
    patch.declinedAt = stamp;
  } else if (action === 'request_clarification') {
    patch.assignmentStatus = 'clarification_requested';
  } else if (action === 'request_reassignment') {
    patch.assignmentStatus = 'reassignment_requested';
  } else {
    const proposedDueDate = parseDate(req.body?.dueDate);
    if (!proposedDueDate) return res.status(400).json({ error: 'invalid_due_date' });
    patch.assignmentStatus = 'due_date_proposed';
    patch.proposedDueDate = proposedDueDate;
  }

  const updated = await store.update('tasks', task.id, patch);
  await recordAssignment(updated, req.user, action, {
    note,
    proposedDueDate: patch.proposedDueDate ?? null,
  });

  const audience = new Set([task.createdBy, task.assignedBy].filter(Boolean));
  audience.delete(req.user.id);
  for (const userId of audience) {
    await notify(userId, req.user.id, {
      type: `task.assignment.${action}`,
      title: assignmentNotificationTitle(action),
      body: `${task.title}${note ? ` — ${note.slice(0, 80)}` : ''}`,
      link: `/tasks?task=${task.id}`,
    });
  }

  await logActivity({
    actorId: req.user.id,
    action: `task.assignment.${action}`,
    subject: 'task',
    subjectId: task.id,
    meta: { note: note || null, proposedDueDate: patch.proposedDueDate ?? null },
  });
  res.json({ task: taskForUser(req.user, updated) });
});

router.post('/:id/start', async (req, res) => {
  const store = await getStore();
  const task = await loadLive(req, res);
  if (!task) return;
  if (!canStart(req.user, task)) return res.status(403).json({ error: 'forbidden' });

  const department = task.department ?? DEFAULT_DEPARTMENT;
  const updated = await store.update('tasks', task.id, {
    stage: stageForState(department, 'working', task.stage),
    startedAt: task.startedAt ?? new Date().toISOString(),
    progress: Math.max(task.progress ?? 0, 1),
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
  const task = await loadLive(req, res);
  if (!task) return;
  if (!canSubmit(req.user, task)) return res.status(403).json({ error: 'forbidden' });

  // Keep the count honest even if an older row drifted, then insist on proof.
  const count = await syncAttachmentCount(task.id);
  if (count === 0) return res.status(400).json({ error: 'deliverable_required' });

  const department = task.department ?? DEFAULT_DEPARTMENT;
  const note = String(req.body?.note || '').trim().slice(0, 2000);
  const now = new Date().toISOString();
  const updated = await store.update('tasks', task.id, {
    stage: stageForState(department, 'submitted', task.stage),
    // A task handed in without ever being started leaves no cycle time to
    // measure, so the hand-in stands in for the moment work began.
    startedAt: task.startedAt ?? now,
    submittedAt: now,
    submittedBy: req.user.id,
    submissionNote: note,
    // A resubmission answers the last review, so the old verdict stops applying.
    reviewDecision: null,
    completedAt: null,
    progress: 100,
  });

  for (const userId of await reviewAudience(task, req.user.id)) {
    await notify(userId, req.user.id, {
      type: 'task.submitted',
      title: { ar: 'تم تسليم مهمة للمراجعة', en: 'Task completed and submitted' },
      body: {
        ar: `${req.user.name} أنهى «${updated.title}» وسلّمها للمراجعة.`,
        en: `${req.user.name} completed “${updated.title}” and submitted it for review.`,
      },
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
  const task = await loadLive(req, res);
  if (!task) return;
  if (!isReviewer(req.user)) return res.status(403).json({ error: 'review_forbidden' });
  if (!canReview(req.user, task)) return res.status(409).json({ error: 'not_submitted' });

  const decision = req.body?.decision;
  const note = String(req.body?.note || '').trim().slice(0, 2000);
  const department = task.department ?? DEFAULT_DEPARTMENT;
  const stamp = new Date().toISOString();

  if (decision === 'approved') {
    // Closing the task and putting a number on somebody's record are separate
    // authorities from being allowed to read the work and send it back.
    if (!canApproveWork(req.user)) return res.status(403).json({ error: 'approve_forbidden' });
    if (!canScoreWork(req.user)) return res.status(403).json({ error: 'score_forbidden' });
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
      progress: 100,
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
    progress: Math.min(task.progress ?? 90, 90),
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
  const task = await loadLive(req, res);
  if (!task) return;
  if (!canReopen(req.user, task)) return res.status(403).json({ error: 'forbidden' });

  const department = task.department ?? DEFAULT_DEPARTMENT;
  const updated = await store.update('tasks', task.id, {
    stage: stageForState(department, 'working', task.stage),
    reviewDecision: null,
    completedAt: null,
    progress: Math.min(task.progress ?? 90, 90),
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
  if (isArchived(task)) return res.status(409).json({ error: 'task_archived' });

  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'empty_comment' });

  if (body.length > 5000) return res.status(400).json({ error: 'comment_too_long' });

  const comment = await create('comments', {
    organizationId: organizationOf(task),
    taskId: task.id,
    userId: req.user.id,
    body,
  });

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

/**
 * The same lookup for the routes that change something.
 *
 * Archiving takes a task out of play — nobody starts, submits, reviews or
 * comments on work that is no longer on a board — so every write stops here.
 * Restoring is the one exception, which is why it loads the task itself.
 */
async function loadLive(req, res) {
  const task = await loadVisible(req, res);
  if (!task) return null;
  if (isArchived(task)) {
    res.status(409).json({ error: 'task_archived' });
    return null;
  }
  return task;
}

/**
 * The fields that make up the brief and the plan, as opposed to the work.
 *
 * A task is a contract: one side states what is wanted, for whom, and by when;
 * the other side does it and reports on it. Everything in this list belongs to
 * the first side, so an assignee editing their own task can move `progress`,
 * `notes` and `labels` but cannot rewrite what they were asked to deliver, hand
 * it to a colleague, or move their own deadline.
 */
const PLAN_FIELDS = {
  title: (task) => task.title,
  description: (task) => task.description ?? '',
  objective: (task) => task.objective ?? '',
  definitionOfDone: (task) => task.definitionOfDone ?? '',
  assigneeId: (task) => task.assigneeId ?? null,
  department: (task) => task.department ?? DEFAULT_DEPARTMENT,
  subteam: (task) => task.subteam ?? null,
  dueDate: (task) => task.dueDate ?? null,
  taskDate: (task) => task.taskDate ?? null,
  priority: (task) => task.priority ?? 'normal',
  effortPoints: (task) => task.effortPoints ?? null,
  estimatedMinutes: (task) => task.estimatedMinutes ?? null,
  appId: (task) => task.appId ?? null,
};

function changesPlan(patch, task) {
  return Object.entries(PLAN_FIELDS).some(
    ([field, currentValue]) => Object.hasOwn(patch, field) && patch[field] !== currentValue(task)
  );
}

/** The lifecycle fields a brand-new task starts with — nothing has happened yet. */
function blankLifecycle() {
  return {
    archivedAt: null,
    archivedBy: null,
    archiveReason: '',
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
 * Assigning work to somebody opens a question they have to answer, which is why
 * a new assignment starts `pending`. Taking a task yourself answers it in the
 * same breath — there is no second party to wait for — so it is recorded as
 * accepted rather than leaving a pending response you would then grant
 * yourself.
 */
function assignmentLifecycle(assigneeId, actorId) {
  const assigned = Boolean(assigneeId);
  const selfAssigned = assigned && assigneeId === actorId;
  const stamp = new Date().toISOString();
  return {
    assignmentStatus: assigned ? (selfAssigned ? 'accepted' : 'pending') : 'unassigned',
    assignedAt: assigned ? stamp : null,
    assignedBy: assigned ? actorId : null,
    acceptedAt: selfAssigned ? stamp : null,
    declinedAt: null,
    assignmentNote: '',
    proposedDueDate: null,
  };
}

async function recordAssignment(task, actor, action, meta = {}) {
  return create('taskAssignments', {
    organizationId: organizationOf(task),
    taskId: task.id,
    actorId: actor.id,
    action,
    assigneeId: task.assigneeId ?? null,
    status: task.assignmentStatus,
    meta,
  });
}

function assignmentNotificationTitle(action) {
  const titles = {
    accept: { ar: 'تم قبول المهمة', en: 'Task assignment accepted' },
    decline: { ar: 'تم رفض المهمة', en: 'Task assignment declined' },
    request_clarification: {
      ar: 'يوجد طلب توضيح على مهمة',
      en: 'Task clarification requested',
    },
    propose_due_date: { ar: 'تم اقتراح موعد تسليم', en: 'New due date proposed' },
    request_reassignment: { ar: 'يوجد طلب إعادة إسناد', en: 'Reassignment requested' },
  };
  return titles[action];
}

/**
 * Who should hear that work is waiting. Whoever filed the task, plus every
 * manager who can act on that department — so a submission never sits unseen
 * because one person is away.
 */
async function reviewAudience(task, actorId) {
  const people = await find('users', isActiveUser);
  const audience = new Set();
  for (const person of people) {
    if (organizationOf(person) !== organizationOf(task)) continue;
    if (!isReviewer(person)) continue;
    if (canViewTask(person, task)) audience.add(person.id);
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
  const target = await findOne('users', (user) => user.id === userId);
  if (!target || !isActiveUser(target)) return;
  const notification = await create('notifications', {
    organizationId: organizationOf(target),
    userId,
    actorId,
    type,
    title,
    body,
    link,
    read: false,
  });
  publishNotification(userId, notification.id);
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
  if (body?.objective !== undefined) {
    value.objective = String(body.objective || '').trim().slice(0, 3000);
  }
  if (body?.definitionOfDone !== undefined) {
    value.definitionOfDone = String(body.definitionOfDone || '').trim().slice(0, 3000);
  }
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

  if (body?.effortPoints !== undefined) {
    if (body.effortPoints === null || body.effortPoints === '') {
      value.effortPoints = null;
    } else {
      const points = Number(body.effortPoints);
      if (!EFFORT_POINTS.includes(points)) return { error: 'invalid_effort_points' };
      value.effortPoints = points;
    }
  }

  if (body?.estimatedMinutes !== undefined) {
    if (body.estimatedMinutes === null || body.estimatedMinutes === '') {
      value.estimatedMinutes = null;
    } else {
      const minutes = Number(body.estimatedMinutes);
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > 100_000) {
        return { error: 'invalid_estimate' };
      }
      value.estimatedMinutes = minutes;
    }
  }

  if (body?.progress !== undefined) {
    const progress = Number(body.progress);
    if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
      return { error: 'invalid_progress' };
    }
    value.progress = Math.round(progress);
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

function taskReference() {
  const time = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `TSK-${time}-${random}`;
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
  const scoreWeight = (task) => task.effortPoints ?? 1;
  const totalScoreWeight = scored.reduce((sum, task) => sum + scoreWeight(task), 0);
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
      ? Math.round(
          (
            scored.reduce((sum, task) => sum + task.score * scoreWeight(task), 0) /
            totalScoreWeight
          ) * 10
        ) / 10
      : null,
    scoredTasks: scored.length,
    effortPoints: tasks.reduce((sum, task) => sum + (task.effortPoints ?? 0), 0),
    estimatedMinutes: tasks.reduce((sum, task) => sum + (task.estimatedMinutes ?? 0), 0),
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
