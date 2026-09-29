/**
 * E-Learning Production — the HTTP layer.
 *
 * Mounted at /api/learning-production. Routes parse and delegate; the services
 * authorize, validate and decide. Every refusal leaves here in one shape:
 *
 *   { "error": { "code": "…", "message": "…", "details": {} } }
 */

import express, { Router } from 'express';
import { requireAuth } from '../../auth.js';
import { isAvailable, unavailableBody } from '../../learningProduction/db.js';
import { actorFor } from '../../learningProduction/access.js';
import { messageFor, notFound, toResponse } from '../../learningProduction/errors.js';
import { parseRange } from '../../learningProduction/blobs.js';
import { largestUploadLimit, uploadLimit } from '../../learningProduction/fileTypes.js';
import { pathId } from '../../learningProduction/validate.js';
import * as courses from '../../learningProduction/services/courseService.js';
import * as lessons from '../../learningProduction/services/lessonService.js';
import * as assets from '../../learningProduction/services/assetService.js';
import * as comments from '../../learningProduction/services/commentService.js';
import * as tools from '../../learningProduction/services/reviewToolsService.js';
import * as team from '../../learningProduction/services/teamService.js';
import * as insights from '../../learningProduction/services/insightsService.js';
import * as templates from '../../learningProduction/services/templateService.js';
import * as runs from '../../learningProduction/services/runService.js';
import * as tasks from '../../learningProduction/services/taskService.js';
import * as issues from '../../learningProduction/services/issueService.js';
import * as releases from '../../learningProduction/services/releaseService.js';
import * as impact from '../../learningProduction/services/impactService.js';
import * as experts from '../../learningProduction/services/expertService.js';
import * as work from '../../learningProduction/services/workService.js';

const router = Router();

function serverError(req, res, error) {
  console.error('[learning-production]', req.method, req.originalUrl, error);
  res.status(500).json({ error: { code: 'SERVER_ERROR', message: messageFor('SERVER_ERROR'), details: {} } });
}

function handler(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (error) {
      const response = toResponse(error);
      if (response) return res.status(response.status).json(response.body);
      serverError(req, res, error);
    }
  };
}

const json = (fn, status = 200) => handler(async (req, res) => res.status(status).json(await fn(req)));

/**
 * Body-parser failures for this prefix: a malformed body is the caller's
 * mistake, not a server fault, and a body over the limit is a size problem.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
export function learningProductionBodyErrors(error, req, res, _next) {
  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: messageFor('VALIDATION_FAILED'), details: { rule: 'invalid_json' } } });
  }
  const response = toResponse(error);
  if (response) return res.status(response.status).json(response.body);
  serverError(req, res, error);
}

const rawUpload = express.raw({ type: 'application/octet-stream', limit: largestUploadLimit() });
const rawCover = express.raw({ type: 'application/octet-stream', limit: uploadLimit('COVER') });
const rawEvidence = express.raw({ type: 'application/octet-stream', limit: uploadLimit('EVIDENCE') });

function headerText(req, name) {
  const value = req.get(name);
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function fileInput(req) {
  return {
    bytes: Buffer.isBuffer(req.body) ? req.body : null,
    fileName: headerText(req, 'x-file-name') ?? 'file',
    notes: headerText(req, 'x-version-notes'),
    durationSeconds: req.get('x-duration-seconds'),
    aiAssisted: req.get('x-ai-assisted'),
    aiTool: headerText(req, 'x-ai-tool'),
  };
}

/** Send a stored file after the service authorized it. Documents download; media plays in place. */
function sendFile(res, file, { download = false } = {}) {
  const inline = !download && /^(application\/pdf$|audio\/|video\/|image\/(png|jpeg|webp)$)/.test(file.mimeType ?? '');
  res.set({
    'Content-Type': inline ? file.mimeType : 'application/octet-stream',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.fileName ?? 'file')}`,
    'Cache-Control': 'private, max-age=300',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Content-Length': String(file.bytes.length),
  });
  res.end(file.bytes);
}

function userParam(value) {
  if (typeof value !== 'string' || !value || value.length > 120) throw notFound();
  return value;
}

const id = (req, name) => pathId(req.params[name]);

router.use(requireAuth);
router.use((req, res, next) => {
  if (!isAvailable()) return res.status(503).json(unavailableBody());
  req.actor = actorFor(req.user);
  next();
});

/* ── the module ───────────────────────────────────────────────────── */

router.get('/me', json((req) => insights.me(req.actor)));
router.get('/dashboard/summary', json((req) => insights.dashboard(req.actor)));
router.get('/dashboard/attention', json((req) => insights.attention(req.actor, req.query.kind)));
router.get('/my-work', json((req) => insights.myWork(req.actor)));
router.get('/reviews', json((req) => insights.reviewQueue(req.actor, req.query)));
router.get('/reports', json((req) => insights.reports(req.actor, req.query)));
router.get('/search', json((req) => insights.search(req.actor, req.query.q)));
router.get('/people', json((req) => team.assignablePeople(req.actor, req.query.q)));

/* ── courses ──────────────────────────────────────────────────────── */

router.get('/courses', json((req) => courses.listCourses(req.actor, req.query)));
router.post('/courses', json((req) => courses.createCourse(req.actor, req.body), 201));
router.get(
  '/courses/:courseId',
  json((req) => courses.getCourse(req.actor, id(req, 'courseId'), { includeArchived: req.query.archived === '1' }))
);
router.patch('/courses/:courseId', json((req) => courses.updateCourse(req.actor, id(req, 'courseId'), req.body)));
router.delete('/courses/:courseId', json((req) => courses.archiveCourse(req.actor, id(req, 'courseId'))));
router.post('/courses/:courseId/archive', json((req) => courses.archiveCourse(req.actor, id(req, 'courseId'))));
router.post('/courses/:courseId/restore', json((req) => courses.restoreCourse(req.actor, id(req, 'courseId'))));
router.put('/courses/:courseId/settings', json((req) => courses.updateSettings(req.actor, id(req, 'courseId'), req.body)));
router.put('/courses/:courseId/defaults', json((req) => courses.updateProductionDefaults(req.actor, id(req, 'courseId'), req.body)));
router.put(
  '/courses/:courseId/cover',
  rawCover,
  json((req) => courses.setCover(req.actor, id(req, 'courseId'), fileInput(req)))
);
router.get(
  '/courses/:courseId/cover',
  handler(async (req, res) => {
    const cover = await courses.coverFile(req.actor, id(req, 'courseId'));
    if (!cover) throw notFound();
    res.set({ 'Content-Type': cover.mimeType, 'Cache-Control': 'private, max-age=600', 'X-Content-Type-Options': 'nosniff' });
    res.end(cover.bytes);
  })
);

router.get('/courses/:courseId/production-matrix', json((req) => lessons.productionMatrix(req.actor, id(req, 'courseId'))));
router.get(
  '/courses/:courseId/lessons',
  json((req) =>
    req.query.archived === '1'
      ? lessons.archivedLessons(req.actor, id(req, 'courseId'))
      : lessons.productionMatrix(req.actor, id(req, 'courseId'))
  )
);
router.post('/courses/:courseId/lessons', json((req) => lessons.createLessons(req.actor, id(req, 'courseId'), req.body), 201));
router.post('/courses/:courseId/lessons/reorder', json((req) => lessons.reorderLessons(req.actor, id(req, 'courseId'), req.body)));
router.post('/courses/:courseId/lessons/move', json((req) => lessons.moveLessons(req.actor, id(req, 'courseId'), req.body)));
router.post('/courses/:courseId/lessons/archive', json((req) => lessons.archiveLessons(req.actor, id(req, 'courseId'), req.body)));
router.post('/courses/:courseId/modules', json((req) => lessons.createModule(req.actor, id(req, 'courseId'), req.body), 201));
router.post('/courses/:courseId/modules/reorder', json((req) => lessons.reorderModules(req.actor, id(req, 'courseId'), req.body)));
router.post('/courses/:courseId/assets/bulk-assign', json((req) => assets.bulkAssign(req.actor, id(req, 'courseId'), req.body)));

router.get('/courses/:courseId/team', json((req) => team.listTeam(req.actor, id(req, 'courseId'))));
router.put(
  '/courses/:courseId/team/:userId',
  json((req) => team.saveMember(req.actor, id(req, 'courseId'), userParam(req.params.userId), req.body))
);
router.delete(
  '/courses/:courseId/team/:userId',
  json((req) => team.removeMember(req.actor, id(req, 'courseId'), userParam(req.params.userId)))
);

router.get('/courses/:courseId/files', json((req) => insights.courseFiles(req.actor, id(req, 'courseId'), req.query)));
router.get('/courses/:courseId/activity', json((req) => insights.courseActivity(req.actor, id(req, 'courseId'), req.query)));
router.get(
  '/courses/:courseId/checklist-template',
  json((req) => tools.checklistTemplate(req.actor, id(req, 'courseId'), req.query.assetType))
);
router.put(
  '/courses/:courseId/checklist-template',
  json((req) => tools.saveChecklistTemplate(req.actor, id(req, 'courseId'), req.query.assetType ?? 'VIDEO', req.body))
);

/* ── modules and lessons ──────────────────────────────────────────── */

router.patch('/modules/:moduleId', json((req) => lessons.updateModule(req.actor, id(req, 'moduleId'), req.body)));
router.delete('/modules/:moduleId', json((req) => lessons.archiveModule(req.actor, id(req, 'moduleId'))));

router.get('/lessons/:lessonId', json((req) => lessons.getLesson(req.actor, id(req, 'lessonId'))));
router.get(
  '/lessons/:lessonId/assets',
  json(async (req) => {
    const lesson = await lessons.getLesson(req.actor, id(req, 'lessonId'));
    return { assets: lesson.assets, people: lesson.people };
  })
);
/** The five assets with the little of each one's content a card can draw. */
router.get('/lessons/:lessonId/asset-board', json((req) => lessons.assetBoard(req.actor, id(req, 'lessonId'))));
router.patch('/lessons/:lessonId', json((req) => lessons.updateLesson(req.actor, id(req, 'lessonId'), req.body)));
router.post('/lessons/:lessonId/duplicate', json((req) => lessons.duplicateLesson(req.actor, id(req, 'lessonId'), req.body), 201));
router.post('/lessons/:lessonId/archive', json((req) => lessons.archiveLesson(req.actor, id(req, 'lessonId'))));
router.post('/lessons/:lessonId/restore', json((req) => lessons.restoreLesson(req.actor, id(req, 'lessonId'))));

/* ── assets: the workflow ─────────────────────────────────────────── */

router.get('/assets/:assetId', json((req) => assets.getAsset(req.actor, id(req, 'assetId'))));
router.patch('/assets/:assetId', json((req) => assets.assign(req.actor, id(req, 'assetId'), req.body)));
router.post('/assets/:assetId/start', json((req) => assets.start(req.actor, id(req, 'assetId'))));
router.post('/assets/:assetId/start-revision', json((req) => assets.startRevision(req.actor, id(req, 'assetId'))));
router.put('/assets/:assetId/draft', json((req) => assets.saveDraft(req.actor, id(req, 'assetId'), req.body)));
router.post('/assets/:assetId/submit', json((req) => assets.submit(req.actor, id(req, 'assetId'), req.body)));
router.post('/assets/:assetId/start-review', json((req) => assets.startReview(req.actor, id(req, 'assetId'))));
router.post('/assets/:assetId/request-changes', json((req) => assets.requestChanges(req.actor, id(req, 'assetId'), req.body)));
router.post('/assets/:assetId/approve', json((req) => assets.approve(req.actor, id(req, 'assetId'), req.body)));
router.post('/assets/:assetId/reopen', json((req) => assets.reopen(req.actor, id(req, 'assetId'), req.body)));
router.post('/assets/:assetId/lock', json((req) => assets.lock(req.actor, id(req, 'assetId'))));
router.post(
  '/assets/:assetId/override-dependency',
  json((req) => assets.overrideDependency(req.actor, id(req, 'assetId'), req.body))
);

router.get(
  '/assets/:assetId/versions',
  json(async (req) => {
    const asset = await assets.getAsset(req.actor, id(req, 'assetId'));
    return { versions: asset.versions, approvals: asset.approvals, people: asset.people };
  })
);
/** A file (raw bytes, name and notes in headers) or a link (JSON). Never replaces a version. */
router.post(
  '/assets/:assetId/versions',
  rawUpload,
  json(
    (req) =>
      assets.uploadVersion(
        req.actor,
        id(req, 'assetId'),
        Buffer.isBuffer(req.body)
          ? fileInput(req)
          : {
              externalUrl: req.body?.externalUrl,
              notes: req.body?.notes,
              durationSeconds: req.body?.durationSeconds,
              aiAssisted: req.body?.aiAssisted,
              aiTool: req.body?.aiTool,
            }
      ),
    201
  )
);

router.get('/assets/:assetId/comments', json((req) => comments.listComments(req.actor, id(req, 'assetId'))));
router.post('/assets/:assetId/comments', json((req) => comments.createComment(req.actor, id(req, 'assetId'), req.body), 201));
router.get('/assets/:assetId/activity', json((req) => insights.assetActivity(req.actor, id(req, 'assetId'), req.query)));

/* ── versions ─────────────────────────────────────────────────────── */

router.get('/versions/:versionId', json((req) => assets.getVersion(req.actor, id(req, 'versionId'))));

const INLINE = /^(application\/pdf$|audio\/|video\/|image\/(png|jpeg|webp)$)/;

/**
 * The bytes of a version, authorized on every request. Supports single byte
 * ranges, because an audio or video element seeks by asking for them.
 */
router.get(
  '/versions/:versionId/file',
  handler(async (req, res) => {
    const file = await assets.versionFile(req.actor, id(req, 'versionId'), req.query.variant === 'preview' ? 'preview' : 'original');
    if (!file) throw notFound();
    const size = file.bytes.length;
    const inline = INLINE.test(file.mimeType ?? '') && req.query.download !== '1';
    res.set({
      'Content-Type': inline ? file.mimeType : 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.fileName ?? 'file')}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    const range = parseRange(req.get('range'), size);
    if (range === 'invalid') return res.status(416).set('Content-Range', `bytes */${size}`).end();
    if (range) {
      res.status(206).set({ 'Content-Range': `bytes ${range.start}-${range.end}/${size}`, 'Content-Length': String(range.end - range.start + 1) });
      return res.end(file.bytes.subarray(range.start, range.end + 1));
    }
    res.set('Content-Length', String(size));
    return res.end(file.bytes);
  })
);

router.put('/versions/:versionId/preview', rawUpload, json((req) => assets.attachPreview(req.actor, id(req, 'versionId'), fileInput(req))));

router.get('/versions/:versionId/annotations', json((req) => comments.versionPositions(req.actor, id(req, 'versionId'), 'annotations')));
router.post(
  '/versions/:versionId/annotations',
  json((req) => comments.createVersionComment(req.actor, id(req, 'versionId'), 'ANNOTATION', req.body), 201)
);
router.patch('/annotations/:annotationId', json((req) => comments.updateAnnotation(req.actor, id(req, 'annotationId'), req.body)));
router.delete('/annotations/:annotationId', json((req) => comments.deleteAnnotation(req.actor, id(req, 'annotationId'))));

router.get('/versions/:versionId/audio-markers', json((req) => comments.versionPositions(req.actor, id(req, 'versionId'), 'audio')));
router.post(
  '/versions/:versionId/audio-markers',
  json((req) => comments.createVersionComment(req.actor, id(req, 'versionId'), 'AUDIO_TIMESTAMP', req.body), 201)
);
router.get('/versions/:versionId/video-markers', json((req) => comments.versionPositions(req.actor, id(req, 'versionId'), 'video')));
router.post(
  '/versions/:versionId/video-markers',
  json((req) => comments.createVersionComment(req.actor, id(req, 'versionId'), 'VIDEO_TIMESTAMP', req.body), 201)
);

router.get('/versions/:versionId/checklist', json((req) => tools.versionChecklist(req.actor, id(req, 'versionId'))));
router.patch('/checklist-items/:itemId', json((req) => tools.updateChecklistItem(req.actor, id(req, 'itemId'), req.body)));
router.get('/versions/:versionId/transcript', json((req) => tools.getTranscript(req.actor, id(req, 'versionId'))));
router.put('/versions/:versionId/transcript', json((req) => tools.saveTranscript(req.actor, id(req, 'versionId'), req.body)));

/* ── comments ─────────────────────────────────────────────────────── */

router.patch('/comments/:commentId', json((req) => comments.editComment(req.actor, id(req, 'commentId'), req.body)));
router.post('/comments/:commentId/resolve', json((req) => comments.resolveComment(req.actor, id(req, 'commentId'))));
router.post('/comments/:commentId/reopen', json((req) => comments.reopenComment(req.actor, id(req, 'commentId'))));
router.post('/comments/:commentId/apply-suggestion', json((req) => comments.applySuggestion(req.actor, id(req, 'commentId'))));

/* ── production runs ──────────────────────────────────────────────── */

router.get('/work', json((req) => work.myWork(req.actor)));
router.get('/review-queue', json((req) => work.reviews(req.actor, req.query)));
router.get('/portfolio', json((req) => work.portfolio(req.actor)));
router.get('/notification-preferences', json((req) => work.getPreferences(req.actor)));
router.put('/notification-preferences', json((req) => work.savePreferences(req.actor, req.body)));

router.get('/templates', json((req) => templates.listTemplates(req.actor)));
router.post('/templates/preview', json((req) => templates.previewTemplate(req.actor, req.body)));
router.post('/templates/versions', json((req) => templates.publishTemplateVersion(req.actor, req.body), 201));
router.get('/templates/versions/:versionId', json((req) => templates.getTemplateVersion(req.actor, id(req, 'versionId'))));
router.get('/traceability', json(() => templates.traceability()));

router.post('/runs', json((req) => runs.createRun(req.actor, req.body), 201));
router.get('/courses/:courseId/runs', json((req) => runs.listRuns(req.actor, id(req, 'courseId'))));
router.get('/runs/:runId', json((req) => runs.getRun(req.actor, id(req, 'runId'))));
router.patch('/runs/:runId', json((req) => runs.updateRun(req.actor, id(req, 'runId'), req.body)));
router.post('/runs/:runId/adopt', json((req) => runs.adoptTemplate(req.actor, id(req, 'runId'), req.body)));
router.get('/runs/:runId/team', json((req) => runs.listRunTeam(req.actor, id(req, 'runId'))));
router.put('/runs/:runId/team/:userId', json((req) => runs.saveRunMember(req.actor, id(req, 'runId'), userParam(req.params.userId), req.body)));
router.delete('/runs/:runId/team/:userId', json((req) => runs.removeRunMember(req.actor, id(req, 'runId'), userParam(req.params.userId))));
router.post('/stages/:stageId/skip', json((req) => runs.skipStage(req.actor, id(req, 'stageId'), req.body)));
router.post('/stages/:stageId/unskip', json((req) => runs.unskipStage(req.actor, id(req, 'stageId'))));

router.get('/tasks/:taskId', json((req) => tasks.getTask(req.actor, id(req, 'taskId'))));
router.patch('/tasks/:taskId', json((req) => tasks.assignTask(req.actor, id(req, 'taskId'), req.body)));
router.post('/tasks/:taskId/start', json((req) => tasks.startTask(req.actor, id(req, 'taskId'))));
router.post('/tasks/:taskId/submit', json((req) => tasks.submitTask(req.actor, id(req, 'taskId'), req.body)));
router.post('/tasks/:taskId/complete', json((req) => tasks.completeTask(req.actor, id(req, 'taskId'), req.body)));
router.post('/tasks/:taskId/start-review', json((req) => tasks.startTaskReview(req.actor, id(req, 'taskId'))));
router.post('/tasks/:taskId/request-changes', json((req) => tasks.requestTaskChanges(req.actor, id(req, 'taskId'), req.body)));
router.post('/tasks/:taskId/approve', json((req) => tasks.approveTask(req.actor, id(req, 'taskId'), req.body)));
router.post('/tasks/:taskId/waive', json((req) => tasks.waiveTask(req.actor, id(req, 'taskId'), req.body)));
router.post('/tasks/:taskId/reopen', json((req) => tasks.reopenTask(req.actor, id(req, 'taskId'), req.body)));
router.post('/tasks/:taskId/override-dependency', json((req) => tasks.overrideTaskDependency(req.actor, id(req, 'taskId'), req.body)));
router.post('/tasks/:taskId/comments', json((req) => tasks.addTaskComment(req.actor, id(req, 'taskId'), req.body), 201));
/** Evidence: a file (raw bytes, name and note in headers) or a link or note (JSON). Never replaces earlier evidence. */
router.post(
  '/tasks/:taskId/evidence',
  rawEvidence,
  json(
    (req) =>
      tasks.addEvidence(
        req.actor,
        id(req, 'taskId'),
        Buffer.isBuffer(req.body)
          ? { bytes: req.body, fileName: headerText(req, 'x-file-name') ?? 'file', note: headerText(req, 'x-evidence-note') }
          : { url: req.body?.url, note: req.body?.note }
      ),
    201
  )
);
router.post('/evidence/:evidenceId/withdraw', json((req) => tasks.withdrawEvidence(req.actor, id(req, 'evidenceId'), req.body)));
router.get(
  '/evidence/:evidenceId/file',
  handler(async (req, res) => sendFile(res, await tasks.evidenceFile(req.actor, id(req, 'evidenceId')), { download: req.query.download === '1' }))
);
router.patch('/task-checklist-items/:itemId', json((req) => tasks.updateChecklistItem(req.actor, id(req, 'itemId'), req.body)));

router.get('/runs/:runId/issues', json((req) => issues.listIssues(req.actor, id(req, 'runId'), req.query)));
router.post('/runs/:runId/issues', json((req) => issues.createIssue(req.actor, id(req, 'runId'), req.body), 201));
router.get('/issues/:issueId', json((req) => issues.getIssue(req.actor, id(req, 'issueId'))));
router.patch('/issues/:issueId', json((req) => issues.updateIssue(req.actor, id(req, 'issueId'), req.body)));
for (const action of ['start', 'fix', 'verify', 'reopen', 'wont-fix']) {
  router.post(`/issues/:issueId/${action}`, json((req) => issues.transitionIssue(req.actor, id(req, 'issueId'), action, req.body)));
}

router.get('/courses/:courseId/releases', json((req) => releases.listReleases(req.actor, id(req, 'courseId'))));
router.post('/runs/:runId/releases', json((req) => releases.prepareRelease(req.actor, id(req, 'runId'), req.body), 201));
router.get('/releases/:releaseId', json((req) => releases.getRelease(req.actor, id(req, 'releaseId'))));
router.post('/releases/:releaseId/signoff', json((req) => releases.signoffRelease(req.actor, id(req, 'releaseId'), req.body)));
router.post('/releases/:releaseId/publish', json((req) => releases.publishRelease(req.actor, id(req, 'releaseId'), req.body)));
router.post('/releases/:releaseId/withdraw', json((req) => releases.withdrawRelease(req.actor, id(req, 'releaseId'), req.body)));
router.post('/releases/:releaseId/rollback', json((req) => releases.rollbackRelease(req.actor, id(req, 'releaseId'), req.body)));

router.get('/runs/:runId/impact', json((req) => impact.getImpact(req.actor, id(req, 'runId'))));
router.put('/runs/:runId/impact', json((req) => impact.saveImpact(req.actor, id(req, 'runId'), req.body)));
router.post('/runs/:runId/impact/apply', json((req) => impact.applyImpact(req.actor, id(req, 'runId'))));

router.get('/runs/:runId/candidates', json((req) => experts.listCandidates(req.actor, id(req, 'runId'))));
router.post('/runs/:runId/candidates', json((req) => experts.createCandidate(req.actor, id(req, 'runId'), req.body), 201));
router.patch('/candidates/:candidateId', json((req) => experts.updateCandidate(req.actor, id(req, 'candidateId'), req.body)));
router.post(
  '/candidates/:candidateId/files',
  rawEvidence,
  json(
    (req) =>
      experts.addCandidateFile(req.actor, id(req, 'candidateId'), {
        bytes: Buffer.isBuffer(req.body) ? req.body : null,
        fileName: headerText(req, 'x-file-name') ?? 'file',
        kind: req.get('x-file-kind'),
      }),
    201
  )
);
router.get(
  '/candidate-files/:fileId',
  handler(async (req, res) => sendFile(res, await experts.candidateFile(req.actor, id(req, 'fileId')), { download: req.query.download === '1' }))
);

router.post('/lessons/:lessonId/assets', json((req) => assets.addLessonAsset(req.actor, id(req, 'lessonId'), req.body), 201));
router.post('/assets/:assetId/applicability', json((req) => assets.setApplicability(req.actor, id(req, 'assetId'), req.body)));

/* ── the rest ─────────────────────────────────────────────────────── */

router.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: messageFor('NOT_FOUND'), details: {} } }));
router.use(learningProductionBodyErrors);

export default router;
