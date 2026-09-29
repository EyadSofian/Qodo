/**
 * Dry-run and UAT issues.
 *
 * First Dry Run r25–r26: "Document all issues appeared" and "Send documented
 * issues to responsible team to act on (Operations, Content, Product)". Each
 * issue belongs to the stage whose review found it, has one owner, and moves
 * OPEN → IN_PROGRESS → FIXED → VERIFIED. Verification is by somebody other
 * than the person who fixed it. An issue nobody will fix is closed as
 * WONT_FIX, with a reason, by someone who may assign work in that stage.
 *
 * The stage's automatic gate ("every issue fixed and verified") and release
 * readiness ("no high or critical issue open") read these rows.
 */

import { ISSUE_AREAS, ISSUE_SEVERITIES, ISSUE_STATUSES } from '../../../shared/learningProduction/runs.js';
import { LP_PERMISSIONS as P } from '../../../shared/learningProduction/permissions.js';
import { SCHEMA as S, direct } from '../db.js';
import { record } from '../activity.js';
import { WINDOW, issueLink, transactionWithOutbox } from '../notifications.js';
import { badRequest, forbidden, notFound, validation, workflowRefusal } from '../errors.js';
import { mapIssue } from '../runMappers.js';
import { assertAssignable, peopleFor, userIdField, userIdsIn } from '../people.js';
import { bodyId, isoDate, oneOf, plainObject, text } from '../validate.js';
import { syncRun } from '../runSync.js';
import { runContext } from './runContext.js';

const SEVERITY_AR = { LOW: 'منخفضة', MEDIUM: 'متوسطة', HIGH: 'عالية', CRITICAL: 'حرجة' };

const ISSUE_ROW_SQL = `
  SELECT i.*, st.stage_key, st.label_json AS stage_label, l.name AS lesson_name, a.asset_type
    FROM ${S}.learning_run_issues i
    JOIN ${S}.learning_stage_instances st ON st.id = i.stage_id
    LEFT JOIN ${S}.learning_lessons l ON l.id = i.lesson_id
    LEFT JOIN ${S}.learning_assets a ON a.id = i.asset_id`;

function canReport(ctx, stageKey) {
  return (
    ctx.grants.has(P.TASK_WORK, stageKey) ||
    ctx.grants.has(P.TASK_REVIEW, stageKey) ||
    ctx.roles.some((role) => role !== 'VIEWER')
  );
}

async function issueContext(actor, issueId, { db = direct, lock = false } = {}) {
  const row = await db.row(`${ISSUE_ROW_SQL} WHERE i.id = $1 AND i.organization_id = $2 ${lock ? 'FOR UPDATE OF i' : ''}`, [
    issueId,
    actor.organizationId,
  ]);
  if (!row) throw notFound();
  const ctx = await runContext(actor, row.run_id, { db });
  return { ...ctx, issue: mapIssue(row) };
}

async function stageManagers(db, courseId, runManager) {
  const found = await db.rows(
    `SELECT user_id FROM ${S}.learning_course_members
      WHERE course_id = $1 AND roles && ARRAY['PRODUCTION_MANAGER', 'COURSE_MANAGER', 'UAT_COORDINATOR']::text[]`,
    [courseId]
  );
  return [...new Set([runManager, ...found.map((row) => row.user_id)].filter(Boolean))];
}

function notice(ctx, issue) {
  return {
    courseName: ctx.course.name,
    issueNumber: issue.issueNumber ?? issue.issue_number,
    title: issue.title,
    severity: issue.severity,
    severityAr: SEVERITY_AR[issue.severity] ?? issue.severity,
  };
}

/**
 * Write one issue — shared by the issue form and by marking a dry-run or UAT
 * checklist line as an issue. `stage` is `{ id, key, issueLog }`.
 */
export async function insertIssue(tx, ctx, stage, input, outbox) {
  if (!stage.issueLog) throw workflowRefusal('NOT_SUPPORTED');
  const body = plainObject(input, 'issue');
  const title = text(body.title, 'title', { required: true, max: 240 });
  const description = text(body.description, 'description', { max: 5000 }) ?? '';
  const severity = oneOf(body.severity, ISSUE_SEVERITIES, 'severity', { fallback: 'MEDIUM' });
  const area = oneOf(body.area, ISSUE_AREAS, 'area', { fallback: 'CONTENT' });
  const ownerUserId = userIdField(body.ownerUserId, 'ownerUserId') ?? null;
  if (ownerUserId) await assertAssignable(ctx, ownerUserId, 'ownerUserId');
  const dueDate = isoDate(body.dueDate, 'dueDate');
  const lessonId = bodyId(body.lessonId, 'lessonId');
  const assetId = bodyId(body.assetId, 'assetId');
  const taskId = bodyId(body.taskId, 'taskId');
  const checklistItemId = bodyId(body.checklistItemId, 'checklistItemId');

  if (lessonId) {
    const found = await tx.row(`SELECT 1 FROM ${S}.learning_lessons WHERE id = $1 AND course_id = $2`, [lessonId, ctx.course.id]);
    if (!found) throw validation('lessonId', 'invalid');
  }
  if (assetId) {
    const found = await tx.row(`SELECT 1 FROM ${S}.learning_assets WHERE id = $1 AND course_id = $2`, [assetId, ctx.course.id]);
    if (!found) throw validation('assetId', 'invalid');
  }
  if (taskId) {
    const found = await tx.row(`SELECT 1 FROM ${S}.learning_task_instances WHERE id = $1 AND run_id = $2`, [taskId, ctx.run.id]);
    if (!found) throw validation('taskId', 'invalid');
  }

  const inserted = await tx.row(
    `INSERT INTO ${S}.learning_run_issues
       (organization_id, run_id, stage_id, issue_number, title, description, severity, area, owner_user_id, due_date,
        lesson_id, asset_id, task_id, checklist_item_id, reported_by)
     SELECT $1, $2, $3, coalesce(max(issue_number), 0) + 1, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
       FROM ${S}.learning_run_issues WHERE run_id = $2
     RETURNING *`,
    [ctx.organizationId, ctx.run.id, stage.id, title, description, severity, area, ownerUserId, dueDate, lessonId, assetId, taskId, checklistItemId, ctx.userId]
  );
  await record(tx, {
    organizationId: ctx.organizationId,
    courseId: ctx.course.id,
    runId: ctx.run.id,
    stageId: stage.id,
    issueId: inserted.id,
    actorUserId: ctx.userId,
    eventType: 'ISSUE_REPORTED',
    metadata: { issueNumber: inserted.issue_number, severity, area },
  });

  const link = issueLink({ courseId: ctx.course.id, issueId: inserted.id });
  if (ownerUserId) {
    outbox.push({
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      recipients: [ownerUserId],
      type: 'issue_assigned',
      message: 'issueAssigned',
      dedupeKey: `issue-owner:${inserted.id}:${ownerUserId}`,
      windowMinutes: WINDOW.SHORT,
      entityType: 'ISSUE',
      entityId: inserted.id,
      link,
      data: notice(ctx, { ...inserted, issueNumber: inserted.issue_number }),
    });
  }
  if (severity === 'HIGH' || severity === 'CRITICAL') {
    outbox.push({
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      recipients: await stageManagers(tx, ctx.course.id, ctx.run.managerUserId),
      type: 'issue_reported',
      message: 'issueReported',
      dedupeKey: `issue-reported:${inserted.id}`,
      windowMinutes: WINDOW.ONCE,
      entityType: 'ISSUE',
      entityId: inserted.id,
      link,
      data: notice(ctx, { ...inserted, issueNumber: inserted.issue_number }),
    });
  }
  return inserted;
}

export async function listIssues(actor, runId, query = {}) {
  const ctx = await runContext(actor, runId);
  const params = [runId];
  let condition = 'i.run_id = $1';
  if (typeof query.stageId === 'string' && query.stageId) {
    params.push(bodyId(query.stageId, 'stageId'));
    condition += ` AND i.stage_id = $${params.length}`;
  }
  if (ISSUE_STATUSES.includes(query.status)) {
    params.push(query.status);
    condition += ` AND i.status = $${params.length}`;
  }
  const rows = await direct.rows(`${ISSUE_ROW_SQL} WHERE ${condition} ORDER BY i.issue_number DESC LIMIT 500`, params);
  const issues = rows.map(mapIssue);
  const stages = await direct.rows(
    `SELECT id, stage_key, label_json FROM ${S}.learning_stage_instances WHERE run_id = $1 AND issue_log ORDER BY sort_order`,
    [runId]
  );
  return {
    issues,
    stages: stages.map((stage) => ({ id: stage.id, key: stage.stage_key, label: stage.label_json })),
    canReport: ctx.runOpen && stages.some((stage) => canReport(ctx, stage.stage_key)),
    people: await peopleFor(userIdsIn(issues)),
  };
}

export async function getIssue(actor, issueId) {
  const ctx = await issueContext(actor, issueId);
  const activity = await direct.rows(
    `SELECT id, event_type, actor_user_id, metadata_json, created_at FROM ${S}.learning_activity_log
      WHERE issue_id = $1 ORDER BY id DESC LIMIT 50`,
    [issueId]
  );
  return {
    issue: ctx.issue,
    actions: issueActions(ctx, ctx.issue),
    activity: activity.map((entry) => ({
      id: String(entry.id),
      eventType: entry.event_type,
      actorUserId: entry.actor_user_id,
      metadata: entry.metadata_json ?? {},
      createdAt: entry.created_at instanceof Date ? entry.created_at.toISOString() : entry.created_at,
    })),
    people: await peopleFor(userIdsIn([ctx.issue, activity.map((entry) => ({ actorUserId: entry.actor_user_id }))])),
  };
}

export async function createIssue(actor, runId, input) {
  const body = plainObject(input, 'body');
  const stageId = bodyId(body.stageId, 'stageId', { required: true });
  const outbox = [];
  const issueId = await transactionWithOutbox(outbox, async (tx) => {
    const ctx = await runContext(actor, runId, { db: tx, lock: true });
    if (!ctx.runOpen) throw workflowRefusal('RUN_CLOSED');
    const stage = await tx.row(`SELECT id, stage_key, issue_log FROM ${S}.learning_stage_instances WHERE id = $1 AND run_id = $2`, [stageId, runId]);
    if (!stage) throw validation('stageId', 'invalid');
    if (!canReport(ctx, stage.stage_key)) throw forbidden();
    const inserted = await insertIssue(tx, ctx, { id: stage.id, key: stage.stage_key, issueLog: stage.issue_log }, body, outbox);
    await syncRun(tx, runId, { actorId: ctx.userId, outbox });
    return inserted.id;
  });
  return getIssue(actor, issueId);
}

/** What this person may do with this issue — the same verdicts the server enforces. */
function issueActions(ctx, issue) {
  const stage = issue.stageKey;
  const isOwner = issue.ownerUserId === ctx.userId;
  const isReporter = issue.reportedBy === ctx.userId;
  const canWork = isOwner || ctx.grants.has(P.TASK_WORK, stage);
  const canVerify = ctx.grants.has(P.TASK_REVIEW, stage) || isReporter;
  const canManage = ctx.grants.has(P.TASK_ASSIGN, stage) || ctx.grants.has(P.RUN_MANAGE, stage);
  const open = ctx.runOpen;
  const verdict = (from, allowed, blocker = null) => {
    if (!open) return { allowed: false, reason: 'RUN_CLOSED' };
    if (!from.includes(issue.status)) return { allowed: false, reason: 'INVALID_TRANSITION' };
    if (!allowed) return { allowed: false, reason: 'FORBIDDEN' };
    if (blocker) return { allowed: false, reason: blocker };
    return { allowed: true, reason: null };
  };
  return {
    EDIT: verdict(['OPEN', 'IN_PROGRESS', 'FIXED'], isReporter || isOwner || canManage),
    START: verdict(['OPEN'], canWork),
    FIX: verdict(['OPEN', 'IN_PROGRESS'], canWork),
    VERIFY: verdict(['FIXED'], canVerify, issue.fixedBy === ctx.userId && !ctx.grants.isAdmin ? 'OWN_WORK' : null),
    REOPEN: verdict(['FIXED', 'VERIFIED', 'WONT_FIX'], canVerify || canManage),
    WONT_FIX: verdict(['OPEN', 'IN_PROGRESS'], canManage),
  };
}

export async function updateIssue(actor, issueId, input) {
  const body = plainObject(input, 'body');
  const outbox = [];
  await transactionWithOutbox(outbox, async (tx) => {
    const ctx = await issueContext(actor, issueId, { db: tx, lock: true });
    const issue = ctx.issue;
    const verdict = issueActions(ctx, issue).EDIT;
    if (!verdict.allowed) throw workflowRefusal(verdict.reason);
    const next = {
      title: 'title' in body ? text(body.title, 'title', { required: true, max: 240 }) : issue.title,
      description: 'description' in body ? text(body.description, 'description', { max: 5000 }) ?? '' : issue.description,
      severity: 'severity' in body ? oneOf(body.severity, ISSUE_SEVERITIES, 'severity', { required: true }) : issue.severity,
      area: 'area' in body ? oneOf(body.area, ISSUE_AREAS, 'area', { required: true }) : issue.area,
      ownerUserId: 'ownerUserId' in body ? userIdField(body.ownerUserId, 'ownerUserId') ?? null : issue.ownerUserId,
      dueDate: 'dueDate' in body ? isoDate(body.dueDate, 'dueDate') : issue.dueDate,
    };
    if (next.ownerUserId && next.ownerUserId !== issue.ownerUserId) await assertAssignable(actor, next.ownerUserId, 'ownerUserId');
    const changed = Object.keys(next).filter((key) => (issue[key] ?? null) !== (next[key] ?? null));
    if (!changed.length) return;
    await tx.query(
      `UPDATE ${S}.learning_run_issues SET title = $2, description = $3, severity = $4, area = $5, owner_user_id = $6, due_date = $7 WHERE id = $1`,
      [issueId, next.title, next.description, next.severity, next.area, next.ownerUserId, next.dueDate]
    );
    await record(tx, {
      organizationId: ctx.organizationId,
      courseId: ctx.course.id,
      runId: ctx.run.id,
      stageId: issue.stageId,
      issueId,
      actorUserId: ctx.userId,
      eventType: 'ISSUE_UPDATED',
      metadata: { fields: changed },
    });
    if (changed.includes('ownerUserId') && next.ownerUserId) {
      outbox.push({
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        recipients: [next.ownerUserId],
        type: 'issue_assigned',
        message: 'issueAssigned',
        dedupeKey: `issue-owner:${issueId}:${next.ownerUserId}`,
        windowMinutes: WINDOW.SHORT,
        entityType: 'ISSUE',
        entityId: issueId,
        link: issueLink({ courseId: ctx.course.id, issueId }),
        data: notice(ctx, { ...issue, ...next }),
      });
    }
    await syncRun(tx, ctx.run.id, { actorId: ctx.userId, outbox });
  });
  return getIssue(actor, issueId);
}

/** `start`, `fix`, `verify`, `reopen` and `wont-fix`. */
export async function transitionIssue(actor, issueId, action, input) {
  const body = plainObject(input, 'body');
  const outbox = [];
  await transactionWithOutbox(outbox, async (tx) => {
    const ctx = await issueContext(actor, issueId, { db: tx, lock: true });
    const issue = ctx.issue;
    const actions = issueActions(ctx, issue);
    const link = issueLink({ courseId: ctx.course.id, issueId });
    const base = {
      organizationId: ctx.organizationId,
      courseId: ctx.course.id,
      runId: ctx.run.id,
      stageId: issue.stageId,
      issueId,
      actorUserId: ctx.userId,
    };

    if (action === 'start') {
      if (!actions.START.allowed) throw workflowRefusal(actions.START.reason);
      await tx.query(
        `UPDATE ${S}.learning_run_issues SET status = 'IN_PROGRESS', owner_user_id = coalesce(owner_user_id, $2) WHERE id = $1`,
        [issueId, ctx.userId]
      );
      await record(tx, { ...base, eventType: 'ISSUE_UPDATED', metadata: { status: 'IN_PROGRESS' } });
    } else if (action === 'fix') {
      if (!actions.FIX.allowed) throw workflowRefusal(actions.FIX.reason);
      const note = text(body.note, 'note', { required: true, max: 4000 });
      await tx.query(
        `UPDATE ${S}.learning_run_issues
            SET status = 'FIXED', fix_note = $2, fixed_by = $3, fixed_at = now(), owner_user_id = coalesce(owner_user_id, $3)
          WHERE id = $1`,
        [issueId, note, ctx.userId]
      );
      await record(tx, { ...base, eventType: 'ISSUE_FIXED', metadata: { issueNumber: issue.issueNumber, note: note.slice(0, 280) } });
      outbox.push({
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        recipients: [issue.reportedBy],
        type: 'issue_fixed',
        message: 'issueFixed',
        dedupeKey: `issue-fixed:${issueId}:${issue.reopenCount}`,
        windowMinutes: WINDOW.ONCE,
        entityType: 'ISSUE',
        entityId: issueId,
        link,
        data: notice(ctx, issue),
      });
    } else if (action === 'verify') {
      if (!actions.VERIFY.allowed) throw workflowRefusal(actions.VERIFY.reason);
      const note = text(body.note, 'note', { max: 4000 }) ?? '';
      await tx.query(
        `UPDATE ${S}.learning_run_issues SET status = 'VERIFIED', verified_by = $2, verified_at = now(), verify_note = $3 WHERE id = $1`,
        [issueId, ctx.userId, note]
      );
      await record(tx, { ...base, eventType: 'ISSUE_VERIFIED', metadata: { issueNumber: issue.issueNumber } });
    } else if (action === 'reopen') {
      if (!actions.REOPEN.allowed) throw workflowRefusal(actions.REOPEN.reason);
      const reason = text(body.reason, 'reason', { max: 1000 });
      if (!reason) throw badRequest('REASON_REQUIRED');
      await tx.query(
        `UPDATE ${S}.learning_run_issues
            SET status = 'OPEN', reopen_count = reopen_count + 1, verified_by = NULL, verified_at = NULL,
                wont_fix_reason = NULL, wont_fix_by = NULL, wont_fix_at = NULL
          WHERE id = $1`,
        [issueId]
      );
      await record(tx, { ...base, eventType: 'ISSUE_REOPENED', metadata: { issueNumber: issue.issueNumber, reason } });
      outbox.push({
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        recipients: [issue.ownerUserId, issue.fixedBy],
        type: 'issue_reopened',
        message: 'issueReopened',
        dedupeKey: `issue-reopened:${issueId}:${issue.reopenCount + 1}`,
        windowMinutes: WINDOW.ONCE,
        entityType: 'ISSUE',
        entityId: issueId,
        link,
        data: notice(ctx, issue),
      });
    } else if (action === 'wont-fix') {
      if (!actions.WONT_FIX.allowed) throw workflowRefusal(actions.WONT_FIX.reason);
      const reason = text(body.reason, 'reason', { max: 1000 });
      if (!reason) throw badRequest('REASON_REQUIRED');
      await tx.query(
        `UPDATE ${S}.learning_run_issues SET status = 'WONT_FIX', wont_fix_reason = $2, wont_fix_by = $3, wont_fix_at = now() WHERE id = $1`,
        [issueId, reason, ctx.userId]
      );
      await record(tx, { ...base, eventType: 'ISSUE_WONT_FIX', metadata: { issueNumber: issue.issueNumber, reason } });
    } else {
      throw notFound();
    }
    await syncRun(tx, ctx.run.id, { actorId: ctx.userId, outbox });
  });
  return getIssue(actor, issueId);
}
