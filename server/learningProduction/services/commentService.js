/**
 * Review feedback: comments, replies, text anchors, suggestions, slide pins
 * and drawings, audio timestamps, and video timestamps with frame drawings.
 *
 * One comment table for every kind of feedback, so "3 open comments" means the
 * same thing on every stage. The position a comment was left at — a shape on
 * slide 4, a range from 01:32 to 01:39 — lives in its own table beside it.
 *
 * Nothing here is ever deleted. A resolved comment stays in the history of the
 * version it was left on; an annotation removed by its author is archived.
 */

import {
  ANNOTATION_TYPES,
  COMMENT_TYPES,
  OUTLINE_SECTIONS,
} from '../../../shared/learningProduction/constants.js';
import { SCRIPT_BLOCK_FIELDS, annotationGeometryError, locateQuote, normalizeContent } from '../../../shared/learningProduction/review.js';
import { SCHEMA as S, direct, transaction } from '../db.js';
import { canComment } from '../access.js';
import { record } from '../activity.js';
import { WINDOW, assetLink, flush } from '../notifications.js';
import { conflict, forbidden, notFound, validation, workflowRefusal } from '../errors.js';
import { mapComment } from '../mappers.js';
import { peopleFor, userIdsIn } from '../people.js';
import { bodyId, integer, oneOf, plainObject, seconds, text } from '../validate.js';
import { assetContext, canResolveComments, contentState, evaluate } from './context.js';
import { beginWork } from './assetService.js';

const COMMENT_SELECT = `
  SELECT c.*, v.version_number,
         an.id AS annotation_id, an.page_number, an.annotation_type, an.x AS an_x, an.y AS an_y,
         an.width AS an_width, an.height AS an_height, an.metadata_json AS an_metadata, an.created_by AS an_created_by,
         am.id AS audio_marker_id, am.start_seconds AS audio_start, am.end_seconds AS audio_end,
         vm.id AS video_marker_id, vm.start_seconds AS video_start, vm.end_seconds AS video_end,
         vm.frame_timestamp, vm.annotation_json AS video_annotation
    FROM ${S}.learning_comments c
    LEFT JOIN ${S}.learning_asset_versions v ON v.id = c.version_id
    LEFT JOIN ${S}.learning_annotations an ON an.comment_id = c.id AND an.deleted_at IS NULL
    LEFT JOIN ${S}.learning_audio_markers am ON am.comment_id = c.id
    LEFT JOIN ${S}.learning_video_markers vm ON vm.comment_id = c.id`;

const COLORS = ['#DC2626', '#F5821F', '#1D6FB8', '#16A34A', '#0B2545', '#7C3AED'];

function threads(rows) {
  const top = [];
  const byId = new Map();
  for (const r of rows) {
    const comment = { ...mapComment(r), replies: [] };
    byId.set(comment.id, comment);
    if (!comment.parentCommentId) top.push(comment);
  }
  for (const comment of byId.values()) {
    if (comment.parentCommentId) byId.get(comment.parentCommentId)?.replies.push(comment);
  }
  return top;
}

export async function listComments(actor, assetId) {
  const actx = await assetContext(actor, assetId);
  const found = await direct.rows(
    `${COMMENT_SELECT}
      WHERE c.asset_id = $1 AND c.organization_id = $2 AND c.deleted_at IS NULL
      ORDER BY c.created_at
      LIMIT 3000`,
    [assetId, actx.organizationId]
  );
  const comments = threads(found);
  return {
    comments,
    canComment: canComment(actx, actx.asset) && actx.asset.status !== 'LOCKED',
    canResolve: canResolveComments(actx) && actx.asset.status !== 'LOCKED',
    people: await peopleFor(userIdsIn(comments)),
  };
}

async function readComment(db, commentId, organizationId) {
  const found = await db.row(`${COMMENT_SELECT} WHERE c.id = $1 AND c.organization_id = $2`, [commentId, organizationId]);
  return found ? { ...mapComment(found), replies: [] } : null;
}

/* ------------------------------------------------------------------ */
/* Positions                                                            */
/* ------------------------------------------------------------------ */

function textAnchor(assetType, raw) {
  const anchor = plainObject(raw, 'anchor');
  const quote = text(anchor.quote, 'anchor.quote', { required: true, max: 1000, trim: false });
  const start = integer(anchor.start, 'anchor.start', { min: 0, max: 5_000_000, required: true });
  const end = integer(anchor.end, 'anchor.end', { min: start, max: 5_000_000, required: true });
  if (assetType === 'OUTLINE') {
    return { section: oneOf(anchor.section, OUTLINE_SECTIONS, 'anchor.section', { required: true }), start, end, quote };
  }
  if (assetType === 'SCRIPT') {
    return {
      blockId: text(anchor.blockId, 'anchor.blockId', { required: true, max: 64 }),
      field: oneOf(anchor.field, SCRIPT_BLOCK_FIELDS, 'anchor.field', { required: true }),
      start,
      end,
      quote,
    };
  }
  throw workflowRefusal('NOT_SUPPORTED');
}

const round6 = (value) => Math.round(Number(value) * 1e6) / 1e6;

function shape(raw, field) {
  const entry = plainObject(raw, field);
  const annotationType = oneOf(entry.annotationType, ANNOTATION_TYPES, `${field}.annotationType`, { required: true });
  const geometry = plainObject(entry.geometry, `${field}.geometry`);
  const problem = annotationGeometryError(annotationType, geometry);
  if (problem) throw validation(`${field}.geometry`, problem);
  const clean = { x: round6(geometry.x), y: round6(geometry.y) };
  if (geometry.width !== undefined) clean.width = round6(geometry.width);
  if (geometry.height !== undefined) clean.height = round6(geometry.height);
  if (Array.isArray(geometry.points)) clean.points = geometry.points.map(([x, y]) => [round6(x), round6(y)]);
  return { annotationType, geometry: clean, color: COLORS.includes(entry.color) ? entry.color : COLORS[0] };
}

function requireStage(actx, ...stages) {
  if (!stages.includes(actx.asset.assetType)) throw workflowRefusal('NOT_SUPPORTED');
}

/* ------------------------------------------------------------------ */
/* Writing                                                              */
/* ------------------------------------------------------------------ */

/**
 * Leave feedback.
 *
 * `commentType` decides which position is required: `anchor` for text,
 * `annotation` for a shape on a slide, `marker` for a moment in a voice-over or
 * a video. A reply carries only a body and inherits its thread's version.
 */
export async function createComment(actor, assetId, input) {
  const body = plainObject(input, 'body');
  const outbox = [];

  const commentId = await transaction(async (tx) => {
    const actx = await assetContext(actor, assetId, { db: tx });
    const asset = actx.asset;
    if (asset.status === 'LOCKED') throw workflowRefusal('ASSET_LOCKED');
    if (!canComment(actx, asset)) throw forbidden();

    const commentBody = text(body.body, 'body', { required: true, max: 10000 });
    const parentId = bodyId(body.parentCommentId, 'parentCommentId');
    let parent = null;
    if (parentId) {
      parent = await tx.row(
        `SELECT id, version_id, user_id FROM ${S}.learning_comments
          WHERE id = $1 AND asset_id = $2 AND parent_comment_id IS NULL AND deleted_at IS NULL`,
        [parentId, assetId]
      );
      if (!parent) throw validation('parentCommentId', 'invalid');
    }

    const commentType = parent ? 'GENERAL' : oneOf(body.commentType, COMMENT_TYPES, 'commentType', { fallback: 'GENERAL' });
    let versionId = parent ? parent.version_id : bodyId(body.versionId, 'versionId') ?? asset.currentVersionId;
    if (versionId) {
      const version = await tx.row(`SELECT id FROM ${S}.learning_asset_versions WHERE id = $1 AND asset_id = $2`, [versionId, assetId]);
      if (!version) throw validation('versionId', 'invalid');
    }
    const needsVersion = ['SLIDE', 'ANNOTATION', 'AUDIO_TIMESTAMP', 'VIDEO_TIMESTAMP'].includes(commentType);
    if (needsVersion && !versionId) throw validation('versionId', 'required');

    let anchor = null;
    let suggestionText = null;
    let annotation = null;
    let marker = null;

    switch (commentType) {
      case 'TEXT_SELECTION':
        requireStage(actx, 'OUTLINE', 'SCRIPT');
        anchor = textAnchor(asset.assetType, body.anchor);
        break;
      case 'SUGGESTION':
        requireStage(actx, 'OUTLINE', 'SCRIPT');
        anchor = textAnchor(asset.assetType, body.anchor);
        suggestionText = text(body.suggestionText, 'suggestionText', { max: 5000, trim: false }) ?? '';
        break;
      case 'SCRIPT_BLOCK': {
        requireStage(actx, 'SCRIPT');
        const entry = plainObject(body.anchor, 'anchor');
        anchor = { blockId: text(entry.blockId, 'anchor.blockId', { required: true, max: 64 }) };
        break;
      }
      case 'SLIDE': {
        requireStage(actx, 'PPT');
        const entry = plainObject(body.anchor, 'anchor');
        anchor = { pageNumber: integer(entry.pageNumber, 'anchor.pageNumber', { min: 1, max: 5000, required: true }) };
        break;
      }
      case 'ANNOTATION': {
        requireStage(actx, 'PPT');
        const entry = plainObject(body.annotation, 'annotation');
        const pageNumber = integer(entry.pageNumber, 'annotation.pageNumber', { min: 1, max: 5000, required: true });
        annotation = { pageNumber, ...shape(entry, 'annotation') };
        anchor = { pageNumber };
        break;
      }
      case 'AUDIO_TIMESTAMP': {
        requireStage(actx, 'VOICE_OVER');
        const entry = plainObject(body.marker, 'marker');
        const startSeconds = seconds(entry.startSeconds, 'marker.startSeconds', { required: true });
        const endSeconds = seconds(entry.endSeconds, 'marker.endSeconds');
        if (endSeconds !== null && endSeconds < startSeconds) throw validation('marker.endSeconds', 'before_start');
        marker = { startSeconds, endSeconds };
        break;
      }
      case 'VIDEO_TIMESTAMP': {
        requireStage(actx, 'VIDEO');
        const entry = plainObject(body.marker, 'marker');
        const startSeconds = seconds(entry.startSeconds, 'marker.startSeconds', { required: true });
        const endSeconds = seconds(entry.endSeconds, 'marker.endSeconds');
        if (endSeconds !== null && endSeconds < startSeconds) throw validation('marker.endSeconds', 'before_start');
        let drawing = null;
        let frameTimestamp = null;
        if (entry.drawing !== undefined && entry.drawing !== null) {
          if (!Array.isArray(entry.drawing) || entry.drawing.length === 0 || entry.drawing.length > 50) {
            throw validation('marker.drawing', 'invalid');
          }
          drawing = entry.drawing.map((item, index) => shape(item, `marker.drawing.${index}`));
          frameTimestamp = seconds(entry.frameTimestamp, 'marker.frameTimestamp') ?? startSeconds;
        }
        marker = { startSeconds, endSeconds, drawing, frameTimestamp };
        break;
      }
      default:
        break;
    }

    const inserted = await tx.row(
      `INSERT INTO ${S}.learning_comments
         (organization_id, asset_id, version_id, parent_comment_id, user_id, comment_type, body, anchor_json, suggestion_text)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        actx.organizationId,
        assetId,
        versionId,
        parentId,
        actx.userId,
        commentType,
        commentBody,
        anchor ? JSON.stringify(anchor) : null,
        suggestionText,
      ]
    );

    if (annotation) {
      await tx.query(
        `INSERT INTO ${S}.learning_annotations
           (organization_id, asset_id, version_id, page_number, annotation_type, x, y, width, height, metadata_json, comment_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          actx.organizationId,
          assetId,
          versionId,
          annotation.pageNumber,
          annotation.annotationType,
          annotation.geometry.x,
          annotation.geometry.y,
          annotation.geometry.width ?? null,
          annotation.geometry.height ?? null,
          JSON.stringify({ points: annotation.geometry.points ?? null, color: annotation.color }),
          inserted.id,
          actx.userId,
        ]
      );
    }
    if (marker && commentType === 'AUDIO_TIMESTAMP') {
      await tx.query(
        `INSERT INTO ${S}.learning_audio_markers (organization_id, asset_id, version_id, start_seconds, end_seconds, comment_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [actx.organizationId, assetId, versionId, marker.startSeconds, marker.endSeconds, inserted.id, actx.userId]
      );
    }
    if (marker && commentType === 'VIDEO_TIMESTAMP') {
      await tx.query(
        `INSERT INTO ${S}.learning_video_markers
           (organization_id, asset_id, version_id, start_seconds, end_seconds, frame_timestamp, annotation_json, comment_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          actx.organizationId,
          assetId,
          versionId,
          marker.startSeconds,
          marker.endSeconds,
          marker.frameTimestamp,
          marker.drawing ? JSON.stringify(marker.drawing) : null,
          inserted.id,
          actx.userId,
        ]
      );
    }

    if (!parent) {
      await record(tx, {
        organizationId: actx.organizationId,
        courseId: actx.course.id,
        lessonId: actx.lesson.id,
        assetId,
        versionId,
        actorUserId: actx.userId,
        eventType: 'COMMENT_CREATED',
        metadata: { commentType, excerpt: commentBody.slice(0, 140) },
      });
    }

    outbox.push({
      organizationId: actx.organizationId,
      actorId: actx.userId,
      recipients: [asset.assigneeUserId, asset.reviewerUserId, parent?.user_id],
      type: 'comment',
      message: 'comment',
      dedupeKey: `comment:${assetId}`,
      windowMinutes: WINDOW.COMMENTS,
      assetId,
      link: assetLink({ courseId: actx.course.id, lessonId: actx.lesson.id, assetType: asset.assetType }),
      data: { courseName: actx.course.name, lessonName: actx.lesson.name, assetType: asset.assetType },
    });
    return inserted.id;
  });

  await flush(outbox);
  const comment = await readComment(direct, commentId, actor.organizationId);
  return { comment, people: await peopleFor(userIdsIn([comment])) };
}

async function lockedComment(tx, actor, commentId) {
  const comment = await tx.row(
    `SELECT * FROM ${S}.learning_comments WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL FOR UPDATE`,
    [commentId, actor.organizationId]
  );
  if (!comment) throw notFound();
  const actx = await assetContext(actor, comment.asset_id, { db: tx });
  return { comment, actx };
}

export async function editComment(actor, commentId, input) {
  const body = plainObject(input, 'body');
  const newBody = text(body.body, 'body', { required: true, max: 10000 });
  await transaction(async (tx) => {
    const { comment, actx } = await lockedComment(tx, actor, commentId);
    if (comment.user_id !== actor.userId) throw forbidden('COMMENT_NOT_EDITABLE');
    if (actx.asset.status === 'LOCKED') throw workflowRefusal('ASSET_LOCKED');
    await tx.query(`UPDATE ${S}.learning_comments SET body = $2, edited_at = now() WHERE id = $1`, [commentId, newBody]);
  });
  return { comment: await readComment(direct, commentId, actor.organizationId) };
}

async function setResolution(actor, commentId, resolved) {
  await transaction(async (tx) => {
    const { comment, actx } = await lockedComment(tx, actor, commentId);
    if (comment.parent_comment_id) throw validation('commentId', 'reply_cannot_be_resolved');
    if (actx.asset.status === 'LOCKED') throw workflowRefusal('ASSET_LOCKED');
    if (!canResolveComments(actx)) throw forbidden();
    if ((comment.status === 'RESOLVED') === resolved) return;

    await tx.query(
      `UPDATE ${S}.learning_comments
          SET status = $2,
              resolved_by = CASE WHEN $3::boolean THEN $4 ELSE NULL END,
              resolved_at = CASE WHEN $3::boolean THEN now() ELSE NULL END
        WHERE id = $1`,
      [commentId, resolved ? 'RESOLVED' : 'OPEN', resolved, actor.userId]
    );
    await tx.query(
      `UPDATE ${S}.learning_annotations SET resolved_at = CASE WHEN $2::boolean THEN now() ELSE NULL END WHERE comment_id = $1`,
      [commentId, resolved]
    );
    await record(tx, {
      organizationId: actx.organizationId,
      courseId: actx.course.id,
      lessonId: actx.lesson.id,
      assetId: actx.asset.id,
      versionId: comment.version_id,
      actorUserId: actor.userId,
      eventType: resolved ? 'COMMENT_RESOLVED' : 'COMMENT_REOPENED',
      metadata: { commentType: comment.comment_type, excerpt: comment.body.slice(0, 140) },
    });
  });
  return { comment: await readComment(direct, commentId, actor.organizationId) };
}

export const resolveComment = (actor, commentId) => setResolution(actor, commentId, true);
export const reopenComment = (actor, commentId) => setResolution(actor, commentId, false);

/**
 * Accept a suggestion into the draft: find the quoted passage where it is now,
 * replace it, and resolve the suggestion — or refuse, if the passage has since
 * been rewritten and there is nothing left to replace.
 */
export async function applySuggestion(actor, commentId) {
  return transaction(async (tx) => {
    const found = await tx.row(
      `SELECT * FROM ${S}.learning_comments WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [commentId, actor.organizationId]
    );
    if (!found || found.comment_type !== 'SUGGESTION') throw notFound();
    if (found.status !== 'OPEN') throw workflowRefusal('INVALID_TRANSITION');

    const actx = await assetContext(actor, found.asset_id, { db: tx, lock: true });
    const state = await contentState(tx, actx);
    const evaluation = evaluate(actx, state);
    if (!evaluation.actions.SAVE_DRAFT.allowed) throw workflowRefusal(evaluation.actions.SAVE_DRAFT.reason ?? 'INVALID_TRANSITION');

    const type = actx.asset.assetType;
    const content = normalizeContent(type, state.draft?.content_json ?? state.current?.content_json ?? {});
    const anchor = found.anchor_json ?? {};
    let target = null;
    let block = null;
    if (type === 'OUTLINE') target = content.sections[anchor.section];
    else {
      block = content.blocks.find((entry) => entry.id === anchor.blockId);
      target = block?.[anchor.field];
    }
    const location = typeof target === 'string' ? locateQuote(target, anchor) : null;
    if (!location) throw conflict('SUGGESTION_OUTDATED');

    const replaced = `${target.slice(0, location.start)}${found.suggestion_text ?? ''}${target.slice(location.end)}`;
    if (type === 'OUTLINE') content.sections[anchor.section] = replaced;
    else block[anchor.field] = replaced;

    const saved = await tx.row(
      `INSERT INTO ${S}.learning_asset_drafts (asset_id, organization_id, content_json, revision, updated_by)
       VALUES ($1, $2, $3, 1, $4)
       ON CONFLICT (asset_id) DO UPDATE
         SET content_json = EXCLUDED.content_json, revision = ${S}.learning_asset_drafts.revision + 1,
             updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING revision`,
      [actx.asset.id, actx.organizationId, JSON.stringify(content), actor.userId]
    );
    if (actx.asset.status === 'NOT_STARTED' || actx.asset.status === 'ASSIGNED') await beginWork(tx, actx);

    await tx.query(
      `UPDATE ${S}.learning_comments
          SET status = 'RESOLVED', resolved_by = $2, resolved_at = now(), suggestion_applied_at = now(), suggestion_applied_by = $2
        WHERE id = $1`,
      [commentId, actor.userId]
    );
    await record(tx, {
      organizationId: actx.organizationId,
      courseId: actx.course.id,
      lessonId: actx.lesson.id,
      assetId: actx.asset.id,
      versionId: found.version_id,
      actorUserId: actor.userId,
      eventType: 'SUGGESTION_APPLIED',
      metadata: { excerpt: String(anchor.quote ?? '').slice(0, 140) },
    });
    return { revision: saved.revision, content };
  });
}

/* ------------------------------------------------------------------ */
/* Annotations and markers                                              */
/* ------------------------------------------------------------------ */

async function lockedAnnotation(tx, actor, annotationId) {
  const annotation = await tx.row(
    `SELECT an.*, c.status AS comment_status FROM ${S}.learning_annotations an
       JOIN ${S}.learning_comments c ON c.id = an.comment_id
      WHERE an.id = $1 AND an.organization_id = $2 AND an.deleted_at IS NULL
      FOR UPDATE OF an`,
    [annotationId, actor.organizationId]
  );
  if (!annotation) throw notFound();
  const actx = await assetContext(actor, annotation.asset_id, { db: tx });
  if (actx.asset.status === 'LOCKED') throw workflowRefusal('ASSET_LOCKED');
  if (annotation.created_by !== actor.userId && !actx.grants.isAdmin) throw forbidden();
  if (annotation.comment_status !== 'OPEN') throw workflowRefusal('INVALID_TRANSITION');
  return { annotation, actx };
}

export async function updateAnnotation(actor, annotationId, input) {
  const body = plainObject(input, 'body');
  await transaction(async (tx) => {
    const { annotation } = await lockedAnnotation(tx, actor, annotationId);
    const next = shape({ annotationType: annotation.annotation_type, geometry: body.geometry, color: body.color ?? annotation.metadata_json?.color }, 'annotation');
    await tx.query(
      `UPDATE ${S}.learning_annotations SET x = $2, y = $3, width = $4, height = $5, metadata_json = $6 WHERE id = $1`,
      [
        annotationId,
        next.geometry.x,
        next.geometry.y,
        next.geometry.width ?? null,
        next.geometry.height ?? null,
        JSON.stringify({ points: next.geometry.points ?? null, color: next.color }),
      ]
    );
  });
  return { updated: true };
}

/** Archive a shape and the comment it carried. Only its author, and only while the comment is open. */
export async function deleteAnnotation(actor, annotationId) {
  await transaction(async (tx) => {
    const { annotation } = await lockedAnnotation(tx, actor, annotationId);
    await tx.query(`UPDATE ${S}.learning_annotations SET deleted_at = now(), deleted_by = $2 WHERE id = $1`, [annotationId, actor.userId]);
    await tx.query(`UPDATE ${S}.learning_comments SET deleted_at = now(), deleted_by = $2 WHERE id = $1`, [
      annotation.comment_id,
      actor.userId,
    ]);
  });
  return { deleted: true };
}

/** Leave feedback addressed by version — the annotation and marker endpoints. */
export async function createVersionComment(actor, versionId, commentType, input) {
  const version = await direct.row(`SELECT asset_id FROM ${S}.learning_asset_versions WHERE id = $1 AND organization_id = $2`, [
    versionId,
    actor.organizationId,
  ]);
  if (!version) throw notFound();
  return createComment(actor, version.asset_id, { ...plainObject(input, 'body'), commentType, versionId });
}

/** Positions on one version, for drawing a slide, a waveform or a timeline. */
export async function versionPositions(actor, versionId, kind) {
  const version = await direct.row(`SELECT asset_id FROM ${S}.learning_asset_versions WHERE id = $1 AND organization_id = $2`, [
    versionId,
    actor.organizationId,
  ]);
  if (!version) throw notFound();
  await assetContext(actor, version.asset_id);
  const condition = {
    annotations: 'an.id IS NOT NULL',
    audio: 'am.id IS NOT NULL',
    video: 'vm.id IS NOT NULL',
  }[kind];
  const found = await direct.rows(
    `${COMMENT_SELECT} WHERE c.version_id = $1 AND c.deleted_at IS NULL AND ${condition} ORDER BY c.created_at`,
    [versionId]
  );
  const comments = found.map((r) => ({ ...mapComment(r), replies: [] }));
  return { comments, people: await peopleFor(userIdsIn(comments)) };
}
