/**
 * A revamp's baseline and change impact.
 *
 * Before a revamp starts work, the team records against the source release
 * what stays (KEEP — its approval is referenced, not copied), what changes
 * (CHANGE — the asset reopens and must earn a new approval on a new version)
 * and what goes (REMOVE — the lesson is archived). The decisions are signed
 * off through the "Record the change impact" task; applying them is a
 * separate, explicit step.
 *
 * Nothing here duplicates an approval: a kept asset still points at the very
 * version approved before, and a changed one keeps that approval in its
 * history while its new version waits for its own.
 */

import { ASSET_TYPES } from '../../../shared/learningProduction/constants.js';
import { IMPACT_DECISIONS } from '../../../shared/learningProduction/runs.js';
import { LP_PERMISSIONS as P } from '../../../shared/learningProduction/permissions.js';
import { SCHEMA as S, direct } from '../db.js';
import { requireGrant } from '../access.js';
import { record } from '../activity.js';
import { transactionWithOutbox } from '../notifications.js';
import { conflict, validation, workflowRefusal } from '../errors.js';
import { peopleFor } from '../people.js';
import { bodyId, oneOf, plainObject, text } from '../validate.js';
import { syncRun } from '../runSync.js';
import { runContext } from './runContext.js';

const iso = (value) => (value instanceof Date ? value.toISOString() : value ?? null);

async function impactTask(db, runId) {
  return db.row(`SELECT id, status FROM ${S}.learning_task_instances WHERE run_id = $1 AND task_key = 'impact.review'`, [runId]);
}

export async function getImpact(actor, runId) {
  const ctx = await runContext(actor, runId);
  if (ctx.run.scenario !== 'REVAMP') throw workflowRefusal('NOT_SUPPORTED');
  const [items, task, source] = await Promise.all([
    direct.rows(`SELECT * FROM ${S}.learning_change_impact_items WHERE run_id = $1`, [runId]),
    impactTask(direct, runId),
    direct.row(`SELECT source_snapshot_json FROM ${S}.learning_production_runs WHERE id = $1`, [runId]),
  ]);
  const release = ctx.run.sourceReleaseId
    ? await direct.row(`SELECT id, version_label, kind, published_at FROM ${S}.learning_releases WHERE id = $1`, [ctx.run.sourceReleaseId])
    : null;
  const applied = items.some((item) => item.applied_at);
  const editable = ctx.runOpen && ctx.grants.has(P.RUN_MANAGE) && !applied && (!task || !['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'].includes(task.status));
  return {
    sourceRelease: release
      ? { id: release.id, versionLabel: release.version_label, kind: release.kind, publishedAt: iso(release.published_at) }
      : null,
    snapshot: source?.source_snapshot_json ?? null,
    items: items.map((item) => ({
      id: item.id,
      lessonId: item.lesson_id,
      assetType: item.asset_type,
      sourceVersionId: item.source_version_id,
      decision: item.decision,
      note: item.note,
      decidedBy: item.decided_by,
      decidedAt: iso(item.decided_at),
      appliedAt: iso(item.applied_at),
    })),
    taskId: task?.id ?? null,
    taskStatus: task?.status ?? null,
    applied,
    canEdit: editable,
    canApply: ctx.runOpen && ctx.grants.has(P.RUN_MANAGE) && task?.status === 'APPROVED' && !applied && items.length > 0,
    people: await peopleFor(items.map((item) => item.decided_by)),
  };
}

/**
 * Record decisions: `{ items: [{ lessonId, assetType?, decision, note }] }`.
 * The set replaces the previous one whole — a lesson switched back from
 * "change the slides" to "keep" must not keep a stale per-asset decision.
 */
export async function saveImpact(actor, runId, input) {
  const body = plainObject(input, 'body');
  if (!Array.isArray(body.items) || body.items.length === 0) throw validation('items', 'required');
  if (body.items.length > 2000) throw validation('items', 'too_many', { max: 2000 });
  const parsed = body.items.map((entry, index) => {
    const item = plainObject(entry, `items.${index}`);
    return {
      lessonId: bodyId(item.lessonId, `items.${index}.lessonId`),
      assetType: item.assetType ? oneOf(item.assetType, ASSET_TYPES, `items.${index}.assetType`) : null,
      decision: oneOf(item.decision, IMPACT_DECISIONS, `items.${index}.decision`, { required: true }),
      note: text(item.note, `items.${index}.note`, { max: 1000 }) ?? '',
    };
  });
  // One decision per line: a repeated line keeps its last decision.
  const items = [...new Map(parsed.map((item) => [`${item.lessonId}|${item.assetType ?? ''}`, item])).values()];

  await transactionWithOutbox([], async (tx) => {
    const ctx = await runContext(actor, runId, { db: tx, lock: true });
    requireGrant(ctx, P.RUN_MANAGE);
    if (!ctx.runOpen) throw workflowRefusal('RUN_CLOSED');
    if (ctx.run.scenario !== 'REVAMP') throw workflowRefusal('NOT_SUPPORTED');
    const task = await impactTask(tx, runId);
    if (task && ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'].includes(task.status)) throw workflowRefusal('IMPACT_LOCKED');
    const applied = await tx.row(`SELECT 1 FROM ${S}.learning_change_impact_items WHERE run_id = $1 AND applied_at IS NOT NULL LIMIT 1`, [runId]);
    if (applied) throw workflowRefusal('IMPACT_LOCKED');

    const snapshotLessons = new Map(
      ((await tx.row(`SELECT source_snapshot_json FROM ${S}.learning_production_runs WHERE id = $1`, [runId]))?.source_snapshot_json?.lessons ?? []).map(
        (lesson) => [lesson.id, lesson]
      )
    );
    await tx.query(`DELETE FROM ${S}.learning_change_impact_items WHERE run_id = $1`, [runId]);
    for (const item of items) {
      if (item.lessonId && !snapshotLessons.has(item.lessonId)) throw validation('lessonId', 'not_in_source');
      if (item.decision === 'REMOVE' && item.assetType) throw validation('decision', 'remove_whole_lesson');
      const sourceVersionId = item.lessonId && item.assetType
        ? snapshotLessons.get(item.lessonId)?.assets.find((asset) => asset.type === item.assetType)?.approvedVersionId ?? null
        : null;
      await tx.query(
        `INSERT INTO ${S}.learning_change_impact_items
           (organization_id, run_id, lesson_id, asset_type, source_version_id, decision, note, decided_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [ctx.organizationId, runId, item.lessonId, item.assetType, sourceVersionId, item.decision, item.note, ctx.userId]
      );
    }
    await record(tx, {
      organizationId: ctx.organizationId,
      courseId: ctx.course.id,
      runId,
      actorUserId: ctx.userId,
      eventType: 'IMPACT_RECORDED',
      metadata: {
        count: items.length,
        change: items.filter((item) => item.decision === 'CHANGE').length,
        remove: items.filter((item) => item.decision === 'REMOVE').length,
      },
    });
  });
  return getImpact(actor, runId);
}

/**
 * Apply the signed-off decisions: reopen what changes, archive what is
 * removed. Kept assets are left exactly as they are.
 */
export async function applyImpact(actor, runId) {
  const outbox = [];
  await transactionWithOutbox(outbox, async (tx) => {
    const ctx = await runContext(actor, runId, { db: tx, lock: true });
    requireGrant(ctx, P.RUN_MANAGE);
    if (!ctx.runOpen) throw workflowRefusal('RUN_CLOSED');
    const task = await impactTask(tx, runId);
    if (task?.status !== 'APPROVED') throw workflowRefusal('APPROVAL_REQUIRED');
    const items = await tx.rows(`SELECT * FROM ${S}.learning_change_impact_items WHERE run_id = $1 FOR UPDATE`, [runId]);
    if (items.some((item) => item.applied_at)) throw conflict('IMPACT_APPLIED');
    const reason = `Revamp run #${ctx.run.runNumber}: change impact`;

    let reopened = 0;
    let archived = 0;
    for (const item of items) {
      if (item.decision === 'CHANGE') {
        const assets = await tx.rows(
          `SELECT id, lesson_id, status, current_version_id FROM ${S}.learning_assets
            WHERE lesson_id = $1 AND applicable AND status IN ('APPROVED', 'LOCKED')
              ${item.asset_type ? 'AND asset_type = $2' : ''}
            FOR UPDATE`,
          item.asset_type ? [item.lesson_id, item.asset_type] : [item.lesson_id]
        );
        for (const asset of assets) {
          await tx.query(
            `UPDATE ${S}.learning_assets
                SET status = 'IN_PROGRESS', work_started_at = now(),
                    approved_at = NULL, approved_by = NULL, approved_version_id = NULL,
                    locked_at = NULL, locked_by = NULL, submitted_at = NULL, submitted_by = NULL, review_started_at = NULL,
                    changes_requested_at = NULL, changes_requested_version_id = NULL, resubmitted_at = NULL
              WHERE id = $1`,
            [asset.id]
          );
          await record(tx, {
            organizationId: ctx.organizationId,
            courseId: ctx.course.id,
            lessonId: asset.lesson_id,
            assetId: asset.id,
            versionId: asset.current_version_id,
            runId,
            actorUserId: ctx.userId,
            eventType: 'REOPENED',
            metadata: { reason, from: asset.status, revamp: true },
          });
          reopened += 1;
        }
      } else if (item.decision === 'REMOVE' && item.lesson_id) {
        const lesson = await tx.row(
          `UPDATE ${S}.learning_lessons SET archived_at = now(), archived_by = $2 WHERE id = $1 AND archived_at IS NULL RETURNING id, name`,
          [item.lesson_id, ctx.userId]
        );
        if (lesson) {
          await record(tx, {
            organizationId: ctx.organizationId,
            courseId: ctx.course.id,
            lessonId: lesson.id,
            runId,
            actorUserId: ctx.userId,
            eventType: 'LESSON_ARCHIVED',
            metadata: { name: lesson.name, reason },
          });
          archived += 1;
        }
      }
    }
    await tx.query(`UPDATE ${S}.learning_change_impact_items SET applied_at = now(), applied_by = $2 WHERE run_id = $1`, [runId, ctx.userId]);
    await record(tx, {
      organizationId: ctx.organizationId,
      courseId: ctx.course.id,
      runId,
      actorUserId: ctx.userId,
      eventType: 'IMPACT_APPLIED',
      metadata: { reopened, archived, kept: items.filter((item) => item.decision === 'KEEP').length },
    });
    await syncRun(tx, runId, { actorId: ctx.userId, outbox });
  });
  return getImpact(actor, runId);
}
