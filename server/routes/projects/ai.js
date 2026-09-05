/**
 * Qodo Projects — AI routes.
 *
 * Two mounts, matching the two scopes: portfolio-wide capabilities at
 * `/api/projects/ai`, and per-project ones at `/api/projects/:projectId/ai`.
 *
 * Every route here needs the permission that would let the person read the
 * thing by hand. That is the whole design: the AI is a different way to ask,
 * never a wider one.
 */

import { Router } from 'express';
import * as ai from '../../projects/aiService.js';
import { handler } from './handler.js';
import { permit, permitPortal, withProject } from './guards.js';
import { PROJECT_PERMISSIONS as P } from '../../../shared/projects/permissions.js';

const language = (req) => (req.query.lang === 'ar' || req.body?.lang === 'ar' ? 'ar' : 'en');

/* ── portfolio ────────────────────────────────────────────────────── */

export const portfolioAiRoutes = Router();

portfolioAiRoutes.get(
  '/status',
  handler(async (_req, res) => {
    // Whether AI is configured is not itself sensitive, and the UI needs it to
    // decide whether to draw the buttons at all.
    res.json({ available: ai.available() });
  })
);

/**
 * Insights over the portfolio.
 *
 * The model receives figures the report engine computed and writes the
 * sentence; it never does the arithmetic. Every insight cites the projects it
 * is about, and one citing a project that is not in the data is dropped.
 */
portfolioAiRoutes.post(
  '/insights',
  permitPortal(P.REPORTS_PORTFOLIO),
  handler(async (req, res) => {
    res.json(await ai.portfolioInsights(req.user, language(req)));
  })
);

/**
 * Ask a question about the projects this person may see.
 *
 * The context is assembled from authorized queries and handed over whole — the
 * model never reaches the database, which is what makes the permission boundary
 * the same one the UI has rather than one somebody has to remember.
 */
portfolioAiRoutes.post(
  '/ask',
  permitPortal(P.PROJECT_VIEW),
  handler(async (req, res) => {
    res.json(await ai.askAboutProjects(req.user, req.body?.question, language(req)));
  })
);

portfolioAiRoutes.post(
  '/translate',
  permitPortal(P.PROJECT_VIEW),
  handler(async (req, res) => {
    res.json(await ai.translate(req.body?.text, req.body?.to));
  })
);

/* ── one project ──────────────────────────────────────────────────── */

export const projectAiRoutes = Router({ mergeParams: true });

projectAiRoutes.use(handler(withProject));

projectAiRoutes.post(
  '/summarise/task/:taskId',
  permit(P.TASK_VIEW),
  handler(async (req, res) => {
    const summary = await ai.summariseTask(req.projectContext, req.params.taskId, language(req));
    if (!summary) return res.status(404).json({ error: 'not_found' });
    res.json(summary);
  })
);

/**
 * Draft text for a field.
 *
 * Returns `isDraft: true` and writes nothing. A generated sentence belongs in a
 * form field until somebody has read it.
 */
projectAiRoutes.post(
  '/generate',
  permit(P.TASK_EDIT),
  handler(async (req, res) => {
    res.json(await ai.generate(req.body?.kind, req.body?.prompt, language(req)));
  })
);

/**
 * Turn a brief into proposed tasks.
 *
 * A proposal, never a write — the response says `requiresConfirmation: true`
 * and there is no route that turns it into records without a person choosing.
 */
projectAiRoutes.post(
  '/propose-tasks',
  permit(P.TASK_CREATE),
  handler(async (req, res) => {
    res.json(await ai.proposeTasks(req.projectContext, req.body?.brief, language(req)));
  })
);

/**
 * Work that already looks like this.
 *
 * Not a model call: duplicate detection at create time has to be fast and
 * deterministic, and word overlap is both.
 */
projectAiRoutes.post(
  '/similar',
  permit(P.TASK_VIEW),
  handler(async (req, res) => {
    res.json({ similar: await ai.findSimilarTasks(req.projectContext, req.body?.title) });
  })
);
