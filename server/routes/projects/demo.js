/**
 * Qodo Projects — the demo-data endpoints.
 *
 * Three verbs on one resource: read what is loaded, load it, remove it. There
 * is deliberately no partial load and no "reload" — an operation that writes a
 * few hundred rows into the same tables as real work should have exactly two
 * states a person can hold in their head.
 *
 * The gate is two locks rather than one, because this endpoint crosses a
 * boundary no other Projects route crosses: it creates **workspace user
 * accounts**, and "may administer Projects" is not the same claim as "may
 * create logins for this company". So a caller needs both the Projects
 * administrator's permission set *and* the workspace administrator role. Either
 * one alone is refused.
 */

import { Router } from 'express';
import * as demo from '../../projects/demoDataService.js';
import * as access from '../../projects/projectAccess.js';
import { PROJECT_PERMISSIONS as P } from '../../../shared/projects/permissions.js';
import { handler } from './handler.js';

const router = Router();

/**
 * Both locks, checked in one place.
 *
 * The rule itself lives in `mayManageDemoData` so it can be asserted without an
 * HTTP server; this is only the plumbing that resolves the permission set and
 * turns a refusal into a 403.
 *
 * The refusal does not say which of the two locks failed. A caller learning
 * that they hold one of them is a small piece of information about how this
 * deployment is configured, and there is no reason to hand it over.
 */
const requireDemoAdmin = handler(async (req, res, next) => {
  const set = await access.permissionSetFor(req.user);
  if (!demo.mayManageDemoData(req.user, set)) {
    return res.status(403).json({ error: 'forbidden', missing: P.PERMISSIONS_MANAGE });
  }
  next();
});

/**
 * What is loaded, and what a load would create.
 *
 * Readable by the same administrator who could load it, and by nobody else: the
 * batch id and the load timestamp say when somebody last put demo data into
 * this deployment, which is a question about the deployment rather than about
 * the demo.
 */
router.get(
  '/',
  requireDemoAdmin,
  handler(async (req, res) => {
    res.json(await demo.status(req.user));
  })
);

router.post(
  '/',
  requireDemoAdmin,
  handler(async (req, res) => {
    res.status(201).json(await demo.load(req.user));
  })
);

/**
 * Remove it.
 *
 * `batchId` is optional and, when absent, means every batch this organization
 * has — which is the same thing in every case the loader allows, since it
 * refuses to create a second one. It is accepted anyway so that a deployment
 * that acquired two batches by some route this code does not know about can
 * still be cleaned up one at a time.
 */
router.delete(
  '/',
  requireDemoAdmin,
  handler(async (req, res) => {
    const batchId = typeof req.query.batchId === 'string' ? req.query.batchId : null;
    res.json(await demo.unload(req.user, batchId));
  })
);

export default router;
