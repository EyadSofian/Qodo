/**
 * Qodo Projects — report and dashboard routes.
 *
 * Mounted twice: at `/api/projects/reports` for portfolio-wide reports, and at
 * `/api/projects/:projectId/reports` for one project's. The engine is the same;
 * the difference is whether a project context narrows it.
 */

import { Router } from 'express';
import * as reports from '../../projects/reportService.js';
import * as dashboards from '../../projects/dashboardService.js';
import { handler } from './handler.js';
import { permit, permitPortal, withProject } from './guards.js';
import { PROJECT_PERMISSIONS as P } from '../../../shared/projects/permissions.js';
import { organizationOf } from '../../../shared/organization.js';

/**
 * Portfolio-level: every project this person may see.
 *
 * `visibleProjectIds` resolves that set from membership before anything else
 * runs, so a portfolio report is the union of what they could already open and
 * never more.
 */
export const portfolioReportRoutes = Router();

portfolioReportRoutes.get(
  '/portfolio',
  permitPortal(P.REPORTS_PORTFOLIO),
  handler(async (req, res) => {
    res.json(
      await reports.portfolio(req.user, {
        includeArchived: ['1', 'true'].includes(String(req.query.includeArchived)),
      })
    );
  })
);

portfolioReportRoutes.get(
  '/workload',
  permitPortal(P.REPORTS_RESOURCE),
  handler(async (req, res) => {
    res.json(await reports.workload(req.user, { from: req.query.from, to: req.query.to }));
  })
);

portfolioReportRoutes.get(
  '/saved',
  permitPortal(P.REPORTS_VIEW),
  handler(async (req, res) => {
    res.json({
      reports: await reports.saved(req.user, organizationOf(req.user), { moduleKey: req.query.module }),
    });
  })
);

portfolioReportRoutes.post(
  '/saved',
  permitPortal(P.REPORTS_MANAGE),
  handler(async (req, res) => {
    res.status(201).json({ report: await reports.save(req.user, organizationOf(req.user), req.body) });
  })
);

/** What the report builder may offer. Derived from the engine's own allowlists. */
portfolioReportRoutes.get(
  '/fields',
  permitPortal(P.REPORTS_VIEW),
  handler(async (req, res) => {
    const moduleKey = String(req.query.module ?? 'task');
    res.json({
      groupings: reports.availableGroupings(moduleKey),
      // Money measures are hidden from anybody without `rate.view`, so the
      // builder cannot offer a chart that would be refused.
      measures: reports.availableMeasures(null, moduleKey),
    });
  })
);

portfolioReportRoutes.post(
  '/run',
  permitPortal(P.REPORTS_VIEW),
  handler(async (req, res) => {
    res.json(await reports.run(req.user, null, req.body));
  })
);

/* ── one project ──────────────────────────────────────────────────── */

export const projectReportRoutes = Router({ mergeParams: true });

projectReportRoutes.use(handler(withProject));

projectReportRoutes.get(
  '/fields',
  permit(P.REPORTS_VIEW),
  handler(async (req, res) => {
    const moduleKey = String(req.query.module ?? 'task');
    res.json({
      groupings: reports.availableGroupings(moduleKey),
      measures: reports.availableMeasures(req.projectContext, moduleKey),
    });
  })
);

projectReportRoutes.post(
  '/run',
  permit(P.REPORTS_VIEW),
  handler(async (req, res) => {
    res.json(await reports.run(req.user, req.projectContext, req.body));
  })
);

/* ── dashboards ───────────────────────────────────────────────────── */

export const dashboardRoutes = Router({ mergeParams: true });

dashboardRoutes.get(
  '/',
  permitPortal(P.DASHBOARD_VIEW),
  handler(async (req, res) => {
    res.json({
      dashboards: await dashboards.list(req.user, organizationOf(req.user), req.query.projectId ?? null),
    });
  })
);

dashboardRoutes.post(
  '/',
  permitPortal(P.DASHBOARD_MANAGE),
  handler(async (req, res) => {
    res.status(201).json({ dashboard: await dashboards.create(req.user, organizationOf(req.user), req.body) });
  })
);

dashboardRoutes.get(
  '/:dashboardId',
  permitPortal(P.DASHBOARD_VIEW),
  handler(async (req, res) => {
    const dashboard = await dashboards.render(
      req.user,
      null,
      organizationOf(req.user),
      req.params.dashboardId
    );
    if (!dashboard) return res.status(404).json({ error: 'not_found' });
    res.json({ dashboard });
  })
);

dashboardRoutes.post(
  '/:dashboardId/widgets',
  permitPortal(P.DASHBOARD_MANAGE),
  handler(async (req, res) => {
    const widget = await dashboards.addWidget(
      req.user,
      organizationOf(req.user),
      req.params.dashboardId,
      req.body
    );
    if (!widget) return res.status(404).json({ error: 'not_found' });
    res.status(201).json({ widget });
  })
);

dashboardRoutes.put(
  '/:dashboardId/layout',
  permitPortal(P.DASHBOARD_MANAGE),
  handler(async (req, res) => {
    const result = await dashboards.setLayout(
      req.user,
      organizationOf(req.user),
      req.params.dashboardId,
      req.body?.layout
    );
    if (!result) return res.status(404).json({ error: 'not_found' });
    res.json(result);
  })
);

dashboardRoutes.delete(
  '/:dashboardId/widgets/:widgetId',
  permitPortal(P.DASHBOARD_MANAGE),
  handler(async (req, res) => {
    const removed = await dashboards.removeWidget(
      req.user,
      organizationOf(req.user),
      req.params.dashboardId,
      req.params.widgetId
    );
    if (!removed) return res.status(404).json({ error: 'not_found' });
    res.status(204).end();
  })
);
