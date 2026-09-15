/**
 * The production history.
 *
 * Append-only at the database level (migration 001). Written inside the same
 * transaction as the change it describes: a change that is not recorded did not
 * happen, so if the history row fails the change rolls back with it.
 */

import { SCHEMA as S } from './db.js';
import { ACTIVITY_EVENTS } from '../../shared/learningProduction/constants.js';

export async function record(db, entry) {
  if (!ACTIVITY_EVENTS.includes(entry.eventType)) {
    throw new Error(`[learning-production] unknown activity event ${entry.eventType}`);
  }
  await db.query(
    `INSERT INTO ${S}.learning_activity_log
       (organization_id, course_id, lesson_id, asset_id, version_id, actor_user_id, event_type, metadata_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.organizationId,
      entry.courseId ?? null,
      entry.lessonId ?? null,
      entry.assetId ?? null,
      entry.versionId ?? null,
      entry.actorUserId ?? null,
      entry.eventType,
      JSON.stringify(entry.metadata ?? {}),
    ]
  );
}

/** Events worth putting in front of a manager. Comments and checklist ticks stay on the asset. */
export const HEADLINE_EVENTS = [
  'COURSE_CREATED',
  'LESSON_CREATED',
  'VERSION_UPLOADED',
  'SUBMITTED_FOR_REVIEW',
  'RESUBMITTED',
  'CHANGES_REQUESTED',
  'APPROVED',
  'LOCKED',
  'REOPENED',
  'DEPENDENCY_OVERRIDDEN',
];

/**
 * A page of history, newest first, with the names needed to read it.
 * `condition` is SQL over the alias `e` (the log) and `c` (its course).
 */
export async function feed(db, { condition, params, before = null, limit = 30, events = null }) {
  const values = [...params];
  let extra = '';
  if (before) {
    values.push(String(before));
    extra += ` AND e.id < $${values.length}::bigint`;
  }
  if (events) {
    values.push(events);
    extra += ` AND e.event_type = ANY($${values.length}::text[])`;
  }
  values.push(Math.min(100, Math.max(1, Number(limit) || 30)));

  const found = await db.rows(
    `SELECT e.id, e.event_type, e.metadata_json, e.created_at, e.actor_user_id,
            e.course_id, e.lesson_id, e.asset_id, e.version_id,
            c.name AS course_name, c.code AS course_code,
            l.name AS lesson_name, a.asset_type, v.version_number
       FROM ${S}.learning_activity_log e
       LEFT JOIN ${S}.learning_courses c ON c.id = e.course_id
       LEFT JOIN ${S}.learning_lessons l ON l.id = e.lesson_id
       LEFT JOIN ${S}.learning_assets a ON a.id = e.asset_id
       LEFT JOIN ${S}.learning_asset_versions v ON v.id = e.version_id
      WHERE ${condition} ${extra}
      ORDER BY e.id DESC
      LIMIT $${values.length}`,
    values
  );

  return found.map((entry) => ({
    id: String(entry.id),
    eventType: entry.event_type,
    metadata: entry.metadata_json ?? {},
    createdAt: entry.created_at instanceof Date ? entry.created_at.toISOString() : entry.created_at,
    actorUserId: entry.actor_user_id,
    course: entry.course_id ? { id: entry.course_id, name: entry.course_name, code: entry.course_code } : null,
    lesson: entry.lesson_id ? { id: entry.lesson_id, name: entry.lesson_name } : null,
    asset: entry.asset_id ? { id: entry.asset_id, assetType: entry.asset_type } : null,
    versionNumber: entry.version_number ?? null,
  }));
}
