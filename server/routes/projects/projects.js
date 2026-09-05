/**
 * Qodo Projects — project routes.
 *
 * Parse, authorize, delegate. There is no business logic in this file and no
 * SQL: `projectService` decides and `db.js` persists. That separation is the
 * only thing standing between this module and what `server/routes/tasks.js`
 * grew into at 2051 lines.
 */

import { Router } from 'express';
import * as projects from '../../projects/projectService.js';
import * as access from '../../projects/projectAccess.js';
import * as audit from '../../projects/auditService.js';
import { handler } from './handler.js';
import { permit, permitPortal, withProject } from './guards.js';
import { PROJECT_PERMISSIONS as P } from '../../../shared/projects/permissions.js';
import { organizationOf } from '../../../shared/organization.js';

const router = Router();

/* ── who am I here ────────────────────────────────────────────────── */

/**
 * The current person's Projects authority.
 *
 * The browser needs it to decide what to render, and it cannot be derived from
 * the workspace session: a workspace administrator and a Projects permission
 * set are two different grants. Declared before `/:projectId` so the literal
 * path wins the route match — "me" is not a project id.
 */
router.get(
  '/me',
  handler(async (req, res) => {
    const set = await access.permissionSetFor(req.user);
    res.json({
      permissionSet: set?.id ?? 'employee',
      isClient: Boolean(set?.isClient),
      permissions: access.permissionsOfSet(set),
    });
  })
);

/* ── list ─────────────────────────────────────────────────────────── */

router.get(
  '/',
  handler(async (req, res) => {
    const result = await projects.list(req.user, {
      scope: req.query.scope,
      groupId: req.query.groupId,
      customerId: req.query.customerId,
      statusId: req.query.statusId,
      ownerId: req.query.ownerId,
      search: req.query.q,
      sort: req.query.sort,
      direction: req.query.direction,
      limit: req.query.limit,
      offset: req.query.offset,
      // `mine=1` and `favorites=1` are the two tabs that mean "me", and they
      // resolve to the session user here rather than taking a user id from the
      // query — otherwise they would be a way to read somebody else's list.
      memberOf: ['1', 'true'].includes(String(req.query.mine)) ? req.user.id : undefined,
      favoritesOf: ['1', 'true'].includes(String(req.query.favorites)) ? req.user.id : undefined,
    });
    res.json(result);
  })
);

/* ── create ───────────────────────────────────────────────────────── */

router.post(
  '/',
  permitPortal(P.PROJECT_CREATE),
  handler(async (req, res) => {
    const project = await projects.create(req.user, req.body);
    res.status(201).json({ project });
  })
);

/* ── one project ──────────────────────────────────────────────────── */

router.get(
  '/:projectId',
  handler(withProject),
  handler(async (req, res) => {
    // Recording the visit must never fail the visit.
    projects.touchRecent(req.projectContext).catch(() => {});
    res.json({
      project: req.projectContext.project,
      membership: req.projectContext.membership,
      // The browser needs to know what to hide. It is not the enforcement
      // point — every route above re-checks — but a UI that offers a button
      // the server will refuse is worse than one that does not show it.
      permissions: access.permissionsOfSet(req.projectContext.permissionSet),
      isClient: req.projectContext.isClient,
    });
  })
);

router.patch(
  '/:projectId',
  handler(withProject),
  permit(P.PROJECT_EDIT),
  handler(async (req, res) => {
    const project = await projects.update(req.projectContext, req.body);
    if (!project) return res.status(404).json({ error: 'not_found' });
    res.json({ project });
  })
);

/* ── lifecycle ────────────────────────────────────────────────────── */

router.post(
  '/:projectId/archive',
  handler(withProject),
  permit(P.PROJECT_ARCHIVE),
  handler(async (req, res) => {
    const project = await projects.setArchived(req.projectContext, true);
    if (!project) return res.status(404).json({ error: 'not_found' });
    res.json({ project });
  })
);

router.post(
  '/:projectId/unarchive',
  handler(withProject),
  permit(P.PROJECT_ARCHIVE),
  handler(async (req, res) => {
    const project = await projects.setArchived(req.projectContext, false);
    if (!project) return res.status(404).json({ error: 'not_found' });
    res.json({ project });
  })
);

router.delete(
  '/:projectId',
  handler(withProject),
  permit(P.PROJECT_DELETE),
  handler(async (req, res) => {
    const project = await projects.softDelete(req.projectContext);
    if (!project) return res.status(404).json({ error: 'not_found' });
    res.json({ project });
  })
);

/**
 * Restore and purge act on a *deleted* project, which `withProject` cannot
 * resolve — `contextFor` filters deleted rows out, and rightly so, because
 * every other route must never see one.
 *
 * So these two authorize differently: the service re-reads the row inside its
 * own organization filter, and the permission is checked at the portal level.
 * That is a narrower door, not a wider one — only somebody who may delete
 * across the organization can reach into the bin.
 */
router.post(
  '/:projectId/restore',
  permitPortal(P.PROJECT_DELETE),
  handler(async (req, res) => {
    const project = await projects.restore(req.user, req.params.projectId);
    if (!project) return res.status(404).json({ error: 'not_found' });
    res.json({ project });
  })
);

router.delete(
  '/:projectId/purge',
  permitPortal(P.PROJECT_PURGE),
  handler(async (req, res) => {
    const result = await projects.purge(req.user, req.params.projectId);
    if (!result) return res.status(404).json({ error: 'not_found' });
    res.json(result);
  })
);

/* ── membership ───────────────────────────────────────────────────── */

router.get(
  '/:projectId/members',
  handler(withProject),
  permit(P.PROJECT_VIEW),
  handler(async (req, res) => {
    res.json({ members: await projects.members(req.projectContext) });
  })
);

router.get(
  '/:projectId/members/candidates',
  handler(withProject),
  permit(P.PROJECT_MANAGE_MEMBERS),
  handler(async (req, res) => {
    res.json({ candidates: await projects.candidates(req.projectContext) });
  })
);

router.post(
  '/:projectId/members',
  handler(withProject),
  permit(P.PROJECT_MANAGE_MEMBERS),
  handler(async (req, res) => {
    const member = await projects.addMember(req.projectContext, req.body);
    res.status(201).json({ member });
  })
);

router.delete(
  '/:projectId/members/:userId',
  handler(withProject),
  permit(P.PROJECT_MANAGE_MEMBERS),
  handler(async (req, res) => {
    const removed = await projects.removeMember(req.projectContext, req.params.userId);
    if (!removed) return res.status(404).json({ error: 'not_found' });
    res.status(204).end();
  })
);

/* ── favourites ───────────────────────────────────────────────────── */

router.put(
  '/:projectId/favorite',
  handler(withProject),
  permit(P.PROJECT_VIEW),
  handler(async (req, res) => {
    res.json(await projects.setFavorite(req.projectContext, req.body?.favorite !== false));
  })
);

/* ── history ──────────────────────────────────────────────────────── */

router.get(
  '/:projectId/activity',
  handler(withProject),
  permit(P.PROJECT_VIEW),
  handler(async (req, res) => {
    const events = await audit.feedFor({
      organizationId: organizationOf(req.user),
      projectId: req.projectContext.project.id,
      limit: Number(req.query.limit) || 50,
      before: req.query.before || null,
    });
    res.json({ events });
  })
);

export default router;
