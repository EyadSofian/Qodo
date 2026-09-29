/**
 * E-Learning Production — telling people.
 *
 * Delivery is the workspace's own path (`server/notify.js`): the bell, the live
 * alert and the phone push. There is one bell; this module never draws its
 * own. What this file adds is reliability and restraint.
 *
 *   • Transactional outbox. A service collects alerts while it works and
 *     `transactionWithOutbox` writes them to `learning_notification_outbox`
 *     inside the same transaction as the change. A change that rolls back
 *     never announces itself; a change that commits is announced even if the
 *     process dies before sending, because the scheduler retries whatever is
 *     left (`retryPending`).
 *   • De-duplication. Every alert has a key. The first one inside its window
 *     is sent; the rest are counted and dropped. Three comments in a minute
 *     are one alert, and a restart never repeats "this is overdue".
 *   • Preferences. A person can mute kinds of alert; muted alerts are
 *     recorded as suppressed, not sent.
 *   • The person who caused a change is never told about it.
 */

import { notify } from '../notify.js';
import { ASSET_SLUGS, ASSET_TYPE_LABELS } from '../../shared/learningProduction/constants.js';
import { SCHEMA as S, direct, transaction } from './db.js';

/** Minutes. `ONCE` is long enough that a key never repeats in practice. */
export const WINDOW = { SHORT: 10, COMMENTS: 15, DAY: 60 * 24, ONCE: 60 * 24 * 365 * 10 };

const MAX_ATTEMPTS = 6;

export function assetLink({ courseId, lessonId, assetType }) {
  return `/learning-production/courses/${courseId}/lessons/${lessonId}/${ASSET_SLUGS[assetType]}`;
}

/** The task drawer, opened over the course's plan. */
export function taskLink({ courseId, taskId }) {
  return `/learning-production/courses/${courseId}/plan?task=${taskId}`;
}

export function issueLink({ courseId, issueId }) {
  return `/learning-production/courses/${courseId}/qa?issue=${issueId}`;
}

export function releaseLink({ courseId, releaseId }) {
  return `/learning-production/courses/${courseId}/qa?release=${releaseId}`;
}

export function runLink({ courseId }) {
  return `/learning-production/courses/${courseId}`;
}

const where = ({ courseName, lessonName }) => `${courseName} · ${lessonName}`;
const stage = (assetType) => ASSET_TYPE_LABELS[assetType] ?? { ar: assetType, en: assetType };
const label = (pair, lang) => (pair && typeof pair === 'object' ? pair[lang] ?? pair.en ?? '' : String(pair ?? ''));
const inCourse = (m) => ({ ar: `${m.courseName} · ${label(m.stageLabel, 'ar')}`, en: `${m.courseName} · ${label(m.stageLabel, 'en')}` });

/** The bilingual wording of each alert. The reader's language is not known when it is sent. */
export const MESSAGES = {
  assigned: (m) => ({
    title: { ar: `${stage(m.assetType).ar}: مُسند إليك`, en: `${stage(m.assetType).en} assigned to you` },
    body: { ar: where(m), en: where(m) },
  }),
  reviewerAssigned: (m) => ({
    title: { ar: `أنت مراجع ${stage(m.assetType).ar}`, en: `You are reviewing the ${stage(m.assetType).en}` },
    body: { ar: where(m), en: where(m) },
  }),
  bulkAssigned: (m) => ({
    title: { ar: `أُسند إليك ${m.count} من أعمال الإنتاج`, en: `${m.count} production assets assigned to you` },
    body: { ar: m.courseName, en: m.courseName },
  }),
  submitted: (m) => ({
    title: {
      ar: `${stage(m.assetType).ar} v${m.versionNumber} بانتظار مراجعتك`,
      en: `${stage(m.assetType).en} v${m.versionNumber} is waiting for your review`,
    },
    body: { ar: where(m), en: where(m) },
  }),
  resubmitted: (m) => ({
    title: {
      ar: `أُعيد إرسال ${stage(m.assetType).ar} v${m.versionNumber} بعد التعديل`,
      en: `${stage(m.assetType).en} v${m.versionNumber} was resubmitted`,
    },
    body: { ar: where(m), en: where(m) },
  }),
  changesRequested: (m) => ({
    title: { ar: `مطلوب تعديلات على ${stage(m.assetType).ar}`, en: `Changes requested on the ${stage(m.assetType).en}` },
    body: {
      ar: `${where(m)}${m.openComments ? ` · ${m.openComments} ملاحظة مفتوحة` : ''}`,
      en: `${where(m)}${m.openComments ? ` · ${m.openComments} open comments` : ''}`,
    },
  }),
  approved: (m) => ({
    title: { ar: `اعتُمد ${stage(m.assetType).ar} v${m.versionNumber}`, en: `${stage(m.assetType).en} v${m.versionNumber} approved` },
    body: { ar: where(m), en: where(m) },
  }),
  reopened: (m) => ({
    title: { ar: `أُعيد فتح ${stage(m.assetType).ar}`, en: `The ${stage(m.assetType).en} was reopened` },
    body: { ar: `${where(m)} · ${m.reason}`, en: `${where(m)} · ${m.reason}` },
  }),
  comment: (m) => ({
    title: { ar: `ملاحظة جديدة على ${stage(m.assetType).ar}`, en: `New comment on the ${stage(m.assetType).en}` },
    body: { ar: where(m), en: where(m) },
  }),
  dueSoon: (m) => ({
    title: { ar: `${stage(m.assetType).ar} مستحق قريبًا`, en: `${stage(m.assetType).en} is due soon` },
    body: { ar: `${where(m)} · ${m.dueDate}`, en: `${where(m)} · ${m.dueDate}` },
  }),
  overdue: (m) => ({
    title: { ar: `${stage(m.assetType).ar} تجاوز موعده`, en: `${stage(m.assetType).en} is overdue` },
    body: { ar: `${where(m)} · ${m.dueDate}`, en: `${where(m)} · ${m.dueDate}` },
  }),

  /* ── production runs ─────────────────────────────────────────── */
  taskAssigned: (m) => ({
    title: { ar: `مهمة مسندة إليك: ${label(m.taskLabel, 'ar')}`, en: `Task assigned to you: ${label(m.taskLabel, 'en')}` },
    body: inCourse(m),
  }),
  taskReviewerAssigned: (m) => ({
    title: { ar: `أنت مراجع: ${label(m.taskLabel, 'ar')}`, en: `You are reviewing: ${label(m.taskLabel, 'en')}` },
    body: inCourse(m),
  }),
  tasksAssigned: (m) => ({
    title: { ar: `أُسندت إليك ${m.count} مهمة في دورة إنتاج`, en: `${m.count} tasks assigned to you in a production run` },
    body: { ar: m.courseName, en: m.courseName },
  }),
  taskSubmitted: (m) => ({
    title: { ar: `بانتظار اعتمادك: ${label(m.taskLabel, 'ar')}`, en: `Waiting for your approval: ${label(m.taskLabel, 'en')}` },
    body: inCourse(m),
  }),
  taskResubmitted: (m) => ({
    title: { ar: `أُعيد الإرسال بعد التعديل: ${label(m.taskLabel, 'ar')}`, en: `Resubmitted after changes: ${label(m.taskLabel, 'en')}` },
    body: inCourse(m),
  }),
  taskChangesRequested: (m) => ({
    title: { ar: `مطلوب تعديلات: ${label(m.taskLabel, 'ar')}`, en: `Changes requested: ${label(m.taskLabel, 'en')}` },
    body: inCourse(m),
  }),
  taskApproved: (m) => ({
    title: { ar: `اعتُمدت: ${label(m.taskLabel, 'ar')}`, en: `Approved: ${label(m.taskLabel, 'en')}` },
    body: inCourse(m),
  }),
  taskReopened: (m) => ({
    title: { ar: `أُعيد فتح: ${label(m.taskLabel, 'ar')}`, en: `Reopened: ${label(m.taskLabel, 'en')}` },
    body: { ar: `${m.courseName} · ${m.reason}`, en: `${m.courseName} · ${m.reason}` },
  }),
  taskComment: (m) => ({
    title: { ar: `ملاحظة جديدة على: ${label(m.taskLabel, 'ar')}`, en: `New comment on: ${label(m.taskLabel, 'en')}` },
    body: inCourse(m),
  }),
  taskMention: (m) => ({
    title: { ar: `أشار إليك أحدهم في: ${label(m.taskLabel, 'ar')}`, en: `You were mentioned on: ${label(m.taskLabel, 'en')}` },
    body: inCourse(m),
  }),
  taskUnblocked: (m) => ({
    title: { ar: `أصبح بإمكانك البدء: ${label(m.taskLabel, 'ar')}`, en: `Ready to start: ${label(m.taskLabel, 'en')}` },
    body: inCourse(m),
  }),
  taskDueSoon: (m) => ({
    title: { ar: `مستحقة قريبًا: ${label(m.taskLabel, 'ar')}`, en: `Due soon: ${label(m.taskLabel, 'en')}` },
    body: { ar: `${m.courseName} · ${m.dueDate}`, en: `${m.courseName} · ${m.dueDate}` },
  }),
  taskOverdue: (m) => ({
    title: { ar: `متأخرة: ${label(m.taskLabel, 'ar')}`, en: `Overdue: ${label(m.taskLabel, 'en')}` },
    body: { ar: `${m.courseName} · ${m.dueDate}`, en: `${m.courseName} · ${m.dueDate}` },
  }),
  stageCompleted: (m) => ({
    title: { ar: `اكتملت مرحلة: ${label(m.stageLabel, 'ar')}`, en: `Stage complete: ${label(m.stageLabel, 'en')}` },
    body: { ar: m.courseName, en: m.courseName },
  }),
  issueAssigned: (m) => ({
    title: { ar: `مشكلة #${m.issueNumber} مسندة إليك`, en: `Issue #${m.issueNumber} assigned to you` },
    body: { ar: `${m.courseName} · ${m.title}`, en: `${m.courseName} · ${m.title}` },
  }),
  issueReported: (m) => ({
    title: { ar: `مشكلة ${m.severityAr} جديدة #${m.issueNumber}`, en: `New ${String(m.severity).toLowerCase()} issue #${m.issueNumber}` },
    body: { ar: `${m.courseName} · ${m.title}`, en: `${m.courseName} · ${m.title}` },
  }),
  issueFixed: (m) => ({
    title: { ar: `مشكلة #${m.issueNumber} أُصلحت وتنتظر التحقق`, en: `Issue #${m.issueNumber} fixed — waiting for verification` },
    body: { ar: `${m.courseName} · ${m.title}`, en: `${m.courseName} · ${m.title}` },
  }),
  issueReopened: (m) => ({
    title: { ar: `أُعيد فتح المشكلة #${m.issueNumber}`, en: `Issue #${m.issueNumber} reopened` },
    body: { ar: `${m.courseName} · ${m.title}`, en: `${m.courseName} · ${m.title}` },
  }),
  releaseReady: (m) => ({
    title: { ar: `الإصدار ${m.versionLabel} بانتظار اعتمادك`, en: `Release ${m.versionLabel} is waiting for your sign-off` },
    body: { ar: m.courseName, en: m.courseName },
  }),
  releaseSignedOff: (m) => ({
    title: { ar: `اعتُمد الإصدار ${m.versionLabel} وجاهز للنشر`, en: `Release ${m.versionLabel} signed off — ready to publish` },
    body: { ar: m.courseName, en: m.courseName },
  }),
  releasePublished: (m) => ({
    title: { ar: `نُشر الإصدار ${m.versionLabel}`, en: `Release ${m.versionLabel} published` },
    body: { ar: m.courseName, en: m.courseName },
  }),
  releaseRolledBack: (m) => ({
    title: { ar: `تم التراجع عن الإصدار ${m.versionLabel}`, en: `Release ${m.versionLabel} rolled back` },
    body: { ar: `${m.courseName} · ${m.reason}`, en: `${m.courseName} · ${m.reason}` },
  }),
};

/** The event types a person can mute, grouped the way the preferences screen shows them. */
export const PREFERENCE_EVENTS = [
  'assigned',
  'review_requested',
  'changes_requested',
  'approved',
  'comment',
  'mention',
  'handoff',
  'deadline',
  'issue',
  'release',
];

/** Which preference group an outbox event type falls under. */
export function preferenceGroup(eventType) {
  const type = String(eventType);
  if (['assigned', 'reviewer_assigned', 'task_assigned', 'task_reviewer_assigned', 'tasks_assigned'].includes(type)) return 'assigned';
  if (['submitted', 'resubmitted', 'task_submitted', 'task_resubmitted', 'release_ready'].includes(type)) return 'review_requested';
  if (['changes_requested', 'task_changes_requested'].includes(type)) return 'changes_requested';
  if (['approved', 'task_approved'].includes(type)) return 'approved';
  if (['comment', 'task_comment'].includes(type)) return 'comment';
  if (type === 'task_mention') return 'mention';
  if (['stage_completed', 'task_unblocked', 'reopened', 'task_reopened'].includes(type)) return 'handoff';
  if (['due_soon', 'overdue', 'task_due_soon', 'task_overdue'].includes(type)) return 'deadline';
  if (type.startsWith('issue_')) return 'issue';
  if (type.startsWith('release_')) return 'release';
  return 'handoff';
}

function entityOf(item) {
  if (item.entityType) return { entityType: item.entityType, entityId: item.entityId ?? null };
  if (item.taskId) return { entityType: 'TASK', entityId: item.taskId };
  if (item.assetId) return { entityType: 'ASSET', entityId: item.assetId };
  return { entityType: 'COURSE', entityId: null };
}

/**
 * Write the collected alerts to the outbox, inside the caller's transaction.
 * One row per recipient; the actor is never a recipient. Returns row ids.
 */
export async function enqueue(tx, outbox) {
  const ids = [];
  for (const item of outbox ?? []) {
    const recipients = [...new Set((item.recipients ?? []).filter(Boolean))].filter((id) => id !== item.actorId);
    if (recipients.length === 0) continue;
    const { entityType, entityId } = entityOf(item);
    for (const userId of recipients) {
      const found = await tx.row(
        `INSERT INTO ${S}.learning_notification_outbox
           (organization_id, recipient_user_id, actor_user_id, event_type, entity_type, entity_id, dedupe_key,
            window_minutes, link, message_key, data_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          item.organizationId,
          userId,
          item.actorId ?? null,
          item.type,
          entityType,
          entityId,
          item.dedupeKey,
          item.windowMinutes ?? WINDOW.SHORT,
          item.link,
          item.message,
          JSON.stringify(item.data ?? {}),
        ]
      );
      ids.push(found.id);
    }
  }
  return ids;
}

/**
 * Claim the right to send one alert. True when this is the first send inside
 * the window — the row either did not exist, or its last send is older than
 * the window and it has just been renewed.
 */
async function claim({ organizationId, userId, dedupeKey, eventType, assetId, entityType, entityId, windowMinutes }) {
  const result = await direct.row(
    `INSERT INTO ${S}.learning_notifications (organization_id, user_id, dedupe_key, event_type, asset_id, entity_type, entity_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, dedupe_key) DO UPDATE SET
       delivered_count  = ${S}.learning_notifications.delivered_count
                          + CASE WHEN ${S}.learning_notifications.last_sent_at < now() - make_interval(mins => $8) THEN 1 ELSE 0 END,
       suppressed_count = ${S}.learning_notifications.suppressed_count
                          + CASE WHEN ${S}.learning_notifications.last_sent_at < now() - make_interval(mins => $8) THEN 0 ELSE 1 END,
       last_sent_at     = CASE WHEN ${S}.learning_notifications.last_sent_at < now() - make_interval(mins => $8)
                               THEN now() ELSE ${S}.learning_notifications.last_sent_at END
     RETURNING (last_sent_at = now()) AS send`,
    [organizationId, userId, dedupeKey, eventType, assetId ?? null, entityType ?? null, entityId ?? null, windowMinutes]
  );
  return Boolean(result?.send);
}

async function mutedGroups(userId) {
  const found = await direct.row(`SELECT muted_events FROM ${S}.learning_notification_preferences WHERE user_id = $1`, [userId]);
  return new Set(found?.muted_events ?? []);
}

/**
 * Deliver outbox rows. Never throws: the change they describe has already
 * committed. A failure is recorded on the row and retried later with backoff.
 */
export async function deliver(ids) {
  if (!ids?.length) return 0;
  let sent = 0;
  const rows = await direct.rows(
    `SELECT * FROM ${S}.learning_notification_outbox WHERE id = ANY($1::bigint[]) AND delivered_at IS NULL AND suppressed_at IS NULL ORDER BY id`,
    [ids]
  );
  const muteCache = new Map();
  for (const row of rows) {
    try {
      if (!muteCache.has(row.recipient_user_id)) muteCache.set(row.recipient_user_id, await mutedGroups(row.recipient_user_id));
      if (muteCache.get(row.recipient_user_id).has(preferenceGroup(row.event_type))) {
        await direct.query(
          `UPDATE ${S}.learning_notification_outbox SET suppressed_at = now(), suppressed_reason = 'MUTED' WHERE id = $1`,
          [row.id]
        );
        continue;
      }
      const allowed = await claim({
        organizationId: row.organization_id,
        userId: row.recipient_user_id,
        dedupeKey: row.dedupe_key,
        eventType: row.event_type,
        assetId: row.entity_type === 'ASSET' ? row.entity_id : null,
        entityType: row.entity_type,
        entityId: row.entity_id,
        windowMinutes: row.window_minutes,
      });
      if (!allowed) {
        await direct.query(
          `UPDATE ${S}.learning_notification_outbox SET suppressed_at = now(), suppressed_reason = 'DUPLICATE' WHERE id = $1`,
          [row.id]
        );
        continue;
      }
      const render = MESSAGES[row.message_key];
      if (!render) throw new Error(`unknown message ${row.message_key}`);
      const { title, body } = render(row.data_json ?? {});
      await notify(row.recipient_user_id, row.actor_user_id ?? null, {
        type: `learning.${row.event_type}`,
        title,
        body,
        link: row.link,
      });
      await direct.query(`UPDATE ${S}.learning_notification_outbox SET delivered_at = now(), attempts = attempts + 1 WHERE id = $1`, [row.id]);
      sent += 1;
    } catch (error) {
      console.error('[learning-production] notification not delivered —', error.message);
      await direct
        .query(
          `UPDATE ${S}.learning_notification_outbox
              SET attempts = attempts + 1, last_error = $2,
                  next_attempt_at = now() + make_interval(mins => power(2, least(attempts, 6))::int),
                  suppressed_at = CASE WHEN attempts + 1 >= ${MAX_ATTEMPTS} THEN now() ELSE NULL END,
                  suppressed_reason = CASE WHEN attempts + 1 >= ${MAX_ATTEMPTS} THEN 'GAVE_UP' ELSE NULL END
            WHERE id = $1`,
          [row.id, String(error.message).slice(0, 500)]
        )
        .catch(() => {});
    }
  }
  return sent;
}

/** The scheduler's retry: anything committed but not yet delivered. */
export async function retryPending(organizationId, { limit = 200 } = {}) {
  const found = await direct.rows(
    `SELECT id FROM ${S}.learning_notification_outbox
      WHERE organization_id = $1 AND delivered_at IS NULL AND suppressed_at IS NULL AND next_attempt_at <= now()
      ORDER BY id LIMIT $2`,
    [organizationId, limit]
  );
  return deliver(found.map((row) => row.id));
}

/**
 * A transaction whose alerts are written with it and delivered after it.
 * `outbox` is the array the work pushes alerts into.
 */
export async function transactionWithOutbox(outbox, fn) {
  const { result, ids } = await transaction(async (tx) => {
    const value = await fn(tx);
    const written = await enqueue(tx, outbox);
    outbox.length = 0;
    return { result: value, ids: written };
  });
  await deliver(ids);
  return result;
}

/**
 * Send alerts collected outside any transaction (deadline reminders). They go
 * through the outbox too, so a crash mid-send is retried.
 */
export async function flush(outbox) {
  if (!outbox?.length) return 0;
  const ids = await transaction((tx) => enqueue(tx, outbox));
  return deliver(ids);
}
