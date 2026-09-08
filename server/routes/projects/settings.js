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
import * as automation from '../../projects/automationService.js';
import * as blueprint from '../../projects/blueprintService.js';
import * as webhooks from '../../projects/webhookService.js';
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

/* ── automation ───────────────────────────────────────────────────── */

router.get(
  '/automation/rules',
  permitPortal(P.AUTOMATION_MANAGE),
  handler(async (req, res) => {
    res.json({
      // The administrator's list, so it includes the rules that are switched
      // off — they are exactly the ones whose toggle this screen exists to
      // turn back on.
      rules: await automation.rules(organizationOf(req.user), req.query.module ?? 'task', req.query.trigger, {
        includeInactive: true,
      }),
    });
  })
);

router.post(
  '/automation/rules',
  permitPortal(P.AUTOMATION_MANAGE),
  handler(async (req, res) => {
    res.status(201).json({ rule: await automation.createRule(req.user, organizationOf(req.user), req.body) });
  })
);

router.put(
  '/automation/rules/:ruleId/active',
  permitPortal(P.AUTOMATION_MANAGE),
  handler(async (req, res) => {
    const rule = await automation.setRuleActive(
      req.user,
      organizationOf(req.user),
      req.params.ruleId,
      req.body?.isActive !== false
    );
    if (!rule) return res.status(404).json({ error: 'not_found' });
    res.json({ rule });
  })
);

router.get(
  '/automation/runs',
  permitPortal(P.AUTOMATION_MANAGE),
  handler(async (req, res) => {
    res.json({
      runs: await automation.runHistory(organizationOf(req.user), {
        ruleId: req.query.ruleId,
        limit: req.query.limit,
      }),
    });
  })
);

/* ── business rules ───────────────────────────────────────────────── */

router.get(
  '/automation/business-rules',
  permitPortal(P.AUTOMATION_MANAGE),
  handler(async (req, res) => {
    res.json({
      rules: await automation.businessRules(organizationOf(req.user), req.query.module ?? 'issue'),
    });
  })
);

router.post(
  '/automation/business-rules',
  permitPortal(P.AUTOMATION_MANAGE),
  handler(async (req, res) => {
    res.status(201).json({
      rule: await automation.createBusinessRule(req.user, organizationOf(req.user), req.body),
    });
  })
);

router.put(
  '/automation/business-rules/reorder',
  permitPortal(P.AUTOMATION_MANAGE),
  handler(async (req, res) => {
    res.json({ order: await automation.reorderBusinessRules(organizationOf(req.user), req.body?.order) });
  })
);

/* ── blueprint ────────────────────────────────────────────────────── */

router.get(
  '/blueprints',
  permitPortal(P.BLUEPRINT_MANAGE),
  handler(async (req, res) => {
    res.json({ blueprints: await blueprint.blueprints(organizationOf(req.user), req.query.module) });
  })
);

router.post(
  '/blueprints',
  permitPortal(P.BLUEPRINT_MANAGE),
  handler(async (req, res) => {
    res.status(201).json({
      blueprint: await blueprint.createBlueprint(req.user, organizationOf(req.user), req.body),
    });
  })
);

router.post(
  '/blueprints/:blueprintId/drafts',
  permitPortal(P.BLUEPRINT_MANAGE),
  handler(async (req, res) => {
    res.status(201).json({
      version: await blueprint.saveDraft(
        req.user,
        organizationOf(req.user),
        req.params.blueprintId,
        req.body
      ),
    });
  })
);

router.post(
  '/blueprints/versions/:versionId/publish',
  permitPortal(P.BLUEPRINT_MANAGE),
  handler(async (req, res) => {
    const version = await blueprint.publish(req.user, organizationOf(req.user), req.params.versionId);
    if (!version) return res.status(404).json({ error: 'not_found' });
    res.json({ version });
  })
);

/**
 * Move existing records onto the published version.
 *
 * Deliberately a separate action rather than something publishing does. A
 * stricter blueprint must not retroactively make a task somebody closed last
 * month illegal (§25).
 */
router.post(
  '/blueprints/:blueprintId/migrate',
  permitPortal(P.BLUEPRINT_MANAGE),
  handler(async (req, res) => {
    const result = await blueprint.migrateRecords(req.user, organizationOf(req.user), req.params.blueprintId);
    if (!result) return res.status(404).json({ error: 'not_found' });
    res.json(result);
  })
);

/* ── webhooks ─────────────────────────────────────────────────────── */

router.get(
  '/webhooks',
  permitPortal(P.AUTOMATION_MANAGE),
  handler(async (req, res) => {
    // The secret comes back masked. There is no route that returns it.
    res.json({ endpoints: await webhooks.endpoints(organizationOf(req.user)) });
  })
);

router.post(
  '/webhooks',
  permitPortal(P.AUTOMATION_MANAGE),
  handler(async (req, res) => {
    // The one moment the secret is visible. It is generated here, returned
    // once, and never readable again.
    res.status(201).json({ endpoint: await webhooks.createEndpoint(req.user, organizationOf(req.user), req.body) });
  })
);

router.get(
  '/webhooks/:endpointId/deliveries',
  permitPortal(P.AUTOMATION_MANAGE),
  handler(async (req, res) => {
    res.json({
      deliveries: await webhooks.deliveries(
        organizationOf(req.user),
        req.params.endpointId,
        Number(req.query.limit) || 50
      ),
    });
  })
);

router.put(
  '/webhooks/:endpointId/active',
  permitPortal(P.AUTOMATION_MANAGE),
  handler(async (req, res) => {
    const result = await webhooks.setActive(
      req.user,
      organizationOf(req.user),
      req.params.endpointId,
      req.body?.isActive !== false
    );
    if (!result) return res.status(404).json({ error: 'not_found' });
    res.json(result);
  })
);

export default router;
