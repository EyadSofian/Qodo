/**
 * Qodo Projects — organization-level configuration.
 *
 * Mounted under `/api/projects/settings`. Everything here is portal-wide rather
 * than per-project: SLA policies, statuses, custom fields, business rules. The
 * path is declared before `/:projectId` in the router root so "settings" is
 * never mistaken for a project id.
 */

import { Router } from 'express';
import * as sla from '../../projects/slaService.js';
import * as metadata from '../../projects/metadataService.js';
import { handler } from './handler.js';
import { permitPortal } from './guards.js';
import { PROJECT_PERMISSIONS as P } from '../../../shared/projects/permissions.js';
import { organizationOf } from '../../../shared/organization.js';

const router = Router();

/* ── SLA ──────────────────────────────────────────────────────────── */

router.get(
  '/sla',
  permitPortal(P.ISSUE_VIEW),
  handler(async (req, res) => {
    res.json({ policies: await sla.policies(organizationOf(req.user)) });
  })
);

router.post(
  '/sla',
  permitPortal(P.SLA_MANAGE),
  handler(async (req, res) => {
    res
      .status(201)
      .json({ policy: await sla.createPolicy(req.user, organizationOf(req.user), req.body) });
  })
);

/* ── statuses ─────────────────────────────────────────────────────── */

router.get(
  '/statuses',
  permitPortal(P.PROJECT_VIEW),
  handler(async (req, res) => {
    res.json({ statuses: await metadata.statusesFor(organizationOf(req.user), req.query.module) });
  })
);

router.post(
  '/statuses',
  permitPortal(P.CUSTOMIZATION_MANAGE),
  handler(async (req, res) => {
    res.status(201).json({
      status: await metadata.createStatus(req.user, organizationOf(req.user), req.body),
    });
  })
);

router.patch(
  '/statuses/:statusId',
  permitPortal(P.CUSTOMIZATION_MANAGE),
  handler(async (req, res) => {
    const status = await metadata.updateStatus(
      req.user,
      organizationOf(req.user),
      req.params.statusId,
      req.body
    );
    if (!status) return res.status(404).json({ error: 'not_found' });
    res.json({ status });
  })
);

/* ── modules ──────────────────────────────────────────────────────── */

router.get(
  '/modules',
  permitPortal(P.PROJECT_VIEW),
  handler(async (req, res) => {
    res.json({ modules: await metadata.modulesFor(organizationOf(req.user)) });
  })
);

/* ── custom fields ────────────────────────────────────────────────── */

router.get(
  '/fields',
  permitPortal(P.PROJECT_VIEW),
  handler(async (req, res) => {
    res.json({ fields: await metadata.fieldsFor(organizationOf(req.user), req.query.module) });
  })
);

router.post(
  '/fields',
  permitPortal(P.CUSTOMIZATION_MANAGE),
  handler(async (req, res) => {
    res
      .status(201)
      .json({ field: await metadata.createField(req.user, organizationOf(req.user), req.body) });
  })
);

export default router;
