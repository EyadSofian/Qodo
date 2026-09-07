/**
 * Qodo Projects — the router root.
 *
 * Everything under /api/projects passes through here first, which is where the
 * three cross-cutting concerns live so no individual route has to remember
 * them: storage availability, the async error translation, and the rule that a
 * project you may not see is indistinguishable from one that does not exist.
 */

import { Router } from 'express';
import { requireAuth } from '../../auth.js';
import { isAvailable, unavailable } from '../../projects/db.js';
import projectRoutes from './projects.js';
import phaseRoutes from './phases.js';
import taskListRoutes from './taskLists.js';
import taskRoutes from './tasks.js';
import scheduleRoutes from './schedule.js';
import issueRoutes from './issues.js';
import settingsRoutes from './settings.js';
import timeRoutes from './time.js';
import budgetRoutes from './budget.js';
import { commentRoutes, forumRoutes, pageRoutes } from './collaboration.js';
import documentRoutes from './documents.js';
import {
  dashboardRoutes,
  portfolioReportRoutes,
  projectReportRoutes,
} from './reports.js';
import { portfolioAiRoutes, projectAiRoutes } from './ai.js';
import {
  integrationRoutes,
  portfolioDataRoutes,
  projectDataRoutes,
} from './data.js';
import demoRoutes from './demo.js';

const router = Router();

router.use(requireAuth);

/**
 * Projects needs PostgreSQL and says so plainly rather than half-working.
 *
 * The rest of the workspace still runs against a JSON file with zero setup —
 * that is not being taken away. But a JSON fallback *for Projects* would mean
 * every query written twice, in SQL and as a JavaScript filter, and the two
 * drifting the first time one of them was fixed. The 503 body carries the
 * one-line docker command, so a developer who hits this knows what to do
 * without opening a document.
 */
router.use((_req, res, next) => {
  if (!isAvailable()) return res.status(503).json(unavailable());
  next();
});

// Organization-level configuration, before anything that could read
// "settings" as a project id.
router.use('/settings', settingsRoutes);
// Portfolio-wide reporting and dashboards, before anything could read
// "reports" or "dashboards" as a project id.
router.use('/reports', portfolioReportRoutes);
router.use('/dashboards', dashboardRoutes);
router.use('/ai', portfolioAiRoutes);
router.use('/data', portfolioDataRoutes);
router.use('/integrations', integrationRoutes);
// Demo data. Before `/:projectId`, like every other organization-level router,
// so "demo" is never read as a project id.
router.use('/demo', demoRoutes);

// The nested routers are mounted first. `/:projectId/phases` has to win the
// match before `/:projectId` in projects.js treats "phases" as a project id.
router.use('/:projectId/phases', phaseRoutes);
router.use('/:projectId/task-lists', taskListRoutes);
router.use('/:projectId/tasks', taskRoutes);
router.use('/:projectId/schedule', scheduleRoutes);
router.use('/:projectId/issues', issueRoutes);
router.use('/:projectId/time', timeRoutes);
router.use('/:projectId/budget', budgetRoutes);
router.use('/:projectId/documents', documentRoutes);
router.use('/:projectId/reports', projectReportRoutes);
router.use('/:projectId/ai', projectAiRoutes);
router.use('/:projectId/data', projectDataRoutes);
// Comments, forums and pages share one router — they share a project, a client
// boundary and a mention parser. Mounted on their three specific prefixes
// rather than on the project root, so an ordinary project request does not
// resolve its authorization context twice on the way past.
router.use('/:projectId/comments', commentRoutes);
router.use('/:projectId/forum', forumRoutes);
router.use('/:projectId/pages', pageRoutes);
router.use('/', projectRoutes);

export default router;
