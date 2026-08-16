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
  isSettledStage,
  stageLabel,
  subteamLabel,
  translateStage,
} from '../../shared/departments.js';
import {
  ASSIGNMENT_ACTIONS,
  TASK_STATES,
  hasSignoffStage,
  canApproveWork,
  canPublish,
  canResetToPending,
  canReopen,
  assigneesOf,
  assignmentFor,
  assignmentRows,
  canRespondToAssignment,
  canReview,
  canScoreWork,
  canStart,
  canSubmit,
  isAssignee,
  isDoer,
  isReviewer,
  scoreBand,
  stageForApproval,
  stageForReturn,
  stageForState,
  stageWriteVerdict,
  taskState,
} from '../../shared/workflow.js';
import { workStartedAt } from '../../shared/taskTiming.js';
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
/**
 * A ceiling rather than a rule anybody hits. Work shared by more than a handful
 * of people is a project, not a task, and the board has no way to draw a card
 * that names a dozen owners.
 */
export const MAX_ASSIGNEES = 8;
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
    return res.json({
      mine: 0,
      overdue: 0,
      dueToday: 0,
      unanswered: 0,
      awaitingMyReview: 0,
      rework: 0,
      reworkTasks: [],
    });
  }

  const visible = await find('tasks', livePredicate(req.user));
  const today = new Date().toISOString().slice(0, 10);
  const isOpen = (task) => {
    const state = taskState(task);
    return state !== 'signed_off' && state !== 'approved';
  };

  const mine = visible.filter((task) => isAssignee(req.user, task) && isOpen(task));
  const reworkTasks = mine
    .filter((task) => task.stage === 'rework' && (task.reworkCount ?? 0) > 0)
    .filter(
      (task) =>
        Number(task.reworkAcknowledgedBy?.[req.user.id] ?? 0) < Number(task.reworkCount ?? 0)
    )
    .sort((a, b) => (a.reviewedAt ?? '').localeCompare(b.reviewedAt ?? ''))
    .map((task) => ({
      id: task.id,
      title: task.title,
      reworkCount: task.reworkCount ?? 0,
      scorePenaltyPercent: reworkPenaltyPercent(task.reworkCount ?? 0),
    }));

  // What a reviewer needs to act on — theirs to clear, not theirs to do.
  const awaitingMyReview = isReviewer(req.user)
    ? visible.filter((task) => taskState(task) === 'submitted' && !isAssignee(req.user, task))
        .length
    : 0;

  res.json({
    mine: mine.length,
    overdue: mine.filter((task) => task.dueDate && task.dueDate < today).length,
    dueToday: mine.filter((task) => task.dueDate === today).length,
    // Assigned to them and never accepted or declined — the quietest way for
    // work to stall, so it gets its own number.
    // Their own answer, not the task's: on shared work one partner accepting
    // must not clear the prompt sitting in front of the other.
    unanswered: mine.filter((task) => assignmentFor(task, req.user.id)?.status === 'pending')
      .length,
    awaitingMyReview,
    rework: reworkTasks.length,
    reworkTasks,
  });
});

/**
 * Opening the mandatory Rework queue acknowledges the current return cycle for
 * every task shown in it. A later return increments `reworkCount`, so it will
 * freeze the workspace again even though the employee already opened an older
 * cycle of the same task.
 */
router.post('/rework/acknowledge', async (req, res) => {
  const store = await getStore();
  const tasks = await find(
    'tasks',
    (task) =>
      livePredicate(req.user)(task) &&
      isAssignee(req.user, task) &&
      task.stage === 'rework' &&
      (task.reworkCount ?? 0) > 0
  );

  for (const task of tasks) {
    await store.update('tasks', task.id, {
      reworkAcknowledgedBy: {
        ...(task.reworkAcknowledgedBy ?? {}),
        [req.user.id]: task.reworkCount ?? 0,
      },
    });
  }

  res.json({ ok: true, acknowledged: tasks.length });
});

router.get('/overview', async (req, res) => {
  if (!can(req.user, PERMISSIONS.TASKS_VIEW)) {
    return res.status(403).json({ error: 'forbidden', missing: PERMISSIONS.TASKS_VIEW });
  }

  const managesTeam = canManagePerformance(req.user);
  let tasks = await find('tasks', livePredicate(req.user));
  let people = visiblePeople(req.user, await find('users', isActiveUser));
  const period = parseOverviewPeriod(req.query);
  if (period === false) return res.status(400).json({ error: 'invalid_date_range' });

  // Performance is more private than the team task table: employees get only
  // their own figures even when the team's work is visible for collaboration.
  if (!managesTeam) {
    tasks = tasks.filter((task) => isAssignee(req.user, task));
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

  if (period) {
    tasks = tasks.filter((task) => {
      const date = task.taskDate ?? task.createdAt?.slice(0, 10);
      return date && date >= period.from && date <= period.to;
    });
  }

  const organization = await findOne(
    'organizations',
    (item) => item.id === organizationOf(req.user)
  );
  const workingDates = period
    ? datesInPeriod(period.from, period.to, organization?.workingDays ?? [0, 1, 2, 3, 4])
    : [];

  const rows = people.map((person) => performanceFor(person, tasks, workingDates));
  res.json({
    scope: managesTeam ? 'team' : 'self',
    period: period
      ? { ...period, workingDays: workingDates.length }
      : { from: null, to: null, workingDays: 0 },
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
      assigneesOf(task)
        .map((id) => names.get(id))
        .filter(Boolean)
        .join('، '),
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
  for (const id of parsed.value.assigneeIds ?? []) {
    if (!(await validAssignee(req.user, id, department))) {
      return res.status(400).json({ error: 'assignee_team_mismatch' });
    }
  }
  const stage = parsed.value.stage ?? firstStage(department);
  const initialState = taskState({ department, stage });
  // Review and completion are events with evidence and a verdict. Accepting a
  // stage id for either one here would let API callers create work after those
  // gates without ever performing them.
  if (initialState === 'submitted') {
    return res.status(409).json({ error: 'submit_required' });
  }
  if (initialState === 'signed_off' || initialState === 'approved') {
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
    assigneeIds: [],
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
    ...assignmentLifecycle(parsed.value.assigneeIds ?? [], req.user.id),
    completedAt: isSettledStage(department, stage) ? new Date().toISOString() : null,
    ...parsed.value,
    organizationId: organizationOf(req.user),
    department,
    stage,
    createdBy: req.user.id,
    order: Math.min(0, ...siblings.map((t) => t.order ?? 0)) - 1,
  });

  if (assigneesOf(task).length > 0) {
    await recordAssignment(task, req.user, 'assigned', {
      assigneeIds: assigneesOf(task),
      assignedBy: req.user.id,
    });
  }

  await notifyPartners(task, req.user.id, {
    type: 'task.assigned',
    title: { ar: 'مهمة جديدة مُسندة إليك', en: 'A new task is assigned to you' },
    body: task.title,
    link: `/tasks?task=${task.id}`,
  });

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
  // Scores are the outcome of a gate, never a generic editable task property —
  // keeping them out of a plain PATCH is what preserves the reviewer/timestamp
  // trail. The refusal now waits until the verdict is known, because the one
  // move that may carry a number is the override closing a task below: it is a
  // gate too, just one that had to be opened by hand.
  const requestedScore = req.body?.score;

  const parsed = await parseTaskInput(req.body, { partial: true, current: task });
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const patch = { ...parsed.value };
  if (req.body?.order !== undefined) patch.order = Number(req.body.order) || 0;

  const nextDepartment = patch.department ?? task.department;
  const nextStage = patch.stage ?? task.stage;
  if (!canUseDepartment(req.user, nextDepartment)) {
    return res.status(403).json({ error: 'forbidden_team' });
  }
  const currentAssignees = assigneesOf(task);
  const nextAssignees = patch.assigneeIds !== undefined ? patch.assigneeIds : currentAssignees;
  // Only re-check the assignment when it is actually being decided: the people
  // are changing, or the team is moving under them. A partner editing their own
  // progress is not assigning anybody, and asking them to prove they *could*
  // have assigned the people already on the card would fail every ordinary edit
  // now that assigning is a manager's authority.
  const assignmentDecided =
    nextAssignees.length !== currentAssignees.length ||
    nextAssignees.some((id) => !currentAssignees.includes(id)) ||
    nextDepartment !== (task.department ?? DEFAULT_DEPARTMENT);
  if (assignmentDecided) {
    for (const id of nextAssignees) {
      if (!(await validAssignee(req.user, id, nextDepartment))) {
        return res.status(400).json({ error: 'assignee_team_mismatch' });
      }
    }
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
  if (verdict === 'publish') return res.status(409).json({ error: 'publish_required' });
  if (verdict === 'reset') return res.status(409).json({ error: 'reset_pending_required' });
  if (verdict === 'forbidden') return res.status(403).json({ error: 'forbidden' });

  // `tasks.move_any` walking through a gate. The stage write itself is allowed
  // from here on; what it still owes is a record that matches the column it just
  // landed in, which is what `overrideStamps` supplies.
  const overridden = verdict === 'override';
  const previousState = taskState(task);
  const nextState = taskState({ ...task, department: nextDepartment, stage: nextStage });
  // Forcing a task into a done column closes it, and nothing closes a task
  // without a number on it — the override is a shortcut around the review, not
  // around the record. Every other move carries no score at all.
  const closing = overridden && nextState === 'approved';
  if (requestedScore !== undefined && !closing) {
    return previousState === 'assigned' || previousState === 'working'
      ? res.status(400).json({ error: 'score_before_review' })
      : res.status(409).json({ error: 'review_required' });
  }

  if (overridden) {
    const score = closing ? Number(requestedScore) : null;
    if (closing && (!Number.isFinite(score) || score < 0 || score > 100)) {
      return res.status(400).json({ error: 'invalid_score' });
    }
    // Scoring is its own authority, and forcing the card into Done is not a way
    // to acquire it.
    if (closing && !canScoreWork(req.user)) {
      return res.status(403).json({ error: 'score_forbidden' });
    }
    Object.assign(
      patch,
      overrideStamps(task, {
        department: nextDepartment,
        state: nextState,
        actorId: req.user.id,
        stamp: new Date().toISOString(),
        score,
      })
    );
  }

  const assignmentChanged =
    Object.hasOwn(patch, 'assigneeIds') &&
    (patch.assigneeIds.length !== currentAssignees.length ||
      patch.assigneeIds.some((id) => !currentAssignees.includes(id)));
  // A deadline that moved has to be able to go late again. The overdue notice
  // fires once per due date, so the stamp is keyed to the date it warned about
  // and clearing it here is what lets a task pushed to next week warn then.
  if (Object.hasOwn(patch, 'dueDate') && patch.dueDate !== task.dueDate) {
    patch.overdueNotifiedFor = null;
  }

  if (assignmentChanged) {
    // Partners already on the task keep the answer they gave; only the people
    // being added start out pending.
    Object.assign(
      patch,
      assignmentLifecycle(patch.assigneeIds, req.user.id, assignmentRows(task))
    );
  } else if (Object.hasOwn(patch, 'dueDate')) {
    // Granting a proposed date answers that partner's request — and only that
    // partner's, since each one proposes their own.
    const proposer = assignmentRows(task).find(
      (row) => row.status === 'due_date_proposed' && row.proposedDueDate === patch.dueDate
    );
    if (proposer) {
      patch.assignments = assignmentRows(task).map((row) =>
        row.userId === proposer.userId
          ? { ...row, status: 'accepted', acceptedAt: new Date().toISOString() }
          : row
      );
    }
  }

  // Settled rather than delivered: the work is finished the moment it is
  // approved, and publishing it later must not restamp the completion date.
  const wasDone = isSettledStage(task.department, task.stage);
  const nowDone = isSettledStage(nextDepartment, nextStage);
  if (wasDone !== nowDone) patch.completedAt = nowDone ? new Date().toISOString() : null;

  const updated = await store.update('tasks', task.id, patch);

  if (assignmentChanged) {
    await recordAssignment(
      updated,
      req.user,
      assigneesOf(updated).length ? 'assigned' : 'unassigned',
      { previousAssigneeIds: currentAssignees, assigneeIds: assigneesOf(updated) }
    );
  } else if (patch.assignments) {
    await recordAssignment(updated, req.user, 'due_date_approved', { dueDate: updated.dueDate });
  }

  if (assignmentChanged) {
    const now = assigneesOf(updated);
    // Told once each, and only about what changed for them: the people who
    // gained the task, and the people who lost it.
    for (const id of now.filter((x) => !currentAssignees.includes(x) && x !== req.user.id)) {
      await notify(id, req.user.id, {
        type: 'task.assigned',
        title: { ar: 'مهمة أُسندت إليك', en: 'A task was assigned to you' },
        body: updated.title,
        link: `/tasks?task=${updated.id}`,
      });
    }
    for (const id of currentAssignees.filter((x) => !now.includes(x) && x !== req.user.id)) {
      await notify(id, req.user.id, {
        type: 'task.unassigned',
        title: { ar: 'تم تغيير إسناد مهمة', en: 'A task assignment changed' },
        body: updated.title,
        link: '/tasks',
      });
    }
  }

  // A card that moved because somebody had the authority to move it is not an
  // edit, and the people who owe the work find out the same way they find out
  // about every other transition — from the task, not from the board changing
  // under them.
  if (overridden) {
    // A close is news of a different order from a move, so it says the number:
    // being scored 88 is the part of "your task was moved to منجزة" that the
    // person who did the work actually needs.
    const scoreSuffix = closing ? ` — ${updated.score}/100` : '';
    await notifyPartners(task, req.user.id, {
      type: 'task.stage_override',
      title: { ar: 'نُقلت مهمتك إلى مرحلة أخرى', en: 'Your task was moved to another stage' },
      body: {
        ar: `نقل ${req.user.name} «${updated.title}» إلى «${stageLabel(nextDepartment, nextStage, 'ar')}»${scoreSuffix}.`,
        en: `${req.user.name} moved “${updated.title}” to “${stageLabel(nextDepartment, nextStage, 'en')}”${scoreSuffix}.`,
      },
      link: `/tasks?task=${updated.id}`,
    });
  }

  await logActivity({
    actorId: req.user.id,
    action: overridden ? 'task.stage_override' : 'task.update',
    subject: 'task',
    subjectId: task.id,
    meta: overridden
      ? {
          title: task.title,
          fromStage: task.stage,
          toStage: nextStage,
          fromState: previousState,
          toState: nextState,
          score: closing ? updated.score : null,
        }
      : { fields: Object.keys(patch) },
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
  await notifyPartners(task, req.user.id, {
    type: 'task.archived',
    title: { ar: 'أُرشفت مهمة كانت لديك', en: 'A task of yours was archived' },
    body: task.title,
    link: '/tasks',
  });

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
  // The answer belongs to the person giving it. On shared work the others are
  // still expected to answer for themselves, so only this row moves.
  const mine = { ...(assignmentFor(task, req.user.id) ?? { userId: req.user.id }), note };
  if (action === 'accept') {
    Object.assign(mine, {
      status: 'accepted',
      acceptedAt: stamp,
      declinedAt: null,
      proposedDueDate: null,
    });
  } else if (action === 'decline') {
    Object.assign(mine, { status: 'declined', declinedAt: stamp });
  } else if (action === 'request_clarification') {
    mine.status = 'clarification_requested';
  } else if (action === 'request_reassignment') {
    mine.status = 'reassignment_requested';
  } else {
    const proposedDueDate = parseDate(req.body?.dueDate);
    if (!proposedDueDate) return res.status(400).json({ error: 'invalid_due_date' });
    Object.assign(mine, { status: 'due_date_proposed', proposedDueDate });
  }

  const patch = {
    assignments: assignmentRows(task).map((row) => (row.userId === req.user.id ? mine : row)),
  };
  const updated = await store.update('tasks', task.id, patch);
  await recordAssignment(updated, req.user, action, {
    note,
    proposedDueDate: mine.proposedDueDate ?? null,
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
    // Pressing the button is the proof a hand-in can only guess at. A stamp
    // this endpoint writes is real, so it is never marked inferred; one that is
    // already there keeps whatever it was.
    startedAtInferred: task.startedAt ? (task.startedAtInferred ?? false) : false,
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

  // Keep the count honest even if an older row drifted.
  const count = await syncAttachmentCount(task.id);
  const department = task.department ?? DEFAULT_DEPARTMENT;
  const note = String(req.body?.note || '').trim().slice(0, 2000);

  /**
   * A hand-in has to say what was done. It no longer has to be a file.
   *
   * The gate used to demand an attachment or a link, which was right for the
   * work it was written against — a designer hands in artwork — and wrong for
   * half of everything else. Calling a client, sitting in a meeting, chasing a
   * supplier: real tasks with no artifact, and the only way to close one was to
   * upload a screenshot of nothing. That is not evidence, it is a ritual, and a
   * gate people route around stops meaning anything.
   *
   * So the requirement moved from *a file* to *an account of the work*: attach
   * something, or write what you did. What it still refuses is a blank hand-in,
   * because "done" with nothing behind it is the opinion this whole lifecycle
   * was built to stop being.
   */
  if (count === 0 && !note) return res.status(400).json({ error: 'submission_empty' });

  const now = new Date().toISOString();
  const updated = await store.update('tasks', task.id, {
    stage: stageForState(department, 'submitted', task.stage),
    // A task handed in without ever being started leaves no cycle time to
    // measure, so the hand-in stands in for the moment work began — and says
    // so, because an invented start reads as a task finished in zero days and
    // drags every average that counts it.
    startedAt: task.startedAt ?? now,
    startedAtInferred: task.startedAt ? (task.startedAtInferred ?? false) : true,
    submittedAt: now,
    // The first hand-in, kept out of reach of the send-back below. Punctuality
    // is a fact about a delivery that already happened; rewriting it every time
    // the work comes back means a task that was on time can only ever be late.
    firstSubmittedAt: task.firstSubmittedAt ?? now,
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
 * The reviewer's verdict. Marketing deliberately separates it from scoring:
 * Mirna either returns the work with a reason or passes it to the final
 * approval desk. Other departments still close and score at this gate.
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
    if (!canApproveWork(req.user)) return res.status(403).json({ error: 'approve_forbidden' });
    const awaitsFinalApproval = department === 'marketing';
    let roundedScore = null;
    let effectiveScore = null;
    const scorePenaltyPercent = reworkPenaltyPercent(task.reworkCount ?? 0);

    if (!awaitsFinalApproval) {
      if (!canScoreWork(req.user)) return res.status(403).json({ error: 'score_forbidden' });
      const score = Number(req.body?.score);
      if (!Number.isFinite(score) || score < 0 || score > 100) {
        return res.status(400).json({ error: 'invalid_score' });
      }
      roundedScore = Math.round(score * 10) / 10;
      effectiveScore = applyReworkPenalty(roundedScore, task.reworkCount ?? 0);
    }

    const updated = await store.update('tasks', task.id, {
      stage: stageForApproval(department, task.stage),
      score: effectiveScore,
      scoreBeforeReworkPenalty: roundedScore,
      scorePenaltyPercent,
      scoreBy: awaitsFinalApproval ? null : req.user.id,
      scoredAt: awaitsFinalApproval ? null : stamp,
      reviewDecision: 'approved',
      reviewedAt: stamp,
      reviewedBy: req.user.id,
      reviewNote: note,
      completedAt: awaitsFinalApproval ? null : stamp,
      progress: 100,
    });

    if (awaitsFinalApproval) {
      await notifyPartners(task, req.user.id, {
        type: 'task.review_passed',
        title: { ar: 'اجتازت مهمتك المراجعة', en: 'Your task passed review' },
        body: {
          ar: `نقلت ${req.user.name} «${updated.title}» إلى قيد الموافقة النهائية.`,
          en: `${req.user.name} moved “${updated.title}” to final approval.`,
        },
        link: `/tasks?task=${updated.id}`,
      });
      for (const userId of await finalApprovalAudience(updated, req.user.id)) {
        await notify(userId, req.user.id, {
          type: 'task.awaiting_final_approval',
          title: { ar: 'مهمة بانتظار الموافقة النهائية', en: 'Task awaiting final approval' },
          body: {
            ar: `تم اعتماد «${updated.title}» بواسطة ${req.user.name} وهي جاهزة للنقل إلى منجزة.`,
            en: `“${updated.title}” was approved by ${req.user.name} and is ready to be marked done.`,
          },
          link: `/tasks?task=${updated.id}`,
        });
      }
    } else {
      await notifyPartners(task, req.user.id, {
        type: 'task.approved',
        title: { ar: 'تم اعتماد مهمتك', en: 'Your task was approved' },
        body: scorePenaltyPercent
          ? {
              ar: `${updated.title} — ${updated.score}/100 بعد خصم ${scorePenaltyPercent}% لإعادة العمل.`,
              en: `${updated.title} — ${updated.score}/100 after a ${scorePenaltyPercent}% rework deduction.`,
            }
          : `${updated.title} — ${updated.score}/100`,
        link: `/tasks?task=${updated.id}`,
      });
    }
    await logActivity({
      actorId: req.user.id,
      action: awaitsFinalApproval ? 'task.review_pass' : 'task.approve',
      subject: 'task',
      subjectId: task.id,
      meta: {
        title: task.title,
        score: updated.score,
        scoreBeforeReworkPenalty: roundedScore,
        scorePenaltyPercent,
      },
    });
    return res.json({ task: taskForUser(req.user, updated) });
  }

  if (decision !== 'changes_requested') return res.status(400).json({ error: 'invalid_decision' });
  if (!note) return res.status(400).json({ error: 'review_note_required' });

  const reworkCount = (task.reworkCount ?? 0) + 1;
  const scorePenaltyPercent = reworkPenaltyPercent(reworkCount);
  const updated = await store.update('tasks', task.id, {
    stage: stageForReturn(department, task.stage),
    reviewDecision: 'changes_requested',
    reviewedAt: stamp,
    reviewedBy: req.user.id,
    reviewNote: note,
    reworkCount,
    scorePenaltyPercent,
    submittedAt: null,
    completedAt: null,
    progress: Math.min(task.progress ?? 90, 90),
  });

  await notifyPartners(task, req.user.id, {
    type: 'task.returned',
    title: { ar: 'مهمة رجعت إليك للتعديل', en: 'A task was sent back to you' },
    body: {
      ar: `${updated.title} — ${note.slice(0, 80)}. خصم التقييم التراكمي الآن ${scorePenaltyPercent}%.`,
      en: `${updated.title} — ${note.slice(0, 80)}. The cumulative score deduction is now ${scorePenaltyPercent}%.`,
    },
    link: `/tasks?task=${updated.id}`,
  });
  await logActivity({
    actorId: req.user.id,
    action: 'task.return',
    subject: 'task',
    subjectId: task.id,
    meta: { title: task.title, reworkCount, scorePenaltyPercent },
  });
  res.json({ task: taskForUser(req.user, updated) });
});

/**
 * The move out of "قيد الموافقة": the final approver marks the work Done.
 *
 * Mirna has already passed the deliverable itself. The final approver now owns
 * the score and the move to Done; this is where completion is stamped.
 */
router.post('/:id/publish', async (req, res) => {
  const store = await getStore();
  const task = await loadLive(req, res);
  if (!task) return;
  if (!canPublish(req.user, task)) return res.status(403).json({ error: 'forbidden' });
  if (!canScoreWork(req.user)) return res.status(403).json({ error: 'score_forbidden' });

  const score = Number(req.body?.score);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    return res.status(400).json({ error: 'invalid_score' });
  }

  const department = task.department ?? DEFAULT_DEPARTMENT;
  const stamp = new Date().toISOString();
  const roundedScore = Math.round(score * 10) / 10;
  const scorePenaltyPercent = reworkPenaltyPercent(task.reworkCount ?? 0);
  const effectiveScore = applyReworkPenalty(roundedScore, task.reworkCount ?? 0);
  const updated = await store.update('tasks', task.id, {
    stage: stageForState(department, 'approved', task.stage),
    publishedAt: stamp,
    publishedBy: req.user.id,
    score: effectiveScore,
    scoreBeforeReworkPenalty: roundedScore,
    scorePenaltyPercent,
    scoreBy: req.user.id,
    scoredAt: stamp,
    completedAt: stamp,
  });

  await notifyPartners(task, req.user.id, {
    type: 'task.approved',
    title: { ar: 'تمت الموافقة النهائية على مهمتك', en: 'Your task received final approval' },
    body: scorePenaltyPercent
      ? {
          ar: `${updated.title} — ${updated.score}/100 بعد خصم ${scorePenaltyPercent}% لإعادة العمل.`,
          en: `${updated.title} — ${updated.score}/100 after a ${scorePenaltyPercent}% rework deduction.`,
        }
      : `${updated.title} — ${updated.score}/100`,
    link: `/tasks?task=${updated.id}`,
  });

  // The reviewer who approved it is the one waiting to hear it went out.
  if (task.reviewedBy && task.reviewedBy !== req.user.id) {
    await notify(task.reviewedBy, req.user.id, {
      type: 'task.published',
      title: { ar: 'تمت الموافقة النهائية على المهمة', en: 'Task received final approval' },
      body: updated.title,
      link: `/tasks?task=${updated.id}`,
    });
  }
  await logActivity({
    actorId: req.user.id,
    action: 'task.publish',
    subject: 'task',
    subjectId: task.id,
    meta: {
      title: task.title,
      score: effectiveScore,
      scoreBeforeReworkPenalty: roundedScore,
      scorePenaltyPercent,
    },
  });
  res.json({ task: taskForUser(req.user, updated) });
});

/**
 * A user carrying the reset permission may return any Marketing task to the
 * start of the board.
 *
 * This is not a plain stage edit. A task cannot honestly be Pending while it
 * still carries a current hand-in, approval, completion or score, so all of
 * those stamps are cleared together. Rework history and deliverables stay: the
 * former is an employee-performance fact, and the latter may still be useful
 * when the work starts again.
 */
router.post('/:id/reset-to-pending', async (req, res) => {
  const store = await getStore();
  const task = await loadLive(req, res);
  if (!task) return;
  if (!canResetToPending(req.user, task)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const department = task.department ?? DEFAULT_DEPARTMENT;
  const requestedOrder = Number(req.body?.order);
  const patch = {
    stage: stageForState(department, 'assigned', firstStage(department)),
    progress: 0,
    startedAt: null,
    startedAtInferred: false,
    submittedAt: null,
    // `firstSubmittedAt` deliberately survives, next to the rework count and for
    // the same reason: the work was handed in once, on a date, and a restart
    // does not unmake that. Nothing reads it as a current hand-in — the board
    // only shows a delivery reading once the task is past the review gate.
    submittedBy: null,
    submissionNote: '',
    reviewedAt: null,
    reviewedBy: null,
    reviewNote: '',
    reviewDecision: null,
    publishedAt: null,
    publishedBy: null,
    completedAt: null,
    score: null,
    scoreBeforeReworkPenalty: null,
    scorePenaltyPercent: reworkPenaltyPercent(task.reworkCount ?? 0),
    scoreBy: null,
    scoredAt: null,
    overdueNotifiedFor: null,
  };
  if (Number.isFinite(requestedOrder)) patch.order = requestedOrder;

  const updated = await store.update('tasks', task.id, patch);

  await notifyPartners(task, req.user.id, {
    type: 'task.reset_pending',
    title: { ar: 'أُعيدت المهمة إلى Pending', en: 'Task returned to Pending' },
    body: {
      ar: `أعاد ${req.user.name} «${updated.title}» إلى Pending لبدء دورة العمل من جديد.`,
      en: `${req.user.name} returned “${updated.title}” to Pending to restart its workflow.`,
    },
    link: `/tasks?task=${updated.id}`,
  });
  await logActivity({
    actorId: req.user.id,
    action: 'task.reset_pending',
    subject: 'task',
    subjectId: task.id,
    meta: {
      title: task.title,
      fromStage: task.stage,
      reworkCount: task.reworkCount ?? 0,
    },
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
  const reworkCount = (task.reworkCount ?? 0) + 1;
  const scorePenaltyPercent = reworkPenaltyPercent(reworkCount);
  const updated = await store.update('tasks', task.id, {
    // Work coming back from an approval is rework, and a board that named that
    // column should get it — landing in "قيد العمل" made a manager's correction
    // indistinguishable from work somebody simply picked up.
    stage: stageForReturn(department, task.stage),
    reviewDecision: null,
    completedAt: null,
    // The publication is undone with the approval it belonged to; leaving the
    // stamp behind would claim a post is live that is back on somebody's desk.
    publishedAt: null,
    publishedBy: null,
    reworkCount,
    score: null,
    scoreBeforeReworkPenalty: null,
    scorePenaltyPercent,
    scoreBy: null,
    scoredAt: null,
    progress: Math.min(task.progress ?? 90, 90),
  });

  await notifyPartners(task, req.user.id, {
    type: 'task.returned',
    title: { ar: 'أُعيد فتح مهمة', en: 'A task was reopened' },
    body: {
      ar: `${updated.title} — خصم التقييم التراكمي الآن ${scorePenaltyPercent}%.`,
      en: `${updated.title} — the cumulative score deduction is now ${scorePenaltyPercent}%.`,
    },
    link: `/tasks?task=${updated.id}`,
  });
  await logActivity({
    actorId: req.user.id,
    action: 'task.reopen',
    subject: 'task',
    subjectId: task.id,
    meta: { title: task.title, reworkCount, scorePenaltyPercent },
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
  const audience = new Set([...assigneesOf(task), task.createdBy].filter(Boolean));
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
  assigneeIds: (task) => assigneesOf(task),
  department: (task) => task.department ?? DEFAULT_DEPARTMENT,
  subteam: (task) => task.subteam ?? null,
  dueDate: (task) => task.dueDate ?? null,
  taskDate: (task) => task.taskDate ?? null,
  priority: (task) => task.priority ?? 'normal',
  effortPoints: (task) => task.effortPoints ?? null,
  estimatedMinutes: (task) => task.estimatedMinutes ?? null,
  appId: (task) => task.appId ?? null,
};

/**
 * Plan fields are compared as strings because one of them is now a list. A raw
 * `!==` on an array compares identities, so echoing the same partners back —
 * which the dialog does on every ordinary save — read as a change of plan and
 * refused the edit.
 */
const planValue = (value) => (Array.isArray(value) ? [...value].sort().join(',') : value);

function changesPlan(patch, task) {
  return Object.entries(PLAN_FIELDS).some(
    ([field, currentValue]) =>
      Object.hasOwn(patch, field) && planValue(patch[field]) !== planValue(currentValue(task))
  );
}

/** The lifecycle fields a brand-new task starts with — nothing has happened yet. */
function blankLifecycle() {
  return {
    archivedAt: null,
    archivedBy: null,
    archiveReason: '',
    startedAt: null,
    startedAtInferred: false,
    submittedAt: null,
    firstSubmittedAt: null,
    submittedBy: null,
    submissionNote: '',
    reviewedAt: null,
    reviewedBy: null,
    reviewNote: '',
    reviewDecision: null,
    publishedAt: null,
    publishedBy: null,
    reworkCount: 0,
    reworkAcknowledgedBy: {},
    attachmentCount: 0,
    score: null,
    scoreBeforeReworkPenalty: null,
    scorePenaltyPercent: 0,
    scoreBy: null,
    scoredAt: null,
  };
}

/**
 * The bookkeeping a forced move has to do.
 *
 * `tasks.move_any` drops a card in a column its history does not support, and
 * the record has to agree with the column it is now in: a task sitting in
 * Pending cannot still carry a score, and one pushed straight to Done cannot go
 * on claiming it was never handed in. Every ordinary transition writes these
 * stamps through the action that owns it — start, submit, review, publish — so
 * this is that same bookkeeping with nobody to produce the evidence.
 *
 * Which is exactly why it is careful about what it invents. A start it had to
 * make up is marked `startedAtInferred`, so the cycle-time reading stays absent
 * instead of averaging in as zero; an approval it had to make up is attributed
 * to the person who forced the move.
 *
 * The score is the one thing it will not invent. A move into a done column has
 * to be handed one — that move closes the task, and nothing closes a task
 * without a number on it — and it is recorded the way the review and publish
 * gates record theirs: rounded, penalised for rework, stamped with who typed
 * it. Every move that is *not* a close clears the score instead, because a task
 * that is no longer finished is no longer scored.
 *
 * `firstSubmittedAt`, `reworkCount` and the deliverables all survive, for the
 * reason `reset-to-pending` keeps them: they are facts about what happened, and
 * moving the card does not unmake them.
 */
function overrideStamps(
  task,
  { department: toDepartment, state: toState, actorId, stamp, score = null }
) {
  const backwards = TASK_STATES.indexOf(toState) < TASK_STATES.indexOf(taskState(task));

  // Work that must have begun, without pretending to know when: an invented
  // start says so, and one the doer actually pressed keeps whatever it was.
  const started = {
    startedAt: task.startedAt ?? stamp,
    startedAtInferred: task.startedAt ? (task.startedAtInferred ?? false) : true,
  };
  // Same for a hand-in the board now implies happened.
  const delivered = {
    submittedAt: task.submittedAt ?? stamp,
    firstSubmittedAt: task.firstSubmittedAt ?? task.submittedAt ?? stamp,
  };
  const noScore = {
    score: null,
    scoreBeforeReworkPenalty: null,
    scorePenaltyPercent: reworkPenaltyPercent(task.reworkCount ?? 0),
    scoreBy: null,
    scoredAt: null,
  };
  const unpublished = { publishedAt: null, publishedBy: null };
  // The number the mover typed, put through the same arithmetic every other
  // gate uses: rounded to one decimal, then cut by the rework the task already
  // cost. Closing by force must not be worth more than closing by review.
  const rounded = Math.round((score ?? 0) * 10) / 10;
  const scored = {
    score: applyReworkPenalty(rounded, task.reworkCount ?? 0),
    scoreBeforeReworkPenalty: rounded,
    scorePenaltyPercent: reworkPenaltyPercent(task.reworkCount ?? 0),
    scoreBy: actorId,
    scoredAt: stamp,
  };

  switch (toState) {
    case 'assigned':
      return {
        progress: 0,
        startedAt: null,
        startedAtInferred: false,
        submittedAt: null,
        submittedBy: null,
        submissionNote: '',
        reviewedAt: null,
        reviewedBy: null,
        reviewNote: '',
        reviewDecision: null,
        completedAt: null,
        // The deadline may pass again on the second run at it.
        overdueNotifiedFor: null,
        ...unpublished,
        ...noScore,
      };
    case 'working':
      return {
        ...started,
        // The hand-in on the table is withdrawn; the manager's note stays,
        // because it is the feedback the work is going back with.
        submittedAt: null,
        reviewDecision: null,
        completedAt: null,
        ...unpublished,
        ...noScore,
        progress: backwards ? Math.min(task.progress ?? 90, 90) : Math.max(task.progress ?? 0, 1),
      };
    case 'submitted':
      return {
        ...started,
        ...delivered,
        // Back on a reviewer's desk, so the last verdict stops applying.
        reviewDecision: null,
        completedAt: null,
        ...unpublished,
        ...noScore,
        progress: 100,
      };
    case 'signed_off':
      return {
        ...started,
        ...delivered,
        reviewedAt: task.reviewedAt ?? stamp,
        reviewedBy: task.reviewedBy ?? actorId,
        reviewDecision: 'approved',
        completedAt: null,
        // Sign-off is "approved, not yet out" — the publication and the score
        // both belong to the publish gate on the far side of it.
        ...unpublished,
        ...noScore,
        progress: 100,
      };
    case 'approved':
      return {
        ...started,
        ...delivered,
        reviewedAt: task.reviewedAt ?? stamp,
        reviewedBy: task.reviewedBy ?? actorId,
        reviewDecision: 'approved',
        // Only a board with a sign-off column models publication at all, and it
        // is the board the card is landing on that decides.
        ...(hasSignoffStage(toDepartment)
          ? {
              publishedAt: task.publishedAt ?? stamp,
              publishedBy: task.publishedBy ?? actorId,
            }
          : {}),
        // `completedAt` is left to the caller's settled-stage check, which is
        // the one place that decides when a task stopped being open.
        ...scored,
        progress: 100,
      };
    default:
      return {};
  }
}

/**
 * Assigning work to somebody opens a question they have to answer, which is why
 * a new assignment starts `pending`. Taking a task yourself answers it in the
 * same breath — there is no second party to wait for — so it is recorded as
 * accepted rather than leaving a pending response you would then grant
 * yourself.
 */
function assignmentLifecycle(assigneeIds, actorId, previous = []) {
  const owners = [...new Set(assigneeIds ?? [])];
  const stamp = new Date().toISOString();
  const keep = new Map(previous.map((row) => [row.userId, row]));

  return {
    assigneeIds: owners,
    // A partner who was already on the task keeps the answer they gave. Adding
    // a second person to a task the first already accepted must not silently
    // put the first back to pending.
    assignments: owners.map(
      (userId) =>
        keep.get(userId) ?? {
          userId,
          // Assigning yourself is the request and the answer in the same
          // breath — there is no second party to wait for.
          status: userId === actorId ? 'accepted' : 'pending',
          note: '',
          acceptedAt: userId === actorId ? stamp : null,
          declinedAt: null,
          proposedDueDate: null,
        }
    ),
    assignedAt: owners.length ? stamp : null,
    assignedBy: owners.length ? actorId : null,
  };
}

async function recordAssignment(task, actor, action, meta = {}) {
  return create('taskAssignments', {
    organizationId: organizationOf(task),
    taskId: task.id,
    actorId: actor.id,
    action,
    assigneeIds: assigneesOf(task),
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
 * Who should hear that work is waiting. The audience follows the review
 * permission, so changing the checkbox in Users changes both the available
 * action and its notifications.
 */
async function reviewAudience(task, actorId) {
  const people = await find('users', isActiveUser);
  if ((task.department ?? DEFAULT_DEPARTMENT) === 'marketing') {
    const appointed = people.filter(
      (person) =>
        person.role !== 'admin' &&
        organizationOf(person) === organizationOf(task) &&
        isReviewer(person) &&
        canViewTask(person, task) &&
        person.id !== actorId
    );
    if (appointed.length > 0) return appointed.map((person) => person.id);
  }

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

/** Everybody appointed to Marketing's second gate through permissions. */
async function finalApprovalAudience(task, actorId) {
  const people = await find('users', isActiveUser);
  const eligible = people.filter(
    (person) =>
      organizationOf(person) === organizationOf(task) &&
      canPublish(person, task) &&
      canViewTask(person, task) &&
      person.id !== actorId
  );
  const appointed = eligible.filter((person) => person.role !== 'admin');
  return (appointed.length > 0 ? appointed : eligible).map((person) => person.id);
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

/**
 * Tell everybody who owes this work, except whoever caused it.
 *
 * Shared tasks made this worth naming: five copies of "if there is an assignee
 * and it is not me" were five chances to forget the second partner exists.
 */
async function notifyPartners(task, actorId, payload) {
  for (const userId of assigneesOf(task)) {
    if (userId !== actorId) await notify(userId, actorId, payload);
  }
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

  /**
   * A task may be shared by several people, and `assigneeIds` is how that is
   * said. `assigneeId` is still accepted because the assistant, the seed and
   * anything integrating against the old shape all speak it — it is read as a
   * list of one rather than kept as a second, disagreeing field.
   */
  const rawAssignees =
    body?.assigneeIds !== undefined
      ? body.assigneeIds
      : body?.assigneeId !== undefined
        ? body.assigneeId === null || body.assigneeId === ''
          ? []
          : [body.assigneeId]
        : undefined;

  if (rawAssignees !== undefined) {
    if (!Array.isArray(rawAssignees)) return { error: 'invalid_assignees' };
    const ids = [...new Set(rawAssignees.map(String).filter(Boolean))];
    if (ids.length > MAX_ASSIGNEES) return { error: 'too_many_assignees' };
    for (const id of ids) {
      if (!(await findOne('users', (u) => u.id === id))) return { error: 'unknown_assignee' };
    }
    value.assigneeIds = ids;
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

function performanceFor(person, tasks, workingDates = []) {
  // A shared task appears in each partner's record carrying the same score —
  // equal owners, equal credit, which is what "shared" was asked to mean.
  const assigned = tasks.filter((task) => assigneesOf(task).includes(person.id));
  const taskDates = new Set(
    assigned.map((task) => task.taskDate ?? task.createdAt?.slice(0, 10)).filter(Boolean)
  );
  const idleDates = workingDates.filter((date) => !taskDates.has(date));
  return {
    user: {
      id: person.id,
      name: person.name,
      avatarColor: person.avatarColor,
      department: person.department ?? DEFAULT_DEPARTMENT,
      subteam: person.subteam ?? null,
      jobRole: person.jobRole ?? null,
    },
    daysWithoutTasks: idleDates.length,
    idleDates,
    ...performanceSummary(assigned),
  };
}

function performanceSummary(tasks) {
  const completed = tasks.filter((task) =>
    isSettledStage(task.department ?? DEFAULT_DEPARTMENT, task.stage)
  );
  const today = new Date().toISOString().slice(0, 10);
  const overdue = tasks.filter(
    (task) =>
      task.dueDate &&
      task.dueDate < today &&
      taskState(task) !== 'signed_off' &&
      !isSettledStage(task.department ?? DEFAULT_DEPARTMENT, task.stage)
  );
  const scored = tasks.filter((task) => Number.isFinite(task.score));
  const scoreWeight = (task) => task.effortPoints ?? 1;
  const totalScoreWeight = scored.reduce((sum, task) => sum + scoreWeight(task), 0);
  const withDeadline = completed.filter(
    (task) => task.dueDate && (task.submittedAt || task.completedAt)
  );
  // Final approval can wait on another person's desk; the employee's punctuality
  // is measured at their hand-in, not when the approver eventually scores it.
  const onTime = withDeadline.filter(
    (task) => (task.submittedAt ?? task.completedAt).slice(0, 10) <= task.dueDate
  );
  const awaitingReview = tasks.filter((task) => taskState(task) === 'submitted');
  // Approved without ever being sent back. A low rate usually means the brief
  // was unclear, not that the person is weak — which is why it is its own number.
  const firstPass = completed.filter((task) => (task.reworkCount ?? 0) === 0);

  /**
   * How long finishing actually takes, start to close, in days.
   *
   * Measured from `startedAt` rather than when the task was filed, because the
   * gap between "a manager wrote it down" and "somebody picked it up" is queue
   * time — a planning number, not a speed one — and mixing the two makes a fast
   * worker on a slow board look slow. Only tasks carrying both stamps count.
   *
   * The median is reported next to the mean on purpose: one task that sat open
   * over a holiday drags an average badly, and on a handful of tasks the
   * average is mostly that outlier. Where they disagree, the median is the
   * honest one.
   *
   * Tasks whose start was invented by their hand-in are left out entirely. They
   * carry a `startedAt` equal to the submission, which is not a task that took
   * no time — it is a task nobody timed, and counting it as zero pulls the
   * average toward a speed the team never achieved.
   */
  const durations = completed
    .filter((task) => workStartedAt(task) && task.completedAt)
    .map((task) => (Date.parse(task.completedAt) - Date.parse(workStartedAt(task))) / 86_400_000)
    .filter((days) => Number.isFinite(days) && days >= 0)
    .sort((a, b) => a - b);

  const round1 = (value) => Math.round(value * 10) / 10;
  const middle = durations.length ? durations[Math.floor(durations.length / 2)] : null;

  return {
    total: tasks.length,
    completed: completed.length,
    active: tasks.length - completed.length,
    overdue: overdue.length,
    awaitingReview: awaitingReview.length,
    returned: tasks.filter((task) => (task.reworkCount ?? 0) > 0).length,
    rework: tasks.filter((task) => task.stage === 'rework').length,
    reworkCycles: tasks.reduce((sum, task) => sum + (task.reworkCount ?? 0), 0),
    /** Null rather than 0 when nothing has been timed — an absent measurement. */
    averageDays: durations.length
      ? round1(durations.reduce((sum, days) => sum + days, 0) / durations.length)
      : null,
    medianDays: middle === null ? null : round1(middle),
    fastestDays: durations.length ? round1(durations[0]) : null,
    slowestDays: durations.length ? round1(durations[durations.length - 1]) : null,
    timedTasks: durations.length,
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

function parseOverviewPeriod(query) {
  const hasPeriod = query?.from !== undefined || query?.to !== undefined;
  if (!hasPeriod) return null;
  const today = new Date().toISOString().slice(0, 10);
  const from = parseDate(query.from || `${today.slice(0, 7)}-01`);
  const to = parseDate(query.to || today);
  if (!from || !to || from === false || to === false || from > to) return false;
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (span > 366) return false;
  return { from, to };
}

function datesInPeriod(from, to, workingDays) {
  const dates = [];
  const end = Math.min(Date.parse(`${to}T00:00:00Z`), Date.now());
  for (
    let stamp = Date.parse(`${from}T00:00:00Z`);
    stamp <= end;
    stamp += 86_400_000
  ) {
    const date = new Date(stamp);
    if (workingDays.includes(date.getUTCDay())) dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

/** Ten percent of the submitted score per return, capped before it can go negative. */
function reworkPenaltyPercent(reworkCount) {
  return Math.min(100, Math.max(0, Number(reworkCount) || 0) * 10);
}

function applyReworkPenalty(score, reworkCount) {
  const multiplier = Math.max(0, 1 - reworkPenaltyPercent(reworkCount) / 100);
  return Math.round(score * multiplier * 10) / 10;
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
