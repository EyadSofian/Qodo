/**
 * Qodo Projects — task list routes.
 *
 * Mounted under `/api/projects/:projectId/task-lists`.
 */

import { Router } from 'express';
import * as taskLists from '../../projects/taskListService.js';
import { handler } from './handler.js';
import { permit, withProject } from './guards.js';
import { PROJECT_PERMISSIONS as P } from '../../../shared/projects/permissions.js';

const router = Router({ mergeParams: true });

router.use(handler(withProject));

router.get(
  '/',
  permit(P.TASKLIST_VIEW),
  handler(async (req, res) => {
    // `phaseId=none` asks for the lists filed against no phase — a real
    // question the UI needs, and distinct from asking for all of them.
    const phaseId =
      req.query.phaseId === 'none' ? null : req.query.phaseId || undefined;
    res.json({ taskLists: await taskLists.list(req.projectContext, { phaseId }) });
  })
);

router.post(
  '/',
  permit(P.TASKLIST_CREATE),
  handler(async (req, res) => {
    res.status(201).json({ taskList: await taskLists.create(req.projectContext, req.body) });
  })
);

router.put(
  '/reorder',
  permit(P.TASKLIST_EDIT),
  handler(async (req, res) => {
    res.json({ taskLists: await taskLists.reorder(req.projectContext, req.body?.order) });
  })
);

router.get(
  '/:taskListId',
  permit(P.TASKLIST_VIEW),
  handler(async (req, res) => {
    const taskList = await taskLists.get(req.projectContext, req.params.taskListId);
    if (!taskList) return res.status(404).json({ error: 'not_found' });
    res.json({ taskList });
  })
);

router.patch(
  '/:taskListId',
  permit(P.TASKLIST_EDIT),
  handler(async (req, res) => {
    const taskList = await taskLists.update(req.projectContext, req.params.taskListId, req.body);
    if (!taskList) return res.status(404).json({ error: 'not_found' });
    res.json({ taskList });
  })
);

router.delete(
  '/:taskListId',
  permit(P.TASKLIST_DELETE),
  handler(async (req, res) => {
    const removed = await taskLists.remove(req.projectContext, req.params.taskListId);
    if (!removed) return res.status(404).json({ error: 'not_found' });
    res.json(removed);
  })
);

export default router;
