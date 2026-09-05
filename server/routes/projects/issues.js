/**
 * Qodo Projects — issue routes.
 *
 * Mounted under `/api/projects/:projectId/issues`.
 */

import { Router } from 'express';
import * as issues from '../../projects/issueService.js';
import { handler } from './handler.js';
import { permit, withProject } from './guards.js';
import {
  PROJECT_PERMISSIONS as P,
  canInProject,
} from '../../../shared/projects/permissions.js';

const router = Router({ mergeParams: true });

router.use(handler(withProject));

router.get(
  '/',
  permit(P.ISSUE_VIEW),
  handler(async (req, res) => {
    res.json(
      await issues.list(req.projectContext, {
        statusId: req.query.statusId,
        severity: req.query.severity,
        priority: req.query.priority,
        open: ['1', 'true'].includes(String(req.query.open)),
        search: req.query.q,
        sort: req.query.sort,
        direction: req.query.direction,
        limit: req.query.limit,
        offset: req.query.offset,
        // Both resolve to the session user rather than taking an id from the
        // query, so neither becomes a way to read somebody else's queue.
        assigneeId: ['1', 'true'].includes(String(req.query.mine))
          ? req.user.id
          : req.query.assigneeId,
        reporterId: ['1', 'true'].includes(String(req.query.reported))
          ? req.user.id
          : req.query.reporterId,
      })
    );
  })
);

router.post(
  '/',
  permit(P.ISSUE_CREATE),
  handler(async (req, res) => {
    res.status(201).json({ issue: await issues.create(req.projectContext, req.body) });
  })
);

router.get(
  '/:issueId',
  permit(P.ISSUE_VIEW),
  handler(async (req, res) => {
    const issue = await issues.get(req.projectContext, req.params.issueId);
    if (!issue) return res.status(404).json({ error: 'not_found' });
    res.json({ issue });
  })
);

router.patch(
  '/:issueId',
  permit(P.ISSUE_EDIT),
  handler(async (req, res) => {
    // Reassigning is a separate authority from editing the description. A
    // reporter may correct their own report; handing it to somebody else is
    // triage.
    if (req.body?.assigneeId !== undefined && !mayAssign(req)) {
      return res.status(403).json({ error: 'forbidden', missing: P.ISSUE_ASSIGN });
    }
    const issue = await issues.update(req.projectContext, req.params.issueId, req.body);
    if (!issue) return res.status(404).json({ error: 'not_found' });
    res.json({ issue });
  })
);

router.delete(
  '/:issueId',
  permit(P.ISSUE_DELETE),
  handler(async (req, res) => {
    const removed = await issues.remove(req.projectContext, req.params.issueId);
    if (!removed) return res.status(404).json({ error: 'not_found' });
    res.json(removed);
  })
);

router.post(
  '/:issueId/links',
  permit(P.ISSUE_EDIT),
  handler(async (req, res) => {
    res.status(201).json({ link: await issues.addLink(req.projectContext, req.params.issueId, req.body) });
  })
);

router.delete(
  '/:issueId/links/:linkId',
  permit(P.ISSUE_EDIT),
  handler(async (req, res) => {
    const removed = await issues.removeLink(req.projectContext, req.params.issueId, req.params.linkId);
    if (!removed) return res.status(404).json({ error: 'not_found' });
    res.status(204).end();
  })
);

/**
 * A second permission check inside a route that already cleared one.
 *
 * `permit()` is middleware and answers a single question; reassigning needs
 * `issue.edit` *and* `issue.assign`, and whether the second applies depends on
 * what is in the body.
 */
function mayAssign(req) {
  return Boolean(req.projectContext) && canInProject(req.projectContext, P.ISSUE_ASSIGN);
}

export default router;
