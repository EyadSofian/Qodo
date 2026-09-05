/**
 * Qodo Projects — document routes.
 *
 * Mounted under `/api/projects/:projectId/documents`.
 *
 * Nothing here serves bytes from a guessable URL. A download is two steps:
 * ask for a link, which authorizes and mints a token good for five minutes,
 * then follow it. A link that leaks out of an email stops working rather than
 * becoming a permanent way into the project (ADR-5).
 */

import express, { Router } from 'express';
import * as documents from '../../projects/documentService.js';
import { handler } from './handler.js';
import { permit, withProject } from './guards.js';
import { PROJECT_PERMISSIONS as P } from '../../../shared/projects/permissions.js';

const router = Router({ mergeParams: true });

router.use(handler(withProject));

/* ── folders ──────────────────────────────────────────────────────── */

router.get(
  '/folders',
  permit(P.DOCUMENT_VIEW),
  handler(async (req, res) => {
    res.json({ folders: await documents.folders(req.projectContext) });
  })
);

router.post(
  '/folders',
  permit(P.DOCUMENT_UPLOAD),
  handler(async (req, res) => {
    res.status(201).json({ folder: await documents.createFolder(req.projectContext, req.body) });
  })
);

/* ── files ────────────────────────────────────────────────────────── */

router.get(
  '/',
  permit(P.DOCUMENT_VIEW),
  handler(async (req, res) => {
    const folderId = req.query.folderId === 'none' ? null : req.query.folderId || undefined;
    res.json({
      files: await documents.list(req.projectContext, {
        folderId,
        limit: req.query.limit,
        offset: req.query.offset,
      }),
    });
  })
);

/**
 * Upload.
 *
 * Raw bytes with the name and type in headers, matching the pattern
 * `src/lib/api.ts` already uses — a multipart body would mean the JSON parser
 * eating a `.json` document on the way in.
 */
router.post(
  '/',
  permit(P.DOCUMENT_UPLOAD),
  express.raw({ type: () => true, limit: documents.MAX_DOCUMENT_BYTES }),
  handler(async (req, res) => {
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const result = await documents.upload(req.projectContext, {
      fileId: req.get('x-file-id') || undefined,
      name: decodeURIComponent(req.get('x-file-name') || 'file'),
      mimeType: req.get('x-file-type') || 'application/octet-stream',
      bytes,
      notes: req.get('x-file-notes') || '',
      folderId: req.get('x-folder-id') || null,
      isExternal: req.get('x-file-external') === '1',
    });
    res.status(201).json({ file: result });
  })
);

router.get(
  '/:fileId',
  permit(P.DOCUMENT_VIEW),
  handler(async (req, res) => {
    const file = await documents.get(req.projectContext, req.params.fileId);
    if (!file) return res.status(404).json({ error: 'not_found' });
    res.json({ file });
  })
);

/**
 * Ask for a download link.
 *
 * Authorization happens here, once, and the answer is a token that expires. The
 * token carries the asker's id, so passing it on does not pass on the access.
 */
router.post(
  '/:fileId/link',
  permit(P.DOCUMENT_VIEW),
  handler(async (req, res) => {
    const file = await documents.get(req.projectContext, req.params.fileId);
    if (!file) return res.status(404).json({ error: 'not_found' });

    const versionNo = Number(req.body?.versionNo) || file.currentVersion;
    const token = documents.signDownload(req.user.id, file.id, versionNo);

    res.json({
      url: `/api/projects/${req.projectContext.project.id}/documents/${file.id}/download?token=${token}`,
      expiresInSeconds: 300,
    });
  })
);

/**
 * Follow the link.
 *
 * The token is checked *and* the record is re-read through the same authorized
 * path a listing uses — a token is a time limit, not a substitute for the
 * permission check.
 */
router.get(
  '/:fileId/download',
  permit(P.DOCUMENT_VIEW),
  handler(async (req, res) => {
    const claim = documents.verifyDownload(req.query.token, req.user.id);
    if (!claim || claim.fileId !== req.params.fileId) {
      return res.status(403).json({ error: 'link_expired' });
    }

    const result = await documents.download(req.projectContext, req.params.fileId, claim.versionNo);
    if (!result) return res.status(404).json({ error: 'not_found' });

    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Length', String(result.sizeBytes));
    // `attachment` always. Rendering a project document inline would make any
    // uploaded HTML a same-origin script in the workspace.
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(result.name)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(result.bytes);
  })
);

router.post(
  '/:fileId/versions/:versionNo/restore',
  permit(P.DOCUMENT_UPLOAD),
  handler(async (req, res) => {
    const restored = await documents.restoreVersion(
      req.projectContext,
      req.params.fileId,
      Number(req.params.versionNo)
    );
    if (!restored) return res.status(404).json({ error: 'not_found' });
    res.json({ file: restored });
  })
);

router.delete(
  '/:fileId',
  permit(P.DOCUMENT_DELETE),
  handler(async (req, res) => {
    const removed = await documents.remove(req.projectContext, req.params.fileId);
    if (!removed) return res.status(404).json({ error: 'not_found' });
    res.status(204).end();
  })
);

export default router;
