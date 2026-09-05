/**
 * Qodo Projects — comments, forums and pages.
 *
 * Mounted under `/api/projects/:projectId`. Comments are polymorphic, so the
 * route carries the entity type and id rather than there being one comment
 * router per module.
 */

import { Router } from 'express';
import * as collaboration from '../../projects/collaborationService.js';
import { handler } from './handler.js';
import { permit, withProject } from './guards.js';
import { PROJECT_PERMISSIONS as P } from '../../../shared/projects/permissions.js';

/**
 * Three routers rather than one mounted three times.
 *
 * They share this file because they share a project, a client boundary and a
 * mention parser — but they get their own path spaces, so a page whose route is
 * `/:pageId` can never be shadowed by a forum route that happens to have the
 * same shape.
 */
export const commentRoutes = Router({ mergeParams: true });
export const forumRoutes = Router({ mergeParams: true });
export const pageRoutes = Router({ mergeParams: true });

for (const router of [commentRoutes, forumRoutes, pageRoutes]) {
  router.use(handler(withProject));
}

/**
 * The entity types a comment may hang off.
 *
 * A closed set: without it, `entityType` is a free-text column somebody can
 * fill with anything, and a comment on `users:u-alice` would be a comment on a
 * record this module does not authorize.
 */
const COMMENTABLE = new Set(['task', 'issue', 'phase', 'task_list', 'document', 'project']);

/* ── comments ─────────────────────────────────────────────────────── */

commentRoutes.get(
  '/:entityType/:entityId',
  permit(P.PROJECT_VIEW),
  handler(async (req, res) => {
    if (!COMMENTABLE.has(req.params.entityType)) {
      return res.status(400).json({ error: 'entity_type_invalid' });
    }
    res.json({
      comments: await collaboration.comments(
        req.projectContext,
        req.params.entityType,
        req.params.entityId,
        { limit: req.query.limit }
      ),
    });
  })
);

commentRoutes.post(
  '/:entityType/:entityId',
  permit(P.COMMENT_CREATE),
  handler(async (req, res) => {
    if (!COMMENTABLE.has(req.params.entityType)) {
      return res.status(400).json({ error: 'entity_type_invalid' });
    }
    res.status(201).json({
      comment: await collaboration.addComment(
        req.projectContext,
        req.params.entityType,
        req.params.entityId,
        req.body
      ),
    });
  })
);

commentRoutes.patch(
  '/:commentId',
  permit(P.COMMENT_CREATE),
  handler(async (req, res) => {
    const comment = await collaboration.editComment(req.projectContext, req.params.commentId, req.body?.body);
    if (!comment) return res.status(404).json({ error: 'not_found' });
    res.json({ comment });
  })
);

commentRoutes.delete(
  '/:commentId',
  permit(P.COMMENT_CREATE),
  handler(async (req, res) => {
    const removed = await collaboration.deleteComment(req.projectContext, req.params.commentId);
    if (!removed) return res.status(404).json({ error: 'not_found' });
    res.status(204).end();
  })
);

commentRoutes.put(
  '/:commentId/reactions',
  permit(P.COMMENT_CREATE),
  handler(async (req, res) => {
    res.json(await collaboration.react(req.projectContext, req.params.commentId, req.body?.emoji));
  })
);

/* ── forums ───────────────────────────────────────────────────────── */

forumRoutes.get(
  '/topics',
  permit(P.FORUM_VIEW),
  handler(async (req, res) => {
    res.json({ topics: await collaboration.topics(req.projectContext, { limit: req.query.limit }) });
  })
);

forumRoutes.post(
  '/topics',
  permit(P.FORUM_POST),
  handler(async (req, res) => {
    res.status(201).json({ topic: await collaboration.createTopic(req.projectContext, req.body) });
  })
);

forumRoutes.get(
  '/topics/:topicId',
  permit(P.FORUM_VIEW),
  handler(async (req, res) => {
    const topic = await collaboration.topicWithPosts(req.projectContext, req.params.topicId);
    if (!topic) return res.status(404).json({ error: 'not_found' });
    res.json({ topic });
  })
);

forumRoutes.post(
  '/topics/:topicId/replies',
  permit(P.FORUM_POST),
  handler(async (req, res) => {
    const post = await collaboration.reply(req.projectContext, req.params.topicId, req.body?.body);
    if (!post) return res.status(404).json({ error: 'not_found' });
    res.status(201).json({ post });
  })
);

/* ── pages ────────────────────────────────────────────────────────── */

pageRoutes.get(
  '/',
  permit(P.PAGE_VIEW),
  handler(async (req, res) => {
    res.json({ pages: await collaboration.pages(req.projectContext) });
  })
);

pageRoutes.post(
  '/',
  permit(P.PAGE_EDIT),
  handler(async (req, res) => {
    res.status(201).json({ page: await collaboration.createPage(req.projectContext, req.body) });
  })
);

pageRoutes.get(
  '/:pageId',
  permit(P.PAGE_VIEW),
  handler(async (req, res) => {
    const page = await collaboration.page(req.projectContext, req.params.pageId);
    if (!page) return res.status(404).json({ error: 'not_found' });
    res.json({ page });
  })
);

pageRoutes.patch(
  '/:pageId',
  permit(P.PAGE_EDIT),
  handler(async (req, res) => {
    const page = await collaboration.updatePage(req.projectContext, req.params.pageId, req.body);
    if (!page) return res.status(404).json({ error: 'not_found' });
    res.json({ page });
  })
);

pageRoutes.get(
  '/:pageId/revisions',
  permit(P.PAGE_VIEW),
  handler(async (req, res) => {
    res.json({ revisions: await collaboration.pageRevisions(req.projectContext, req.params.pageId) });
  })
);

pageRoutes.post(
  '/:pageId/revisions/:revisionNo/restore',
  permit(P.PAGE_EDIT),
  handler(async (req, res) => {
    const page = await collaboration.restorePageRevision(
      req.projectContext,
      req.params.pageId,
      Number(req.params.revisionNo)
    );
    if (!page) return res.status(404).json({ error: 'not_found' });
    res.json({ page });
  })
);
