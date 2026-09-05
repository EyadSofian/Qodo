/**
 * Qodo Projects — time and money routes.
 *
 * Mounted under `/api/projects/:projectId/time` and `/budget`.
 */

import { Router } from 'express';
import * as time from '../../projects/timeService.js';
import { projectAll, projectFields } from '../../projects/projectAccess.js';
import { handler } from './handler.js';
import { permit, withProject } from './guards.js';
import { PROJECT_PERMISSIONS as P } from '../../../shared/projects/permissions.js';

const router = Router({ mergeParams: true });

router.use(handler(withProject));

/* ── timers ───────────────────────────────────────────────────────── */

router.post(
  '/timer/start',
  permit(P.TIME_LOG),
  handler(async (req, res) => {
    res.status(201).json({ timer: await time.startTimer(req.projectContext, req.body) });
  })
);

router.post(
  '/timer/pause',
  permit(P.TIME_LOG),
  handler(async (req, res) => {
    const timer = await time.pauseTimer(req.projectContext);
    if (!timer) return res.status(404).json({ error: 'no_running_timer' });
    res.json({ timer });
  })
);

router.post(
  '/timer/resume',
  permit(P.TIME_LOG),
  handler(async (req, res) => {
    const timer = await time.resumeTimer(req.projectContext);
    if (!timer) return res.status(404).json({ error: 'no_paused_timer' });
    res.json({ timer });
  })
);

router.post(
  '/timer/stop',
  permit(P.TIME_LOG),
  handler(async (req, res) => {
    const result = await time.stopTimer(req.projectContext);
    if (!result) return res.status(404).json({ error: 'no_running_timer' });
    res.json(result);
  })
);

/* ── entries ──────────────────────────────────────────────────────── */

router.get(
  '/entries',
  permit(P.TIME_VIEW),
  handler(async (req, res) => {
    const result = await time.listEntries(req.projectContext, {
      from: req.query.from,
      to: req.query.to,
      taskId: req.query.taskId,
      userId: req.query.userId,
      approvalStatus: req.query.status,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    // Rates are stripped unless this person holds `rate.view`. Doing it on the
    // way out — one projection — is what keeps a rate from leaking through a
    // listing nobody remembered to gate.
    res.json({ ...result, entries: projectAll(req.projectContext, result.entries) });
  })
);

router.post(
  '/entries',
  permit(P.TIME_LOG),
  handler(async (req, res) => {
    const entry = await time.logTime(req.projectContext, req.body);
    res.status(201).json({ entry: projectFields(req.projectContext, entry) });
  })
);

router.patch(
  '/entries/:entryId',
  permit(P.TIME_LOG),
  handler(async (req, res) => {
    const entry = await time.updateEntry(req.projectContext, req.params.entryId, req.body);
    if (!entry) return res.status(404).json({ error: 'not_found' });
    res.json({ entry: projectFields(req.projectContext, entry) });
  })
);

router.delete(
  '/entries/:entryId',
  permit(P.TIME_LOG),
  handler(async (req, res) => {
    const removed = await time.deleteEntry(req.projectContext, req.params.entryId);
    if (!removed) return res.status(404).json({ error: 'not_found' });
    res.status(204).end();
  })
);

/* ── timesheets ───────────────────────────────────────────────────── */

router.get(
  '/timesheet',
  permit(P.TIME_VIEW),
  handler(async (req, res) => {
    const sheet = await time.timesheetFor(req.projectContext, req.user.id, req.query.week);
    const entries = await time.listEntries(req.projectContext, {
      from: sheet.periodStart,
      to: sheet.periodEnd,
      userId: req.user.id,
      limit: 200,
    });
    res.json({ timesheet: sheet, ...entries, entries: projectAll(req.projectContext, entries.entries) });
  })
);

router.post(
  '/timesheet/submit',
  permit(P.TIMESHEET_SUBMIT),
  handler(async (req, res) => {
    res.json({ timesheet: await time.submitTimesheet(req.projectContext, req.body?.week) });
  })
);

router.post(
  '/timesheet/:timesheetId/recall',
  permit(P.TIMESHEET_SUBMIT),
  handler(async (req, res) => {
    const sheet = await time.recallTimesheet(req.projectContext, req.params.timesheetId);
    if (!sheet) return res.status(404).json({ error: 'not_found' });
    res.json({ timesheet: sheet });
  })
);

router.get(
  '/timesheet/pending',
  permit(P.TIMESHEET_APPROVE),
  handler(async (req, res) => {
    res.json({ timesheets: await time.pendingTimesheets(req.projectContext) });
  })
);

router.post(
  '/timesheet/:timesheetId/review',
  permit(P.TIMESHEET_APPROVE),
  handler(async (req, res) => {
    const sheet = await time.reviewTimesheet(
      req.projectContext,
      req.params.timesheetId,
      req.body?.decision,
      req.body?.reason
    );
    if (!sheet) return res.status(404).json({ error: 'not_found' });
    res.json({ timesheet: sheet });
  })
);

export default router;
