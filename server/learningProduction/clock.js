/**
 * Deadline notices for E-Learning Production.
 *
 * Runs from the workspace scheduler. Each asset is announced once when it
 * becomes due soon and once when it goes overdue — the de-duplication key
 * includes the due date, so moving a deadline lets it be announced again, and
 * nothing is repeated every morning.
 */

import { DUE_SOON_DAYS } from '../../shared/learningProduction/constants.js';
import { SCHEMA as S, direct, isAvailable } from './db.js';
import { WINDOW, assetLink, flush } from './notifications.js';
import { today } from './services/summaries.js';

const EVERY_MS = 30 * 60 * 1000;
const lastRun = new Map();

export async function runLearningProductionClock(organizationId, { force = false } = {}) {
  if (!isAvailable()) return 0;
  if (!force && Date.now() - (lastRun.get(organizationId) ?? 0) < EVERY_MS) return 0;
  lastRun.set(organizationId, Date.now());

  try {
    const day = today();
    const found = await direct.rows(
      `SELECT a.id, a.asset_type, a.due_date, a.assignee_user_id, a.lesson_id, a.course_id,
              l.name AS lesson_name, c.name AS course_name
         FROM ${S}.learning_assets a
         JOIN ${S}.learning_lessons l ON l.id = a.lesson_id AND l.archived_at IS NULL
         JOIN ${S}.learning_courses c ON c.id = a.course_id AND c.archived_at IS NULL
        WHERE a.organization_id = $1
          AND a.assignee_user_id IS NOT NULL
          AND a.status IN ('ASSIGNED', 'IN_PROGRESS', 'CHANGES_REQUESTED')
          AND a.due_date IS NOT NULL
          AND a.due_date <= $2::date + ${DUE_SOON_DAYS}
        LIMIT 2000`,
      [organizationId, day]
    );

    const outbox = found.map((r) => {
      const overdue = r.due_date < day;
      return {
        organizationId,
        actorId: null,
        recipients: [r.assignee_user_id],
        type: overdue ? 'overdue' : 'due_soon',
        message: overdue ? 'overdue' : 'dueSoon',
        dedupeKey: `${overdue ? 'overdue' : 'due-soon'}:${r.id}:${r.due_date}`,
        windowMinutes: WINDOW.ONCE,
        assetId: r.id,
        link: assetLink({ courseId: r.course_id, lessonId: r.lesson_id, assetType: r.asset_type }),
        data: { courseName: r.course_name, lessonName: r.lesson_name, assetType: r.asset_type, dueDate: r.due_date },
      };
    });
    return await flush(outbox);
  } catch (error) {
    console.error('[scheduler:learning-production]', error.message);
    return 0;
  }
}
