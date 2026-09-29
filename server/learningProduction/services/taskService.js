/**
 * Program-level tasks — the workflow.
 *
 * Mirrors assetService.js: every change is a named action that runs in a
 * transaction, locks the task, re-evaluates the rules against the database
 * (`evaluateTask`), writes the change and its history together, re-derives
 * the run (`syncRun`), writes its alerts to the outbox, and only then commits.
 *
 * Version-bound approval: submitting freezes a submission — the ids of the
 * live evidence and the checklist as it stood — and the reviewer's decision
 * is recorded on that submission and no other. Evidence added afterwards
 * belongs to the next submission. A decision, once made, is final (trigger).
 */

import { PRIORITIES } from '../../../shared/learningProduction/constants.js';
import { CHECK_STATUSES, computeRun, evaluateTask, primaryTaskAction, taskDueState } from '../../../shared/learningProduction/runs.js';
import { mentionedIds } from '../../../shared/mentions.js';
import { SCHEMA as S, direct } from '../db.js';
import { canSeeSensitive } from '../access.js';
import { feed, record } from '../activity.js';
import { WINDOW, taskLink, transactionWithOutbox } from '../notifications.js';
import { badRequest, notFound, validation, workflowRefusal } from '../errors.js';
import { mapChecklistItem, mapEvidence, mapSubmission, mapTaskComment } from '../runMappers.js';
import { assertAssignable, organizationPeople, peopleFor, userIdField, userIdsIn } from '../people.js';
import { dateOrder, httpsUrl, isoDate, oneOf, plainObject, text } from '../validate.js';
import * as blobs from '../blobs.js';
import { ACCEPTED, KINDS, detectKind, safeFileName, uploadLimit } from '../fileTypes.js';
import { loadRunStructure, runFacts, syncRun } from '../runSync.js';
import { insertIssue } from './issueService.js';
import { taskContext } from './runContext.js';
import { today } from './summaries.js';

/* ------------------------------------------------------------------ */
/* Evaluation                                                           */
/* ------------------------------------------------------------------ */

/** Everything evaluateTask needs, read inside the caller's transaction. */
async function taskState(db, tctx) {
  const { stages, tasks } = await loadRunStructure(db, tctx.run.id);
  const facts = await runFacts(db, tctx.run);
  const computed = computeRun({ stages, tasks, facts, lessonAssetTypes: tctx.run.lessonAssetTypes });
  const self = computed.tasks.find((entry) => entry.id === tctx.task.id);
  const [checklist, evidence, lastDecision] = await Promise.all([
    db.rows(`SELECT * FROM ${S}.learning_task_checklist_items WHERE task_id = $1 ORDER BY sort_order`, [tctx.task.id]),
    db.rows(
      `SELECT * FROM ${S}.learning_task_evidence WHERE task_id = $1 ORDER BY created_at`,
      [tctx.task.id]
    ),
    db.row(
      `SELECT reviewed_at FROM ${S}.learning_task_submissions WHERE task_id = $1 AND decision <> 'PENDING'
        ORDER BY submission_number DESC LIMIT 1`,
      [tctx.task.id]
    ),
  ]);
  const live = evidence.filter((entry) => !entry.withdrawn_at);
  const decidedAt = lastDecision?.reviewed_at ? new Date(lastDecision.reviewed_at).getTime() : null;
  return {
    computed,
    self,
    blockers: self?.blockers ?? [],
    gate: self?.gate ?? null,
    checklist: checklist.map(mapChecklistItem),
    evidenceRows: evidence,
    liveEvidence: live,
    evidenceSinceDecision: decidedAt === null ? live.length : live.filter((entry) => new Date(entry.created_at).getTime() > decidedAt).length,
  };
}

function evaluate(tctx, state) {
  return evaluateTask({
    task: { ...tctx.task, stageKey: tctx.stage.key },
    grants: tctx.grants,
    roles: tctx.roles,
    userId: tctx.userId,
    blockers: state.blockers,
    checklist: state.checklist.map((item) => ({ required: item.required, status: item.status })),
    evidenceCount: state.liveEvidence.length,
    evidenceSinceDecision: state.evidenceSinceDecision,
    stageSkipped: tctx.stage.skipped,
    runOpen: tctx.runOpen,
  });
}

function ensure(evaluation, action) {
  const verdict = evaluation.actions[action];
  if (!verdict?.allowed) throw workflowRefusal(verdict?.reason ?? 'INVALID_TRANSITION', { action });
}

/** Who may read sensitive evidence on a sensitive task: see canSeeSensitive, plus the people named on it. */
function mayReadSensitive(tctx, evidenceCreatedBy) {
  if (!tctx.task.sensitive) return true;
  return (
    canSeeSensitive(tctx) ||
    evidenceCreatedBy === tctx.userId ||
    tctx.task.assigneeUserId === tctx.userId ||
    tctx.task.reviewerUserId === tctx.userId
  );
}

function base(tctx) {
  return {
    organizationId: tctx.organizationId,
    courseId: tctx.course.id,
    runId: tctx.run.id,
    stageId: tctx.task.stageId,
    taskId: tctx.task.id,
    actorUserId: tctx.userId,
  };
}

function notice(tctx, extra = {}) {
  return { courseName: tctx.course.name, taskLabel: tctx.task.label, stageLabel: tctx.stage.label, ...extra };
}

function alert(tctx, { recipients, type, message, dedupeKey, windowMinutes = WINDOW.SHORT, data = {} }) {
  return {
    organizationId: tctx.organizationId,
    actorId: tctx.userId,
    recipients,
    type,
    message,
    dedupeKey,
    windowMinutes,
    taskId: tctx.task.id,
    link: taskLink({ courseId: tctx.course.id, taskId: tctx.task.id }),
    data: notice(tctx, data),
  };
}

async function runManagers(db, tctx) {
  const found = await db.rows(
    `SELECT user_id FROM ${S}.learning_course_members
      WHERE course_id = $1 AND roles && ARRAY['PRODUCTION_MANAGER', 'COURSE_MANAGER']::text[]`,
    [tctx.course.id]
  );
  return [...new Set([tctx.run.managerUserId, ...found.map((row) => row.user_id)].filter(Boolean))];
}

/**
 * Run one task action: lock, evaluate, write, sync, commit, then deliver.
 * `work` returns `{ completed: boolean }` when it finished the task, so the
 * people it unblocked hear about it.
 */
async function act(actor, taskId, work) {
  const outbox = [];
  await transactionWithOutbox(outbox, async (tx) => {
    const tctx = await taskContext(actor, taskId, { db: tx, lock: true });
    const state = await taskState(tx, tctx);
    const result = (await work({ tx, tctx, state, evaluation: evaluate(tctx, state), outbox })) ?? {};
    await syncRun(tx, tctx.run.id, { actorId: tctx.userId, outbox, justCompleted: result.completed ? [tctx.task.key] : [] });
  });
  return getTask(actor, taskId);
}

async function startIfNeeded(tx, tctx) {
  if (tctx.task.status !== 'NOT_STARTED') return;
  await tx.query(
    `UPDATE ${S}.learning_task_instances
        SET status = 'IN_PROGRESS', started_at = coalesce(started_at, now()),
            assignee_user_id = coalesce(assignee_user_id, $2), assigned_at = coalesce(assigned_at, now())
      WHERE id = $1`,
    [tctx.task.id, tctx.userId]
  );
  await record(tx, { ...base(tctx), eventType: 'TASK_STARTED', metadata: {} });
  tctx.task.status = 'IN_PROGRESS';
  tctx.task.assigneeUserId = tctx.task.assigneeUserId ?? tctx.userId;
}

/* ------------------------------------------------------------------ */
/* Reading                                                              */
/* ------------------------------------------------------------------ */

/** The task drawer: the task, its checklist, evidence, submissions, discussion and history, and what you may do. */
export async function getTask(actor, taskId) {
  const tctx = await taskContext(actor, taskId);
  const state = await taskState(direct, tctx);
  const evaluation = evaluate(tctx, state);
  const [submissions, comments, activity] = await Promise.all([
    direct.rows(`SELECT * FROM ${S}.learning_task_submissions WHERE task_id = $1 ORDER BY submission_number DESC`, [taskId]),
    direct.rows(`SELECT * FROM ${S}.learning_task_comments WHERE task_id = $1 ORDER BY created_at`, [taskId]),
    feed(direct, { condition: 'e.task_id = $1', params: [taskId], limit: 40, includeSensitive: canSeeSensitive(tctx) }),
  ]);

  const evidence = state.evidenceRows.map((row) => mapEvidence(row, { redact: !mayReadSensitive(tctx, row.created_by) }));
  const mappedSubmissions = submissions.map(mapSubmission);
  const mappedComments = comments.map(mapTaskComment);
  const task = { ...tctx.task, stageKey: tctx.stage.key };
  const day = today();
  const blockersWithLinks = state.blockers;

  const payload = {
    task: {
      ...task,
      display: task.status === 'NOT_STARTED' ? (evaluation.blocked ? 'BLOCKED' : 'READY') : task.status,
      dueState: taskDueState(task.dueDate, task.status, day),
      gate: state.gate,
    },
    stage: tctx.stage,
    run: { id: tctx.run.id, runNumber: tctx.run.runNumber, scenario: tctx.run.scenario, status: tctx.run.status, lessonAssetTypes: tctx.run.lessonAssetTypes },
    course: { id: tctx.course.id, name: tctx.course.name, code: tctx.course.code },
    blockers: blockersWithLinks,
    checklist: state.checklist,
    evidence,
    submissions: mappedSubmissions,
    comments: mappedComments,
    activity,
    evaluation: {
      actions: evaluation.actions,
      blocked: evaluation.blocked,
      isAssignee: evaluation.isAssignee,
      isReviewer: evaluation.isReviewer,
      approvalNeedsOverride: evaluation.approvalNeedsOverride,
      checklist: evaluation.checklist,
      evidenceCount: evaluation.evidenceCount,
      evidenceSinceDecision: state.evidenceSinceDecision,
      canComment: evaluation.canComment,
    },
    primary: primaryTaskAction(evaluation, task),
    seeSensitive: canSeeSensitive(tctx),
    upload: { maxBytes: uploadLimit('EVIDENCE'), accepted: ACCEPTED.EVIDENCE.map((kind) => KINDS[kind].label) },
  };
  payload.people = await peopleFor(userIdsIn([task, evidence, mappedSubmissions, mappedComments, activity, blockersWithLinks]));
  return payload;
}

/* ------------------------------------------------------------------ */
/* Assignment                                                           */
/* ------------------------------------------------------------------ */

export async function assignTask(actor, taskId, input) {
  const body = plainObject(input, 'body');
  const patch = {};
  if ('assigneeUserId' in body) patch.assigneeUserId = userIdField(body.assigneeUserId, 'assigneeUserId') ?? null;
  if ('reviewerUserId' in body) patch.reviewerUserId = userIdField(body.reviewerUserId, 'reviewerUserId') ?? null;
  if ('dueDate' in body) patch.dueDate = isoDate(body.dueDate, 'dueDate');
  if ('startDate' in body) patch.startDate = isoDate(body.startDate, 'startDate');
  if ('priority' in body) patch.priority = oneOf(body.priority, PRIORITIES, 'priority', { required: true });
  if (patch.assigneeUserId) await assertAssignable(actor, patch.assigneeUserId, 'assigneeUserId');
  if (patch.reviewerUserId) await assertAssignable(actor, patch.reviewerUserId, 'reviewerUserId');

  return act(actor, taskId, async ({ tx, tctx, evaluation, outbox }) => {
    ensure(evaluation, 'ASSIGN');
    const task = tctx.task;
    const next = {
      assigneeUserId: task.assigneeUserId,
      reviewerUserId: task.reviewerUserId,
      dueDate: task.dueDate,
      startDate: task.startDate,
      priority: task.priority,
      ...patch,
    };
    dateOrder(next.startDate, next.dueDate, 'dueDate');
    if (next.reviewerUserId && next.reviewerUserId === next.assigneeUserId) throw badRequest('REVIEWER_IS_ASSIGNEE', { field: 'reviewerUserId' });
    if (next.reviewerUserId && !task.requiresApproval) throw validation('reviewerUserId', 'not_applicable');
    const changed = Object.keys(next).filter((key) => (task[key] ?? null) !== (next[key] ?? null));
    if (!changed.length) return;

    await tx.query(
      `UPDATE ${S}.learning_task_instances
          SET assignee_user_id = $2, reviewer_user_id = $3, due_date = $4, start_date = $5, priority = $6,
              assigned_at = CASE WHEN $7::boolean THEN now() ELSE assigned_at END
        WHERE id = $1`,
      [task.id, next.assigneeUserId, next.reviewerUserId, next.dueDate, next.startDate, next.priority, changed.includes('assigneeUserId') && Boolean(next.assigneeUserId)]
    );
    if (changed.includes('reviewerUserId')) {
      await tx.query(
        `UPDATE ${S}.learning_task_submissions SET reviewer_user_id = $2 WHERE task_id = $1 AND decision = 'PENDING'`,
        [task.id, next.reviewerUserId]
      );
    }
    await record(tx, {
      ...base(tctx),
      eventType: 'TASK_ASSIGNED',
      metadata: { changes: Object.fromEntries(changed.map((key) => [key, [task[key] ?? null, next[key] ?? null]])) },
    });

    if (changed.includes('assigneeUserId') && next.assigneeUserId) {
      outbox.push(alert(tctx, { recipients: [next.assigneeUserId], type: 'task_assigned', message: 'taskAssigned', dedupeKey: `task-assigned:${task.id}:${next.assigneeUserId}` }));
    }
    if (changed.includes('reviewerUserId') && next.reviewerUserId) {
      const inReview = task.status === 'SUBMITTED' || task.status === 'UNDER_REVIEW';
      outbox.push(
        alert(tctx, {
          recipients: [next.reviewerUserId],
          type: inReview ? 'task_submitted' : 'task_reviewer_assigned',
          message: inReview ? 'taskSubmitted' : 'taskReviewerAssigned',
          dedupeKey: `task-reviewer:${task.id}:${next.reviewerUserId}`,
        })
      );
    }
  });
}

/* ------------------------------------------------------------------ */
/* Doing                                                                */
/* ------------------------------------------------------------------ */

export async function startTask(actor, taskId) {
  return act(actor, taskId, async ({ tx, tctx, evaluation }) => {
    ensure(evaluation, 'START');
    await startIfNeeded(tx, tctx);
  });
}

/**
 * Tick, untick, mark not applicable (with a reason) or mark as an issue.
 * On a dry-run or UAT task, marking a line as an issue logs a tracked issue
 * in that stage's issue log in the same transaction, linked to the line.
 */
export async function updateChecklistItem(actor, itemId, input) {
  const body = plainObject(input, 'body');
  const status = oneOf(body.status, CHECK_STATUSES, 'status', { required: true });
  const comment = text(body.comment, 'comment', { max: 2000 }) ?? '';
  if (status === 'NOT_APPLICABLE' && !comment) throw badRequest('REASON_REQUIRED', { field: 'comment' });

  const item = await direct.row(
    `SELECT id, task_id FROM ${S}.learning_task_checklist_items WHERE id = $1 AND organization_id = $2`,
    [itemId, actor.organizationId]
  );
  if (!item) throw notFound();

  return act(actor, item.task_id, async ({ tx, tctx, evaluation, outbox }) => {
    ensure(evaluation, 'EDIT');
    await startIfNeeded(tx, tctx);
    const current = await tx.row(`SELECT * FROM ${S}.learning_task_checklist_items WHERE id = $1 FOR UPDATE`, [itemId]);
    let issueId = current.issue_id;
    if (status === 'ISSUE' && !issueId) {
      const stage = await tx.row(`SELECT id, stage_key, issue_log FROM ${S}.learning_stage_instances WHERE id = $1`, [tctx.task.stageId]);
      if (stage.issue_log) {
        const issue = await insertIssue(
          tx,
          tctx,
          { id: stage.id, key: stage.stage_key, issueLog: true },
          { ...plainObject(body.issue, 'issue'), taskId: tctx.task.id, checklistItemId: itemId, title: body.issue?.title ?? current.label_json?.en ?? 'Issue' },
          outbox
        );
        issueId = issue.id;
      } else if (!comment) {
        throw badRequest('REASON_REQUIRED', { field: 'comment' });
      }
    }
    await tx.query(
      `UPDATE ${S}.learning_task_checklist_items SET status = $2, note = $3, issue_id = $4, updated_by = $5 WHERE id = $1`,
      [itemId, status, comment, issueId, tctx.userId]
    );
    await record(tx, {
      ...base(tctx),
      eventType: 'TASK_CHECKLIST_UPDATED',
      metadata: { item: current.item_key, from: current.status, to: status, ...(status === 'NOT_APPLICABLE' ? { reason: comment.slice(0, 280) } : {}) },
    });
  });
}

/** A file (raw bytes), a link or a note. Never replaces earlier evidence. */
export async function addEvidence(actor, taskId, input) {
  const probe = await taskContext(actor, taskId);
  ensure(evaluate(probe, await taskState(direct, probe)), 'EDIT');

  let file = null;
  let url = null;
  const note = text(input.note, 'note', { max: 4000 }) ?? '';
  if (input.bytes) {
    const bytes = input.bytes;
    if (!bytes.length) throw badRequest('FILE_REQUIRED');
    const limit = uploadLimit('EVIDENCE');
    if (bytes.length > limit) throw badRequest('FILE_TOO_LARGE', { maxBytes: limit });
    const kind = detectKind(bytes, input.fileName, 'EVIDENCE');
    if (!kind || !ACCEPTED.EVIDENCE.includes(kind)) {
      throw badRequest('FILE_TYPE_NOT_ALLOWED', { accepted: ACCEPTED.EVIDENCE.map((entry) => KINDS[entry].label) });
    }
    file = { kind, name: safeFileName(input.fileName), size: bytes.length, checksum: blobs.checksum(bytes), key: await blobs.store(bytes) };
  } else if (input.url) {
    url = httpsUrl(input.url, 'url');
  } else if (!note) {
    throw badRequest('FILE_REQUIRED');
  }

  try {
    return await act(actor, taskId, async ({ tx, tctx, evaluation }) => {
      ensure(evaluation, 'EDIT');
      await startIfNeeded(tx, tctx);
      const inserted = await tx.row(
        `INSERT INTO ${S}.learning_task_evidence
           (organization_id, task_id, kind, storage_key, file_name, mime_type, file_size, checksum, url, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [
          tctx.organizationId,
          taskId,
          file ? 'FILE' : url ? 'LINK' : 'NOTE',
          file?.key ?? null,
          file?.name ?? null,
          file ? KINDS[file.kind].mime : null,
          file?.size ?? null,
          file?.checksum ?? null,
          url,
          note,
          tctx.userId,
        ]
      );
      await record(tx, {
        ...base(tctx),
        eventType: 'EVIDENCE_ADDED',
        // A sensitive task's evidence is described without its name.
        metadata: { evidenceId: inserted.id, kind: file ? 'FILE' : url ? 'LINK' : 'NOTE', ...(tctx.task.sensitive ? {} : { fileName: file?.name ?? null }) },
      });
    });
  } catch (error) {
    if (file) await blobs.discard(file.key);
    throw error;
  }
}

/** Withdraw a piece of evidence, with a reason. The record stays; submissions that cited it still name it. */
export async function withdrawEvidence(actor, evidenceId, input) {
  const reason = text(plainObject(input, 'body').reason, 'reason', { max: 1000 });
  if (!reason) throw badRequest('REASON_REQUIRED');
  const row = await direct.row(`SELECT id, task_id, created_by FROM ${S}.learning_task_evidence WHERE id = $1 AND organization_id = $2`, [
    evidenceId,
    actor.organizationId,
  ]);
  if (!row) throw notFound();
  return act(actor, row.task_id, async ({ tx, tctx, evaluation }) => {
    ensure(evaluation, 'EDIT');
    await tx.query(
      `UPDATE ${S}.learning_task_evidence SET withdrawn_at = now(), withdrawn_by = $2, withdraw_reason = $3 WHERE id = $1 AND withdrawn_at IS NULL`,
      [evidenceId, tctx.userId, reason]
    );
    await record(tx, { ...base(tctx), eventType: 'EVIDENCE_WITHDRAWN', metadata: { evidenceId, reason } });
  });
}

/** The bytes of one piece of evidence, after the access and sensitivity checks. */
export async function evidenceFile(actor, evidenceId) {
  const row = await direct.row(`SELECT * FROM ${S}.learning_task_evidence WHERE id = $1 AND organization_id = $2`, [evidenceId, actor.organizationId]);
  if (!row || !row.storage_key) throw notFound();
  const tctx = await taskContext(actor, row.task_id);
  if (!mayReadSensitive(tctx, row.created_by)) throw notFound();
  const bytes = await blobs.load(row.storage_key);
  if (!bytes) throw notFound();
  return { bytes, mimeType: row.mime_type, fileName: row.file_name };
}

/** Finish a task that needs no approval. */
export async function completeTask(actor, taskId, input) {
  const notes = text(plainObject(input, 'body').notes, 'notes', { max: 2000 }) ?? '';
  return act(actor, taskId, async ({ tx, tctx, evaluation }) => {
    ensure(evaluation, 'COMPLETE');
    await tx.query(`UPDATE ${S}.learning_task_instances SET status = 'DONE', done_at = now(), done_by = $2 WHERE id = $1`, [tctx.task.id, tctx.userId]);
    await record(tx, { ...base(tctx), eventType: 'TASK_COMPLETED', metadata: { notes: notes.slice(0, 280) } });
    return { completed: true };
  });
}

/* ------------------------------------------------------------------ */
/* Review                                                               */
/* ------------------------------------------------------------------ */

/**
 * Send for approval. Freezes the live evidence ids and the checklist into a
 * submission; the reviewer decides on that submission. Resubmitting after
 * changes needs new evidence when the task requires evidence at all.
 */
export async function submitTask(actor, taskId, input) {
  const notes = text(plainObject(input, 'body').notes, 'notes', { max: 2000 }) ?? '';
  return act(actor, taskId, async ({ tx, tctx, state, evaluation, outbox }) => {
    ensure(evaluation, 'SUBMIT');
    const task = tctx.task;
    const resubmission = task.status === 'CHANGES_REQUESTED';
    const submission = await tx.row(
      `INSERT INTO ${S}.learning_task_submissions
         (organization_id, task_id, submission_number, evidence_ids, checklist_json, notes, submitted_by, is_resubmission, reviewer_user_id)
       SELECT $1, $2, coalesce(max(submission_number), 0) + 1, $3, $4, $5, $6, $7, $8
         FROM ${S}.learning_task_submissions WHERE task_id = $2
       RETURNING id, submission_number`,
      [
        tctx.organizationId,
        task.id,
        state.liveEvidence.map((entry) => entry.id),
        JSON.stringify(state.checklist.map((item) => ({ key: item.key, status: item.status, comment: item.comment }))),
        notes,
        tctx.userId,
        resubmission,
        task.reviewerUserId,
      ]
    );
    await tx.query(
      `UPDATE ${S}.learning_task_instances SET status = 'SUBMITTED', submitted_at = now(), submitted_by = $2, review_started_at = NULL WHERE id = $1`,
      [task.id, tctx.userId]
    );
    await record(tx, {
      ...base(tctx),
      eventType: resubmission ? 'TASK_RESUBMITTED' : 'TASK_SUBMITTED',
      metadata: { submissionNumber: submission.submission_number, evidence: state.liveEvidence.length, notes: notes.slice(0, 280) },
    });
    outbox.push(
      alert(tctx, {
        recipients: task.reviewerUserId ? [task.reviewerUserId] : await runManagers(tx, tctx),
        type: resubmission ? 'task_resubmitted' : 'task_submitted',
        message: resubmission ? 'taskResubmitted' : 'taskSubmitted',
        dedupeKey: `task-review:${submission.id}`,
        windowMinutes: WINDOW.ONCE,
      })
    );
  });
}

async function markReviewStarted(tx, tctx, { explicit = false } = {}) {
  if (tctx.task.status === 'UNDER_REVIEW') return;
  const claim = !tctx.task.reviewerUserId;
  await tx.query(
    `UPDATE ${S}.learning_task_instances
        SET status = CASE WHEN $3::boolean THEN 'UNDER_REVIEW' ELSE status END,
            review_started_at = coalesce(review_started_at, now()), reviewer_user_id = coalesce(reviewer_user_id, $2)
      WHERE id = $1`,
    [tctx.task.id, tctx.userId, explicit]
  );
  await tx.query(
    `UPDATE ${S}.learning_task_submissions
        SET review_started_at = coalesce(review_started_at, now()), reviewer_user_id = coalesce(reviewer_user_id, $2)
      WHERE task_id = $1 AND decision = 'PENDING'`,
    [tctx.task.id, tctx.userId]
  );
  if (claim) tctx.task.reviewerUserId = tctx.userId;
  await record(tx, { ...base(tctx), eventType: 'TASK_REVIEW_STARTED', metadata: { implicit: !explicit } });
}

export async function startTaskReview(actor, taskId) {
  return act(actor, taskId, async ({ tx, tctx, evaluation }) => {
    ensure(evaluation, 'START_REVIEW');
    await markReviewStarted(tx, tctx, { explicit: true });
  });
}

/** Send it back. A note is required: "changes requested" with nothing attached helps nobody. */
export async function requestTaskChanges(actor, taskId, input) {
  const notes = text(plainObject(input, 'body').notes, 'notes', { max: 5000 }) ?? '';
  if (!notes) throw badRequest('FEEDBACK_REQUIRED');
  return act(actor, taskId, async ({ tx, tctx, evaluation, outbox }) => {
    ensure(evaluation, 'REQUEST_CHANGES');
    await markReviewStarted(tx, tctx);
    const decided = await tx.row(
      `UPDATE ${S}.learning_task_submissions
          SET decision = 'CHANGES_REQUESTED', reviewed_by = $2, reviewed_at = now(), review_notes = $3
        WHERE task_id = $1 AND decision = 'PENDING' RETURNING id, submission_number`,
      [tctx.task.id, tctx.userId, notes]
    );
    await tx.query(`UPDATE ${S}.learning_task_instances SET status = 'CHANGES_REQUESTED', changes_requested_at = now() WHERE id = $1`, [tctx.task.id]);
    await record(tx, {
      ...base(tctx),
      eventType: 'TASK_CHANGES_REQUESTED',
      metadata: { submissionNumber: decided?.submission_number ?? null, notes: notes.slice(0, 280) },
    });
    outbox.push(
      alert(tctx, {
        recipients: [tctx.task.assigneeUserId, tctx.task.submittedBy],
        type: 'task_changes_requested',
        message: 'taskChangesRequested',
        dedupeKey: `task-changes:${decided?.id ?? tctx.task.id}`,
        windowMinutes: WINDOW.ONCE,
      })
    );
  });
}

/**
 * Approve the pending submission — that submission and no other. Nobody
 * approves their own; an administrator may, but must say why, and the
 * override is kept on the decision.
 */
export async function approveTask(actor, taskId, input) {
  const body = plainObject(input, 'body');
  const notes = text(body.notes, 'notes', { max: 5000 }) ?? '';
  const overrideReason = text(body.overrideReason, 'overrideReason', { max: 1000 }) || null;
  return act(actor, taskId, async ({ tx, tctx, evaluation, outbox }) => {
    ensure(evaluation, 'APPROVE');
    const override = evaluation.approvalNeedsOverride;
    if (override && !overrideReason) throw badRequest('REASON_REQUIRED', { field: 'overrideReason' });
    await markReviewStarted(tx, tctx);
    const decided = await tx.row(
      `UPDATE ${S}.learning_task_submissions
          SET decision = 'APPROVED', reviewed_by = $2, reviewed_at = now(), review_notes = $3,
              admin_override = $4, override_reason = $5
        WHERE task_id = $1 AND decision = 'PENDING' RETURNING id, submission_number`,
      [tctx.task.id, tctx.userId, notes, override, override ? overrideReason : null]
    );
    await tx.query(`UPDATE ${S}.learning_task_instances SET status = 'APPROVED', approved_at = now(), approved_by = $2 WHERE id = $1`, [
      tctx.task.id,
      tctx.userId,
    ]);
    await record(tx, {
      ...base(tctx),
      eventType: 'TASK_APPROVED',
      metadata: { submissionNumber: decided?.submission_number ?? null, notes: notes.slice(0, 280), adminOverride: override },
    });
    outbox.push(
      alert(tctx, {
        recipients: [tctx.task.assigneeUserId, tctx.task.submittedBy],
        type: 'task_approved',
        message: 'taskApproved',
        dedupeKey: `task-approved:${decided?.id ?? tctx.task.id}`,
        windowMinutes: WINDOW.ONCE,
      })
    );
    return { completed: true };
  });
}

/* ------------------------------------------------------------------ */
/* Exceptions                                                           */
/* ------------------------------------------------------------------ */

function reason(value) {
  const clean = typeof value === 'string' ? value.trim() : '';
  if (!clean) throw badRequest('REASON_REQUIRED');
  if (clean.length > 1000) throw validation('reason', 'too_long', { max: 1000 });
  return clean;
}

/** Take a conditional (or, by an administrator, a required) task out of its stage's count. */
export async function waiveTask(actor, taskId, input) {
  const why = reason(plainObject(input, 'body').reason);
  return act(actor, taskId, async ({ tx, tctx, evaluation }) => {
    ensure(evaluation, 'WAIVE');
    await tx.query(`UPDATE ${S}.learning_task_instances SET status = 'WAIVED', waived_at = now(), waived_by = $2, waive_reason = $3 WHERE id = $1`, [
      tctx.task.id,
      tctx.userId,
      why,
    ]);
    await record(tx, {
      ...base(tctx),
      eventType: 'TASK_WAIVED',
      metadata: { reason: why, classification: tctx.task.classification, adminOverride: tctx.task.classification === 'REQUIRED' },
    });
    return { completed: true };
  });
}

/** Reopen finished or waived work. Approvals already given stay attached to their submissions. */
export async function reopenTask(actor, taskId, input) {
  const why = reason(plainObject(input, 'body').reason);
  return act(actor, taskId, async ({ tx, tctx, evaluation, outbox }) => {
    ensure(evaluation, 'REOPEN');
    const from = tctx.task.status;
    await tx.query(
      `UPDATE ${S}.learning_task_instances
          SET status = 'IN_PROGRESS', reopened_at = now(), approved_at = NULL, approved_by = NULL, done_at = NULL, done_by = NULL,
              waived_at = NULL, waived_by = NULL, waive_reason = NULL, submitted_at = NULL, submitted_by = NULL,
              review_started_at = NULL, changes_requested_at = NULL
        WHERE id = $1`,
      [tctx.task.id]
    );
    await record(tx, { ...base(tctx), eventType: 'TASK_REOPENED', metadata: { from, reason: why } });
    outbox.push(
      alert(tctx, {
        recipients: [tctx.task.assigneeUserId],
        type: 'task_reopened',
        message: 'taskReopened',
        dedupeKey: `task-reopened:${tctx.task.id}`,
        data: { reason: why.slice(0, 120) },
      })
    );
  });
}

export async function overrideTaskDependency(actor, taskId, input) {
  const why = reason(plainObject(input, 'body').reason);
  return act(actor, taskId, async ({ tx, tctx, state, evaluation }) => {
    ensure(evaluation, 'OVERRIDE_DEPENDENCY');
    await tx.query(
      `UPDATE ${S}.learning_task_instances SET dependency_override_by = $2, dependency_override_at = now(), dependency_override_reason = $3 WHERE id = $1`,
      [tctx.task.id, tctx.userId, why]
    );
    await record(tx, {
      ...base(tctx),
      eventType: 'TASK_DEPENDENCY_OVERRIDDEN',
      metadata: { reason: why, waitingFor: state.blockers.map((blocker) => blocker.key) },
    });
  });
}

/* ------------------------------------------------------------------ */
/* Discussion                                                           */
/* ------------------------------------------------------------------ */

export async function addTaskComment(actor, taskId, input) {
  const body = plainObject(input, 'body');
  const message = text(body.body, 'body', { required: true, max: 10000, trim: false });
  if (!message.trim()) throw validation('body', 'required');
  const parentId = typeof body.parentId === 'string' && body.parentId ? body.parentId : null;

  const people = await organizationPeople(actor);
  const mentions = mentionedIds(message, people).filter((id) => id !== actor.userId);

  return act(actor, taskId, async ({ tx, tctx, evaluation, outbox }) => {
    if (!evaluation.canComment) throw workflowRefusal('FORBIDDEN');
    let parent = null;
    if (parentId) {
      parent = await tx.row(`SELECT id, user_id FROM ${S}.learning_task_comments WHERE id = $1 AND task_id = $2`, [parentId, taskId]);
      if (!parent) throw validation('parentId', 'invalid');
    }
    const inserted = await tx.row(
      `INSERT INTO ${S}.learning_task_comments (organization_id, task_id, parent_id, user_id, body, mentions)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [tctx.organizationId, taskId, parent?.id ?? null, tctx.userId, message, mentions]
    );
    await record(tx, { ...base(tctx), eventType: 'TASK_COMMENTED', metadata: { commentId: inserted.id, mentions: mentions.length } });
    if (mentions.length) {
      outbox.push(alert(tctx, { recipients: mentions, type: 'task_mention', message: 'taskMention', dedupeKey: `task-mention:${inserted.id}` }));
    }
    const others = [tctx.task.assigneeUserId, tctx.task.reviewerUserId, parent?.user_id].filter((id) => id && !mentions.includes(id));
    if (others.length) {
      outbox.push(
        alert(tctx, { recipients: others, type: 'task_comment', message: 'taskComment', dedupeKey: `task-comment:${taskId}`, windowMinutes: WINDOW.COMMENTS })
      );
    }
  });
}

