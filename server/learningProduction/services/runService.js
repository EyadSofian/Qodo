/**
 * Production runs: starting one, reading one, and steering it.
 *
 * Starting a run picks one of three ways — AI-assisted new program,
 * expert-led new program, or a revamp of an earlier release — and copies the
 * scenario's current published template version into stages, tasks,
 * checklists and dependencies, all in one transaction. Nothing about lessons
 * is required up front: a run can start before the curriculum exists, and
 * lessons are added when the curriculum stage gets there.
 */

import { ASSET_TYPES, COURSE_ROLES, PRIORITIES } from '../../../shared/learningProduction/constants.js';
import { LP_PERMISSIONS as P } from '../../../shared/learningProduction/permissions.js';
import {
  OPEN_RUN_STATUSES,
  computeRun,
  currentRunStage,
  isTaskComplete,
  isTaskGating,
  runHealth,
  runProgress,
  taskDueState,
} from '../../../shared/learningProduction/runs.js';
import { SCENARIOS, SCENARIO_ASSET_TYPES } from '../../../shared/learningProduction/workflowTemplates.js';
import { normalizeSettings } from '../../../shared/learningProduction/workflow.js';
import { SCHEMA as S, direct } from '../db.js';
import { courseCapabilities, courseContext, requireGrant } from '../access.js';
import { record } from '../activity.js';
import { WINDOW, transactionWithOutbox } from '../notifications.js';
import { badRequest, conflict, forbidden, notFound, validation, workflowRefusal } from '../errors.js';
import { mapRelease, mapRun, mapTemplateVersion } from '../runMappers.js';
import { assertAssignable, peopleFor, userIdField, userIdsIn } from '../people.js';
import { bodyId, dateOrder, isoDate, oneOf, plainObject, text } from '../validate.js';
import { loadRunStructure, runFacts, syncRun } from '../runSync.js';
import { insertChecklistTemplate } from './courseService.js';
import { buildSnapshot } from './releaseService.js';
import { runContext, stageContext } from './runContext.js';
import { currentTemplateRow } from './templateService.js';
import { today } from './summaries.js';

/* ------------------------------------------------------------------ */
/* Instantiating a template                                             */
/* ------------------------------------------------------------------ */

function normalizeRoles(value, field) {
  if (!Array.isArray(value) || value.length === 0) throw validation(field, 'required');
  if (!value.every((role) => COURSE_ROLES.includes(role))) throw validation(field, 'invalid');
  return [...new Set(value)];
}

/**
 * Who holds each role on this course and run. Used to pre-fill assignees and
 * reviewers: a role held by exactly one person is that person's work; a role
 * held by several is left for the manager to hand out.
 */
async function roleHolders(db, courseId, runId, managerUserId) {
  const rows = await db.rows(
    `SELECT user_id, roles FROM ${S}.learning_course_members WHERE course_id = $1
     UNION ALL
     SELECT user_id, roles FROM ${S}.learning_run_members WHERE run_id = $2`,
    [courseId, runId]
  );
  const holders = new Map();
  for (const row of rows) {
    for (const role of row.roles) holders.set(role, new Set([...(holders.get(role) ?? []), row.user_id]));
  }
  return (role) => {
    if (!role) return null;
    if (role === 'PRODUCTION_MANAGER') return managerUserId ?? null;
    const set = holders.get(role);
    return set && set.size === 1 ? [...set][0] : null;
  };
}

/**
 * Copy a template definition into a run. Stage and task labels, sources and
 * rules are copied too, so the run reads the same whatever the templates
 * become. Returns `{ stageIds, taskIds }` by key.
 */
export async function instantiateTemplate(tx, { organizationId, courseId, runId, definition, managerUserId }) {
  const holderOf = await roleHolders(tx, courseId, runId, managerUserId);
  const stageIds = new Map();
  const taskIds = new Map();
  const pendingDependencies = [];

  for (const [stageIndex, stage] of definition.stages.entries()) {
    const insertedStage = await tx.row(
      `INSERT INTO ${S}.learning_stage_instances
         (organization_id, run_id, stage_key, sort_order, label_json, description_json, note_json, origin, source_json,
          after_keys, owner_role, skippable_json, issue_log, lesson_assets)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id`,
      [
        organizationId,
        runId,
        stage.key,
        stageIndex,
        JSON.stringify(stage.label),
        stage.description ? JSON.stringify(stage.description) : null,
        stage.note ? JSON.stringify(stage.note) : null,
        stage.origin,
        stage.source ? JSON.stringify(stage.source) : null,
        stage.after ?? [],
        stage.ownerRole ?? null,
        stage.skippable ? JSON.stringify(stage.skippable) : null,
        Boolean(stage.issueLog),
        Boolean(stage.lessonAssets),
      ]
    );
    stageIds.set(stage.key, insertedStage.id);

    for (const [taskIndex, task] of stage.tasks.entries()) {
      const assignee = task.kind === 'AUTO' ? null : holderOf(task.role);
      let reviewer = task.requiresApproval ? holderOf(task.reviewerRole) : null;
      if (reviewer && reviewer === assignee) reviewer = null;
      const insertedTask = await tx.row(
        `INSERT INTO ${S}.learning_task_instances
           (organization_id, run_id, stage_id, task_key, sort_order, label_json, description_json, note_json, condition_json,
            origin, approval_origin, source_json, kind, classification, role, reviewer_role, requires_evidence,
            evidence_label_json, requires_approval, sensitive, external_tool, rule_json, assignee_user_id, reviewer_user_id,
            assigned_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
                 CASE WHEN $23::text IS NULL THEN NULL ELSE now() END)
         RETURNING id`,
        [
          organizationId,
          runId,
          insertedStage.id,
          task.key,
          taskIndex,
          JSON.stringify(task.label),
          task.description ? JSON.stringify(task.description) : null,
          task.note ? JSON.stringify(task.note) : null,
          task.condition ? JSON.stringify(task.condition) : null,
          task.origin,
          task.approvalOrigin ?? null,
          task.source ? JSON.stringify(task.source) : null,
          task.kind,
          task.classification,
          task.role ?? null,
          task.reviewerRole ?? null,
          Boolean(task.requiresEvidence),
          task.evidenceLabel ? JSON.stringify(task.evidenceLabel) : null,
          Boolean(task.requiresApproval),
          Boolean(task.sensitive),
          task.externalTool ?? null,
          task.rule ? JSON.stringify(task.rule) : null,
          assignee,
          reviewer,
        ]
      );
      taskIds.set(task.key, { id: insertedTask.id, assignee, reviewer, label: task.label, stageLabel: stage.label });
      for (const dependency of task.after ?? []) pendingDependencies.push([task.key, dependency]);

      if (task.checklist.length) {
        await tx.query(
          `INSERT INTO ${S}.learning_task_checklist_items
             (organization_id, task_id, item_key, sort_order, label_json, group_json, note_json, origin, source_json, required)
           SELECT $1, $2, t.item_key, t.position - 1, t.label::jsonb, t.grp::jsonb, t.note::jsonb, t.origin, t.source::jsonb, t.required
             FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::boolean[])
                  WITH ORDINALITY AS t(item_key, label, grp, note, origin, source, required, position)`,
          [
            organizationId,
            insertedTask.id,
            task.checklist.map((entry) => entry.key),
            task.checklist.map((entry) => JSON.stringify(entry.label)),
            task.checklist.map((entry) => (entry.group ? JSON.stringify(entry.group) : null)),
            task.checklist.map((entry) => (entry.note ? JSON.stringify(entry.note) : null)),
            task.checklist.map((entry) => entry.origin),
            task.checklist.map((entry) =>
              entry.source || entry.groupSource ? JSON.stringify({ ...(entry.source ?? {}), ...(entry.groupSource ? { group: entry.groupSource } : {}) }) : null
            ),
            task.checklist.map((entry) => entry.required !== false),
          ]
        );
      }
    }
  }

  for (const [taskKey, dependency] of pendingDependencies) {
    await tx.query(
      `INSERT INTO ${S}.learning_task_dependencies (task_id, depends_on_task_id, organization_id) VALUES ($1, $2, $3)`,
      [taskIds.get(taskKey).id, taskIds.get(dependency).id, organizationId]
    );
  }
  return { stageIds, taskIds };
}

/** One alert per person for the work a new run handed them. */
function assignmentOutbox({ organizationId, actorId, courseId, courseName, taskIds }) {
  const perPerson = new Map();
  for (const [, entry] of taskIds) {
    for (const person of [entry.assignee, entry.reviewer].filter(Boolean)) perPerson.set(person, (perPerson.get(person) ?? 0) + 1);
  }
  return [...perPerson.entries()].map(([userId, count]) => ({
    organizationId,
    actorId,
    recipients: [userId],
    type: 'tasks_assigned',
    message: 'tasksAssigned',
    dedupeKey: `run-tasks:${courseId}:${userId}`,
    windowMinutes: WINDOW.SHORT,
    entityType: 'COURSE',
    entityId: courseId,
    link: '/learning-production/my-work',
    data: { courseName, count },
  }));
}

/* ------------------------------------------------------------------ */
/* Creating a run                                                       */
/* ------------------------------------------------------------------ */

async function readTeam(actor, value) {
  const team = new Map();
  for (const [index, entry] of (Array.isArray(value) ? value : []).slice(0, 100).entries()) {
    const member = plainObject(entry, `team.${index}`);
    const userId = userIdField(member.userId, `team.${index}.userId`);
    if (!userId) throw validation(`team.${index}.userId`, 'required');
    await assertAssignable(actor, userId, `team.${index}.userId`);
    team.set(userId, new Set([...(team.get(userId) ?? []), ...normalizeRoles(member.roles, `team.${index}.roles`)]));
  }
  return team;
}

/** Who makes, and who reviews, each lesson file — by the role they hold on the team. */
const LESSON_MAKER = { OUTLINE: 'OUTLINE_WRITER', PPT: 'PPT_DESIGNER', SCRIPT: 'SCRIPT_WRITER', VOICE_OVER: 'VOICE_OVER_ARTIST', VIDEO: 'VIDEO_EDITOR' };
const LESSON_REVIEWERS = {
  OUTLINE: ['SUBJECT_MATTER_EXPERT'],
  PPT: ['QUALITY_REVIEWER'],
  SCRIPT: ['SUBJECT_MATTER_EXPERT'],
  VOICE_OVER: ['AUDIO_REVIEWER', 'QUALITY_REVIEWER'],
  VIDEO: ['QUALITY_REVIEWER'],
};

/**
 * The course's default maker and reviewer for each lesson file, filled from
 * the team chosen for a run: when exactly one person holds the maker role
 * they make that file in every lesson added from now on, and likewise the
 * reviewer. A default already set on the course is never overwritten, and a
 * person is never made the reviewer of their own file.
 */
export function defaultsFromTeam(current, members) {
  const holders = (role) => [...members].filter(([, roles]) => roles.has(role)).map(([userId]) => userId);
  const only = (role) => {
    const found = holders(role);
    return found.length === 1 ? found[0] : null;
  };
  const next = {};
  let changed = false;
  for (const type of ASSET_TYPES) {
    const existing = current?.[type] ?? {};
    const assigneeUserId = existing.assigneeUserId ?? only(LESSON_MAKER[type]);
    let reviewerUserId = existing.reviewerUserId ?? null;
    if (!reviewerUserId) {
      for (const role of LESSON_REVIEWERS[type]) {
        const candidate = only(role);
        if (candidate && candidate !== assigneeUserId) {
          reviewerUserId = candidate;
          break;
        }
      }
    }
    next[type] = { assigneeUserId: assigneeUserId ?? null, reviewerUserId };
    if (next[type].assigneeUserId !== (existing.assigneeUserId ?? null) || next[type].reviewerUserId !== (existing.reviewerUserId ?? null)) changed = true;
  }
  return changed ? next : null;
}

async function addCourseMembers(tx, { organizationId, courseId, addedBy, team }) {
  for (const [userId, roles] of team) {
    await tx.query(
      `INSERT INTO ${S}.learning_course_members (organization_id, course_id, user_id, roles, added_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (course_id, user_id) DO UPDATE
         SET roles = (SELECT array_agg(DISTINCT r) FROM unnest(${S}.learning_course_members.roles || EXCLUDED.roles) AS r)`,
      [organizationId, courseId, userId, [...roles], addedBy]
    );
  }
}

/**
 * Start a production run.
 *
 * `{ scenario, courseId? | course: { name, code, description, priority }, title?, managerUserId, startDate,
 *    targetDate, team: [{ userId, roles }], sourceReleaseId? | baseline: 'CURRENT_CONTENT',
 *    expertContracted?: { userId, reason } }`
 *
 * A new course needs `course.create`; a run on an existing course needs
 * `run.manage` there. A course whose only open run is a legacy one has that
 * run closed (with the reason recorded) — lesson assets have one working copy
 * each, and two runs would both claim it.
 */
export async function createRun(actor, input) {
  const body = plainObject(input, 'body');
  const scenario = oneOf(body.scenario, SCENARIOS, 'scenario', { required: true });
  const existingCourseId = bodyId(body.courseId, 'courseId');
  const managerUserId = userIdField(body.managerUserId, 'managerUserId') ?? actor.userId;
  await assertAssignable(actor, managerUserId, 'managerUserId');
  const startDate = isoDate(body.startDate, 'startDate');
  const targetDate = isoDate(body.targetDate, 'targetDate');
  dateOrder(startDate, targetDate, 'targetDate');
  const title = text(body.title, 'title', { max: 160 }) || null;
  const team = await readTeam(actor, body.team);

  let courseInput = null;
  if (!existingCourseId) {
    if (!actor.grants.has(P.COURSE_CREATE)) throw forbidden('FORBIDDEN', { permission: P.COURSE_CREATE });
    if (scenario === 'REVAMP') throw validation('courseId', 'required');
    const course = plainObject(body.course, 'course');
    courseInput = {
      name: text(course.name, 'course.name', { required: true, max: 160 }),
      code: text(course.code, 'course.code', { max: 40 }) || null,
      description: text(course.description, 'course.description', { max: 5000 }) ?? '',
      priority: oneOf(course.priority, PRIORITIES, 'course.priority', { fallback: 'NORMAL' }),
    };
  }

  let expert = null;
  if (body.expertContracted) {
    if (scenario !== 'EXPERT_NEW') throw validation('expertContracted', 'not_applicable');
    const entry = plainObject(body.expertContracted, 'expertContracted');
    const userId = userIdField(entry.userId, 'expertContracted.userId') ?? null;
    const reason = text(entry.reason, 'expertContracted.reason', { max: 1000 });
    if (!reason) throw badRequest('REASON_REQUIRED', { field: 'expertContracted.reason' });
    if (userId) await assertAssignable(actor, userId, 'expertContracted.userId');
    expert = { userId, reason };
  }

  const sourceReleaseId = bodyId(body.sourceReleaseId, 'sourceReleaseId');
  const baselineFromContent = body.baseline === 'CURRENT_CONTENT';
  if (scenario === 'REVAMP' && !sourceReleaseId && !baselineFromContent) throw validation('sourceReleaseId', 'required');

  const outbox = [];
  const created = await transactionWithOutbox(outbox, async (tx) => {
    let courseId = existingCourseId;
    let courseName;
    if (courseId) {
      const ctx = await courseContext(actor, courseId, { db: tx, lock: true });
      requireGrant(ctx, P.RUN_MANAGE);
      courseName = ctx.course.name;
    } else {
      const inserted = await tx.row(
        `INSERT INTO ${S}.learning_courses
           (organization_id, name, code, description, manager_user_id, priority, start_date, target_date, settings_json, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [
          actor.organizationId,
          courseInput.name,
          courseInput.code,
          courseInput.description,
          managerUserId,
          courseInput.priority,
          startDate,
          targetDate,
          JSON.stringify(normalizeSettings({})),
          actor.userId,
        ]
      );
      courseId = inserted.id;
      courseName = inserted.name;
      await insertChecklistTemplate(tx, actor.organizationId, courseId, actor.userId);
      await record(tx, {
        organizationId: actor.organizationId,
        courseId,
        actorUserId: actor.userId,
        eventType: 'COURSE_CREATED',
        metadata: { name: inserted.name, code: inserted.code },
      });
    }

    // The manager and the team are the course team; the creator keeps a hand
    // in what they made unless their workspace keys already reach everything.
    const members = new Map(team);
    members.set(managerUserId, new Set([...(members.get(managerUserId) ?? []), 'PRODUCTION_MANAGER']));
    if (!existingCourseId && !actor.grants.has(P.RUN_MANAGE)) {
      members.set(actor.userId, new Set([...(members.get(actor.userId) ?? []), 'PRODUCTION_MANAGER']));
    }
    if (expert?.userId) members.set(expert.userId, new Set([...(members.get(expert.userId) ?? []), 'SUBJECT_MATTER_EXPERT']));
    await addCourseMembers(tx, { organizationId: actor.organizationId, courseId, addedBy: actor.userId, team: members });
    const courseRow = await tx.row(`SELECT production_defaults_json FROM ${S}.learning_courses WHERE id = $1`, [courseId]);
    const defaults = defaultsFromTeam(courseRow?.production_defaults_json ?? {}, members);
    if (defaults) {
      await tx.query(`UPDATE ${S}.learning_courses SET production_defaults_json = $2 WHERE id = $1`, [courseId, JSON.stringify(defaults)]);
    }

    // One run in flight per course.
    const open = await tx.row(
      `SELECT id, scenario, run_number FROM ${S}.learning_production_runs
        WHERE course_id = $1 AND status IN ('ACTIVE', 'ON_HOLD') FOR UPDATE`,
      [courseId]
    );
    const runNumber = (await tx.row(`SELECT coalesce(max(run_number), 0) + 1 AS n FROM ${S}.learning_production_runs WHERE course_id = $1`, [courseId])).n;
    if (open) {
      if (open.scenario !== 'LEGACY') throw conflict('RUN_ALREADY_OPEN', { runId: open.id });
      const reason = `Superseded by run #${runNumber} (${scenario})`;
      await tx.query(
        `UPDATE ${S}.learning_production_runs SET status = 'CLOSED', closed_at = now(), closed_by = $2, close_reason = $3 WHERE id = $1`,
        [open.id, actor.userId, reason]
      );
      await record(tx, {
        organizationId: actor.organizationId,
        courseId,
        runId: open.id,
        actorUserId: actor.userId,
        eventType: 'RUN_STATUS_CHANGED',
        metadata: { from: 'ACTIVE', to: 'CLOSED', reason },
      });
    }

    // A revamp starts from a release: a published one, or — for a course whose
    // content predates release tracking — a baseline recorded now, labelled as
    // recorded rather than verified.
    let sourceRelease = null;
    if (scenario === 'REVAMP') {
      if (sourceReleaseId) {
        sourceRelease = await tx.row(
          `SELECT * FROM ${S}.learning_releases WHERE id = $1 AND course_id = $2 AND published_at IS NOT NULL`,
          [sourceReleaseId, courseId]
        );
        if (!sourceRelease) throw validation('sourceReleaseId', 'invalid');
      } else {
        const { snapshot, summary } = await buildSnapshot(tx, courseId);
        sourceRelease = await tx.row(
          `INSERT INTO ${S}.learning_releases
             (organization_id, course_id, release_number, version_label, kind, status, snapshot_json, summary_json, notes,
              prepared_by, published_by, published_at, deployment_notes)
           SELECT $1, $2, coalesce(max(release_number), 0) + 1, 'baseline-' || (coalesce(max(release_number), 0) + 1),
                  'LEGACY_BASELINE', 'PUBLISHED', $3, $4, $5, $6, $6, now(), $7
             FROM ${S}.learning_releases WHERE course_id = $2
           RETURNING *`,
          [
            actor.organizationId,
            courseId,
            JSON.stringify(snapshot),
            JSON.stringify(summary),
            'Baseline recorded when the revamp started.',
            actor.userId,
            'Recorded from the course content as it stood; publication was not tracked in this system.',
          ]
        );
        await tx.query(
          `UPDATE ${S}.learning_courses SET current_release_id = coalesce(current_release_id, $2) WHERE id = $1`,
          [courseId, sourceRelease.id]
        );
      }
    }

    const template = await currentTemplateRow(tx, actor.organizationId, scenario);
    const definition = template.definition_json;
    const lessonAssetTypes = definition.lessonAssetTypes ?? SCENARIO_ASSET_TYPES[scenario];
    const run = await tx.row(
      `INSERT INTO ${S}.learning_production_runs
         (organization_id, course_id, run_number, scenario, template_version_id, title, status, manager_user_id, start_date,
          target_date, source_release_id, source_snapshot_json, options_json, lesson_asset_types, expert_contracted_user_id,
          expert_skip_reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING *`,
      [
        actor.organizationId,
        courseId,
        runNumber,
        scenario,
        template.id,
        title,
        managerUserId,
        startDate,
        targetDate,
        sourceRelease?.id ?? null,
        sourceRelease ? JSON.stringify(sourceRelease.snapshot_json) : null,
        JSON.stringify(template.options_json ?? {}),
        lessonAssetTypes,
        expert?.userId ?? null,
        expert?.reason ?? null,
        actor.userId,
      ]
    );

    const { stageIds, taskIds } = await instantiateTemplate(tx, {
      organizationId: actor.organizationId,
      courseId,
      runId: run.id,
      definition,
      managerUserId,
    });

    if (expert && stageIds.has('EXPERT_ACQUISITION')) {
      await tx.query(
        `UPDATE ${S}.learning_stage_instances SET status = 'SKIPPED', skipped_at = now(), skipped_by = $2, skip_reason = $3 WHERE id = $1`,
        [stageIds.get('EXPERT_ACQUISITION'), actor.userId, expert.reason]
      );
      await record(tx, {
        organizationId: actor.organizationId,
        courseId,
        runId: run.id,
        stageId: stageIds.get('EXPERT_ACQUISITION'),
        actorUserId: actor.userId,
        eventType: 'STAGE_SKIPPED',
        metadata: { stageKey: 'EXPERT_ACQUISITION', reason: expert.reason, expertContracted: true },
      });
    }

    await record(tx, {
      organizationId: actor.organizationId,
      courseId,
      runId: run.id,
      actorUserId: actor.userId,
      eventType: 'RUN_CREATED',
      metadata: {
        scenario,
        runNumber,
        templateVersion: template.version_number,
        stages: stageIds.size,
        tasks: taskIds.size,
        sourceReleaseId: sourceRelease?.id ?? null,
        baseline: baselineFromContent,
      },
    });

    // Derive the first statuses. No "ready to start" alerts at creation — the
    // assignment alert below already says it.
    await syncRun(tx, run.id, { actorId: actor.userId });
    outbox.push(...assignmentOutbox({ organizationId: actor.organizationId, actorId: actor.userId, courseId, courseName, taskIds }));
    return { runId: run.id, courseId };
  });

  return getRun(actor, created.runId);
}

/* ------------------------------------------------------------------ */
/* Reading                                                              */
/* ------------------------------------------------------------------ */

/** Per-task counts the plan draws beside each task, in one query. */
async function taskCounts(db, runId) {
  const rows = await db.rows(
    `SELECT t.id,
            (SELECT count(*)::int FROM ${S}.learning_task_checklist_items c WHERE c.task_id = t.id) AS checklist_total,
            (SELECT count(*)::int FROM ${S}.learning_task_checklist_items c WHERE c.task_id = t.id AND c.status <> 'PENDING') AS checklist_done,
            (SELECT count(*)::int FROM ${S}.learning_task_checklist_items c WHERE c.task_id = t.id AND c.required AND c.status = 'PENDING') AS checklist_pending_required,
            (SELECT count(*)::int FROM ${S}.learning_task_evidence e WHERE e.task_id = t.id AND e.withdrawn_at IS NULL) AS evidence,
            (SELECT count(*)::int FROM ${S}.learning_task_comments m WHERE m.task_id = t.id) AS comments,
            (SELECT count(*)::int FROM ${S}.learning_task_submissions s WHERE s.task_id = t.id) AS submissions
       FROM ${S}.learning_task_instances t WHERE t.run_id = $1`,
    [runId]
  );
  return new Map(rows.map((row) => [row.id, row]));
}

function taskSummary(entry, counts, day) {
  return {
    id: entry.id,
    key: entry.key,
    stageKey: entry.stageKey,
    label: entry.label,
    kind: entry.kind,
    classification: entry.classification,
    origin: entry.origin,
    approvalOrigin: entry.approvalOrigin,
    role: entry.role,
    reviewerRole: entry.reviewerRole,
    requiresApproval: entry.requiresApproval,
    requiresEvidence: entry.requiresEvidence,
    sensitive: entry.sensitive,
    externalTool: entry.externalTool,
    status: entry.status,
    display: entry.status === 'NOT_STARTED' ? (entry.blockers.length && !entry.dependencyOverrideAt ? 'BLOCKED' : 'READY') : entry.status,
    blockers: entry.blockers,
    gate: entry.gate,
    priority: entry.priority,
    assigneeUserId: entry.assigneeUserId,
    reviewerUserId: entry.reviewerUserId,
    dueDate: entry.dueDate,
    dueState: taskDueState(entry.dueDate, entry.status, day),
    waiveReason: entry.waiveReason,
    after: entry.after,
    counts: counts
      ? {
          checklist: counts.checklist_total,
          checklistDone: counts.checklist_done,
          checklistPendingRequired: counts.checklist_pending_required,
          evidence: counts.evidence,
          comments: counts.comments,
          submissions: counts.submissions,
        }
      : null,
  };
}

async function overdueAssets(db, courseId, day) {
  const row = await db.row(
    `SELECT count(*) FILTER (WHERE a.due_date < $2::date)::int AS overdue, count(*)::int AS open
       FROM ${S}.learning_assets a
       JOIN ${S}.learning_lessons l ON l.id = a.lesson_id AND l.archived_at IS NULL
      WHERE a.course_id = $1 AND a.applicable AND a.status NOT IN ('APPROVED', 'LOCKED')`,
    [courseId, day]
  );
  return row ?? { overdue: 0, open: 0 };
}

/**
 * Everything the run overview answers: where it is, what gate is next, how
 * healthy it is, what waits for approval, what is late, and who is on the
 * hook — plus every stage and task for the plan.
 */
export async function getRun(actor, runId) {
  const ctx = await runContext(actor, runId);
  const run = ctx.run;
  const day = today();
  const [{ stages, tasks }, facts, counts, releasesRows, template, issueRows, assetLoad] = await Promise.all([
    loadRunStructure(direct, runId),
    runFacts(direct, run),
    taskCounts(direct, runId),
    direct.rows(
      `SELECT rel.*, r.run_number FROM ${S}.learning_releases rel
         LEFT JOIN ${S}.learning_production_runs r ON r.id = rel.run_id
        WHERE rel.course_id = $1 ORDER BY rel.release_number DESC`,
      [run.courseId]
    ),
    run.templateVersionId
      ? direct.row(`SELECT * FROM ${S}.learning_workflow_template_versions WHERE id = $1`, [run.templateVersionId])
      : null,
    direct.rows(
      `SELECT st.stage_key, i.severity, i.status, count(*)::int AS n
         FROM ${S}.learning_run_issues i JOIN ${S}.learning_stage_instances st ON st.id = i.stage_id
        WHERE i.run_id = $1 GROUP BY st.stage_key, i.severity, i.status`,
      [runId]
    ),
    overdueAssets(direct, run.courseId, day),
  ]);

  const computed = computeRun({ stages, tasks, facts, lessonAssetTypes: run.lessonAssetTypes });
  const progress = runProgress({ ...computed, facts, lessonAssetTypes: run.lessonAssetTypes, scenario: run.scenario });
  const summaries = computed.tasks.map((entry) => taskSummary(entry, counts.get(entry.id), day));
  const byStage = new Map();
  for (const entry of summaries) byStage.set(entry.stageKey, [...(byStage.get(entry.stageKey) ?? []), entry]);

  const openGating = summaries.filter((entry) => isTaskGating(entry) && !isTaskComplete(entry.status));
  const overdueTasks = summaries.filter((entry) => entry.dueState === 'OVERDUE');
  const health = runHealth({
    status: run.status,
    workflowPercent: progress.workflow.percent,
    overdue: overdueTasks.length + assetLoad.overdue,
    open: openGating.length + assetLoad.open,
    startDate: run.startDate,
    targetDate: run.targetDate,
    today: day,
    settings: ctx.settings,
  });

  const current = currentRunStage(computed.stages);
  const nextGate = current
    ? {
        stageKey: current.key,
        label: current.label,
        status: current.status,
        blockers: current.blockers,
        pending: (byStage.get(current.key) ?? [])
          .filter((entry) => isTaskGating(entry) && !isTaskComplete(entry.status))
          .map((entry) => ({
            id: entry.id,
            key: entry.key,
            label: entry.label,
            display: entry.display,
            kind: entry.kind,
            assigneeUserId: entry.assigneeUserId,
            reviewerUserId: entry.reviewerUserId,
            role: entry.role,
            dueDate: entry.dueDate,
            dueState: entry.dueState,
            gate: entry.gate,
          })),
      }
    : null;

  const issues = {};
  for (const row of issueRows) {
    const bucket = (issues[row.stage_key] ??= { open: 0, total: 0, blocking: 0 });
    bucket.total += row.n;
    if (['OPEN', 'IN_PROGRESS', 'FIXED'].includes(row.status)) {
      bucket.open += row.n;
      if (['HIGH', 'CRITICAL'].includes(row.severity)) bucket.blocking += row.n;
    }
  }

  const releases = releasesRows.map((row) => mapRelease(row));
  const payload = {
    run,
    course: { id: ctx.course.id, name: ctx.course.name, code: ctx.course.code, currentReleaseId: ctx.course.currentReleaseId, hasCover: ctx.course.hasCover },
    template: template ? mapTemplateVersion(template) : null,
    stages: computed.stages.map((stage) => ({
      id: stage.id,
      key: stage.key,
      label: stage.label,
      description: stage.description,
      note: stage.note,
      origin: stage.origin,
      source: stage.source,
      after: stage.after,
      ownerRole: stage.ownerRole,
      skippable: stage.skippable,
      issueLog: stage.issueLog,
      lessonAssets: stage.lessonAssets,
      status: stage.status,
      blockers: stage.blockers,
      progress: stage.progress,
      startedAt: stage.startedAt,
      completedAt: stage.completedAt,
      skippedAt: stage.skippedAt,
      skippedBy: stage.skippedBy,
      skipReason: stage.skipReason,
      issues: issues[stage.key] ?? { open: 0, total: 0, blocking: 0 },
      tasks: byStage.get(stage.key) ?? [],
    })),
    progress,
    health,
    currentStage: current ? current.key : null,
    nextGate,
    pendingApprovals: summaries.filter((entry) => entry.status === 'SUBMITTED' || entry.status === 'UNDER_REVIEW'),
    overdueTasks,
    assetLoad,
    releases,
    facts: { assets: facts.assets, blockingIssues: facts.blockingIssues },
    runOpen: ctx.runOpen,
    isCurrentRun: ctx.isCurrentRun,
    capabilities: { ...courseCapabilities(ctx), runOpen: ctx.runOpen },
    today: day,
  };
  payload.people = await peopleFor(userIdsIn([run, summaries, releases, computed.stages]));
  return payload;
}

/** Every run of a course, newest first, with the figures a list needs. */
export async function listRuns(actor, courseId) {
  const ctx = await courseContext(actor, courseId);
  const rows = await direct.rows(
    `SELECT r.*, tv.version_number AS template_version_number,
            (SELECT count(*)::int FROM ${S}.learning_task_instances t WHERE t.run_id = r.id AND t.classification <> 'OPTIONAL' AND t.status <> 'WAIVED') AS gating,
            (SELECT count(*)::int FROM ${S}.learning_task_instances t WHERE t.run_id = r.id AND t.classification <> 'OPTIONAL' AND t.status IN ('APPROVED', 'DONE')) AS gating_done,
            (SELECT st.stage_key FROM ${S}.learning_stage_instances st WHERE st.run_id = r.id AND st.status NOT IN ('DONE', 'SKIPPED') ORDER BY st.sort_order LIMIT 1) AS current_stage,
            (SELECT st.label_json FROM ${S}.learning_stage_instances st WHERE st.run_id = r.id AND st.status NOT IN ('DONE', 'SKIPPED') ORDER BY st.sort_order LIMIT 1) AS current_stage_label
       FROM ${S}.learning_production_runs r
       LEFT JOIN ${S}.learning_workflow_template_versions tv ON tv.id = r.template_version_id
      WHERE r.course_id = $1 AND r.organization_id = $2
      ORDER BY r.run_number DESC`,
    [courseId, ctx.organizationId]
  );
  const runs = rows.map((row) => ({
    ...mapRun(row),
    templateVersionNumber: row.template_version_number ?? null,
    workflow: { done: row.gating_done, total: row.gating, percent: row.gating ? Math.round((row.gating_done / row.gating) * 100) : 0 },
    currentStage: row.current_stage ? { key: row.current_stage, label: row.current_stage_label } : null,
  }));
  return {
    runs,
    currentRunId: runs.find((entry) => OPEN_RUN_STATUSES.includes(entry.status))?.id ?? runs[0]?.id ?? null,
    capabilities: courseCapabilities(ctx),
    people: await peopleFor(userIdsIn(runs)),
  };
}

/* ------------------------------------------------------------------ */
/* Steering                                                             */
/* ------------------------------------------------------------------ */

function reason(value) {
  const clean = typeof value === 'string' ? value.trim() : '';
  if (!clean) throw badRequest('REASON_REQUIRED');
  if (clean.length > 1000) throw validation('reason', 'too_long', { max: 1000 });
  return clean;
}

/** Title, manager and dates; and hold, resume or cancel — each with its own record. */
export async function updateRun(actor, runId, input) {
  const body = plainObject(input, 'body');
  const outbox = [];
  await transactionWithOutbox(outbox, async (tx) => {
    const ctx = await runContext(actor, runId, { db: tx, lock: true });
    requireGrant(ctx, P.RUN_MANAGE);
    const run = ctx.run;
    if (!OPEN_RUN_STATUSES.includes(run.status)) throw workflowRefusal('RUN_CLOSED');

    const next = {
      title: 'title' in body ? text(body.title, 'title', { max: 160 }) || null : run.title,
      managerUserId: 'managerUserId' in body ? userIdField(body.managerUserId, 'managerUserId') : run.managerUserId,
      startDate: 'startDate' in body ? isoDate(body.startDate, 'startDate') : run.startDate,
      targetDate: 'targetDate' in body ? isoDate(body.targetDate, 'targetDate') : run.targetDate,
    };
    dateOrder(next.startDate, next.targetDate, 'targetDate');
    if (!next.managerUserId) throw validation('managerUserId', 'required');
    if (next.managerUserId !== run.managerUserId) await assertAssignable(actor, next.managerUserId, 'managerUserId');
    const changed = Object.keys(next).filter((key) => (run[key] ?? null) !== (next[key] ?? null));
    if (changed.length) {
      await tx.query(
        `UPDATE ${S}.learning_production_runs SET title = $2, manager_user_id = $3, start_date = $4, target_date = $5 WHERE id = $1`,
        [runId, next.title, next.managerUserId, next.startDate, next.targetDate]
      );
      await record(tx, {
        organizationId: ctx.organizationId,
        courseId: run.courseId,
        runId,
        actorUserId: ctx.userId,
        eventType: 'RUN_UPDATED',
        metadata: { fields: changed },
      });
    }

    if (body.status && body.status !== run.status) {
      const to = oneOf(body.status, ['ACTIVE', 'ON_HOLD', 'CANCELLED'], 'status', { required: true });
      if (to === 'CANCELLED') {
        const why = reason(body.reason);
        await tx.query(
          `UPDATE ${S}.learning_production_runs SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3 WHERE id = $1`,
          [runId, ctx.userId, why]
        );
        await tx.query(
          `UPDATE ${S}.learning_releases SET status = 'WITHDRAWN', withdrawn_at = now(), withdrawn_by = $2, withdraw_reason = $3
            WHERE run_id = $1 AND status IN ('CANDIDATE', 'SIGNED_OFF')`,
          [runId, ctx.userId, `Run cancelled: ${why}`]
        );
      } else {
        await tx.query(`UPDATE ${S}.learning_production_runs SET status = $2 WHERE id = $1`, [runId, to]);
      }
      await record(tx, {
        organizationId: ctx.organizationId,
        courseId: run.courseId,
        runId,
        actorUserId: ctx.userId,
        eventType: 'RUN_STATUS_CHANGED',
        metadata: { from: run.status, to, reason: body.reason ?? null },
      });
    }
  });
  return getRun(actor, runId);
}

/**
 * Skip a stage, with a reason kept in the history. A stage whose template
 * says when it may be skipped (experts, when one is contracted), or whose
 * every gating task is conditional, may be skipped by whoever manages the
 * run; anything else only by an administrator.
 */
export async function skipStage(actor, stageId, input) {
  const why = reason(plainObject(input, 'body').reason);
  const outbox = [];
  const runId = await transactionWithOutbox(outbox, async (tx) => {
    const ctx = await stageContext(actor, stageId, { db: tx, lock: true });
    requireGrant(ctx, P.RUN_MANAGE);
    if (!ctx.runOpen) throw workflowRefusal('RUN_CLOSED');
    if (ctx.stage.status === 'SKIPPED') return ctx.run.id;
    if (ctx.stage.status === 'DONE') throw workflowRefusal('INVALID_TRANSITION');
    const gating = await tx.rows(
      `SELECT classification FROM ${S}.learning_task_instances WHERE stage_id = $1 AND classification <> 'OPTIONAL'`,
      [stageId]
    );
    const conditionalOnly = gating.length > 0 && gating.every((entry) => entry.classification === 'CONDITIONAL');
    if (!ctx.stage.skippable && !conditionalOnly && !ctx.grants.isAdmin) throw forbidden('STAGE_NOT_SKIPPABLE');

    await tx.query(
      `UPDATE ${S}.learning_stage_instances SET status = 'SKIPPED', skipped_at = now(), skipped_by = $2, skip_reason = $3 WHERE id = $1`,
      [stageId, ctx.userId, why]
    );
    await record(tx, {
      organizationId: ctx.organizationId,
      courseId: ctx.course.id,
      runId: ctx.run.id,
      stageId,
      actorUserId: ctx.userId,
      eventType: 'STAGE_SKIPPED',
      metadata: { stageKey: ctx.stage.key, reason: why, adminOverride: !ctx.stage.skippable && !conditionalOnly },
    });
    await syncRun(tx, ctx.run.id, { actorId: ctx.userId, outbox });
    return ctx.run.id;
  });
  return getRun(actor, runId);
}

export async function unskipStage(actor, stageId) {
  const outbox = [];
  const runId = await transactionWithOutbox(outbox, async (tx) => {
    const ctx = await stageContext(actor, stageId, { db: tx, lock: true });
    requireGrant(ctx, P.RUN_MANAGE);
    if (!ctx.runOpen) throw workflowRefusal('RUN_CLOSED');
    if (ctx.stage.status !== 'SKIPPED') return ctx.run.id;
    await tx.query(
      `UPDATE ${S}.learning_stage_instances SET status = 'BLOCKED', skipped_at = NULL, skipped_by = NULL, skip_reason = NULL WHERE id = $1`,
      [stageId]
    );
    await record(tx, {
      organizationId: ctx.organizationId,
      courseId: ctx.course.id,
      runId: ctx.run.id,
      stageId,
      actorUserId: ctx.userId,
      eventType: 'STAGE_REOPENED',
      metadata: { stageKey: ctx.stage.key, unskipped: true },
    });
    await syncRun(tx, ctx.run.id, { actorId: ctx.userId, outbox });
    return ctx.run.id;
  });
  return getRun(actor, runId);
}

/**
 * Put a legacy run on a workflow. Its stages are created fresh and nothing is
 * marked done on its behalf: automatic gates read the real lesson assets, and
 * every other task — curriculum, deployment, UAT — waits for real evidence.
 */
export async function adoptTemplate(actor, runId, input) {
  const body = plainObject(input, 'body');
  const scenario = oneOf(body.scenario, SCENARIOS.filter((entry) => entry !== 'REVAMP'), 'scenario', { required: true });
  const outbox = [];
  await transactionWithOutbox(outbox, async (tx) => {
    const ctx = await runContext(actor, runId, { db: tx, lock: true });
    requireGrant(ctx, P.RUN_MANAGE);
    if (ctx.run.scenario !== 'LEGACY' || !OPEN_RUN_STATUSES.includes(ctx.run.status)) throw workflowRefusal('INVALID_TRANSITION');
    const template = await currentTemplateRow(tx, ctx.organizationId, scenario);
    const definition = template.definition_json;
    await tx.query(
      `UPDATE ${S}.learning_production_runs
          SET scenario = $2, template_version_id = $3, options_json = $4, lesson_asset_types = $5, manager_user_id = coalesce(manager_user_id, $6)
        WHERE id = $1`,
      [runId, scenario, template.id, JSON.stringify(template.options_json ?? {}), definition.lessonAssetTypes, ctx.userId]
    );
    const { stageIds, taskIds } = await instantiateTemplate(tx, {
      organizationId: ctx.organizationId,
      courseId: ctx.course.id,
      runId,
      definition,
      managerUserId: ctx.run.managerUserId ?? ctx.userId,
    });
    await record(tx, {
      organizationId: ctx.organizationId,
      courseId: ctx.course.id,
      runId,
      actorUserId: ctx.userId,
      eventType: 'TEMPLATE_ADOPTED',
      metadata: { scenario, templateVersion: template.version_number, stages: stageIds.size, tasks: taskIds.size },
    });
    await syncRun(tx, runId, { actorId: ctx.userId });
    outbox.push(...assignmentOutbox({ organizationId: ctx.organizationId, actorId: ctx.userId, courseId: ctx.course.id, courseName: ctx.course.name, taskIds }));
  });
  return getRun(actor, runId);
}

/* ------------------------------------------------------------------ */
/* Run team                                                             */
/* ------------------------------------------------------------------ */

/** Roles on this run only — a UAT tester for this cycle, say. Course roles live on the course team. */
export async function listRunTeam(actor, runId) {
  const ctx = await runContext(actor, runId);
  const rows = await direct.rows(`SELECT user_id, roles FROM ${S}.learning_run_members WHERE run_id = $1 ORDER BY created_at`, [runId]);
  const members = rows.map((row) => ({ userId: row.user_id, roles: row.roles }));
  return {
    members,
    canManage: ctx.grants.has(P.TEAM_MANAGE) && ctx.runOpen,
    people: await peopleFor([...members.map((member) => member.userId), ctx.run.managerUserId]),
  };
}

export async function saveRunMember(actor, runId, userId, input) {
  const roles = normalizeRoles(plainObject(input, 'body').roles, 'roles');
  await transactionWithOutbox([], async (tx) => {
    const ctx = await runContext(actor, runId, { db: tx, lock: true });
    requireGrant(ctx, P.TEAM_MANAGE);
    if (!ctx.runOpen) throw workflowRefusal('RUN_CLOSED');
    await assertAssignable(actor, userId, 'userId');
    const existing = await tx.row(`SELECT id FROM ${S}.learning_run_members WHERE run_id = $1 AND user_id = $2`, [runId, userId]);
    await tx.query(
      `INSERT INTO ${S}.learning_run_members (organization_id, run_id, user_id, roles, added_by) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (run_id, user_id) DO UPDATE SET roles = EXCLUDED.roles`,
      [ctx.organizationId, runId, userId, roles, ctx.userId]
    );
    await record(tx, {
      organizationId: ctx.organizationId,
      courseId: ctx.course.id,
      runId,
      actorUserId: ctx.userId,
      eventType: existing ? 'RUN_MEMBER_UPDATED' : 'RUN_MEMBER_ADDED',
      metadata: { userId, roles },
    });
  });
  return listRunTeam(actor, runId);
}

export async function removeRunMember(actor, runId, userId) {
  await transactionWithOutbox([], async (tx) => {
    const ctx = await runContext(actor, runId, { db: tx, lock: true });
    requireGrant(ctx, P.TEAM_MANAGE);
    const removed = await tx.row(`DELETE FROM ${S}.learning_run_members WHERE run_id = $1 AND user_id = $2 RETURNING roles`, [runId, userId]);
    if (!removed) throw notFound();
    await record(tx, {
      organizationId: ctx.organizationId,
      courseId: ctx.course.id,
      runId,
      actorUserId: ctx.userId,
      eventType: 'RUN_MEMBER_REMOVED',
      metadata: { userId, roles: removed.roles },
    });
  });
  return listRunTeam(actor, runId);
}

