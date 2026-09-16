/**
 * Modules, lessons, and the production matrix.
 *
 * Creating a lesson creates its five assets in the same transaction — a lesson
 * with three assets is not a smaller lesson, it is a broken one — and each
 * asset inherits the course's production defaults, so a team that has said
 * "Sara designs the slides" does not have to say it again for lesson forty.
 */

import { ASSET_TYPES, OUTLINE_SECTIONS } from '../../../shared/learningProduction/constants.js';
import { LP_PERMISSIONS as P } from '../../../shared/learningProduction/permissions.js';
import { currentStage, lessonProgress, lessonState } from '../../../shared/learningProduction/workflow.js';
import { MAX_IMPORT_LESSONS } from '../../../shared/learningProduction/lessonImport.js';
import { SCHEMA as S, direct, transaction } from '../db.js';
import { courseCapabilities, courseContext, requireGrant } from '../access.js';
import { record } from '../activity.js';
import { WINDOW, assetLink, flush } from '../notifications.js';
import { badRequest, notFound, validation } from '../errors.js';
import { mapLesson, mapModule } from '../mappers.js';
import { assertAssignable, peopleFor, userIdField, userIdsIn } from '../people.js';
import { bodyId, integer, isUuid, isoDate, plainObject, text } from '../validate.js';
import { assetSummary, today } from './summaries.js';

/* ------------------------------------------------------------------ */
/* Creating lessons                                                     */
/* ------------------------------------------------------------------ */

/** The course defaults, minus anybody who has since left or been disabled. */
async function usableDefaults(defaults) {
  const ids = new Set();
  for (const entry of Object.values(defaults ?? {})) {
    if (entry?.assigneeUserId) ids.add(entry.assigneeUserId);
    if (entry?.reviewerUserId) ids.add(entry.reviewerUserId);
  }
  const people = await peopleFor(ids);
  const active = (id) => (id && people[id]?.active ? id : null);
  return Object.fromEntries(
    ASSET_TYPES.map((type) => [
      type,
      { assigneeUserId: active(defaults?.[type]?.assigneeUserId), reviewerUserId: active(defaults?.[type]?.reviewerUserId) },
    ])
  );
}

/**
 * Insert lessons, each with its five assets. `lessons` is
 * `[{ name, moduleId, sortOrder, description?, ownerUserId?, targetDate?, estimatedDurationMinutes? }]`.
 * Returns `[{ lesson, assets }]` as raw rows.
 */
export async function insertLessonsWithAssets(tx, ctx, lessons) {
  const defaults = await usableDefaults(ctx.course.productionDefaults);
  const created = [];

  for (const lesson of lessons) {
    const inserted = await tx.row(
      `INSERT INTO ${S}.learning_lessons
         (organization_id, course_id, module_id, name, description, sort_order,
          estimated_duration_minutes, owner_user_id, target_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        ctx.organizationId,
        ctx.course.id,
        lesson.moduleId ?? null,
        lesson.name,
        lesson.description ?? '',
        lesson.sortOrder ?? 0,
        lesson.estimatedDurationMinutes ?? null,
        lesson.ownerUserId ?? null,
        lesson.targetDate ?? null,
        ctx.userId,
      ]
    );

    const assets = await tx.rows(
      `INSERT INTO ${S}.learning_assets
         (organization_id, course_id, lesson_id, asset_type, status, assignee_user_id, reviewer_user_id, assigned_at)
       SELECT $1, $2, $3, t.asset_type,
              CASE WHEN t.assignee IS NULL THEN 'NOT_STARTED' ELSE 'ASSIGNED' END,
              t.assignee, t.reviewer,
              CASE WHEN t.assignee IS NULL THEN NULL ELSE now() END
         FROM unnest($4::text[], $5::text[], $6::text[]) WITH ORDINALITY AS t(asset_type, assignee, reviewer, position)
        ORDER BY t.position
       RETURNING id, asset_type, assignee_user_id, reviewer_user_id`,
      [
        ctx.organizationId,
        ctx.course.id,
        inserted.id,
        ASSET_TYPES,
        ASSET_TYPES.map((type) => defaults[type].assigneeUserId),
        ASSET_TYPES.map((type) => defaults[type].reviewerUserId),
      ]
    );

    const defaulted = assets.filter((asset) => asset.assignee_user_id || asset.reviewer_user_id);
    if (defaulted.length) {
      await tx.query(
        `INSERT INTO ${S}.learning_asset_assignments
           (organization_id, asset_id, assignee_user_id, reviewer_user_id, priority, assigned_by)
         SELECT $1, t.asset_id, t.assignee, t.reviewer, 'NORMAL', $2
           FROM unnest($3::uuid[], $4::text[], $5::text[]) AS t(asset_id, assignee, reviewer)`,
        [
          ctx.organizationId,
          ctx.userId,
          defaulted.map((asset) => asset.id),
          defaulted.map((asset) => asset.assignee_user_id),
          defaulted.map((asset) => asset.reviewer_user_id),
        ]
      );
    }

    created.push({ lesson: inserted, assets });
  }
  return created;
}

/**
 * One alert per person for work that arrived through defaults: a single
 * assignment links straight to it, forty assignments are one line pointing at
 * My Work.
 */
export function defaultAssignmentOutbox(ctx, created) {
  const perUser = new Map();
  for (const { lesson, assets } of created) {
    for (const asset of assets) {
      if (!asset.assignee_user_id) continue;
      const list = perUser.get(asset.assignee_user_id) ?? [];
      list.push({ lesson, asset });
      perUser.set(asset.assignee_user_id, list);
    }
  }

  return [...perUser.entries()].map(([userId, items]) => {
    const [first] = items;
    const single = items.length === 1;
    return {
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      recipients: [userId],
      type: 'assigned',
      message: single ? 'assigned' : 'bulkAssigned',
      dedupeKey: single ? `assigned:${first.asset.id}:${userId}` : `bulk-assigned:${ctx.course.id}:${userId}`,
      windowMinutes: WINDOW.SHORT,
      assetId: single ? first.asset.id : null,
      link: single
        ? assetLink({ courseId: ctx.course.id, lessonId: first.lesson.id, assetType: first.asset.asset_type })
        : '/learning-production/my-work',
      data: {
        courseName: ctx.course.name,
        lessonName: first.lesson.name,
        assetType: first.asset.asset_type,
        count: items.length,
      },
    };
  });
}

/** Where the next lesson goes in each module: `{ moduleId|'none': nextSortOrder }`. */
async function nextLessonOrders(db, courseId) {
  const found = await db.rows(
    `SELECT module_id, max(sort_order) AS top FROM ${S}.learning_lessons
      WHERE course_id = $1 AND archived_at IS NULL GROUP BY module_id`,
    [courseId]
  );
  return new Map(found.map((r) => [r.module_id ?? 'none', Number(r.top) + 1]));
}

function nextOrder(orders, moduleId) {
  const key = moduleId ?? 'none';
  const value = orders.get(key) ?? 0;
  orders.set(key, value + 1);
  return value;
}

async function recordLessonsCreated(tx, ctx, created) {
  if (created.length <= 3) {
    for (const { lesson } of created) {
      await record(tx, {
        organizationId: ctx.organizationId,
        courseId: ctx.course.id,
        lessonId: lesson.id,
        actorUserId: ctx.userId,
        eventType: 'LESSON_CREATED',
        metadata: { name: lesson.name },
      });
    }
  } else {
    await record(tx, {
      organizationId: ctx.organizationId,
      courseId: ctx.course.id,
      actorUserId: ctx.userId,
      eventType: 'LESSON_CREATED',
      metadata: { count: created.length, names: created.slice(0, 5).map(({ lesson }) => lesson.name) },
    });
  }
}

/**
 * Create one lesson, or many at once.
 *
 * `{ name, moduleId, … }` creates one. `{ items: [{ name, moduleId | moduleName }] }`
 * creates many — the pasted list, the CSV import and the course wizard all
 * send this. A module named but not yet existing is created on the way.
 */
export async function createLessons(actor, courseId, input) {
  const body = plainObject(input, 'body');
  const ctx = await courseContext(actor, courseId);
  requireGrant(ctx, P.LESSON_CREATE);

  let items;
  if (Array.isArray(body.items)) {
    if (body.items.length > MAX_IMPORT_LESSONS) throw validation('items', 'too_many', { max: MAX_IMPORT_LESSONS });
    items = body.items.map((item, index) => {
      const entry = plainObject(item, `items.${index}`);
      return {
        name: text(entry.name, `items.${index}.name`, { required: true, max: 200 }),
        moduleId: bodyId(entry.moduleId, `items.${index}.moduleId`),
        moduleName: entry.moduleName ? text(entry.moduleName, `items.${index}.moduleName`, { max: 200 }) || null : null,
      };
    });
  } else {
    const ownerUserId = userIdField(body.ownerUserId, 'ownerUserId') ?? null;
    await assertAssignable(actor, ownerUserId, 'ownerUserId');
    items = [
      {
        name: text(body.name, 'name', { required: true, max: 200 }),
        moduleId: bodyId(body.moduleId, 'moduleId'),
        moduleName: null,
        description: text(body.description, 'description', { max: 5000 }) ?? '',
        ownerUserId,
        targetDate: isoDate(body.targetDate, 'targetDate'),
        estimatedDurationMinutes: integer(body.estimatedDurationMinutes, 'estimatedDurationMinutes', { min: 1, max: 10000 }),
      },
    ];
  }
  if (items.length === 0) throw validation('items', 'required');

  const outbox = [];
  const created = await transaction(async (tx) => {
    const modules = await tx.rows(
      `SELECT id, name, sort_order FROM ${S}.learning_course_modules WHERE course_id = $1 AND archived_at IS NULL`,
      [courseId]
    );
    const byId = new Map(modules.map((module) => [module.id, module]));
    const byName = new Map(modules.map((module) => [module.name.trim().toLowerCase(), module]));
    let moduleOrder = modules.reduce((top, module) => Math.max(top, module.sort_order + 1), 0);
    const orders = await nextLessonOrders(tx, courseId);

    const lessons = [];
    for (const item of items) {
      let moduleId = item.moduleId;
      if (moduleId && !byId.has(moduleId)) throw validation('moduleId', 'invalid');
      if (!moduleId && item.moduleName) {
        const key = item.moduleName.trim().toLowerCase();
        let module = byName.get(key);
        if (!module) {
          module = await tx.row(
            `INSERT INTO ${S}.learning_course_modules (organization_id, course_id, name, sort_order)
             VALUES ($1, $2, $3, $4) RETURNING id, name, sort_order`,
            [ctx.organizationId, courseId, item.moduleName, moduleOrder++]
          );
          byName.set(key, module);
          byId.set(module.id, module);
          await record(tx, {
            organizationId: ctx.organizationId,
            courseId,
            actorUserId: ctx.userId,
            eventType: 'MODULE_CREATED',
            metadata: { name: module.name },
          });
        }
        moduleId = module.id;
      }
      lessons.push({ ...item, moduleId, sortOrder: nextOrder(orders, moduleId) });
    }

    const result = await insertLessonsWithAssets(tx, ctx, lessons);
    await recordLessonsCreated(tx, ctx, result);
    outbox.push(...defaultAssignmentOutbox(ctx, result));
    return result;
  });

  await flush(outbox);
  return { lessons: created.map(({ lesson }) => mapLesson(lesson)) };
}

/* ------------------------------------------------------------------ */
/* Modules                                                              */
/* ------------------------------------------------------------------ */

async function moduleContext(actor, moduleId, db = direct) {
  const module = await db.row(
    `SELECT * FROM ${S}.learning_course_modules WHERE id = $1 AND organization_id = $2 AND archived_at IS NULL`,
    [moduleId, actor.organizationId]
  );
  if (!module) throw notFound();
  const ctx = await courseContext(actor, module.course_id, { db });
  return { ...ctx, module };
}

export async function createModule(actor, courseId, input) {
  const body = plainObject(input, 'body');
  const ctx = await courseContext(actor, courseId);
  requireGrant(ctx, P.LESSON_CREATE);
  const name = text(body.name, 'name', { required: true, max: 200 });
  const description = text(body.description, 'description', { max: 2000 }) ?? '';

  return transaction(async (tx) => {
    const { next } = await tx.row(
      `SELECT coalesce(max(sort_order) + 1, 0) AS next FROM ${S}.learning_course_modules
        WHERE course_id = $1 AND archived_at IS NULL`,
      [courseId]
    );
    const module = await tx.row(
      `INSERT INTO ${S}.learning_course_modules (organization_id, course_id, name, description, sort_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [ctx.organizationId, courseId, name, description, next]
    );
    await record(tx, {
      organizationId: ctx.organizationId,
      courseId,
      actorUserId: ctx.userId,
      eventType: 'MODULE_CREATED',
      metadata: { name },
    });
    return { module: mapModule(module) };
  });
}

export async function updateModule(actor, moduleId, input) {
  const body = plainObject(input, 'body');
  const ctx = await moduleContext(actor, moduleId);
  requireGrant(ctx, P.LESSON_EDIT);
  const name = 'name' in body ? text(body.name, 'name', { required: true, max: 200 }) : ctx.module.name;
  const description = 'description' in body ? text(body.description, 'description', { max: 2000 }) ?? '' : ctx.module.description;

  return transaction(async (tx) => {
    const module = await tx.row(
      `UPDATE ${S}.learning_course_modules SET name = $2, description = $3 WHERE id = $1 RETURNING *`,
      [moduleId, name, description]
    );
    await record(tx, {
      organizationId: ctx.organizationId,
      courseId: ctx.course.id,
      actorUserId: ctx.userId,
      eventType: 'MODULE_UPDATED',
      metadata: { name, previousName: ctx.module.name },
    });
    return { module: mapModule(module) };
  });
}

/** Archive an empty module. A module with lessons in it is refused, never emptied silently. */
export async function archiveModule(actor, moduleId) {
  const ctx = await moduleContext(actor, moduleId);
  requireGrant(ctx, P.LESSON_EDIT);

  return transaction(async (tx) => {
    const { count } = await tx.row(
      `SELECT count(*)::int AS count FROM ${S}.learning_lessons WHERE module_id = $1 AND archived_at IS NULL`,
      [moduleId]
    );
    if (count > 0) throw badRequest('MODULE_NOT_EMPTY', { lessons: count });
    await tx.query(`UPDATE ${S}.learning_course_modules SET archived_at = now() WHERE id = $1`, [moduleId]);
    await record(tx, {
      organizationId: ctx.organizationId,
      courseId: ctx.course.id,
      actorUserId: ctx.userId,
      eventType: 'MODULE_ARCHIVED',
      metadata: { name: ctx.module.name },
    });
    return { archived: true };
  });
}

function idList(value, field, max = 1000) {
  if (!Array.isArray(value) || value.length === 0) throw validation(field, 'required');
  if (value.length > max) throw validation(field, 'too_many', { max });
  if (!value.every(isUuid)) throw validation(field, 'invalid');
  return [...new Set(value.map((id) => id.toLowerCase()))];
}

export async function reorderModules(actor, courseId, input) {
  const body = plainObject(input, 'body');
  const ctx = await courseContext(actor, courseId);
  requireGrant(ctx, P.LESSON_EDIT);
  const ids = idList(body.moduleIds, 'moduleIds', 200);

  return transaction(async (tx) => {
    const updated = await tx.rows(
      `UPDATE ${S}.learning_course_modules m SET sort_order = t.position - 1
         FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, position)
        WHERE m.id = t.id AND m.course_id = $2 AND m.archived_at IS NULL
        RETURNING m.id`,
      [ids, courseId]
    );
    if (updated.length !== ids.length) throw validation('moduleIds', 'invalid');
    return { moduleIds: ids };
  });
}

/* ------------------------------------------------------------------ */
/* Lessons                                                              */
/* ------------------------------------------------------------------ */

async function lessonRow(actor, lessonId, db = direct, { includeArchived = false } = {}) {
  const lesson = await db.row(
    `SELECT l.*, m.name AS module_name, m.archived_at AS module_archived_at
       FROM ${S}.learning_lessons l
       LEFT JOIN ${S}.learning_course_modules m ON m.id = l.module_id
      WHERE l.id = $1 AND l.organization_id = $2`,
    [lessonId, actor.organizationId]
  );
  if (!lesson || (lesson.archived_at && !includeArchived)) throw notFound();
  return lesson;
}

const ASSET_ROWS_SQL = `
  SELECT a.*, v.version_number AS current_version_number,
         (SELECT count(*)::int FROM ${S}.learning_comments cm
           WHERE cm.asset_id = a.id AND cm.status = 'OPEN' AND cm.parent_comment_id IS NULL AND cm.deleted_at IS NULL) AS open_comments
    FROM ${S}.learning_assets a
    LEFT JOIN ${S}.learning_asset_versions v ON v.id = a.current_version_id`;

/** One lesson with its five asset summaries — the lesson workspace header. */
export async function getLesson(actor, lessonId) {
  const lesson = await lessonRow(actor, lessonId);
  const ctx = await courseContext(actor, lesson.course_id);
  const assets = await direct.rows(`${ASSET_ROWS_SQL} WHERE a.lesson_id = $1`, [lessonId]);

  const statuses = Object.fromEntries(assets.map((asset) => [asset.asset_type, asset.status]));
  const day = today();
  const summaries = ASSET_TYPES.map((type) => assets.find((asset) => asset.asset_type === type))
    .filter(Boolean)
    .map((asset) => assetSummary(asset, statuses, ctx.settings, day));
  const mapped = { ...mapLesson(lesson), moduleName: lesson.module_name ?? null };

  return {
    lesson: mapped,
    course: { id: ctx.course.id, name: ctx.course.name, code: ctx.course.code },
    assets: summaries,
    progress: lessonProgress(statuses),
    state: lessonState(statuses),
    currentStage: currentStage(statuses),
    capabilities: courseCapabilities(ctx),
    people: await peopleFor(userIdsIn([mapped, summaries])),
  };
}

/* ------------------------------------------------------------------ */
/* The asset board                                                      */
/* ------------------------------------------------------------------ */

/** Whitespace-collapsed and cut to `limit`, with an ellipsis when it was cut. */
function excerpt(value, limit) {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit).trimEnd()}…` : clean;
}

/**
 * The small piece of an asset's current version that its card can draw.
 *
 * Deliberately not the version itself: the board shows five assets at once and
 * a script's blocks or an outline's sections can each be pages long. What comes
 * back is enough to recognise the content — a couple of objectives, the first
 * lines of narration, how long the audio runs — and never enough to read it.
 * Opening the asset is what reading it is for.
 */
function previewOf(assetType, version) {
  if (!version) return null;
  const content = version.content_json ?? null;
  if (assetType === 'OUTLINE') {
    const sections = content?.sections ?? {};
    const filled = OUTLINE_SECTIONS.filter((key) => String(sections[key] ?? '').trim()).map((key) => ({
      key,
      // The card draws its own bullet, so the section's first one would double it.
      text: excerpt(String(sections[key]).replace(/^[\s•\-–]+/, ''), 160),
    }));
    return { kind: 'OUTLINE', sections: filled.slice(0, 4), sectionCount: filled.length };
  }
  if (assetType === 'SCRIPT') {
    const blocks = Array.isArray(content?.blocks) ? content.blocks : [];
    const words = blocks.reduce((sum, block) => sum + String(block?.narration ?? '').split(/\s+/).filter(Boolean).length, 0);
    return {
      kind: 'SCRIPT',
      mode: content?.mode === 'SCENE' ? 'SCENE' : 'SLIDE',
      blockCount: blocks.length,
      words,
      blocks: blocks.slice(0, 2).map((block) => ({ title: excerpt(block?.title, 60), narration: excerpt(block?.narration, 220) })),
    };
  }
  if (assetType === 'PPT') {
    return {
      kind: 'PPT',
      fileName: version.file_name ?? null,
      fileSize: version.file_size === null || version.file_size === undefined ? null : Number(version.file_size),
      hasPreview: Boolean(version.preview_storage_key),
      externalUrl: version.external_url ?? null,
    };
  }
  const duration = version.duration_seconds === null || version.duration_seconds === undefined ? null : Number(version.duration_seconds);
  if (assetType === 'VOICE_OVER') {
    return {
      kind: 'VOICE_OVER',
      durationSeconds: duration,
      fileName: version.file_name ?? null,
      hasTranscript: Boolean(version.transcript_body),
      transcript: excerpt(version.transcript_body, 180) || null,
    };
  }
  return { kind: 'VIDEO', durationSeconds: duration, fileName: version.file_name ?? null, externalUrl: version.external_url ?? null };
}

/**
 * One lesson's five assets, each with the little of its content a card can
 * show — the course workspace's Assets tab.
 *
 * One query for the assets, one for their current versions. It never loads a
 * file, a comment thread or an annotation: a board that showed five previews by
 * fetching five whole assets would be the most expensive read in the module and
 * would still show less than this does.
 */
export async function assetBoard(actor, lessonId) {
  const lesson = await lessonRow(actor, lessonId);
  const ctx = await courseContext(actor, lesson.course_id);

  const assets = await direct.rows(`${ASSET_ROWS_SQL} WHERE a.lesson_id = $1`, [lessonId]);
  const versionIds = assets.map((asset) => asset.current_version_id).filter(Boolean);
  const versions = versionIds.length
    ? await direct.rows(
        `SELECT v.id, v.asset_id, v.version_number, v.source_kind, v.file_name, v.mime_type, v.file_size,
                v.external_url, v.content_json, v.preview_storage_key, v.duration_seconds, v.version_notes,
                v.created_by, v.created_at, tr.body AS transcript_body
           FROM ${S}.learning_asset_versions v
           LEFT JOIN ${S}.learning_transcripts tr ON tr.version_id = v.id
          WHERE v.id = ANY($1::uuid[])`,
        [versionIds]
      )
    : [];
  const counts = await direct.rows(
    `SELECT asset_id, count(*)::int AS n FROM ${S}.learning_asset_versions
      WHERE asset_id = ANY($1::uuid[]) GROUP BY asset_id`,
    [assets.map((asset) => asset.id)]
  );

  const versionOf = new Map(versions.map((version) => [version.id, version]));
  const versionCount = new Map(counts.map((entry) => [entry.asset_id, entry.n]));
  const statuses = Object.fromEntries(assets.map((asset) => [asset.asset_type, asset.status]));
  const day = today();

  const board = ASSET_TYPES.map((type) => assets.find((asset) => asset.asset_type === type))
    .filter(Boolean)
    .map((asset) => {
      const version = asset.current_version_id ? versionOf.get(asset.current_version_id) ?? null : null;
      return {
        ...assetSummary(asset, statuses, ctx.settings, day),
        versionCount: versionCount.get(asset.id) ?? 0,
        versionNotes: version?.version_notes ?? '',
        versionCreatedAt: version?.created_at ? new Date(version.created_at).toISOString() : null,
        versionCreatedBy: version?.created_by ?? null,
        preview: previewOf(asset.asset_type, version),
      };
    });

  const mapped = { ...mapLesson(lesson), moduleName: lesson.module_name ?? null };
  return {
    lesson: mapped,
    course: { id: ctx.course.id, name: ctx.course.name, code: ctx.course.code },
    assets: board,
    progress: lessonProgress(statuses),
    state: lessonState(statuses),
    currentStage: currentStage(statuses),
    capabilities: courseCapabilities(ctx),
    people: await peopleFor(userIdsIn([mapped, board])),
  };
}

/**
 * Every lesson in a course with its five asset summaries, in one response.
 *
 * Two queries whatever the size of the course: the matrix never asks for a
 * lesson at a time, and never loads a comment, a version or an annotation. The
 * full asset is fetched only when somebody opens one.
 */
export async function productionMatrix(actor, courseId) {
  const ctx = await courseContext(actor, courseId);
  const [modules, found] = await Promise.all([
    direct.rows(
      `SELECT * FROM ${S}.learning_course_modules
        WHERE course_id = $1 AND organization_id = $2 AND archived_at IS NULL
        ORDER BY sort_order, created_at`,
      [courseId, ctx.organizationId]
    ),
    direct.rows(
      `SELECT l.id AS lesson_id, l.name AS lesson_name, l.module_id, l.sort_order, l.owner_user_id, l.target_date,
              l.estimated_duration_minutes, l.created_at AS lesson_created_at,
              a.id, a.asset_type, a.status, a.priority, a.assignee_user_id, a.reviewer_user_id, a.due_date,
              a.updated_at, a.submitted_at, a.dependency_override_at,
              v.version_number AS current_version_number,
              coalesce(oc.n, 0) AS open_comments
         FROM ${S}.learning_lessons l
         JOIN ${S}.learning_assets a ON a.lesson_id = l.id
         LEFT JOIN ${S}.learning_asset_versions v ON v.id = a.current_version_id
         LEFT JOIN (
           SELECT cm.asset_id, count(*)::int AS n
             FROM ${S}.learning_comments cm
             JOIN ${S}.learning_assets ca ON ca.id = cm.asset_id
            WHERE ca.course_id = $1 AND cm.status = 'OPEN' AND cm.parent_comment_id IS NULL AND cm.deleted_at IS NULL
            GROUP BY cm.asset_id
         ) oc ON oc.asset_id = a.id
        WHERE l.course_id = $1 AND l.organization_id = $2 AND l.archived_at IS NULL
        ORDER BY l.sort_order, l.created_at`,
      [courseId, ctx.organizationId]
    ),
  ]);

  const lessons = new Map();
  for (const r of found) {
    let lesson = lessons.get(r.lesson_id);
    if (!lesson) {
      lesson = {
        id: r.lesson_id,
        name: r.lesson_name,
        moduleId: r.module_id ?? null,
        sortOrder: r.sort_order,
        ownerUserId: r.owner_user_id ?? null,
        targetDate: r.target_date ?? null,
        estimatedDurationMinutes: r.estimated_duration_minutes ?? null,
        rows: [],
      };
      lessons.set(r.lesson_id, lesson);
    }
    lesson.rows.push(r);
  }

  const day = today();
  const moduleOrder = new Map(modules.map((module, index) => [module.id, index]));
  const result = [...lessons.values()]
    .map(({ rows: assetRows, ...lesson }) => {
      const statuses = Object.fromEntries(assetRows.map((r) => [r.asset_type, r.status]));
      const assets = {};
      for (const r of assetRows) assets[r.asset_type] = assetSummary(r, statuses, ctx.settings, day);
      return {
        ...lesson,
        assets,
        progress: lessonProgress(statuses),
        state: lessonState(statuses),
        currentStage: currentStage(statuses),
      };
    })
    .sort((a, b) => {
      const moduleA = a.moduleId ? moduleOrder.get(a.moduleId) ?? 9999 : 10000;
      const moduleB = b.moduleId ? moduleOrder.get(b.moduleId) ?? 9999 : 10000;
      return moduleA - moduleB || a.sortOrder - b.sortOrder;
    });

  return {
    course: { id: ctx.course.id, name: ctx.course.name, code: ctx.course.code },
    modules: modules.map(mapModule),
    lessons: result,
    capabilities: courseCapabilities(ctx),
    settings: { enforceDependencies: ctx.settings.enforceDependencies },
    today: day,
    people: await peopleFor(userIdsIn(result)),
  };
}

export async function archivedLessons(actor, courseId) {
  const ctx = await courseContext(actor, courseId);
  const found = await direct.rows(
    `SELECT l.*, m.name AS module_name FROM ${S}.learning_lessons l
       LEFT JOIN ${S}.learning_course_modules m ON m.id = l.module_id
      WHERE l.course_id = $1 AND l.organization_id = $2 AND l.archived_at IS NOT NULL
      ORDER BY l.archived_at DESC LIMIT 200`,
    [courseId, ctx.organizationId]
  );
  return { lessons: found.map((lesson) => ({ ...mapLesson(lesson), moduleName: lesson.module_name ?? null })) };
}

export async function updateLesson(actor, lessonId, input) {
  const body = plainObject(input, 'body');
  const lesson = await lessonRow(actor, lessonId);
  const ctx = await courseContext(actor, lesson.course_id);
  requireGrant(ctx, P.LESSON_EDIT);

  const next = {
    name: 'name' in body ? text(body.name, 'name', { required: true, max: 200 }) : lesson.name,
    description: 'description' in body ? text(body.description, 'description', { max: 5000 }) ?? '' : lesson.description,
    moduleId: 'moduleId' in body ? bodyId(body.moduleId, 'moduleId') : lesson.module_id,
    ownerUserId: 'ownerUserId' in body ? userIdField(body.ownerUserId, 'ownerUserId') : lesson.owner_user_id,
    targetDate: 'targetDate' in body ? isoDate(body.targetDate, 'targetDate') : lesson.target_date,
    estimatedDurationMinutes:
      'estimatedDurationMinutes' in body
        ? integer(body.estimatedDurationMinutes, 'estimatedDurationMinutes', { min: 1, max: 10000 })
        : lesson.estimated_duration_minutes,
  };
  if (next.ownerUserId !== lesson.owner_user_id) await assertAssignable(actor, next.ownerUserId, 'ownerUserId');

  return transaction(async (tx) => {
    if (next.moduleId && next.moduleId !== lesson.module_id) {
      const module = await tx.row(
        `SELECT id FROM ${S}.learning_course_modules WHERE id = $1 AND course_id = $2 AND archived_at IS NULL`,
        [next.moduleId, ctx.course.id]
      );
      if (!module) throw validation('moduleId', 'invalid');
    }
    let sortOrder = lesson.sort_order;
    if (next.moduleId !== lesson.module_id) {
      sortOrder = nextOrder(await nextLessonOrders(tx, ctx.course.id), next.moduleId);
    }
    const updated = await tx.row(
      `UPDATE ${S}.learning_lessons
          SET name = $2, description = $3, module_id = $4, owner_user_id = $5, target_date = $6,
              estimated_duration_minutes = $7, sort_order = $8
        WHERE id = $1 RETURNING *`,
      [lessonId, next.name, next.description, next.moduleId, next.ownerUserId, next.targetDate, next.estimatedDurationMinutes, sortOrder]
    );
    const changed = Object.keys(next).filter((key) => {
      const column = { name: 'name', description: 'description', moduleId: 'module_id', ownerUserId: 'owner_user_id', targetDate: 'target_date', estimatedDurationMinutes: 'estimated_duration_minutes' }[key];
      return (lesson[column] ?? null) !== (next[key] ?? null);
    });
    if (changed.length) {
      await record(tx, {
        organizationId: ctx.organizationId,
        courseId: ctx.course.id,
        lessonId,
        actorUserId: ctx.userId,
        eventType: 'LESSON_UPDATED',
        metadata: { fields: changed, name: next.name },
      });
    }
    return { lesson: mapLesson(updated) };
  });
}

/**
 * Drag and drop. `{ moduleId, lessonIds }` makes those lessons, in that order,
 * the contents of that module (or of "no module" when `moduleId` is null).
 */
export async function reorderLessons(actor, courseId, input) {
  const body = plainObject(input, 'body');
  const ctx = await courseContext(actor, courseId);
  requireGrant(ctx, P.LESSON_EDIT);
  const moduleId = bodyId(body.moduleId, 'moduleId');
  const ids = idList(body.lessonIds, 'lessonIds');

  return transaction(async (tx) => {
    if (moduleId) {
      const module = await tx.row(
        `SELECT id FROM ${S}.learning_course_modules WHERE id = $1 AND course_id = $2 AND archived_at IS NULL`,
        [moduleId, courseId]
      );
      if (!module) throw validation('moduleId', 'invalid');
    }
    const updated = await tx.rows(
      `UPDATE ${S}.learning_lessons l SET module_id = $3, sort_order = t.position - 1
         FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, position)
        WHERE l.id = t.id AND l.course_id = $2 AND l.archived_at IS NULL
        RETURNING l.id`,
      [ids, courseId, moduleId]
    );
    if (updated.length !== ids.length) throw validation('lessonIds', 'invalid');
    return { moduleId, lessonIds: ids };
  });
}

/** Move lessons to the end of another module. */
export async function moveLessons(actor, courseId, input) {
  const body = plainObject(input, 'body');
  const ctx = await courseContext(actor, courseId);
  requireGrant(ctx, P.LESSON_EDIT);
  const moduleId = bodyId(body.moduleId, 'moduleId');
  const ids = idList(body.lessonIds, 'lessonIds');

  return transaction(async (tx) => {
    if (moduleId) {
      const module = await tx.row(
        `SELECT id FROM ${S}.learning_course_modules WHERE id = $1 AND course_id = $2 AND archived_at IS NULL`,
        [moduleId, courseId]
      );
      if (!module) throw validation('moduleId', 'invalid');
    }
    const orders = await nextLessonOrders(tx, courseId);
    const start = orders.get(moduleId ?? 'none') ?? 0;
    const updated = await tx.rows(
      `UPDATE ${S}.learning_lessons l SET module_id = $3, sort_order = $4 + t.position - 1
         FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, position)
        WHERE l.id = t.id AND l.course_id = $2 AND l.archived_at IS NULL
        RETURNING l.id`,
      [ids, courseId, moduleId, start]
    );
    if (updated.length !== ids.length) throw validation('lessonIds', 'invalid');
    return { moved: updated.length };
  });
}

/**
 * Duplicate a lesson's structure: its name, module, description and estimated
 * length, placed right after it, with five fresh assets. No files, no
 * versions, no approvals — a copy of last month's review is not a review.
 */
export async function duplicateLesson(actor, lessonId, input) {
  const body = plainObject(input, 'body');
  const source = await lessonRow(actor, lessonId);
  const ctx = await courseContext(actor, source.course_id);
  requireGrant(ctx, P.LESSON_CREATE);
  const name = text(body.name, 'name', { max: 200 }) || `${source.name} (2)`;

  const outbox = [];
  const created = await transaction(async (tx) => {
    await tx.query(
      `UPDATE ${S}.learning_lessons SET sort_order = sort_order + 1
        WHERE course_id = $1 AND module_id IS NOT DISTINCT FROM $2 AND sort_order > $3 AND archived_at IS NULL`,
      [ctx.course.id, source.module_id, source.sort_order]
    );
    const result = await insertLessonsWithAssets(tx, ctx, [
      {
        name,
        moduleId: source.module_id,
        sortOrder: source.sort_order + 1,
        description: source.description,
        estimatedDurationMinutes: source.estimated_duration_minutes,
      },
    ]);
    await recordLessonsCreated(tx, ctx, result);
    outbox.push(...defaultAssignmentOutbox(ctx, result));
    return result[0].lesson;
  });

  await flush(outbox);
  return { lesson: mapLesson(created) };
}

export async function archiveLessons(actor, courseId, input) {
  const body = plainObject(input, 'body');
  const ctx = await courseContext(actor, courseId);
  requireGrant(ctx, P.LESSON_EDIT);
  const ids = idList(body.lessonIds, 'lessonIds');

  return transaction(async (tx) => {
    const archived = await tx.rows(
      `UPDATE ${S}.learning_lessons SET archived_at = now(), archived_by = $3
        WHERE id = ANY($1::uuid[]) AND course_id = $2 AND archived_at IS NULL
        RETURNING id, name`,
      [ids, courseId, ctx.userId]
    );
    if (archived.length <= 3) {
      for (const lesson of archived) {
        await record(tx, {
          organizationId: ctx.organizationId,
          courseId,
          lessonId: lesson.id,
          actorUserId: ctx.userId,
          eventType: 'LESSON_ARCHIVED',
          metadata: { name: lesson.name },
        });
      }
    } else {
      await record(tx, {
        organizationId: ctx.organizationId,
        courseId,
        actorUserId: ctx.userId,
        eventType: 'LESSON_ARCHIVED',
        metadata: { count: archived.length, names: archived.slice(0, 5).map((lesson) => lesson.name) },
      });
    }
    return { archived: archived.length };
  });
}

/** Archive one lesson by its own id. */
export async function archiveLesson(actor, lessonId) {
  const lesson = await lessonRow(actor, lessonId);
  return archiveLessons(actor, lesson.course_id, { lessonIds: [lessonId] });
}

export async function restoreLesson(actor, lessonId) {
  const lesson = await lessonRow(actor, lessonId, direct, { includeArchived: true });
  if (!lesson.archived_at) return { lesson: mapLesson(lesson) };
  const ctx = await courseContext(actor, lesson.course_id);
  requireGrant(ctx, P.LESSON_EDIT);

  return transaction(async (tx) => {
    // A lesson whose module was archived in the meantime comes back without one,
    // rather than into a module nobody can see.
    const moduleId = lesson.module_id && !lesson.module_archived_at ? lesson.module_id : null;
    const sortOrder = nextOrder(await nextLessonOrders(tx, ctx.course.id), moduleId);
    const restored = await tx.row(
      `UPDATE ${S}.learning_lessons SET archived_at = NULL, archived_by = NULL, module_id = $2, sort_order = $3
        WHERE id = $1 RETURNING *`,
      [lessonId, moduleId, sortOrder]
    );
    await record(tx, {
      organizationId: ctx.organizationId,
      courseId: ctx.course.id,
      lessonId,
      actorUserId: ctx.userId,
      eventType: 'LESSON_RESTORED',
      metadata: { name: lesson.name },
    });
    return { lesson: mapLesson(restored) };
  });
}
