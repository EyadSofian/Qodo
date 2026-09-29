/**
 * Deadline notices and delivery retries for E-Learning Production.
 *
 * Runs from the workspace scheduler, at most every thirty minutes per
 * organization. Three jobs:
 *
 *   1. Lesson assets and run tasks that are due soon or overdue tell their
 *      assignee. "Due soon" is once per deadline, inside the person's own
 *      window (preferences, default two days). "Overdue" is once when it goes
 *      late and then again every N days (preferences, default three; zero
 *      means once) — the key carries the period, so a restart never repeats it
 *      and moving the deadline lets it be announced afresh.
 *   2. Anything left in the notification outbox is retried.
 */

import { SCHEMA as S, direct, isAvailable } from './db.js';
import { WINDOW, assetLink, flush, retryPending, taskLink } from './notifications.js';
import { daysBetween } from '../../shared/learningProduction/workflow.js';
import { today } from './services/summaries.js';

const EVERY_MS = 30 * 60 * 1000;
const lastRun = new Map();

async function preferences(organizationId) {
  const rows = await direct.rows(
    `SELECT user_id, due_soon_days, overdue_repeat_days FROM ${S}.learning_notification_preferences WHERE organization_id = $1`,
    [organizationId]
  );
  return new Map(rows.map((row) => [row.user_id, { dueSoonDays: row.due_soon_days, overdueRepeatDays: row.overdue_repeat_days }]));
}

/**
 * The key for one deadline notice, or null when nothing is due for this
 * person now. The overdue key names the repeat period it falls in.
 */
export function deadlineKey({ id, dueDate, day, prefs, prefix }) {
  const dueSoonDays = prefs?.dueSoonDays ?? 2;
  const repeat = prefs?.overdueRepeatDays ?? 3;
  const until = daysBetween(day, dueDate);
  if (until === null) return null;
  if (until < 0) {
    const late = -until;
    const period = repeat > 0 ? Math.floor((late - 1) / repeat) : 0;
    return { overdue: true, key: `${prefix}overdue:${id}:${dueDate}:${period}` };
  }
  if (dueSoonDays > 0 && until <= dueSoonDays) return { overdue: false, key: `${prefix}due-soon:${id}:${dueDate}` };
  return null;
}

export async function runLearningProductionClock(organizationId, { force = false } = {}) {
  if (!isAvailable()) return 0;
  if (!force && Date.now() - (lastRun.get(organizationId) ?? 0) < EVERY_MS) return 0;
  lastRun.set(organizationId, Date.now());

  try {
    const day = today();
    const prefs = await preferences(organizationId);
    const [assets, tasks] = await Promise.all([
      direct.rows(
        `SELECT a.id, a.asset_type, a.due_date, a.assignee_user_id, a.lesson_id, a.course_id,
                l.name AS lesson_name, c.name AS course_name
           FROM ${S}.learning_assets a
           JOIN ${S}.learning_lessons l ON l.id = a.lesson_id AND l.archived_at IS NULL
           JOIN ${S}.learning_courses c ON c.id = a.course_id AND c.archived_at IS NULL
          WHERE a.organization_id = $1 AND a.applicable
            AND a.assignee_user_id IS NOT NULL
            AND a.status IN ('ASSIGNED', 'IN_PROGRESS', 'CHANGES_REQUESTED')
            AND a.due_date IS NOT NULL
            AND a.due_date <= $2::date + 14
          LIMIT 3000`,
        [organizationId, day]
      ),
      direct.rows(
        `SELECT t.id, t.label_json, t.due_date, t.assignee_user_id, r.course_id, c.name AS course_name, st.label_json AS stage_label
           FROM ${S}.learning_task_instances t
           JOIN ${S}.learning_stage_instances st ON st.id = t.stage_id AND st.status <> 'SKIPPED'
           JOIN ${S}.learning_production_runs r ON r.id = t.run_id AND r.status = 'ACTIVE'
           JOIN ${S}.learning_courses c ON c.id = r.course_id AND c.archived_at IS NULL
          WHERE t.organization_id = $1 AND t.assignee_user_id IS NOT NULL AND t.kind <> 'AUTO'
            AND t.status IN ('NOT_STARTED', 'IN_PROGRESS', 'CHANGES_REQUESTED')
            AND t.due_date IS NOT NULL AND t.due_date <= $2::date + 14
          LIMIT 3000`,
        [organizationId, day]
      ),
    ]);

    const outbox = [];
    for (const r of assets) {
      const found = deadlineKey({ id: r.id, dueDate: r.due_date, day, prefs: prefs.get(r.assignee_user_id), prefix: '' });
      if (!found) continue;
      outbox.push({
        organizationId,
        actorId: null,
        recipients: [r.assignee_user_id],
        type: found.overdue ? 'overdue' : 'due_soon',
        message: found.overdue ? 'overdue' : 'dueSoon',
        dedupeKey: found.key,
        windowMinutes: WINDOW.ONCE,
        assetId: r.id,
        link: assetLink({ courseId: r.course_id, lessonId: r.lesson_id, assetType: r.asset_type }),
        data: { courseName: r.course_name, lessonName: r.lesson_name, assetType: r.asset_type, dueDate: r.due_date },
      });
    }
    for (const r of tasks) {
      const found = deadlineKey({ id: r.id, dueDate: r.due_date, day, prefs: prefs.get(r.assignee_user_id), prefix: 'task-' });
      if (!found) continue;
      outbox.push({
        organizationId,
        actorId: null,
        recipients: [r.assignee_user_id],
        type: found.overdue ? 'task_overdue' : 'task_due_soon',
        message: found.overdue ? 'taskOverdue' : 'taskDueSoon',
        dedupeKey: found.key,
        windowMinutes: WINDOW.ONCE,
        taskId: r.id,
        link: taskLink({ courseId: r.course_id, taskId: r.id }),
        data: { courseName: r.course_name, taskLabel: r.label_json, stageLabel: r.stage_label, dueDate: r.due_date },
      });
    }
    const sent = await flush(outbox);
    return sent + (await retryPending(organizationId));
  } catch (error) {
    console.error('[scheduler:learning-production]', error.message);
    return 0;
  }
}
