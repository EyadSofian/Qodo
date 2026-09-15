/**
 * Courses: the list, one course, creating, editing, archiving, defaults and
 * settings.
 */

import {
  ASSET_TYPES,
  COURSE_ROLES,
  COURSE_STATUSES,
  DEFAULT_VIDEO_CHECKLIST,
  PRIORITIES,
  STAGE_DEPENDENCIES,
} from '../../../shared/learningProduction/constants.js';
import { LP_PERMISSIONS as P } from '../../../shared/learningProduction/permissions.js';
import { normalizeSettings, statusAfterAssignment } from '../../../shared/learningProduction/workflow.js';
import { MAX_IMPORT_LESSONS } from '../../../shared/learningProduction/lessonImport.js';
import { SCHEMA as S, direct, transaction } from '../db.js';
import { courseCapabilities, courseContext, requireGrant, visibleCourseCondition } from '../access.js';
import { HEADLINE_EVENTS, feed, record } from '../activity.js';
import { WINDOW, flush } from '../notifications.js';
import { badRequest, forbidden, validation } from '../errors.js';
import { mapCourse } from '../mappers.js';
import { assertAssignable, peopleFor, userIdField, userIdsIn } from '../people.js';
import { dateOrder, isoDate, oneOf, plainObject, text } from '../validate.js';
import * as blobs from '../blobs.js';
import { ACCEPTED, KINDS, detectKind, uploadLimit } from '../fileTypes.js';
import { defaultAssignmentOutbox, insertLessonsWithAssets } from './lessonService.js';
import { COMPLETE_SQL, REVIEW_SQL, coursesWithStats, stageStats, today } from './summaries.js';

/** English labels for the built-in checklist; the interface translates the category key. */
export const CHECKLIST_LABELS = {
  CONTENT_ACCURACY: 'Content accuracy',
  VISUAL_QUALITY: 'Visual quality',
  AUDIO_QUALITY: 'Audio quality',
  SYNCHRONIZATION: 'Synchronization',
  BRANDING: 'Branding',
  SPELLING: 'Spelling',
  ANIMATIONS: 'Animations',
  TRANSITIONS: 'Transitions',
  TECHNICAL_QUALITY: 'Technical quality',
  FINAL_APPROVAL: 'Final approval',
};

const escapeLike = (value) => value.replace(/[\\%_]/g, (match) => `\\${match}`);

/* ------------------------------------------------------------------ */
/* Reading                                                              */
/* ------------------------------------------------------------------ */

const HEALTH_FILTERS = ['ON_TRACK', 'AT_RISK', 'DELAYED', 'COMPLETED'];
const SORTS = ['recent', 'name', 'target', 'progress'];

export async function listCourses(actor, query = {}) {
  const params = [];
  let condition = visibleCourseCondition(actor, params, 'c');
  condition += query.archived === '1' ? ' AND c.archived_at IS NOT NULL' : ' AND c.archived_at IS NULL';

  const search = typeof query.q === 'string' ? query.q.trim().toLowerCase().slice(0, 100) : '';
  if (search) {
    params.push(`%${escapeLike(search)}%`);
    condition += ` AND (lower(c.name) LIKE $${params.length} ESCAPE '\\' OR lower(coalesce(c.code, '')) LIKE $${params.length} ESCAPE '\\')`;
  }
  if (typeof query.managerId === 'string' && query.managerId) {
    params.push(query.managerId);
    condition += ` AND c.manager_user_id = $${params.length}`;
  }
  if (COURSE_STATUSES.includes(query.status)) {
    params.push(query.status);
    condition += ` AND c.status = $${params.length}`;
  }

  let courses = await coursesWithStats(direct, { condition, params });

  if (HEALTH_FILTERS.includes(query.health)) courses = courses.filter((course) => course.health === query.health);

  const sort = SORTS.includes(query.sort) ? query.sort : 'recent';
  const compare = {
    recent: (a, b) => String(b.lastActivityAt ?? b.updatedAt).localeCompare(String(a.lastActivityAt ?? a.updatedAt)),
    name: (a, b) => a.name.localeCompare(b.name, 'ar'),
    target: (a, b) => String(a.targetDate ?? '9999').localeCompare(String(b.targetDate ?? '9999')),
    progress: (a, b) => b.progress - a.progress,
  }[sort];
  courses.sort(compare);

  const managers = await peopleFor(courses.map((course) => course.managerUserId));
  return {
    courses: courses.map(({ settings: _settings, ...course }) => course),
    people: managers,
    canCreate: actor.grants.has(P.COURSE_CREATE),
  };
}

/** One course: the header, its stages, its team and the latest of its history. */
export async function getCourse(actor, courseId, { includeArchived = false } = {}) {
  const ctx = await courseContext(actor, courseId, { includeArchived });
  const [[withStats], stages, members, activity, blocked] = await Promise.all([
    coursesWithStats(direct, { condition: 'c.id = $1', params: [courseId], limit: 1 }),
    stageStats(direct, { condition: 'c.id = $1', params: [courseId] }),
    direct.rows(
      `SELECT user_id, roles FROM ${S}.learning_course_members WHERE course_id = $1 ORDER BY created_at`,
      [courseId]
    ),
    feed(direct, { condition: 'e.course_id = $1', params: [courseId], limit: 12, events: HEADLINE_EVENTS }),
    blockedCounts(direct, { condition: 'c.id = $1', params: [courseId] }),
  ]);

  const team = members.map((member) => ({ userId: member.user_id, roles: member.roles }));
  const { settings: _settings, ...course } = withStats;
  return {
    course: { ...course, archivedAt: ctx.course.archivedAt },
    settings: ctx.settings,
    stages,
    blocked,
    team,
    activity,
    capabilities: courseCapabilities(ctx),
    people: await peopleFor(userIdsIn([course, team, activity], [course.managerUserId])),
  };
}

/**
 * Assets that have somebody assigned and cannot start because an earlier stage
 * is not approved. A video waiting for an unassigned voice-over is ordinary
 * pipeline; a designer with a name on work they cannot begin is a problem.
 */
export async function blockedCounts(db, { condition, params }) {
  const values = [...params];
  const dependents = [];
  const requires = [];
  for (const [type, list] of Object.entries(STAGE_DEPENDENCIES)) {
    for (const required of list) {
      dependents.push(type);
      requires.push(required);
    }
  }
  values.push(dependents);
  const dependentRef = `$${values.length}::text[]`;
  values.push(requires);
  const requiresRef = `$${values.length}::text[]`;

  const found = await db.row(
    `SELECT count(DISTINCT a.id)::int AS assets, count(DISTINCT a.lesson_id)::int AS lessons
       FROM ${S}.learning_courses c
       JOIN ${S}.learning_lessons l ON l.course_id = c.id AND l.archived_at IS NULL
       JOIN ${S}.learning_assets a ON a.lesson_id = l.id
       JOIN unnest(${dependentRef}, ${requiresRef}) AS d(asset_type, requires) ON d.asset_type = a.asset_type
       JOIN ${S}.learning_assets s ON s.lesson_id = a.lesson_id AND s.asset_type = d.requires
      WHERE ${condition}
        AND a.status = 'ASSIGNED'
        AND a.dependency_override_at IS NULL
        AND s.status NOT IN ${COMPLETE_SQL}
        AND coalesce((c.settings_json ->> 'enforceDependencies')::boolean, true)`,
    values
  );
  return { assets: found?.assets ?? 0, lessons: found?.lessons ?? 0 };
}

/* ------------------------------------------------------------------ */
/* Writing                                                              */
/* ------------------------------------------------------------------ */

function normalizeRoles(value, field) {
  if (!Array.isArray(value) || value.length === 0) throw validation(field, 'required');
  if (!value.every((role) => COURSE_ROLES.includes(role))) throw validation(field, 'invalid');
  return [...new Set(value)];
}

/** `{ STAGE: { assigneeUserId, reviewerUserId } }`, every person checked. */
export async function normalizeDefaults(actor, input) {
  const source = plainObject(input, 'productionDefaults');
  const result = {};
  for (const type of ASSET_TYPES) {
    const entry = plainObject(source[type], `productionDefaults.${type}`);
    const assigneeUserId = userIdField(entry.assigneeUserId, `productionDefaults.${type}.assigneeUserId`) ?? null;
    const reviewerUserId = userIdField(entry.reviewerUserId, `productionDefaults.${type}.reviewerUserId`) ?? null;
    if (assigneeUserId && assigneeUserId === reviewerUserId) {
      throw badRequest('REVIEWER_IS_ASSIGNEE', { field: `productionDefaults.${type}.reviewerUserId` });
    }
    await assertAssignable(actor, assigneeUserId, `productionDefaults.${type}.assigneeUserId`);
    await assertAssignable(actor, reviewerUserId, `productionDefaults.${type}.reviewerUserId`);
    if (assigneeUserId || reviewerUserId) result[type] = { assigneeUserId, reviewerUserId };
  }
  return result;
}

async function insertChecklistTemplate(tx, organizationId, courseId, userId) {
  const checklist = await tx.row(
    `INSERT INTO ${S}.learning_checklists (organization_id, course_id, asset_type, is_template, created_by)
     VALUES ($1, $2, 'VIDEO', true, $3)
     ON CONFLICT (course_id, asset_type) WHERE is_template DO NOTHING
     RETURNING id`,
    [organizationId, courseId, userId]
  );
  if (!checklist) return;
  await tx.query(
    `INSERT INTO ${S}.learning_checklist_items (organization_id, checklist_id, sort_order, category, label, required)
     SELECT $1, $2, t.position - 1, t.category, t.label, true
       FROM unnest($3::text[], $4::text[]) WITH ORDINALITY AS t(category, label, position)`,
    [organizationId, checklist.id, DEFAULT_VIDEO_CHECKLIST, DEFAULT_VIDEO_CHECKLIST.map((key) => CHECKLIST_LABELS[key])]
  );
}

/**
 * Create a course, and optionally its structure, team and defaults in the same
 * transaction — the wizard sends everything at the end, so a half-finished
 * wizard never leaves a half-made course behind.
 */
export async function createCourse(actor, input) {
  if (!actor.grants.has(P.COURSE_CREATE)) throw forbidden('FORBIDDEN', { permission: P.COURSE_CREATE });
  const body = plainObject(input, 'body');

  const name = text(body.name, 'name', { required: true, max: 160 });
  const code = text(body.code, 'code', { max: 40 }) || null;
  const description = text(body.description, 'description', { max: 5000 }) ?? '';
  const managerUserId = userIdField(body.managerUserId, 'managerUserId') ?? actor.userId;
  await assertAssignable(actor, managerUserId, 'managerUserId');
  const startDate = isoDate(body.startDate, 'startDate');
  const targetDate = isoDate(body.targetDate, 'targetDate');
  dateOrder(startDate, targetDate, 'targetDate');
  const priority = oneOf(body.priority, PRIORITIES, 'priority', { fallback: 'NORMAL' });
  const settings = normalizeSettings(body.settings);
  const productionDefaults = await normalizeDefaults(actor, body.productionDefaults);

  const modules = (Array.isArray(body.modules) ? body.modules : []).slice(0, 100).map((module, index) => {
    const entry = plainObject(module, `modules.${index}`);
    return {
      name: text(entry.name, `modules.${index}.name`, { required: true, max: 200 }),
      lessons: (Array.isArray(entry.lessons) ? entry.lessons : []).map((lesson, lessonIndex) =>
        text(lesson, `modules.${index}.lessons.${lessonIndex}`, { required: true, max: 200 })
      ),
    };
  });
  const looseLessons = (Array.isArray(body.lessons) ? body.lessons : []).map((lesson, index) =>
    text(lesson, `lessons.${index}`, { required: true, max: 200 })
  );
  const lessonCount = modules.reduce((sum, module) => sum + module.lessons.length, 0) + looseLessons.length;
  if (lessonCount > MAX_IMPORT_LESSONS) throw validation('lessons', 'too_many', { max: MAX_IMPORT_LESSONS });

  const team = new Map();
  const addRoles = (userId, roles) => team.set(userId, new Set([...(team.get(userId) ?? []), ...roles]));
  for (const [index, entry] of (Array.isArray(body.team) ? body.team : []).slice(0, 100).entries()) {
    const member = plainObject(entry, `team.${index}`);
    const userId = userIdField(member.userId, `team.${index}.userId`);
    if (!userId) throw validation(`team.${index}.userId`, 'required');
    await assertAssignable(actor, userId, `team.${index}.userId`);
    addRoles(userId, normalizeRoles(member.roles, `team.${index}.roles`));
  }
  addRoles(managerUserId, ['PRODUCTION_MANAGER']);
  // The creator keeps a hand in what they made — unless their workspace keys
  // already reach every course, in which case a team row would only be noise.
  if (!actor.grants.has(P.COURSE_EDIT)) addRoles(actor.userId, ['PRODUCTION_MANAGER']);

  const outbox = [];
  const course = await transaction(async (tx) => {
    const inserted = await tx.row(
      `INSERT INTO ${S}.learning_courses
         (organization_id, name, code, description, manager_user_id, priority, start_date, target_date,
          settings_json, production_defaults_json, is_demo, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        actor.organizationId,
        name,
        code,
        description,
        managerUserId,
        priority,
        startDate,
        targetDate,
        JSON.stringify(settings),
        JSON.stringify(productionDefaults),
        body.isDemo === true && actor.grants.isAdmin,
        actor.userId,
      ]
    );

    for (const [userId, roles] of team) {
      await tx.query(
        `INSERT INTO ${S}.learning_course_members (organization_id, course_id, user_id, roles, added_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [actor.organizationId, inserted.id, userId, [...roles], actor.userId]
      );
    }
    await insertChecklistTemplate(tx, actor.organizationId, inserted.id, actor.userId);
    await record(tx, {
      organizationId: actor.organizationId,
      courseId: inserted.id,
      actorUserId: actor.userId,
      eventType: 'COURSE_CREATED',
      metadata: { name, code },
    });

    const ctx = { ...actor, course: mapCourse(inserted) };
    const lessons = [];
    for (const [moduleIndex, module] of modules.entries()) {
      const created = await tx.row(
        `INSERT INTO ${S}.learning_course_modules (organization_id, course_id, name, sort_order)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [actor.organizationId, inserted.id, module.name, moduleIndex]
      );
      module.lessons.forEach((lessonName, index) => lessons.push({ name: lessonName, moduleId: created.id, sortOrder: index }));
    }
    looseLessons.forEach((lessonName, index) => lessons.push({ name: lessonName, moduleId: null, sortOrder: index }));

    if (lessons.length) {
      const created = await insertLessonsWithAssets(tx, ctx, lessons);
      await record(tx, {
        organizationId: actor.organizationId,
        courseId: inserted.id,
        actorUserId: actor.userId,
        eventType: 'LESSON_CREATED',
        metadata: { count: created.length, names: created.slice(0, 5).map(({ lesson }) => lesson.name) },
      });
      outbox.push(...defaultAssignmentOutbox(ctx, created));
    }
    return inserted;
  });

  await flush(outbox);
  return { course: mapCourse(course) };
}

export async function updateCourse(actor, courseId, input) {
  const body = plainObject(input, 'body');
  const ctx = await courseContext(actor, courseId);
  requireGrant(ctx, P.COURSE_EDIT);
  const current = ctx.course;

  const next = {
    name: 'name' in body ? text(body.name, 'name', { required: true, max: 160 }) : current.name,
    code: 'code' in body ? text(body.code, 'code', { max: 40 }) || null : current.code,
    description: 'description' in body ? text(body.description, 'description', { max: 5000 }) ?? '' : current.description,
    managerUserId: 'managerUserId' in body ? userIdField(body.managerUserId, 'managerUserId') : current.managerUserId,
    status: 'status' in body ? oneOf(body.status, COURSE_STATUSES, 'status', { required: true }) : current.status,
    priority: 'priority' in body ? oneOf(body.priority, PRIORITIES, 'priority', { required: true }) : current.priority,
    startDate: 'startDate' in body ? isoDate(body.startDate, 'startDate') : current.startDate,
    targetDate: 'targetDate' in body ? isoDate(body.targetDate, 'targetDate') : current.targetDate,
  };
  dateOrder(next.startDate, next.targetDate, 'targetDate');
  if (!next.managerUserId) throw validation('managerUserId', 'required');
  if (next.managerUserId !== current.managerUserId) await assertAssignable(actor, next.managerUserId, 'managerUserId');

  const changed = Object.keys(next).filter((key) => (current[key] ?? null) !== (next[key] ?? null));
  if (changed.length === 0) return { course: current };

  return transaction(async (tx) => {
    const updated = await tx.row(
      `UPDATE ${S}.learning_courses
          SET name = $2, code = $3, description = $4, manager_user_id = $5, status = $6, priority = $7,
              start_date = $8, target_date = $9
        WHERE id = $1 RETURNING *`,
      [courseId, next.name, next.code, next.description, next.managerUserId, next.status, next.priority, next.startDate, next.targetDate]
    );
    if (changed.includes('managerUserId')) {
      await tx.query(
        `INSERT INTO ${S}.learning_course_members (organization_id, course_id, user_id, roles, added_by)
         VALUES ($1, $2, $3, ARRAY['PRODUCTION_MANAGER'], $4)
         ON CONFLICT (course_id, user_id) DO UPDATE
           SET roles = CASE WHEN 'PRODUCTION_MANAGER' = ANY(${S}.learning_course_members.roles)
                            THEN ${S}.learning_course_members.roles
                            ELSE array_append(${S}.learning_course_members.roles, 'PRODUCTION_MANAGER') END`,
        [ctx.organizationId, courseId, next.managerUserId, ctx.userId]
      );
    }
    await record(tx, {
      organizationId: ctx.organizationId,
      courseId,
      actorUserId: ctx.userId,
      eventType: 'COURSE_UPDATED',
      metadata: { fields: changed },
    });
    return { course: mapCourse(updated) };
  });
}

export async function updateSettings(actor, courseId, input) {
  const ctx = await courseContext(actor, courseId);
  requireGrant(ctx, P.COURSE_EDIT);
  const settings = normalizeSettings({ ...ctx.settings, ...plainObject(input, 'body') });

  return transaction(async (tx) => {
    await tx.query(`UPDATE ${S}.learning_courses SET settings_json = $2 WHERE id = $1`, [courseId, JSON.stringify(settings)]);
    await record(tx, {
      organizationId: ctx.organizationId,
      courseId,
      actorUserId: ctx.userId,
      eventType: 'COURSE_UPDATED',
      metadata: { fields: ['settings'] },
    });
    return { settings };
  });
}

/**
 * Save who normally makes and reviews each stage. With `applyToOpen`, fill the
 * gaps in unfinished assets too — never replacing a name somebody already put
 * on a piece of work.
 */
export async function updateProductionDefaults(actor, courseId, input) {
  const body = plainObject(input, 'body');
  const ctx = await courseContext(actor, courseId);
  requireGrant(ctx, P.TEAM_MANAGE);
  const defaults = await normalizeDefaults(actor, body.productionDefaults);
  const applyToOpen = body.applyToOpen === true;

  const outbox = [];
  const result = await transaction(async (tx) => {
    await tx.query(`UPDATE ${S}.learning_courses SET production_defaults_json = $2 WHERE id = $1`, [
      courseId,
      JSON.stringify(defaults),
    ]);
    let filled = 0;

    if (applyToOpen) {
      const assignedTo = new Map();
      for (const [type, entry] of Object.entries(defaults)) {
        const candidates = await tx.rows(
          `SELECT a.id, a.status, a.assignee_user_id, a.reviewer_user_id, a.priority, a.due_date
             FROM ${S}.learning_assets a
             JOIN ${S}.learning_lessons l ON l.id = a.lesson_id AND l.archived_at IS NULL
            WHERE a.course_id = $1 AND a.asset_type = $2 AND a.status NOT IN ${COMPLETE_SQL}
              AND (a.assignee_user_id IS NULL OR a.reviewer_user_id IS NULL)
            FOR UPDATE OF a`,
          [courseId, type]
        );
        const changes = [];
        for (const asset of candidates) {
          const assignee = asset.assignee_user_id ?? (entry.assigneeUserId !== asset.reviewer_user_id ? entry.assigneeUserId : null);
          const reviewer = asset.reviewer_user_id ?? (entry.reviewerUserId !== assignee ? entry.reviewerUserId : null);
          if (assignee === asset.assignee_user_id && reviewer === asset.reviewer_user_id) continue;
          changes.push({ asset, assignee, reviewer, status: statusAfterAssignment(asset.status, assignee) });
          if (assignee && assignee !== asset.assignee_user_id) assignedTo.set(assignee, (assignedTo.get(assignee) ?? 0) + 1);
        }
        if (changes.length === 0) continue;

        await tx.query(
          `UPDATE ${S}.learning_assets a
              SET assignee_user_id = t.assignee, reviewer_user_id = t.reviewer, status = t.status,
                  assigned_at = CASE WHEN a.assignee_user_id IS NULL AND t.assignee IS NOT NULL THEN now() ELSE a.assigned_at END
             FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[]) AS t(id, assignee, reviewer, status)
            WHERE a.id = t.id`,
          [changes.map((c) => c.asset.id), changes.map((c) => c.assignee), changes.map((c) => c.reviewer), changes.map((c) => c.status)]
        );
        await tx.query(
          `INSERT INTO ${S}.learning_asset_assignments
             (organization_id, asset_id, assignee_user_id, reviewer_user_id, due_date, priority, assigned_by)
           SELECT $1, t.id, t.assignee, t.reviewer, t.due, t.priority, $2
             FROM unnest($3::uuid[], $4::text[], $5::text[], $6::date[], $7::text[]) AS t(id, assignee, reviewer, due, priority)`,
          [
            ctx.organizationId,
            ctx.userId,
            changes.map((c) => c.asset.id),
            changes.map((c) => c.assignee),
            changes.map((c) => c.reviewer),
            changes.map((c) => c.asset.due_date),
            changes.map((c) => c.asset.priority),
          ]
        );
        await record(tx, {
          organizationId: ctx.organizationId,
          courseId,
          actorUserId: ctx.userId,
          eventType: 'ASSET_ASSIGNED',
          metadata: { bulk: true, fromDefaults: true, assetType: type, count: changes.length },
        });
        filled += changes.length;
      }

      for (const [userId, count] of assignedTo) {
        outbox.push({
          organizationId: ctx.organizationId,
          actorId: ctx.userId,
          recipients: [userId],
          type: 'assigned',
          message: 'bulkAssigned',
          dedupeKey: `bulk-assigned:${courseId}:${userId}`,
          windowMinutes: WINDOW.SHORT,
          link: '/learning-production/my-work',
          data: { courseName: ctx.course.name, count },
        });
      }
    }

    return { productionDefaults: defaults, filled };
  });

  await flush(outbox);
  return result;
}

export async function archiveCourse(actor, courseId) {
  const ctx = await courseContext(actor, courseId);
  requireGrant(ctx, P.COURSE_DELETE);
  return transaction(async (tx) => {
    await tx.query(`UPDATE ${S}.learning_courses SET archived_at = now(), archived_by = $2 WHERE id = $1`, [courseId, ctx.userId]);
    await record(tx, {
      organizationId: ctx.organizationId,
      courseId,
      actorUserId: ctx.userId,
      eventType: 'COURSE_ARCHIVED',
      metadata: { name: ctx.course.name },
    });
    return { archived: true };
  });
}

export async function restoreCourse(actor, courseId) {
  const ctx = await courseContext(actor, courseId, { includeArchived: true });
  requireGrant(ctx, P.COURSE_DELETE);
  if (!ctx.course.archivedAt) return { restored: false };
  return transaction(async (tx) => {
    await tx.query(`UPDATE ${S}.learning_courses SET archived_at = NULL, archived_by = NULL WHERE id = $1`, [courseId]);
    await record(tx, {
      organizationId: ctx.organizationId,
      courseId,
      actorUserId: ctx.userId,
      eventType: 'COURSE_RESTORED',
      metadata: { name: ctx.course.name },
    });
    return { restored: true };
  });
}

export async function setCover(actor, courseId, { bytes, fileName }) {
  const ctx = await courseContext(actor, courseId);
  requireGrant(ctx, P.COURSE_EDIT);
  if (!bytes?.length) throw badRequest('FILE_REQUIRED');
  if (bytes.length > uploadLimit('COVER')) throw badRequest('FILE_TOO_LARGE', { maxBytes: uploadLimit('COVER') });
  const kind = detectKind(bytes, fileName, 'COVER');
  if (!kind || !ACCEPTED.COVER.includes(kind)) {
    throw badRequest('FILE_TYPE_NOT_ALLOWED', { accepted: ACCEPTED.COVER.map((entry) => KINDS[entry].label) });
  }

  const key = await blobs.store(bytes);
  const previous = await direct.row(`SELECT cover_storage_key FROM ${S}.learning_courses WHERE id = $1`, [courseId]);
  try {
    await direct.query(`UPDATE ${S}.learning_courses SET cover_storage_key = $2, cover_mime_type = $3 WHERE id = $1`, [
      courseId,
      key,
      KINDS[kind].mime,
    ]);
  } catch (error) {
    await blobs.discard(key);
    throw error;
  }
  // A cover is decoration, not production history — the old image goes.
  if (previous?.cover_storage_key) await blobs.discard(previous.cover_storage_key);
  return { hasCover: true };
}

export async function coverFile(actor, courseId) {
  await courseContext(actor, courseId, { includeArchived: true });
  const found = await direct.row(`SELECT cover_storage_key, cover_mime_type FROM ${S}.learning_courses WHERE id = $1`, [courseId]);
  if (!found?.cover_storage_key) return null;
  const bytes = await blobs.load(found.cover_storage_key);
  return bytes ? { bytes, mimeType: found.cover_mime_type } : null;
}

export { REVIEW_SQL, today };
