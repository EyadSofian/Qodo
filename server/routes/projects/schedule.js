/**
 * Qodo Projects — schedule routes.
 *
 * Mounted under `/api/projects/:projectId/schedule`. The Gantt reads from here
 * and writes back through here, which is the point: a bar dragged on a chart is
 * a request that clears `task.edit_schedule` exactly like a typed date does.
 */

import { Router } from 'express';
import * as schedule from '../../projects/scheduleService.js';
import { handler } from './handler.js';
import { permit, withProject } from './guards.js';
import { PROJECT_PERMISSIONS as P } from '../../../shared/projects/permissions.js';

const router = Router({ mergeParams: true });

router.use(handler(withProject));

/**
 * The computed schedule: early and late dates, float, and the critical path.
 *
 * Read-only. It says what the dates *would* be if the network were levelled;
 * nothing is written until somebody with `task.edit_schedule` asks for it.
 */
router.get(
  '/',
  permit(P.TASK_VIEW),
  handler(async (req, res) => {
    res.json(await schedule.scheduleOf(req.projectContext));
  })
);

router.get(
  '/dependencies',
  permit(P.TASK_VIEW),
  handler(async (req, res) => {
    res.json({ dependencies: await schedule.dependencies(req.projectContext) });
  })
);

router.post(
  '/dependencies',
  permit(P.TASK_EDIT_SCHEDULE),
  handler(async (req, res) => {
    res.status(201).json({ dependency: await schedule.addDependency(req.projectContext, req.body) });
  })
);

router.delete(
  '/dependencies/:dependencyId',
  permit(P.TASK_EDIT_SCHEDULE),
  handler(async (req, res) => {
    const removed = await schedule.removeDependency(req.projectContext, req.params.dependencyId);
    if (!removed) return res.status(404).json({ error: 'not_found' });
    res.status(204).end();
  })
);

/**
 * Move a task, and say what else moves with it.
 *
 * `POST` previews and `PUT` commits, so a drag can show "this pushes the
 * project out by six working days" before anything is written. Both need the
 * same permission — a preview reveals the schedule, and the schedule is not
 * public inside the project either.
 */
router.post(
  '/reschedule',
  permit(P.TASK_EDIT_SCHEDULE),
  handler(async (req, res) => {
    res.json(
      await schedule.reschedule(req.projectContext, req.body?.taskId, req.body?.startDate, {
        commit: false,
      })
    );
  })
);

router.put(
  '/reschedule',
  permit(P.TASK_EDIT_SCHEDULE),
  handler(async (req, res) => {
    res.json(
      await schedule.reschedule(req.projectContext, req.body?.taskId, req.body?.startDate, {
        commit: true,
      })
    );
  })
);

router.put(
  '/apply',
  permit(P.TASK_EDIT_SCHEDULE),
  handler(async (req, res) => {
    res.json(await schedule.applySchedule(req.projectContext));
  })
);

/* ── baselines ────────────────────────────────────────────────────── */

router.get(
  '/baselines',
  permit(P.TASK_VIEW),
  handler(async (req, res) => {
    res.json({ baselines: await schedule.baselines(req.projectContext) });
  })
);

router.post(
  '/baselines',
  permit(P.BASELINE_CREATE),
  handler(async (req, res) => {
    res.status(201).json({ baseline: await schedule.captureBaseline(req.projectContext, req.body) });
  })
);

router.get(
  '/baselines/:baselineId/variance',
  permit(P.TASK_VIEW),
  handler(async (req, res) => {
    const variance = await schedule.compareToBaseline(req.projectContext, req.params.baselineId);
    if (!variance) return res.status(404).json({ error: 'not_found' });
    res.json({ variance });
  })
);

export default router;
