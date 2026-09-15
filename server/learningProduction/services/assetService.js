/**
 * Production assets — the workflow.
 *
 * Every change to an asset's status is one of the named actions below. Each
 * one runs in a transaction that locks the asset row, re-evaluates the rules
 * against what is in the database at that moment (never against what the
 * browser believed), writes the change and its history together, and only then
 * — after the commit — sends its notifications.
 */

import { ASSET_TYPES, PRIORITIES, REVIEW_STATUSES, isTextAsset } from '../../../shared/learningProduction/constants.js';
import { LP_PERMISSIONS as P } from '../../../shared/learningProduction/permissions.js';
import { normalizeContent } from '../../../shared/learningProduction/review.js';
import { primaryAction, statusAfterAssignment } from '../../../shared/learningProduction/workflow.js';
import { SCHEMA as S, direct, transaction } from '../db.js';
import { canComment, courseContext } from '../access.js';
import { record } from '../activity.js';
import { WINDOW, assetLink, flush } from '../notifications.js';
import { badRequest, conflict, forbidden, validation, workflowRefusal } from '../errors.js';
import { mapApproval, mapAsset, mapVersion } from '../mappers.js';
import { assertAssignable, peopleFor, userIdField, userIdsIn } from '../people.js';
import { dateOrder, httpsUrl, idList, integer, isoDate, oneOf, plainObject, seconds, text } from '../validate.js';
import * as blobs from '../blobs.js';
import { ACCEPTED, KINDS, detectKind, safeFileName, uploadLimit } from '../fileTypes.js';
import { schedulePreview } from '../previewConverter.js';
import { assetContext, contentState, evaluate, versionContext } from './context.js';
import { ensureVersionChecklist } from './reviewToolsService.js';

const iso = (value) => (value instanceof Date ? value.toISOString() : value ?? null);

function ensure(evaluation, action) {
  const verdict = evaluation.actions[action];
  if (!verdict?.allowed) throw workflowRefusal(verdict?.reason ?? 'INVALID_TRANSITION', { action });
}

function base(actx) {
  return {
    organizationId: actx.organizationId,
    courseId: actx.course.id,
    lessonId: actx.lesson.id,
    assetId: actx.asset.id,
    actorUserId: actx.userId,
  };
}

function notice(actx, extra = {}) {
  return { courseName: actx.course.name, lessonName: actx.lesson.name, assetType: actx.asset.assetType, ...extra };
}

function linkTo(actx) {
  return assetLink({ courseId: actx.course.id, lessonId: actx.lesson.id, assetType: actx.asset.assetType });
}

async function openCommentCount(db, assetId) {
  const found = await db.row(
    `SELECT count(*)::int AS n FROM ${S}.learning_comments
      WHERE asset_id = $1 AND status = 'OPEN' AND parent_comment_id IS NULL AND deleted_at IS NULL`,
    [assetId]
  );
  return found?.n ?? 0;
}

async function courseManagers(db, courseId) {
  const found = await db.rows(
    `SELECT user_id FROM ${S}.learning_course_members
      WHERE course_id = $1 AND roles && ARRAY['PRODUCTION_MANAGER', 'COURSE_MANAGER']::text[]`,
    [courseId]
  );
  return found.map((member) => member.user_id);
}

/**
 * Run one action: lock, evaluate, write, commit, then notify. The caller reads
 * the asset back afterwards — reading it inside would hold the lock for no
 * reason, and failing to read it must never undo a committed change.
 */
async function act(actor, assetId, work) {
  const outbox = [];
  const result = await transaction(async (tx) => {
    const actx = await assetContext(actor, assetId, { db: tx, lock: true });
    const state = await contentState(tx, actx);
    return work({ tx, actx, state, evaluation: evaluate(actx, state), outbox });
  });
  await flush(outbox);
  return result;
}

/* ------------------------------------------------------------------ */
/* Reading                                                              */
/* ------------------------------------------------------------------ */

/** The approved (or else current) PPT, Script and Voice Over, for the video reviewer's reference panel. */
async function referenceVersions(db, actx) {
  const found = await db.rows(
    `SELECT a.id AS reference_asset_id, a.asset_type, a.status, a.approved_version_id, v.*
       FROM ${S}.learning_assets a
       JOIN ${S}.learning_asset_versions v ON v.id = coalesce(a.approved_version_id, a.current_version_id)
      WHERE a.lesson_id = $1 AND a.asset_type IN ('PPT', 'SCRIPT', 'VOICE_OVER')`,
    [actx.lesson.id]
  );
  return found.map((r) => ({
    assetType: r.asset_type,
    assetId: r.reference_asset_id,
    status: r.status,
    approved: r.approved_version_id === r.id,
    version: mapVersion(r, { withContent: r.asset_type === 'SCRIPT' }),
  }));
}

/** Everything the asset workspace draws, including what this person may do next. */
export async function getAsset(actor, assetId) {
  const actx = await assetContext(actor, assetId);
  const asset = actx.asset;
  const type = asset.assetType;
  const state = await contentState(direct, actx);
  const evaluation = evaluate(actx, state);

  const [versions, approvals, openComments, references] = await Promise.all([
    direct.rows(
      `SELECT v.id, v.asset_id, v.version_number, v.source_kind, v.storage_key, v.file_name, v.mime_type, v.file_size,
              v.external_url, v.preview_storage_key, v.preview_file_name, v.duration_seconds, v.version_notes,
              v.created_by, v.created_at,
              (SELECT ap.decision FROM ${S}.learning_asset_approvals ap
                WHERE ap.version_id = v.id ORDER BY ap.submitted_at DESC LIMIT 1) AS decision
         FROM ${S}.learning_asset_versions v
        WHERE v.asset_id = $1
        ORDER BY v.version_number DESC`,
      [asset.id]
    ),
    direct.rows(
      `SELECT ap.*, v.version_number FROM ${S}.learning_asset_approvals ap
         JOIN ${S}.learning_asset_versions v ON v.id = ap.version_id
        WHERE ap.asset_id = $1 ORDER BY ap.submitted_at DESC`,
      [asset.id]
    ),
    openCommentCount(direct, asset.id),
    type === 'VIDEO' ? referenceVersions(direct, actx) : Promise.resolve([]),
  ]);

  const mappedVersions = versions.map((v) => ({ ...mapVersion(v), decision: v.decision ?? null }));
  const currentVersion = state.current
    ? { ...mappedVersions.find((v) => v.id === state.current.id), content: state.current.content_json ?? null }
    : null;
  const draft = isTextAsset(type)
    ? {
        content: normalizeContent(type, state.draft?.content_json ?? state.current?.content_json ?? {}),
        revision: state.draft?.revision ?? 0,
        updatedAt: iso(state.draft?.updated_at),
        updatedBy: state.draft?.updated_by ?? null,
      }
    : null;

  const mappedApprovals = approvals.map(mapApproval);
  const payload = {
    asset,
    lesson: actx.lesson,
    course: { id: actx.course.id, name: actx.course.name, code: actx.course.code },
    settings: { wordsPerMinute: actx.settings.wordsPerMinute, enforceDependencies: actx.settings.enforceDependencies },
    siblings: ASSET_TYPES.map((assetType) => ({
      assetType,
      id: actx.siblingIds[assetType] ?? null,
      status: actx.siblingStatuses[assetType] ?? 'NOT_STARTED',
    })),
    evaluation: {
      actions: evaluation.actions,
      blocked: evaluation.blocked,
      waitingFor: evaluation.dependencies.waitingFor.map((assetType) => ({
        assetType,
        assetId: actx.siblingIds[assetType] ?? null,
        status: actx.siblingStatuses[assetType] ?? 'NOT_STARTED',
      })),
      overridden: evaluation.dependencies.overridden,
      isAssignee: evaluation.isAssignee,
      isReviewer: evaluation.isReviewer,
      canResolveComments: evaluation.canResolveComments,
      canComment: canComment(actx, asset) && asset.status !== 'LOCKED',
      hasContent: state.hasContent,
      versionSinceChanges: state.versionSinceChanges,
      draftDiffers: state.draftDiffers,
    },
    primary: primaryAction(evaluation, { assetType: type }),
    currentVersion,
    draft,
    versions: mappedVersions,
    approvals: mappedApprovals,
    openComments,
    references,
    upload: isTextAsset(type)
      ? null
      : {
          maxBytes: uploadLimit(type),
          accepted: ACCEPTED[type].map((kind) => KINDS[kind].label),
          allowsLink: type !== 'VOICE_OVER',
          previewMaxBytes: uploadLimit('PREVIEW'),
        },
  };
  payload.people = await peopleFor(userIdsIn([asset, mappedVersions, mappedApprovals], [state.draft?.updated_by]));
  return payload;
}

/* ------------------------------------------------------------------ */
/* Assignment                                                           */
/* ------------------------------------------------------------------ */

async function readAssignmentPatch(actor, input) {
  const body = plainObject(input, 'body');
  const patch = {};
  if ('assigneeUserId' in body) patch.assigneeUserId = userIdField(body.assigneeUserId, 'assigneeUserId');
  if ('reviewerUserId' in body) patch.reviewerUserId = userIdField(body.reviewerUserId, 'reviewerUserId');
  if ('dueDate' in body) patch.dueDate = isoDate(body.dueDate, 'dueDate');
  if ('startDate' in body) patch.startDate = isoDate(body.startDate, 'startDate');
  if ('priority' in body) patch.priority = oneOf(body.priority, PRIORITIES, 'priority', { required: true });
  if (patch.assigneeUserId) await assertAssignable(actor, patch.assigneeUserId, 'assigneeUserId');
  if (patch.reviewerUserId) await assertAssignable(actor, patch.reviewerUserId, 'reviewerUserId');
  return patch;
}

async function applyAssignment(tx, actx, patch, outbox, versionNumber) {
  const asset = actx.asset;
  const next = {
    assigneeUserId: asset.assigneeUserId,
    reviewerUserId: asset.reviewerUserId,
    dueDate: asset.dueDate,
    startDate: asset.startDate,
    priority: asset.priority,
    ...patch,
  };
  dateOrder(next.startDate, next.dueDate, 'dueDate');
  if (next.assigneeUserId && next.assigneeUserId === next.reviewerUserId) {
    throw badRequest('REVIEWER_IS_ASSIGNEE', { field: 'reviewerUserId' });
  }

  const changes = {};
  for (const key of Object.keys(next)) {
    if ((asset[key] ?? null) !== (next[key] ?? null)) changes[key] = [asset[key] ?? null, next[key] ?? null];
  }
  if (Object.keys(changes).length === 0) return false;

  const status = statusAfterAssignment(asset.status, next.assigneeUserId);
  await tx.query(
    `UPDATE ${S}.learning_assets
        SET assignee_user_id = $2, reviewer_user_id = $3, due_date = $4, start_date = $5, priority = $6, status = $7,
            assigned_at = CASE WHEN $8::boolean THEN now() ELSE assigned_at END
      WHERE id = $1`,
    [asset.id, next.assigneeUserId, next.reviewerUserId, next.dueDate, next.startDate, next.priority, status, Boolean(changes.assigneeUserId && next.assigneeUserId)]
  );
  if (changes.reviewerUserId) {
    await tx.query(
      `UPDATE ${S}.learning_asset_approvals SET reviewer_user_id = $2 WHERE asset_id = $1 AND decision = 'PENDING'`,
      [asset.id, next.reviewerUserId]
    );
  }
  await tx.query(
    `INSERT INTO ${S}.learning_asset_assignments
       (organization_id, asset_id, assignee_user_id, reviewer_user_id, due_date, priority, assigned_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [actx.organizationId, asset.id, next.assigneeUserId, next.reviewerUserId, next.dueDate, next.priority, actx.userId]
  );
  await record(tx, { ...base(actx), eventType: 'ASSET_ASSIGNED', metadata: { changes } });

  if (changes.assigneeUserId && next.assigneeUserId) {
    outbox.push({
      organizationId: actx.organizationId,
      actorId: actx.userId,
      recipients: [next.assigneeUserId],
      type: 'assigned',
      message: 'assigned',
      dedupeKey: `assigned:${asset.id}:${next.assigneeUserId}`,
      windowMinutes: WINDOW.SHORT,
      assetId: asset.id,
      link: linkTo(actx),
      data: notice(actx),
    });
  }
  if (changes.reviewerUserId && next.reviewerUserId) {
    const inReview = REVIEW_STATUSES.includes(asset.status);
    outbox.push({
      organizationId: actx.organizationId,
      actorId: actx.userId,
      recipients: [next.reviewerUserId],
      type: inReview ? 'submitted' : 'reviewer_assigned',
      message: inReview ? 'submitted' : 'reviewerAssigned',
      dedupeKey: `reviewer:${asset.id}:${next.reviewerUserId}`,
      windowMinutes: WINDOW.SHORT,
      assetId: asset.id,
      link: linkTo(actx),
      data: notice(actx, { versionNumber: versionNumber ?? 1 }),
    });
  }
  Object.assign(asset, next, { status });
  return true;
}

export async function assign(actor, assetId, input) {
  const patch = await readAssignmentPatch(actor, input);
  await act(actor, assetId, async ({ tx, actx, state, evaluation, outbox }) => {
    ensure(evaluation, 'ASSIGN');
    await applyAssignment(tx, actx, patch, outbox, state.current?.version_number);
  });
  return getAsset(actor, assetId);
}

/**
 * Assign many assets at once — "give every PPT in module 2 to Sara". Locked
 * assets, and assets outside the stages this person may assign, are skipped
 * and counted rather than failing the whole batch.
 */
export async function bulkAssign(actor, courseId, input) {
  const body = plainObject(input, 'body');
  const ctx = await courseContext(actor, courseId);
  const ids = idList(body.assetIds, 'assetIds', 1000);
  const patch = await readAssignmentPatch(actor, body);
  if (Object.keys(patch).length === 0) throw validation('assigneeUserId', 'required');

  const collected = [];
  const summary = await transaction(async (tx) => {
    let updated = 0;
    let skipped = 0;
    for (const assetId of ids) {
      let actx;
      try {
        actx = await assetContext(actor, assetId, { db: tx, lock: true });
      } catch {
        skipped += 1;
        continue;
      }
      if (actx.course.id !== ctx.course.id) {
        skipped += 1;
        continue;
      }
      const state = await contentState(tx, actx);
      if (!evaluate(actx, state).actions.ASSIGN.allowed) {
        skipped += 1;
        continue;
      }
      const assetPatch = { ...patch };
      // A bulk reviewer who is already the maker of one of the assets is skipped
      // for that asset only, instead of refusing the batch.
      if (assetPatch.reviewerUserId && (assetPatch.assigneeUserId ?? actx.asset.assigneeUserId) === assetPatch.reviewerUserId) {
        delete assetPatch.reviewerUserId;
      }
      if (assetPatch.assigneeUserId && assetPatch.assigneeUserId === (assetPatch.reviewerUserId ?? actx.asset.reviewerUserId)) {
        skipped += 1;
        continue;
      }
      if (await applyAssignment(tx, actx, assetPatch, collected, state.current?.version_number)) updated += 1;
    }
    return { updated, skipped };
  });

  // Collapse per recipient: forty assignments are one alert.
  const byRecipient = new Map();
  for (const item of collected) {
    const key = item.recipients[0];
    byRecipient.set(key, [...(byRecipient.get(key) ?? []), item]);
  }
  const outbox = [...byRecipient.entries()].map(([userId, items]) =>
    items.length === 1
      ? items[0]
      : {
          organizationId: ctx.organizationId,
          actorId: ctx.userId,
          recipients: [userId],
          type: 'assigned',
          message: 'bulkAssigned',
          dedupeKey: `bulk-assigned:${courseId}:${userId}`,
          windowMinutes: WINDOW.SHORT,
          link: '/learning-production/my-work',
          data: { courseName: ctx.course.name, count: items.length },
        }
  );
  await flush(outbox);
  return summary;
}

/* ------------------------------------------------------------------ */
/* Making                                                               */
/* ------------------------------------------------------------------ */

/**
 * Move unstarted (or approved) work into progress. Somebody who starts
 * unassigned work becomes its assignee — they are, visibly, the one doing it.
 * A revision after approval opens a new cycle: the approval stays with the
 * version it was given to, and nothing about it carries over.
 */
export async function beginWork(tx, actx, { revision = false } = {}) {
  const asset = actx.asset;
  const selfAssign = !asset.assigneeUserId;
  await tx.query(
    `UPDATE ${S}.learning_assets
        SET status = 'IN_PROGRESS', work_started_at = now(),
            assignee_user_id = coalesce(assignee_user_id, $2),
            assigned_at = coalesce(assigned_at, now())
            ${
              revision
                ? `, approved_at = NULL, approved_by = NULL, approved_version_id = NULL, submitted_at = NULL,
                   submitted_by = NULL, review_started_at = NULL, changes_requested_at = NULL,
                   changes_requested_version_id = NULL, resubmitted_at = NULL`
                : ''
            }
      WHERE id = $1`,
    [asset.id, actx.userId]
  );
  if (selfAssign) {
    await tx.query(
      `INSERT INTO ${S}.learning_asset_assignments
         (organization_id, asset_id, assignee_user_id, reviewer_user_id, due_date, priority, assigned_by)
       VALUES ($1, $2, $3, $4, $5, $6, $3)`,
      [actx.organizationId, asset.id, actx.userId, asset.reviewerUserId, asset.dueDate, asset.priority]
    );
  }
  await record(tx, { ...base(actx), eventType: 'WORK_STARTED', metadata: revision ? { revision: true } : {} });
  asset.status = 'IN_PROGRESS';
  if (selfAssign) asset.assigneeUserId = actx.userId;
  if (revision) {
    asset.submittedBy = null;
    asset.approvedVersionId = null;
  }
}

export async function start(actor, assetId) {
  await act(actor, assetId, async ({ tx, actx, evaluation }) => {
    ensure(evaluation, 'START');
    await beginWork(tx, actx);
  });
  return getAsset(actor, assetId);
}

export async function startRevision(actor, assetId) {
  await act(actor, assetId, async ({ tx, actx, evaluation }) => {
    ensure(evaluation, 'START_REVISION');
    await beginWork(tx, actx, { revision: true });
  });
  return getAsset(actor, assetId);
}

/**
 * Autosave for written assets. Optimistic: the caller sends the revision it
 * last saw, and a mismatch is a 409 rather than a silent overwrite of what
 * another tab wrote a moment ago.
 */
export async function saveDraft(actor, assetId, input) {
  const body = plainObject(input, 'body');
  const revision = integer(body.revision, 'revision', { min: 0, required: true });

  return transaction(async (tx) => {
    const actx = await assetContext(actor, assetId, { db: tx, lock: true });
    const type = actx.asset.assetType;
    if (!isTextAsset(type)) throw workflowRefusal('NOT_SUPPORTED');
    const state = await contentState(tx, actx);
    ensure(evaluate(actx, state), 'SAVE_DRAFT');

    const content = normalizeContent(type, body.content);
    const serialized = JSON.stringify(content);
    if (serialized.length > 2_000_000) throw validation('content', 'too_long');

    const current = state.draft?.revision ?? 0;
    if (revision !== current) throw conflict('DRAFT_CONFLICT', { revision: current });

    const saved = await tx.row(
      `INSERT INTO ${S}.learning_asset_drafts (asset_id, organization_id, content_json, revision, updated_by)
       VALUES ($1, $2, $3, 1, $4)
       ON CONFLICT (asset_id) DO UPDATE
         SET content_json = EXCLUDED.content_json,
             revision = ${S}.learning_asset_drafts.revision + 1,
             updated_by = EXCLUDED.updated_by,
             updated_at = now()
       RETURNING revision, updated_at`,
      [assetId, actx.organizationId, serialized, actx.userId]
    );
    if (actx.asset.status === 'NOT_STARTED' || actx.asset.status === 'ASSIGNED') await beginWork(tx, actx);
    return { revision: saved.revision, savedAt: iso(saved.updated_at), status: actx.asset.status };
  });
}

/**
 * A new file or link version. Never replaces anything: the previous versions,
 * their files and their review history all stay exactly as they were.
 */
export async function uploadVersion(actor, assetId, input) {
  const probe = await assetContext(actor, assetId);
  const type = probe.asset.assetType;
  if (isTextAsset(type)) throw workflowRefusal('NOT_SUPPORTED');

  const notes = text(input.notes, 'notes', { max: 2000 }) ?? '';
  const durationSeconds = seconds(input.durationSeconds, 'durationSeconds');
  // Refuse before storing a single byte — a 300 MB upload from somebody who
  // may not upload should cost nothing.
  ensure(evaluate(probe, await contentState(direct, probe)), 'UPLOAD_VERSION');

  let file = null;
  let url = null;
  if (input.externalUrl) {
    if (type === 'VOICE_OVER') throw workflowRefusal('NOT_SUPPORTED');
    url = httpsUrl(input.externalUrl, 'externalUrl');
  } else {
    const bytes = input.bytes;
    if (!bytes?.length) throw badRequest('FILE_REQUIRED');
    const limit = uploadLimit(type);
    if (bytes.length > limit) throw badRequest('FILE_TOO_LARGE', { maxBytes: limit });
    const kind = detectKind(bytes, input.fileName, type);
    if (!kind || !ACCEPTED[type].includes(kind)) {
      throw badRequest('FILE_TYPE_NOT_ALLOWED', { accepted: ACCEPTED[type].map((entry) => KINDS[entry].label) });
    }
    file = {
      kind,
      name: safeFileName(input.fileName),
      size: bytes.length,
      checksum: blobs.checksum(bytes),
      key: await blobs.store(bytes),
    };
  }

  let created = null;
  try {
    await act(actor, assetId, async ({ tx, actx, evaluation }) => {
      ensure(evaluation, 'UPLOAD_VERSION');
      const from = actx.asset.status;
      if (from === 'NOT_STARTED' || from === 'ASSIGNED') await beginWork(tx, actx);
      if (from === 'APPROVED') await beginWork(tx, actx, { revision: true });

      const { next } = await tx.row(
        `SELECT coalesce(max(version_number), 0) + 1 AS next FROM ${S}.learning_asset_versions WHERE asset_id = $1`,
        [assetId]
      );
      created = await tx.row(
        `INSERT INTO ${S}.learning_asset_versions
           (organization_id, asset_id, version_number, source_kind, storage_key, file_name, mime_type, file_size,
            checksum, external_url, duration_seconds, version_notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [
          actx.organizationId,
          assetId,
          next,
          file ? 'FILE' : 'LINK',
          file?.key ?? null,
          file?.name ?? null,
          file ? KINDS[file.kind].mime : null,
          file?.size ?? null,
          file?.checksum ?? null,
          url,
          durationSeconds,
          notes,
          actx.userId,
        ]
      );
      await tx.query(`UPDATE ${S}.learning_assets SET current_version_id = $2 WHERE id = $1`, [assetId, created.id]);
      await record(tx, {
        ...base(actx),
        versionId: created.id,
        eventType: 'VERSION_UPLOADED',
        metadata: { versionNumber: next, fileName: file?.name ?? null, fileSize: file?.size ?? null, link: Boolean(url), notes: notes.slice(0, 280) },
      });
    });
  } catch (error) {
    if (file) await blobs.discard(file.key);
    throw error;
  }

  if (file && (file.kind === 'pptx' || file.kind === 'ppt')) schedulePreview(created);
  return getAsset(actor, assetId);
}

/**
 * Attach a PDF rendering to a PowerPoint version, so it can be reviewed slide
 * by slide. The slides themselves are unchanged, so this is not a new version —
 * and a version's preview is attached once and never replaced.
 */
export async function attachPreview(actor, versionId, input) {
  const vctx = await versionContext(actor, versionId);
  const version = vctx.version;
  if (vctx.asset.assetType !== 'PPT' || version.source_kind !== 'FILE' || version.mime_type === KINDS.pdf.mime) {
    throw workflowRefusal('NOT_SUPPORTED');
  }
  if (version.preview_storage_key) throw conflict('PREVIEW_EXISTS');
  if (vctx.asset.status === 'LOCKED') throw workflowRefusal('ASSET_LOCKED');
  if (vctx.asset.assigneeUserId !== vctx.userId && !vctx.grants.has(P.ASSET_EDIT, 'PPT')) throw forbidden();

  const bytes = input.bytes;
  if (!bytes?.length) throw badRequest('FILE_REQUIRED');
  if (bytes.length > uploadLimit('PREVIEW')) throw badRequest('FILE_TOO_LARGE', { maxBytes: uploadLimit('PREVIEW') });
  if (detectKind(bytes, input.fileName, 'PREVIEW') !== 'pdf') throw badRequest('FILE_TYPE_NOT_ALLOWED', { accepted: ['PDF'] });

  const key = await blobs.store(bytes);
  try {
    await transaction(async (tx) => {
      const updated = await tx.row(
        `UPDATE ${S}.learning_asset_versions
            SET preview_storage_key = $2, preview_file_name = $3, preview_mime_type = 'application/pdf', preview_file_size = $4
          WHERE id = $1 AND preview_storage_key IS NULL
          RETURNING version_number`,
        [versionId, key, safeFileName(input.fileName), bytes.length]
      );
      if (!updated) throw conflict('PREVIEW_EXISTS');
      await record(tx, {
        ...base(vctx),
        versionId,
        eventType: 'VERSION_UPLOADED',
        metadata: { preview: true, versionNumber: updated.version_number },
      });
    });
  } catch (error) {
    await blobs.discard(key);
    throw error;
  }
  return getAsset(actor, vctx.asset.id);
}

/* ------------------------------------------------------------------ */
/* Review                                                               */
/* ------------------------------------------------------------------ */

/**
 * Submit, or resubmit after changes. A written asset whose draft has moved on
 * since its last version is snapshotted into a new immutable version first —
 * the reviewer always reviews a fixed version, never a live document.
 */
export async function submit(actor, assetId, input) {
  const body = plainObject(input, 'body');
  const notes = text(body.notes, 'notes', { max: 2000 }) ?? '';

  await act(actor, assetId, async ({ tx, actx, state, outbox }) => {
    const asset = actx.asset;
    let current = state.current;
    let versionSinceChanges = state.versionSinceChanges;

    if (isTextAsset(asset.assetType) && state.draftHasText && state.draftDiffers) {
      ensure(evaluate(actx, { hasContent: true, versionSinceChanges: true }), 'SUBMIT');
      const { next } = await tx.row(
        `SELECT coalesce(max(version_number), 0) + 1 AS next FROM ${S}.learning_asset_versions WHERE asset_id = $1`,
        [assetId]
      );
      current = await tx.row(
        `INSERT INTO ${S}.learning_asset_versions
           (organization_id, asset_id, version_number, source_kind, content_json, version_notes, created_by)
         VALUES ($1, $2, $3, 'CONTENT', $4, $5, $6)
         RETURNING id, version_number`,
        [actx.organizationId, assetId, next, JSON.stringify(normalizeContent(asset.assetType, state.draft.content_json)), notes, actx.userId]
      );
      await tx.query(`UPDATE ${S}.learning_assets SET current_version_id = $2 WHERE id = $1`, [assetId, current.id]);
      await record(tx, {
        ...base(actx),
        versionId: current.id,
        eventType: 'VERSION_UPLOADED',
        metadata: { versionNumber: next, content: true, notes: notes.slice(0, 280) },
      });
      asset.currentVersionId = current.id;
      versionSinceChanges = true;
    }

    ensure(evaluate(actx, { hasContent: Boolean(current), versionSinceChanges }), 'SUBMIT');

    const resubmission = asset.status === 'CHANGES_REQUESTED';
    await tx.query(
      `UPDATE ${S}.learning_assets
          SET status = $2, submitted_at = now(), submitted_by = $3, review_started_at = NULL,
              resubmitted_at = CASE WHEN $4::boolean THEN now() ELSE resubmitted_at END
        WHERE id = $1`,
      [assetId, resubmission ? 'RESUBMITTED' : 'SUBMITTED', actx.userId, resubmission]
    );
    await tx.query(
      `INSERT INTO ${S}.learning_asset_approvals
         (organization_id, asset_id, version_id, submitted_by, is_resubmission, reviewer_user_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [actx.organizationId, assetId, current.id, actx.userId, resubmission, asset.reviewerUserId]
    );
    const open = await openCommentCount(tx, assetId);
    await record(tx, {
      ...base(actx),
      versionId: current.id,
      eventType: resubmission ? 'RESUBMITTED' : 'SUBMITTED_FOR_REVIEW',
      metadata: { versionNumber: current.version_number, openComments: open, notes: notes.slice(0, 280) },
    });

    outbox.push({
      organizationId: actx.organizationId,
      actorId: actx.userId,
      recipients: asset.reviewerUserId ? [asset.reviewerUserId] : await courseManagers(tx, actx.course.id),
      type: resubmission ? 'resubmitted' : 'submitted',
      message: resubmission ? 'resubmitted' : 'submitted',
      dedupeKey: `review:${current.id}`,
      windowMinutes: WINDOW.ONCE,
      assetId,
      link: linkTo(actx),
      data: notice(actx, { versionNumber: current.version_number }),
    });
  });
  return getAsset(actor, assetId);
}

/** The reviewer opens the submission. Somebody reviewing unclaimed work becomes its reviewer. */
export async function startReview(actor, assetId) {
  await act(actor, assetId, async ({ tx, actx, state, evaluation }) => {
    ensure(evaluation, 'START_REVIEW');
    await markReviewStarted(tx, actx, state, { explicit: true });
  });
  return getAsset(actor, assetId);
}

async function markReviewStarted(tx, actx, state, { explicit = false } = {}) {
  const asset = actx.asset;
  if (asset.status === 'UNDER_REVIEW') return;
  const claim = !asset.reviewerUserId;
  await tx.query(
    `UPDATE ${S}.learning_assets
        SET status = CASE WHEN $3::boolean THEN 'UNDER_REVIEW' ELSE status END,
            review_started_at = coalesce(review_started_at, now()),
            reviewer_user_id = coalesce(reviewer_user_id, $2)
      WHERE id = $1`,
    [asset.id, actx.userId, explicit]
  );
  await tx.query(
    `UPDATE ${S}.learning_asset_approvals
        SET review_started_at = coalesce(review_started_at, now()), reviewer_user_id = coalesce(reviewer_user_id, $2)
      WHERE asset_id = $1 AND decision = 'PENDING'`,
    [asset.id, actx.userId]
  );
  if (claim) {
    await tx.query(
      `INSERT INTO ${S}.learning_asset_assignments
         (organization_id, asset_id, assignee_user_id, reviewer_user_id, due_date, priority, assigned_by)
       VALUES ($1, $2, $3, $4, $5, $6, $4)`,
      [actx.organizationId, asset.id, asset.assigneeUserId, actx.userId, asset.dueDate, asset.priority]
    );
    asset.reviewerUserId = actx.userId;
  }
  await record(tx, {
    ...base(actx),
    versionId: asset.currentVersionId,
    eventType: 'REVIEW_STARTED',
    metadata: { versionNumber: state.current?.version_number ?? null, implicit: !explicit },
  });
}

/**
 * Send the work back. The maker needs something to act on: an overall summary,
 * or at least one open comment — "changes requested" with nothing attached is
 * a conversation somebody has to start to decode.
 */
export async function requestChanges(actor, assetId, input) {
  const body = plainObject(input, 'body');
  const summary = text(body.summary, 'summary', { max: 5000 }) ?? '';

  await act(actor, assetId, async ({ tx, actx, state, evaluation, outbox }) => {
    ensure(evaluation, 'REQUEST_CHANGES');
    const open = await openCommentCount(tx, assetId);
    if (!summary && open === 0) throw badRequest('FEEDBACK_REQUIRED');

    await markReviewStarted(tx, actx, state);
    await tx.query(
      `UPDATE ${S}.learning_assets
          SET status = 'CHANGES_REQUESTED', changes_requested_at = now(), changes_requested_version_id = current_version_id
        WHERE id = $1`,
      [assetId]
    );
    const decision = await tx.row(
      `UPDATE ${S}.learning_asset_approvals
          SET decision = 'CHANGES_REQUESTED', reviewed_by = $2, reviewed_at = now(), notes = $3
        WHERE asset_id = $1 AND decision = 'PENDING'
        RETURNING id`,
      [assetId, actx.userId, summary]
    );
    await record(tx, {
      ...base(actx),
      versionId: actx.asset.currentVersionId,
      eventType: 'CHANGES_REQUESTED',
      metadata: { versionNumber: state.current?.version_number ?? null, openComments: open, summary: summary.slice(0, 280) },
    });
    outbox.push({
      organizationId: actx.organizationId,
      actorId: actx.userId,
      recipients: [actx.asset.assigneeUserId, actx.asset.submittedBy],
      type: 'changes_requested',
      message: 'changesRequested',
      dedupeKey: `changes:${decision?.id ?? actx.asset.currentVersionId}`,
      windowMinutes: WINDOW.ONCE,
      assetId,
      link: linkTo(actx),
      data: notice(actx, { openComments: open }),
    });
  });
  return getAsset(actor, assetId);
}

function milestoneCrossed(before, after, total) {
  if (!total) return null;
  const from = (before / total) * 100;
  const to = (after / total) * 100;
  return [100, 75, 50, 25].find((mark) => from < mark && to >= mark) ?? null;
}

/**
 * Approve the current version — that version and no other. With `lock`, and
 * the authority to lock, the asset is locked in the same step.
 */
export async function approve(actor, assetId, input) {
  const body = plainObject(input, 'body');
  const notes = text(body.notes, 'notes', { max: 5000 }) ?? '';
  const lock = body.lock === true;

  await act(actor, assetId, async ({ tx, actx, state, evaluation, outbox }) => {
    ensure(evaluation, 'APPROVE');
    const asset = actx.asset;
    if (lock && !actx.grants.has(P.ASSET_LOCK, asset.assetType)) throw forbidden('FORBIDDEN', { permission: P.ASSET_LOCK });

    if (asset.assetType === 'VIDEO') {
      const items = await ensureVersionChecklist(tx, actx, asset.currentVersionId);
      const pending = items.filter((item) => item.required && item.status !== 'PASSED');
      if (pending.length) throw conflict('CHECKLIST_INCOMPLETE', { pending: pending.length });
    }

    const before = await tx.row(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE a.status IN ('APPROVED', 'LOCKED'))::int AS complete
         FROM ${S}.learning_assets a
         JOIN ${S}.learning_lessons l ON l.id = a.lesson_id AND l.archived_at IS NULL
        WHERE a.course_id = $1`,
      [actx.course.id]
    );

    await markReviewStarted(tx, actx, state);
    await tx.query(
      `UPDATE ${S}.learning_assets
          SET status = $2, approved_at = now(), approved_by = $3, approved_version_id = current_version_id,
              locked_at = CASE WHEN $4::boolean THEN now() ELSE NULL END,
              locked_by = CASE WHEN $4::boolean THEN $3 ELSE NULL END
        WHERE id = $1`,
      [assetId, lock ? 'LOCKED' : 'APPROVED', actx.userId, lock]
    );
    await tx.query(
      `UPDATE ${S}.learning_asset_approvals
          SET decision = 'APPROVED', reviewed_by = $2, reviewed_at = now(), notes = $3
        WHERE asset_id = $1 AND decision = 'PENDING'`,
      [assetId, actx.userId, notes]
    );

    const versionNumber = state.current?.version_number ?? null;
    await record(tx, {
      ...base(actx),
      versionId: asset.currentVersionId,
      eventType: 'APPROVED',
      metadata: {
        versionNumber,
        notes: notes.slice(0, 280),
        courseMilestone: milestoneCrossed(before.complete, before.complete + 1, before.total),
      },
    });
    if (lock) {
      await record(tx, { ...base(actx), versionId: asset.currentVersionId, eventType: 'LOCKED', metadata: { versionNumber, withApproval: true } });
    }

    outbox.push({
      organizationId: actx.organizationId,
      actorId: actx.userId,
      recipients: [asset.assigneeUserId, asset.submittedBy],
      type: 'approved',
      message: 'approved',
      dedupeKey: `approved:${asset.currentVersionId}`,
      windowMinutes: WINDOW.ONCE,
      assetId,
      link: linkTo(actx),
      data: notice(actx, { versionNumber }),
    });
  });
  return getAsset(actor, assetId);
}

export async function lock(actor, assetId) {
  await act(actor, assetId, async ({ tx, actx, state, evaluation }) => {
    ensure(evaluation, 'LOCK');
    await tx.query(`UPDATE ${S}.learning_assets SET status = 'LOCKED', locked_at = now(), locked_by = $2 WHERE id = $1`, [
      assetId,
      actx.userId,
    ]);
    await record(tx, {
      ...base(actx),
      versionId: actx.asset.currentVersionId,
      eventType: 'LOCKED',
      metadata: { versionNumber: state.current?.version_number ?? null },
    });
  });
  return getAsset(actor, assetId);
}

function reason(value) {
  const clean = typeof value === 'string' ? value.trim() : '';
  if (!clean) throw badRequest('REASON_REQUIRED');
  if (clean.length > 1000) throw validation('reason', 'too_long', { max: 1000 });
  return clean;
}

/** Reopen approved or locked work. The reason is kept; the approval history is untouched. */
export async function reopen(actor, assetId, input) {
  const why = reason(plainObject(input, 'body').reason);
  await act(actor, assetId, async ({ tx, actx, state, evaluation, outbox }) => {
    ensure(evaluation, 'REOPEN');
    const from = actx.asset.status;
    await tx.query(
      `UPDATE ${S}.learning_assets
          SET status = 'IN_PROGRESS', work_started_at = now(),
              approved_at = NULL, approved_by = NULL, approved_version_id = NULL,
              locked_at = NULL, locked_by = NULL,
              submitted_at = NULL, submitted_by = NULL, review_started_at = NULL,
              changes_requested_at = NULL, changes_requested_version_id = NULL, resubmitted_at = NULL
        WHERE id = $1`,
      [assetId]
    );
    await record(tx, {
      ...base(actx),
      versionId: actx.asset.currentVersionId,
      eventType: 'REOPENED',
      metadata: { reason: why, from, versionNumber: state.current?.version_number ?? null },
    });
    outbox.push({
      organizationId: actx.organizationId,
      actorId: actx.userId,
      recipients: [actx.asset.assigneeUserId],
      type: 'reopened',
      message: 'reopened',
      dedupeKey: `reopened:${assetId}`,
      windowMinutes: WINDOW.SHORT,
      assetId,
      link: linkTo(actx),
      data: notice(actx, { reason: why.slice(0, 120) }),
    });
  });
  return getAsset(actor, assetId);
}

/** Let one blocked asset start early. Recorded with who, when and why. */
export async function overrideDependency(actor, assetId, input) {
  const why = reason(plainObject(input, 'body').reason);
  await act(actor, assetId, async ({ tx, actx, evaluation }) => {
    ensure(evaluation, 'OVERRIDE_DEPENDENCY');
    await tx.query(
      `UPDATE ${S}.learning_assets
          SET dependency_override_by = $2, dependency_override_at = now(), dependency_override_reason = $3
        WHERE id = $1`,
      [assetId, actx.userId, why]
    );
    await record(tx, {
      ...base(actx),
      eventType: 'DEPENDENCY_OVERRIDDEN',
      metadata: { reason: why, waitingFor: evaluation.dependencies.waitingFor },
    });
  });
  return getAsset(actor, assetId);
}

/* ------------------------------------------------------------------ */
/* Versions and files                                                   */
/* ------------------------------------------------------------------ */

export async function getVersion(actor, versionId) {
  const vctx = await versionContext(actor, versionId);
  const version = mapVersion(vctx.version, { withContent: true });
  return {
    version,
    asset: { id: vctx.asset.id, assetType: vctx.asset.assetType, lessonId: vctx.lesson.id, courseId: vctx.course.id },
    people: await peopleFor([version.createdBy]),
  };
}

/** The bytes of a version — the original, or its PDF preview — after the access check. */
export async function versionFile(actor, versionId, variant) {
  const vctx = await versionContext(actor, versionId);
  const version = vctx.version;
  const preview = variant === 'preview';
  const key = preview ? version.preview_storage_key : version.storage_key;
  if (!key) return null;
  const bytes = await blobs.load(key);
  if (!bytes) return null;
  return {
    bytes,
    mimeType: preview ? version.preview_mime_type : version.mime_type,
    fileName: preview ? version.preview_file_name : version.file_name,
  };
}
