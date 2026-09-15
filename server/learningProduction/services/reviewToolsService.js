/**
 * QA checklists and voice-over transcripts.
 */

import { ASSET_TYPES, CHECKLIST_ITEM_STATUSES, TRANSCRIPT_SOURCES } from '../../../shared/learningProduction/constants.js';
import { LP_PERMISSIONS as P } from '../../../shared/learningProduction/permissions.js';
import { REVIEW_STATUSES } from '../../../shared/learningProduction/workflow.js';
import { SCHEMA as S, transaction, direct } from '../db.js';
import { courseContext } from '../access.js';
import { record } from '../activity.js';
import { forbidden, notFound, validation, workflowRefusal } from '../errors.js';
import { num } from '../mappers.js';
import { oneOf, plainObject, seconds, text } from '../validate.js';
import { versionContext } from './context.js';

const iso = (value) => (value instanceof Date ? value.toISOString() : value ?? null);

function mapItem(r) {
  return {
    id: r.id,
    sortOrder: r.sort_order,
    category: r.category ?? null,
    label: r.label,
    required: r.required,
    status: r.status,
    notes: r.notes ?? '',
    updatedBy: r.updated_by ?? null,
    updatedAt: iso(r.updated_at),
  };
}

/* ------------------------------------------------------------------ */
/* Checklists                                                           */
/* ------------------------------------------------------------------ */

async function templateFor(tx, organizationId, courseId, assetType, userId) {
  let template = await tx.row(
    `SELECT id FROM ${S}.learning_checklists WHERE course_id = $1 AND asset_type = $2 AND is_template`,
    [courseId, assetType]
  );
  if (!template) {
    template = await tx.row(
      `INSERT INTO ${S}.learning_checklists (organization_id, course_id, asset_type, is_template, created_by)
       VALUES ($1, $2, $3, true, $4)
       ON CONFLICT (course_id, asset_type) WHERE is_template DO UPDATE SET updated_at = now()
       RETURNING id`,
      [organizationId, courseId, assetType, userId]
    );
  }
  return template.id;
}

/**
 * The checklist of one version, copied from the course template the first
 * time anybody opens it. Editing the template afterwards never rewrites a
 * review that has already been done.
 */
export async function ensureVersionChecklist(tx, actx, versionId) {
  if (!versionId) return [];
  let checklist = await tx.row(`SELECT id FROM ${S}.learning_checklists WHERE version_id = $1`, [versionId]);
  if (!checklist) {
    const templateId = await templateFor(tx, actx.organizationId, actx.course.id, actx.asset.assetType, actx.userId);
    checklist = await tx.row(
      `INSERT INTO ${S}.learning_checklists (organization_id, course_id, asset_type, asset_id, version_id, is_template, created_by)
       VALUES ($1, $2, $3, $4, $5, false, $6)
       ON CONFLICT (version_id) WHERE version_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [actx.organizationId, actx.course.id, actx.asset.assetType, actx.asset.id, versionId, actx.userId]
    );
    if (checklist) {
      await tx.query(
        `INSERT INTO ${S}.learning_checklist_items (organization_id, checklist_id, sort_order, category, label, required)
         SELECT organization_id, $1, sort_order, category, label, required
           FROM ${S}.learning_checklist_items
          WHERE checklist_id = $2 AND archived_at IS NULL`,
        [checklist.id, templateId]
      );
    } else {
      checklist = await tx.row(`SELECT id FROM ${S}.learning_checklists WHERE version_id = $1`, [versionId]);
    }
  }
  return tx.rows(
    `SELECT * FROM ${S}.learning_checklist_items WHERE checklist_id = $1 AND archived_at IS NULL ORDER BY sort_order`,
    [checklist.id]
  );
}

function canWorkChecklist(vctx) {
  const stage = vctx.asset.assetType;
  return (
    REVIEW_STATUSES.includes(vctx.asset.status) &&
    vctx.asset.submittedBy !== vctx.userId &&
    (vctx.asset.reviewerUserId === vctx.userId || vctx.grants.has(P.ASSET_REVIEW, stage) || vctx.grants.has(P.ASSET_APPROVE, stage))
  );
}

export async function versionChecklist(actor, versionId) {
  return transaction(async (tx) => {
    const vctx = await versionContext(actor, versionId, { db: tx });
    const items = await ensureVersionChecklist(tx, vctx, versionId);
    return {
      items: items.map(mapItem),
      canEdit: canWorkChecklist(vctx) && vctx.asset.currentVersionId === versionId,
    };
  });
}

export async function updateChecklistItem(actor, itemId, input) {
  const body = plainObject(input, 'body');
  return transaction(async (tx) => {
    const item = await tx.row(
      `SELECT i.*, c.version_id FROM ${S}.learning_checklist_items i
         JOIN ${S}.learning_checklists c ON c.id = i.checklist_id
        WHERE i.id = $1 AND i.organization_id = $2 AND i.archived_at IS NULL AND NOT c.is_template
        FOR UPDATE OF i`,
      [itemId, actor.organizationId]
    );
    if (!item) throw notFound();
    const vctx = await versionContext(actor, item.version_id, { db: tx });
    if (vctx.asset.status === 'LOCKED') throw workflowRefusal('ASSET_LOCKED');
    if (!canWorkChecklist(vctx) || vctx.asset.currentVersionId !== item.version_id) throw forbidden();

    const status = 'status' in body ? oneOf(body.status, CHECKLIST_ITEM_STATUSES, 'status', { required: true }) : item.status;
    const notes = 'notes' in body ? text(body.notes, 'notes', { max: 2000 }) ?? '' : item.notes;
    const updated = await tx.row(
      `UPDATE ${S}.learning_checklist_items SET status = $2, notes = $3, updated_by = $4 WHERE id = $1 RETURNING *`,
      [itemId, status, notes, actor.userId]
    );
    if (status !== item.status) {
      await record(tx, {
        organizationId: vctx.organizationId,
        courseId: vctx.course.id,
        lessonId: vctx.lesson.id,
        assetId: vctx.asset.id,
        versionId: item.version_id,
        actorUserId: actor.userId,
        eventType: 'CHECKLIST_UPDATED',
        metadata: { label: item.label, category: item.category, status },
      });
    }
    return { item: mapItem(updated) };
  });
}

export async function checklistTemplate(actor, courseId, assetType = 'VIDEO') {
  const type = oneOf(assetType, ASSET_TYPES, 'assetType', { fallback: 'VIDEO' });
  const ctx = await courseContext(actor, courseId);
  return transaction(async (tx) => {
    const templateId = await templateFor(tx, ctx.organizationId, courseId, type, ctx.userId);
    const items = await tx.rows(
      `SELECT * FROM ${S}.learning_checklist_items WHERE checklist_id = $1 AND archived_at IS NULL ORDER BY sort_order`,
      [templateId]
    );
    return { assetType: type, items: items.map(mapItem), canEdit: ctx.grants.has(P.COURSE_EDIT) };
  });
}

/** Replace the template's items. Removed items are archived, never deleted. */
export async function saveChecklistTemplate(actor, courseId, assetType, input) {
  const type = oneOf(assetType, ASSET_TYPES, 'assetType', { required: true });
  const ctx = await courseContext(actor, courseId);
  if (!ctx.grants.has(P.COURSE_EDIT)) throw forbidden('FORBIDDEN', { permission: P.COURSE_EDIT });
  const body = plainObject(input, 'body');
  if (!Array.isArray(body.items) || body.items.length > 60) throw validation('items', 'invalid');
  const items = body.items.map((entry, index) => {
    const item = plainObject(entry, `items.${index}`);
    return {
      id: typeof item.id === 'string' ? item.id : null,
      category: typeof item.category === 'string' && /^[A-Z_]{2,40}$/.test(item.category) ? item.category : null,
      label: text(item.label, `items.${index}.label`, { required: true, max: 200 }),
      required: item.required !== false,
    };
  });

  return transaction(async (tx) => {
    const templateId = await templateFor(tx, ctx.organizationId, courseId, type, ctx.userId);
    const existing = await tx.rows(
      `SELECT id FROM ${S}.learning_checklist_items WHERE checklist_id = $1 AND archived_at IS NULL`,
      [templateId]
    );
    const known = new Set(existing.map((row) => row.id));
    const kept = new Set();

    for (const [index, item] of items.entries()) {
      if (item.id && known.has(item.id)) {
        kept.add(item.id);
        await tx.query(
          `UPDATE ${S}.learning_checklist_items SET sort_order = $2, label = $3, required = $4, updated_by = $5 WHERE id = $1`,
          [item.id, index, item.label, item.required, ctx.userId]
        );
      } else {
        await tx.query(
          `INSERT INTO ${S}.learning_checklist_items
             (organization_id, checklist_id, sort_order, category, label, required, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [ctx.organizationId, templateId, index, item.category, item.label, item.required, ctx.userId]
        );
      }
    }
    const removed = [...known].filter((id) => !kept.has(id));
    if (removed.length) {
      await tx.query(`UPDATE ${S}.learning_checklist_items SET archived_at = now() WHERE id = ANY($1::uuid[])`, [removed]);
    }
    await record(tx, {
      organizationId: ctx.organizationId,
      courseId,
      actorUserId: ctx.userId,
      eventType: 'CHECKLIST_UPDATED',
      metadata: { template: true, assetType: type, count: items.length },
    });
    const saved = await tx.rows(
      `SELECT * FROM ${S}.learning_checklist_items WHERE checklist_id = $1 AND archived_at IS NULL ORDER BY sort_order`,
      [templateId]
    );
    return { assetType: type, items: saved.map(mapItem), canEdit: true };
  });
}

/* ------------------------------------------------------------------ */
/* Transcripts                                                          */
/* ------------------------------------------------------------------ */

function mapTranscript(r) {
  if (!r) return null;
  return {
    id: r.id,
    versionId: r.version_id,
    source: r.source,
    provider: r.provider ?? null,
    body: r.body ?? '',
    segments: (r.segments_json ?? []).map((segment) => ({
      startSeconds: num(segment.startSeconds),
      endSeconds: num(segment.endSeconds),
      text: segment.text,
    })),
    updatedBy: r.updated_by ?? null,
    updatedAt: iso(r.updated_at),
  };
}

function canEditTranscript(vctx) {
  const stage = vctx.asset.assetType;
  return (
    vctx.asset.status !== 'LOCKED' &&
    (vctx.asset.assigneeUserId === vctx.userId ||
      vctx.asset.reviewerUserId === vctx.userId ||
      vctx.grants.has(P.ASSET_EDIT, stage) ||
      vctx.grants.has(P.ASSET_REVIEW, stage))
  );
}

export async function getTranscript(actor, versionId) {
  const vctx = await versionContext(actor, versionId);
  if (vctx.asset.assetType !== 'VOICE_OVER') throw workflowRefusal('NOT_SUPPORTED');
  const found = await direct.row(`SELECT * FROM ${S}.learning_transcripts WHERE version_id = $1`, [versionId]);
  return { transcript: mapTranscript(found), canEdit: canEditTranscript(vctx) };
}

/**
 * Save a transcript. Timed segments are optional: a person typing it in has
 * none, and a transcription service that returns them fills `segments` so the
 * reviewer can click a sentence to hear it.
 */
export async function saveTranscript(actor, versionId, input) {
  const body = plainObject(input, 'body');
  const vctx = await versionContext(actor, versionId);
  if (vctx.asset.assetType !== 'VOICE_OVER') throw workflowRefusal('NOT_SUPPORTED');
  if (!canEditTranscript(vctx)) throw forbidden();

  const transcriptBody = text(body.body, 'body', { max: 200_000, trim: false }) ?? '';
  const source = oneOf(body.source, TRANSCRIPT_SOURCES, 'source', { fallback: 'MANUAL' });
  const provider = text(body.provider, 'provider', { max: 80 }) || null;
  if (body.segments !== undefined && (!Array.isArray(body.segments) || body.segments.length > 5000)) {
    throw validation('segments', 'invalid');
  }
  const segments = (body.segments ?? []).map((segment, index) => {
    const entry = plainObject(segment, `segments.${index}`);
    const startSeconds = seconds(entry.startSeconds, `segments.${index}.startSeconds`, { required: true });
    const endSeconds = seconds(entry.endSeconds, `segments.${index}.endSeconds`);
    if (endSeconds !== null && endSeconds < startSeconds) throw validation(`segments.${index}.endSeconds`, 'before_start');
    return { startSeconds, endSeconds, text: text(entry.text, `segments.${index}.text`, { max: 2000 }) ?? '' };
  });

  return transaction(async (tx) => {
    const previous = await tx.row(`SELECT source FROM ${S}.learning_transcripts WHERE version_id = $1`, [versionId]);
    const saved = await tx.row(
      `INSERT INTO ${S}.learning_transcripts (organization_id, asset_id, version_id, source, provider, body, segments_json, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (version_id) DO UPDATE
         SET source = EXCLUDED.source, provider = EXCLUDED.provider, body = EXCLUDED.body,
             segments_json = EXCLUDED.segments_json, updated_by = EXCLUDED.updated_by
       RETURNING *`,
      [vctx.organizationId, vctx.asset.id, versionId, source, provider, transcriptBody, JSON.stringify(segments), actor.userId]
    );
    // History notes that a transcript arrived or changed source — not every keystroke of an edit.
    if (!previous || previous.source !== source) {
      await record(tx, {
        organizationId: vctx.organizationId,
        courseId: vctx.course.id,
        lessonId: vctx.lesson.id,
        assetId: vctx.asset.id,
        versionId,
        actorUserId: actor.userId,
        eventType: 'TRANSCRIPT_UPDATED',
        metadata: { source, segments: segments.length },
      });
    }
    return { transcript: mapTranscript(saved), canEdit: true };
  });
}
