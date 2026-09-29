/**
 * Releases: what a run publishes.
 *
 * Publication is an explicit, gated action in three steps, each by someone
 * with the authority for it:
 *
 *   prepare   the production manager freezes a candidate — every lesson and
 *             the exact approved version of each of its assets, plus the
 *             approved deliverables of the run's tasks — once every stage
 *             before Release is done and nothing blocking is open;
 *   sign off  somebody other than the preparer (an administrator may, with a
 *             reason) confirms it;
 *   publish   somebody records the deployment: the platform link and notes.
 *             There is no LMS API; this system records and verifies a manual
 *             deployment rather than pretending to perform one.
 *
 * A published release supersedes the previous one; a rollback restores the
 * previous one as current. Nothing is ever rewritten — the rows are guarded
 * by a trigger, and the versions they point at are immutable.
 */

import { OPEN_RUN_STATUSES, nextReleaseLabel, runProgress } from '../../../shared/learningProduction/runs.js';
import { LP_PERMISSIONS as P } from '../../../shared/learningProduction/permissions.js';
import { SCHEMA as S, direct } from '../db.js';
import { courseContext, requireGrant } from '../access.js';
import { record } from '../activity.js';
import { WINDOW, releaseLink, transactionWithOutbox } from '../notifications.js';
import { badRequest, conflict, forbidden, notFound, workflowRefusal } from '../errors.js';
import { mapRelease } from '../runMappers.js';
import { peopleFor, userIdsIn } from '../people.js';
import { httpsUrl, plainObject, text } from '../validate.js';
import { syncRun } from '../runSync.js';
import { runContext } from './runContext.js';

/**
 * The content of a course as it stands: every lesson not archived, and for
 * each applicable asset its status and approved version. Used for release
 * candidates and for a revamp's baseline.
 */
export async function buildSnapshot(db, courseId, { runId = null } = {}) {
  const rows = await db.rows(
    `SELECT l.id AS lesson_id, l.name AS lesson_name, l.sort_order, m.name AS module_name, m.sort_order AS module_order,
            a.id AS asset_id, a.asset_type, a.status, a.applicable, a.approved_version_id, v.version_number
       FROM ${S}.learning_lessons l
       LEFT JOIN ${S}.learning_course_modules m ON m.id = l.module_id
       LEFT JOIN ${S}.learning_assets a ON a.lesson_id = l.id
       LEFT JOIN ${S}.learning_asset_versions v ON v.id = a.approved_version_id
      WHERE l.course_id = $1 AND l.archived_at IS NULL
      ORDER BY coalesce(m.sort_order, 99999), l.sort_order, l.created_at`,
    [courseId]
  );
  const lessons = new Map();
  for (const row of rows) {
    if (!lessons.has(row.lesson_id)) {
      lessons.set(row.lesson_id, { id: row.lesson_id, name: row.lesson_name, moduleName: row.module_name ?? null, assets: [] });
    }
    if (row.asset_id) {
      lessons.get(row.lesson_id).assets.push({
        type: row.asset_type,
        assetId: row.asset_id,
        status: row.status,
        applicable: row.applicable,
        approvedVersionId: row.approved_version_id ?? null,
        versionNumber: row.version_number ?? null,
      });
    }
  }

  let deliverables = [];
  if (runId) {
    deliverables = (
      await db.rows(
        `SELECT t.task_key, t.label_json, s.id AS submission_id, s.submission_number, s.evidence_ids
           FROM ${S}.learning_task_instances t
           JOIN LATERAL (
             SELECT * FROM ${S}.learning_task_submissions sub
              WHERE sub.task_id = t.id AND sub.decision = 'APPROVED'
              ORDER BY sub.submission_number DESC LIMIT 1
           ) s ON true
          WHERE t.run_id = $1 AND t.status = 'APPROVED'
          ORDER BY t.task_key`,
        [runId]
      )
    ).map((row) => ({
      taskKey: row.task_key,
      label: row.label_json,
      submissionId: row.submission_id,
      submissionNumber: row.submission_number,
      evidenceIds: row.evidence_ids ?? [],
    }));
  }

  const list = [...lessons.values()];
  const applicable = list.flatMap((lesson) => lesson.assets.filter((asset) => asset.applicable));
  return {
    snapshot: { takenAt: new Date().toISOString(), lessons: list, deliverables },
    summary: {
      lessons: list.length,
      assets: applicable.length,
      approvedAssets: applicable.filter((asset) => asset.approvedVersionId && ['APPROVED', 'LOCKED'].includes(asset.status)).length,
      deliverables: deliverables.length,
    },
  };
}

/** Assets whose approved version moved since the snapshot — the candidate is no longer what it says. */
async function staleAssets(db, snapshot) {
  const expected = new Map();
  for (const lesson of snapshot?.lessons ?? []) {
    for (const asset of lesson.assets) if (asset.applicable) expected.set(asset.assetId, asset.approvedVersionId);
  }
  if (expected.size === 0) return [];
  const current = await db.rows(
    `SELECT id, status, approved_version_id, applicable FROM ${S}.learning_assets WHERE id = ANY($1::uuid[])`,
    [[...expected.keys()]]
  );
  return current
    .filter((row) => row.applicable && (row.approved_version_id !== expected.get(row.id) || !['APPROVED', 'LOCKED'].includes(row.status)))
    .map((row) => row.id);
}

async function releaseRow(db, actor, releaseId, { lock = false } = {}) {
  const row = await db.row(
    `SELECT rel.*, r.run_number FROM ${S}.learning_releases rel
       LEFT JOIN ${S}.learning_production_runs r ON r.id = rel.run_id
      WHERE rel.id = $1 AND rel.organization_id = $2 ${lock ? 'FOR UPDATE OF rel' : ''}`,
    [releaseId, actor.organizationId]
  );
  if (!row) throw notFound();
  return row;
}

async function releaseManagers(db, courseId, runManager) {
  const found = await db.rows(
    `SELECT user_id FROM ${S}.learning_course_members
      WHERE course_id = $1 AND roles && ARRAY['PRODUCTION_MANAGER', 'COURSE_MANAGER']::text[]`,
    [courseId]
  );
  return [...new Set([runManager, ...found.map((row) => row.user_id)].filter(Boolean))];
}

export async function listReleases(actor, courseId) {
  const ctx = await courseContext(actor, courseId);
  const rows = await direct.rows(
    `SELECT rel.*, r.run_number FROM ${S}.learning_releases rel
       LEFT JOIN ${S}.learning_production_runs r ON r.id = rel.run_id
      WHERE rel.course_id = $1 ORDER BY rel.release_number DESC`,
    [courseId]
  );
  const releases = rows.map((row) => mapRelease(row));
  return {
    releases,
    currentReleaseId: ctx.course.currentReleaseId,
    people: await peopleFor(userIdsIn(releases)),
  };
}

export async function getRelease(actor, releaseId) {
  const row = await releaseRow(direct, actor, releaseId);
  await courseContext(actor, row.course_id);
  const release = mapRelease(row, { withSnapshot: true });
  return { release, stale: row.status === 'CANDIDATE' || row.status === 'SIGNED_OFF' ? await staleAssets(direct, row.snapshot_json) : [], people: await peopleFor(userIdsIn([release])) };
}

/** Freeze a release candidate from the run's approved content. */
export async function prepareRelease(actor, runId, input) {
  const body = plainObject(input, 'body');
  const notes = text(body.notes, 'notes', { max: 2000 }) ?? '';
  const outbox = [];

  const releaseId = await transactionWithOutbox(outbox, async (tx) => {
    const ctx = await runContext(actor, runId, { db: tx, lock: true });
    requireGrant(ctx, P.RUN_MANAGE);
    if (!ctx.runOpen) throw workflowRefusal('RUN_CLOSED');
    if (ctx.run.scenario === 'LEGACY') throw workflowRefusal('LEGACY_RUN');

    const live = await tx.row(
      `SELECT id FROM ${S}.learning_releases WHERE run_id = $1 AND status IN ('CANDIDATE', 'SIGNED_OFF')`,
      [runId]
    );
    if (live) throw conflict('RELEASE_IN_PROGRESS', { releaseId: live.id });

    const computed = await syncRun(tx, runId, { actorId: ctx.userId, outbox });
    const progress = runProgress({ ...computed, lessonAssetTypes: ctx.run.lessonAssetTypes, scenario: ctx.run.scenario });
    if (!progress.readiness.readyForSignoff) {
      throw conflict('RELEASE_NOT_READY', { failing: progress.readiness.checks.filter((check) => !check.ok && !check.gate).map((check) => check.id) });
    }

    const previous = await tx.row(
      `SELECT version_label FROM ${S}.learning_releases
        WHERE course_id = $1 AND published_at IS NOT NULL ORDER BY release_number DESC LIMIT 1`,
      [ctx.course.id]
    );
    const suggested = nextReleaseLabel(previous?.version_label, { major: ctx.run.scenario === 'REVAMP' });
    const versionLabel = text(body.versionLabel, 'versionLabel', { max: 40 }) || (previous ? suggested : 'r1.0.0');
    const taken = await tx.row(
      `SELECT 1 FROM ${S}.learning_releases WHERE course_id = $1 AND lower(version_label) = lower($2)`,
      [ctx.course.id, versionLabel]
    );
    if (taken) throw conflict('RELEASE_LABEL_TAKEN', { versionLabel });

    const { snapshot, summary } = await buildSnapshot(tx, ctx.course.id, { runId });
    const inserted = await tx.row(
      `INSERT INTO ${S}.learning_releases
         (organization_id, course_id, run_id, release_number, version_label, kind, status, snapshot_json, summary_json, notes, prepared_by)
       SELECT $1, $2, $3, coalesce(max(release_number), 0) + 1, $4, 'RELEASE', 'CANDIDATE', $5, $6, $7, $8
         FROM ${S}.learning_releases WHERE course_id = $2
       RETURNING id, version_label`,
      [ctx.organizationId, ctx.course.id, runId, versionLabel, JSON.stringify(snapshot), JSON.stringify(summary), notes, ctx.userId]
    );
    await record(tx, {
      organizationId: ctx.organizationId,
      courseId: ctx.course.id,
      runId,
      releaseId: inserted.id,
      actorUserId: ctx.userId,
      eventType: 'RELEASE_PREPARED',
      metadata: { versionLabel, summary },
    });
    outbox.push({
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      recipients: await releaseManagers(tx, ctx.course.id, ctx.run.managerUserId),
      type: 'release_ready',
      message: 'releaseReady',
      dedupeKey: `release-ready:${inserted.id}`,
      windowMinutes: WINDOW.ONCE,
      entityType: 'RELEASE',
      entityId: inserted.id,
      link: releaseLink({ courseId: ctx.course.id, releaseId: inserted.id }),
      data: { courseName: ctx.course.name, versionLabel },
    });
    return inserted.id;
  });
  return getRelease(actor, releaseId);
}

export async function signoffRelease(actor, releaseId, input) {
  const body = plainObject(input, 'body');
  const notes = text(body.notes, 'notes', { max: 2000 }) ?? '';
  const overrideReason = text(body.overrideReason, 'overrideReason', { max: 1000 }) || null;
  const outbox = [];

  await transactionWithOutbox(outbox, async (tx) => {
    const row = await releaseRow(tx, actor, releaseId, { lock: true });
    const ctx = await runContext(actor, row.run_id, { db: tx });
    requireGrant(ctx, P.RELEASE_SIGNOFF);
    if (row.status !== 'CANDIDATE') throw workflowRefusal('INVALID_TRANSITION');
    if (row.prepared_by === ctx.userId) {
      if (!ctx.grants.isAdmin) throw forbidden('OWN_WORK');
      if (!overrideReason) throw badRequest('REASON_REQUIRED');
    }
    const stale = await staleAssets(tx, row.snapshot_json);
    if (stale.length) throw conflict('RELEASE_STALE', { assets: stale.length });

    await tx.query(
      `UPDATE ${S}.learning_releases
          SET status = 'SIGNED_OFF', signoff_by = $2, signoff_at = now(), signoff_notes = $3, signoff_override_reason = $4
        WHERE id = $1`,
      [releaseId, ctx.userId, notes, row.prepared_by === ctx.userId ? overrideReason : null]
    );
    await record(tx, {
      organizationId: ctx.organizationId,
      courseId: row.course_id,
      runId: row.run_id,
      releaseId,
      actorUserId: ctx.userId,
      eventType: 'RELEASE_SIGNED_OFF',
      metadata: { versionLabel: row.version_label, override: row.prepared_by === ctx.userId },
    });
    await syncRun(tx, row.run_id, { actorId: ctx.userId, outbox });
    outbox.push({
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      recipients: [row.prepared_by, ...(await releaseManagers(tx, row.course_id, ctx.run.managerUserId))],
      type: 'release_signed_off',
      message: 'releaseSignedOff',
      dedupeKey: `release-signed:${releaseId}`,
      windowMinutes: WINDOW.ONCE,
      entityType: 'RELEASE',
      entityId: releaseId,
      link: releaseLink({ courseId: row.course_id, releaseId }),
      data: { courseName: ctx.course.name, versionLabel: row.version_label },
    });
  });
  return getRelease(actor, releaseId);
}

/**
 * Record the deployment and make the release current. The run is released,
 * and the release it replaces is superseded — both in one transaction.
 */
export async function publishRelease(actor, releaseId, input) {
  const body = plainObject(input, 'body');
  const platformUrl = httpsUrl(body.platformUrl, 'platformUrl');
  const deploymentNotes = text(body.deploymentNotes, 'deploymentNotes', { max: 4000 }) ?? '';
  const outbox = [];

  await transactionWithOutbox(outbox, async (tx) => {
    const row = await releaseRow(tx, actor, releaseId, { lock: true });
    const ctx = await runContext(actor, row.run_id, { db: tx, lock: true });
    requireGrant(ctx, P.RELEASE_PUBLISH);
    if (row.status !== 'SIGNED_OFF') throw workflowRefusal(row.status === 'CANDIDATE' ? 'SIGNOFF_REQUIRED' : 'INVALID_TRANSITION');
    if (!OPEN_RUN_STATUSES.includes(ctx.run.status)) throw workflowRefusal('RUN_CLOSED');
    const stale = await staleAssets(tx, row.snapshot_json);
    if (stale.length) throw conflict('RELEASE_STALE', { assets: stale.length });

    const course = await tx.row(`SELECT current_release_id FROM ${S}.learning_courses WHERE id = $1 FOR UPDATE`, [row.course_id]);
    if (course.current_release_id && course.current_release_id !== releaseId) {
      await tx.query(
        `UPDATE ${S}.learning_releases SET status = 'SUPERSEDED', superseded_at = now(), superseded_by_release_id = $2
          WHERE id = $1 AND status = 'PUBLISHED'`,
        [course.current_release_id, releaseId]
      );
    }
    await tx.query(
      `UPDATE ${S}.learning_releases
          SET status = 'PUBLISHED', published_by = $2, published_at = now(), platform_url = $3, deployment_notes = $4
        WHERE id = $1`,
      [releaseId, ctx.userId, platformUrl, deploymentNotes]
    );
    await tx.query(`UPDATE ${S}.learning_courses SET current_release_id = $2 WHERE id = $1`, [row.course_id, releaseId]);
    await record(tx, {
      organizationId: ctx.organizationId,
      courseId: row.course_id,
      runId: row.run_id,
      releaseId,
      actorUserId: ctx.userId,
      eventType: 'RELEASE_PUBLISHED',
      metadata: { versionLabel: row.version_label, platformUrl, superseded: course.current_release_id ?? null },
    });
    await syncRun(tx, row.run_id, { actorId: ctx.userId, outbox });
    await tx.query(
      `UPDATE ${S}.learning_production_runs SET status = 'RELEASED', released_at = now() WHERE id = $1`,
      [row.run_id]
    );
    await record(tx, {
      organizationId: ctx.organizationId,
      courseId: row.course_id,
      runId: row.run_id,
      actorUserId: ctx.userId,
      eventType: 'RUN_STATUS_CHANGED',
      metadata: { from: ctx.run.status, to: 'RELEASED', releaseId },
    });
    outbox.push({
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      recipients: await releaseManagers(tx, row.course_id, ctx.run.managerUserId),
      type: 'release_published',
      message: 'releasePublished',
      dedupeKey: `release-published:${releaseId}`,
      windowMinutes: WINDOW.ONCE,
      entityType: 'RELEASE',
      entityId: releaseId,
      link: releaseLink({ courseId: row.course_id, releaseId }),
      data: { courseName: ctx.course.name, versionLabel: row.version_label },
    });
  });
  return getRelease(actor, releaseId);
}

/** Withdraw a candidate that will not be published. Its record stays. */
export async function withdrawRelease(actor, releaseId, input) {
  const reason = text(plainObject(input, 'body').reason, 'reason', { max: 1000 });
  if (!reason) throw badRequest('REASON_REQUIRED');
  const outbox = [];
  await transactionWithOutbox(outbox, async (tx) => {
    const row = await releaseRow(tx, actor, releaseId, { lock: true });
    const ctx = await runContext(actor, row.run_id, { db: tx });
    requireGrant(ctx, P.RUN_MANAGE);
    if (!['CANDIDATE', 'SIGNED_OFF'].includes(row.status)) throw workflowRefusal('INVALID_TRANSITION');
    await tx.query(
      `UPDATE ${S}.learning_releases SET status = 'WITHDRAWN', withdrawn_at = now(), withdrawn_by = $2, withdraw_reason = $3 WHERE id = $1`,
      [releaseId, ctx.userId, reason]
    );
    await record(tx, {
      organizationId: ctx.organizationId,
      courseId: row.course_id,
      runId: row.run_id,
      releaseId,
      actorUserId: ctx.userId,
      eventType: 'RELEASE_WITHDRAWN',
      metadata: { versionLabel: row.version_label, reason },
    });
    await syncRun(tx, row.run_id, { actorId: ctx.userId, outbox });
  });
  return getRelease(actor, releaseId);
}

/**
 * Roll the current release back: it is marked rolled back, with a reason, and
 * the release it superseded becomes current again. The run stays released —
 * fixing what went wrong is a new run.
 */
export async function rollbackRelease(actor, releaseId, input) {
  const reason = text(plainObject(input, 'body').reason, 'reason', { max: 1000 });
  if (!reason) throw badRequest('REASON_REQUIRED');
  const outbox = [];
  await transactionWithOutbox(outbox, async (tx) => {
    const row = await releaseRow(tx, actor, releaseId, { lock: true });
    const ctx = await courseContext(actor, row.course_id, { db: tx });
    requireGrant(ctx, P.RELEASE_PUBLISH);
    const course = await tx.row(`SELECT current_release_id FROM ${S}.learning_courses WHERE id = $1 FOR UPDATE`, [row.course_id]);
    if (row.status !== 'PUBLISHED' || course.current_release_id !== releaseId) throw workflowRefusal('INVALID_TRANSITION');
    const previous = await tx.row(`SELECT id FROM ${S}.learning_releases WHERE superseded_by_release_id = $1`, [releaseId]);
    await tx.query(
      `UPDATE ${S}.learning_releases SET status = 'ROLLED_BACK', rolled_back_at = now(), rolled_back_by = $2, rollback_reason = $3 WHERE id = $1`,
      [releaseId, ctx.userId, reason]
    );
    await tx.query(`UPDATE ${S}.learning_courses SET current_release_id = $2 WHERE id = $1`, [row.course_id, previous?.id ?? null]);
    await record(tx, {
      organizationId: ctx.organizationId,
      courseId: row.course_id,
      runId: row.run_id,
      releaseId,
      actorUserId: ctx.userId,
      eventType: 'RELEASE_ROLLED_BACK',
      metadata: { versionLabel: row.version_label, reason, restored: previous?.id ?? null },
    });
    outbox.push({
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      recipients: await releaseManagers(tx, row.course_id, null),
      type: 'release_rolled_back',
      message: 'releaseRolledBack',
      dedupeKey: `release-rollback:${releaseId}`,
      windowMinutes: WINDOW.ONCE,
      entityType: 'RELEASE',
      entityId: releaseId,
      link: releaseLink({ courseId: row.course_id, releaseId }),
      data: { courseName: ctx.course.name, versionLabel: row.version_label, reason: reason.slice(0, 120) },
    });
  });
  return getRelease(actor, releaseId);
}
