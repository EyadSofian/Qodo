/**
 * Qodo Projects — import, export and integrations.
 *
 * Import is per project, because a row has to land somewhere. Export and the
 * integration catalogue are organization-level.
 */

import express, { Router } from 'express';
import * as importer from '../../projects/importService.js';
import * as exporter from '../../projects/exportService.js';
import * as integrations from '../../projects/integrationService.js';
import * as tasks from '../../projects/taskService.js';
import * as issues from '../../projects/issueService.js';
import { handler } from './handler.js';
import { permit, permitPortal, withProject } from './guards.js';
import { PROJECT_PERMISSIONS as P } from '../../../shared/projects/permissions.js';
import { organizationOf } from '../../../shared/organization.js';

/* ── per project: import and export ───────────────────────────────── */

export const projectDataRoutes = Router({ mergeParams: true });

projectDataRoutes.use(handler(withProject));

projectDataRoutes.get(
  '/import/fields',
  permit(P.DATA_IMPORT),
  handler(async (req, res) => {
    res.json({ fields: importer.importableFields(String(req.query.module ?? 'task')) });
  })
);

/**
 * The first look at a file.
 *
 * Headers, ten rows and a *suggested* mapping. The suggestion is never applied
 * on its own: a column called "Owner" could be the assignee or the client, and
 * only the person importing knows which.
 */
projectDataRoutes.post(
  '/import/preview',
  permit(P.DATA_IMPORT),
  express.raw({ type: () => true, limit: '8mb' }),
  handler(async (req, res) => {
    const text = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    res.json(importer.preview(text, String(req.query.module ?? 'task')));
  })
);

/**
 * Run the import — as a rehearsal, or for real.
 *
 * A dry run parses every row, applies the mapping and validates each value,
 * writing nothing. That is what makes it a rehearsal rather than a spell-check.
 */
projectDataRoutes.post(
  '/import/run',
  permit(P.DATA_IMPORT),
  express.raw({ type: () => true, limit: '8mb' }),
  handler(async (req, res) => {
    const text = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    const moduleKey = String(req.query.module ?? 'task');
    const dryRun = req.query.dryRun !== '0';

    let mapping = {};
    try {
      mapping = JSON.parse(decodeURIComponent(req.get('x-mapping') || '{}'));
    } catch {
      return res.status(400).json({ error: 'mapping_invalid' });
    }

    // Creating a record needs the create permission for that module, not just
    // `data.import` — importing must not be a way around a permission.
    const context = req.projectContext;
    const create =
      moduleKey === 'issue'
        ? async (record) => issues.create(context, record)
        : async (record) => tasks.create(context, record);

    if (!dryRun) {
      const needed = moduleKey === 'issue' ? P.ISSUE_CREATE : P.TASK_CREATE;
      const { canInProject } = await import('../../../shared/projects/permissions.js');
      if (!canInProject(context, needed)) {
        return res.status(403).json({ error: 'forbidden', missing: needed });
      }
    }

    res.json(
      await importer.run(context, {
        text,
        moduleKey,
        mapping,
        dryRun,
        fileName: decodeURIComponent(req.get('x-file-name') || ''),
        createTask: create,
      })
    );
  })
);

projectDataRoutes.get(
  '/import/history',
  permit(P.DATA_IMPORT),
  handler(async (req, res) => {
    res.json({
      runs: await importer.history(organizationOf(req.user), req.projectContext.project.id),
    });
  })
);

projectDataRoutes.get(
  '/export',
  permit(P.DATA_EXPORT),
  handler(async (req, res) => {
    const result = await exporter.exportModule(req.user, req.projectContext, String(req.query.module ?? 'task'), {
      format: req.query.format,
      limit: req.query.limit,
    });

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(result.body);
  })
);

/* ── organization: export and integrations ────────────────────────── */

export const portfolioDataRoutes = Router();

portfolioDataRoutes.get(
  '/export',
  permitPortal(P.DATA_EXPORT),
  handler(async (req, res) => {
    const result = await exporter.exportModule(req.user, null, String(req.query.module ?? 'task'), {
      format: req.query.format,
      limit: req.query.limit,
    });

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(result.body);
  })
);

export const integrationRoutes = Router();

/**
 * Every provider, with whether it is actually connected.
 *
 * A provider nobody has configured appears as `not_configured` rather than
 * being absent — somebody has to find it in order to set it up — and never as
 * connected, which is the promise §68 asks for.
 */
integrationRoutes.get(
  '/',
  permitPortal(P.INTEGRATION_MANAGE),
  handler(async (req, res) => {
    res.json({ integrations: await integrations.catalogue(organizationOf(req.user)) });
  })
);

integrationRoutes.post(
  '/',
  permitPortal(P.INTEGRATION_MANAGE),
  handler(async (req, res) => {
    res.status(201).json({
      connection: await integrations.connect(req.user, organizationOf(req.user), req.body),
    });
  })
);

integrationRoutes.delete(
  '/:provider',
  permitPortal(P.INTEGRATION_MANAGE),
  handler(async (req, res) => {
    const removed = await integrations.disconnect(req.user, organizationOf(req.user), req.params.provider);
    if (!removed) return res.status(404).json({ error: 'not_found' });
    res.status(204).end();
  })
);
