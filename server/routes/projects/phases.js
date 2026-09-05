/**
 * Qodo Projects — phase routes.
 *
 * Mounted under `/api/projects/:projectId/phases`. Parse, authorize, delegate.
 */

import { Router } from 'express';
import * as phases from '../../projects/phaseService.js';
import { handler } from './handler.js';
import { permit, withProject } from './guards.js';
import { PROJECT_PERMISSIONS as P } from '../../../shared/projects/permissions.js';

const router = Router({ mergeParams: true });

router.use(handler(withProject));

router.get(
  '/',
  permit(P.PHASE_VIEW),
  handler(async (req, res) => {
    res.json({ phases: await phases.list(req.projectContext, { statusId: req.query.statusId }) });
  })
);

router.post(
  '/',
  permit(P.PHASE_CREATE),
  handler(async (req, res) => {
    res.status(201).json({ phase: await phases.create(req.projectContext, req.body) });
  })
);

/**
 * Reorder before `/:phaseId`, so the literal path wins the match. Express takes
 * the first route that matches and `reorder` is a perfectly good uuid-shaped
 * string as far as the router is concerned.
 */
router.put(
  '/reorder',
  permit(P.PHASE_EDIT),
  handler(async (req, res) => {
    res.json({ phases: await phases.reorder(req.projectContext, req.body?.order) });
  })
);

router.get(
  '/:phaseId',
  permit(P.PHASE_VIEW),
  handler(async (req, res) => {
    const phase = await phases.get(req.projectContext, req.params.phaseId);
    if (!phase) return res.status(404).json({ error: 'not_found' });
    res.json({ phase });
  })
);

router.patch(
  '/:phaseId',
  permit(P.PHASE_EDIT),
  handler(async (req, res) => {
    const phase = await phases.update(req.projectContext, req.params.phaseId, req.body);
    if (!phase) return res.status(404).json({ error: 'not_found' });
    res.json({ phase });
  })
);

router.delete(
  '/:phaseId',
  permit(P.PHASE_DELETE),
  handler(async (req, res) => {
    const removed = await phases.remove(req.projectContext, req.params.phaseId);
    if (!removed) return res.status(404).json({ error: 'not_found' });
    res.json(removed);
  })
);

export default router;
