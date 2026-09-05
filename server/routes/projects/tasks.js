/**
 * Qodo Projects — project task routes.
 *
 * Mounted under `/api/projects/:projectId/tasks`.
 *
 * What is deliberately **not** here: submit, review, request changes, approve
 * and score. Those live on `/api/tasks/:id/...` behind `shared/workflow.js`,
 * and they stay there. A project edit form must not become a second door to
 * marking somebody else's work approved — the whole point of inheriting the
 * contract (ADR-3) is that there is one guard, not two.
 */

import { Router } from 'express';
import * as tasks from '../../projects/taskService.js';
import { handler } from './handler.js';
import { permit, withProject } from './guards.js';
import {
  PROJECT_PERMISSIONS as P,
  canInProject,
} from '../../../shared/projects/permissions.js';

const router = Router({ mergeParams: true });

router.use(handler(withProject));

/* ── listing ──────────────────────────────────────────────────────── */

router.get(
  '/',
  permit(P.TASK_VIEW),
  handler(async (req, res) => {
    res.json(
      await tasks.list(req.projectContext, {
        phaseId: req.query.phaseId,
        taskListId: req.query.taskListId,
        statusId: req.query.statusId,
        parentTaskId: req.query.parentTaskId,
        topLevel: ['1', 'true'].includes(String(req.query.topLevel)),
        overdue: ['1', 'true'].includes(String(req.query.overdue)),
        // `mine=1` resolves to the session user, never to an id from the query —
        // otherwise it would be a way to read somebody else's workload.
        assigneeId: ['1', 'true'].includes(String(req.query.mine))
          ? req.user.id
          : req.query.assigneeId,
        sort: req.query.sort,
        direction: req.query.direction,
        limit: req.query.limit,
        offset: req.query.offset,
      })
    );
  })
);

router.post(
  '/',
  permit(P.TASK_CREATE),
  handler(async (req, res) => {
    res.status(201).json({ task: await tasks.create(req.projectContext, req.body) });
  })
);

/* ── one task ─────────────────────────────────────────────────────── */

router.get(
  '/:taskId',
  permit(P.TASK_VIEW),
  handler(async (req, res) => {
    const task = await tasks.get(req.projectContext, req.params.taskId);
    if (!task) return res.status(404).json({ error: 'not_found' });
    res.json({ task });
  })
);

/**
 * Edit a task.
 *
 * A status change needs `task.edit_status` as well as `task.edit`, and that is
 * checked here rather than in the service because it is a routing question:
 * dragging a Kanban card and typing in a form arrive at the same place, and both
 * must clear the same gate.
 */
router.patch(
  '/:taskId',
  permit(P.TASK_EDIT),
  handler(async (req, res, next) => {
    if (req.body?.statusId !== undefined && !permitted(req, P.TASK_EDIT_STATUS)) {
      return res.status(403).json({ error: 'forbidden', missing: P.TASK_EDIT_STATUS });
    }
    if (
      (req.body?.startDate !== undefined ||
        req.body?.endDate !== undefined ||
        req.body?.durationDays !== undefined) &&
      !permitted(req, P.TASK_EDIT_SCHEDULE)
    ) {
      return res.status(403).json({ error: 'forbidden', missing: P.TASK_EDIT_SCHEDULE });
    }
    next();
  }),
  handler(async (req, res) => {
    const task = await tasks.update(req.projectContext, req.params.taskId, req.body);
    if (!task) return res.status(404).json({ error: 'not_found' });
    // A child's progress changing moves its parents. Doing it here, after the
    // write, keeps the rollup out of the update path for tasks that have no
    // parent — which is most of them.
    if (req.body?.progress !== undefined || req.body?.statusId !== undefined) {
      await tasks.rollUp(req.projectContext, req.params.taskId);
    }
    res.json({ task });
  })
);

router.delete(
  '/:taskId',
  permit(P.TASK_DELETE),
  handler(async (req, res) => {
    const removed = await tasks.remove(req.projectContext, req.params.taskId);
    if (!removed) return res.status(404).json({ error: 'not_found' });
    res.json(removed);
  })
);

/* ── hierarchy ────────────────────────────────────────────────────── */

router.put(
  '/:taskId/parent',
  permit(P.TASK_EDIT),
  handler(async (req, res) => {
    const moved = await tasks.reparent(req.projectContext, req.params.taskId, req.body?.parentTaskId ?? null);
    if (!moved) return res.status(404).json({ error: 'not_found' });
    res.json({ task: await tasks.get(req.projectContext, req.params.taskId) });
  })
);

/* ── assignees ────────────────────────────────────────────────────── */

router.put(
  '/:taskId/assignees',
  permit(P.TASK_ASSIGN),
  handler(async (req, res) => {
    const kind = ['assignee', 'contributor', 'reviewer', 'approver', 'follower'].includes(
      req.body?.kind
    )
      ? req.body.kind
      : 'assignee';
    const task = await tasks.setAssignees(req.projectContext, req.params.taskId, req.body?.userIds, kind);
    if (!task) return res.status(404).json({ error: 'not_found' });
    res.json({ task });
  })
);

/* ── checklist ────────────────────────────────────────────────────── */

router.get(
  '/:taskId/checklist',
  permit(P.TASK_VIEW),
  handler(async (req, res) => {
    // Read through the task rather than the table directly, so an internal task
    // a client cannot see does not leak its checklist through a side door.
    const task = await tasks.get(req.projectContext, req.params.taskId);
    if (!task) return res.status(404).json({ error: 'not_found' });
    res.json({ checklist: task.checklist });
  })
);

router.post(
  '/:taskId/checklist',
  permit(P.TASK_EDIT),
  handler(async (req, res) => {
    const task = await tasks.get(req.projectContext, req.params.taskId);
    if (!task) return res.status(404).json({ error: 'not_found' });
    res.status(201).json({
      item: await tasks.addChecklistItem(req.projectContext, req.params.taskId, req.body),
    });
  })
);

router.patch(
  '/:taskId/checklist/:itemId',
  permit(P.TASK_EDIT),
  handler(async (req, res) => {
    const task = await tasks.get(req.projectContext, req.params.taskId);
    if (!task) return res.status(404).json({ error: 'not_found' });
    const item = await tasks.setChecklistItem(
      req.projectContext,
      req.params.taskId,
      req.params.itemId,
      req.body
    );
    if (!item) return res.status(404).json({ error: 'not_found' });
    res.json({ item });
  })
);

router.delete(
  '/:taskId/checklist/:itemId',
  permit(P.TASK_EDIT),
  handler(async (req, res) => {
    const task = await tasks.get(req.projectContext, req.params.taskId);
    if (!task) return res.status(404).json({ error: 'not_found' });
    const removed = await tasks.removeChecklistItem(
      req.projectContext,
      req.params.taskId,
      req.params.itemId
    );
    if (!removed) return res.status(404).json({ error: 'not_found' });
    res.status(204).end();
  })
);

/**
 * The permission check as a boolean, for the routes that gate on two of them.
 *
 * `permit()` is middleware and answers one question per route; editing a
 * schedule needs `task.edit` *and* `task.edit_schedule`, and the second depends
 * on what is in the body.
 */
function permitted(req, permission) {
  if (!req.projectContext) return false;
  return canInProject(req.projectContext, permission);
}

export default router;
