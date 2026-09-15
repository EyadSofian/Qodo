/**
 * E-Learning Production — telling people.
 *
 * Delivery is the workspace's own path (`server/notify.js`): the bell, the live
 * alert and the phone push. What this file adds is restraint.
 *
 *   • Every alert has a de-duplication key. The first one inside its window is
 *     sent; the rest are counted and dropped. Three comments in a minute are
 *     one alert, and a scheduler restart never repeats "this is overdue".
 *   • Nothing is sent from inside a transaction. Services collect alerts in an
 *     outbox and hand it here after the commit, so a change that rolled back
 *     never announced itself.
 *   • The person who caused a change is never told about it.
 */

import { notify } from '../notify.js';
import { ASSET_SLUGS, ASSET_TYPE_LABELS } from '../../shared/learningProduction/constants.js';
import { SCHEMA as S, direct } from './db.js';

/** Minutes. `ONCE` is long enough that a key never repeats in practice. */
export const WINDOW = { SHORT: 10, COMMENTS: 15, ONCE: 60 * 24 * 365 * 10 };

export function assetLink({ courseId, lessonId, assetType }) {
  return `/learning-production/courses/${courseId}/lessons/${lessonId}/${ASSET_SLUGS[assetType]}`;
}

const where = ({ courseName, lessonName }) => `${courseName} · ${lessonName}`;
const stage = (assetType) => ASSET_TYPE_LABELS[assetType] ?? { ar: assetType, en: assetType };

/** The bilingual wording of each alert. */
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
};

/**
 * Claim the right to send one alert. True when this is the first send inside
 * the window — the row either did not exist, or its last send is older than
 * the window and it has just been renewed.
 */
async function claim({ organizationId, userId, dedupeKey, eventType, assetId, windowMinutes }) {
  const result = await direct.row(
    `INSERT INTO ${S}.learning_notifications (organization_id, user_id, dedupe_key, event_type, asset_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, dedupe_key) DO UPDATE SET
       delivered_count  = ${S}.learning_notifications.delivered_count
                          + CASE WHEN ${S}.learning_notifications.last_sent_at < now() - make_interval(mins => $6) THEN 1 ELSE 0 END,
       suppressed_count = ${S}.learning_notifications.suppressed_count
                          + CASE WHEN ${S}.learning_notifications.last_sent_at < now() - make_interval(mins => $6) THEN 0 ELSE 1 END,
       last_sent_at     = CASE WHEN ${S}.learning_notifications.last_sent_at < now() - make_interval(mins => $6)
                               THEN now() ELSE ${S}.learning_notifications.last_sent_at END
     RETURNING (last_sent_at = now()) AS send`,
    [organizationId, userId, dedupeKey, eventType, assetId ?? null, windowMinutes]
  );
  return Boolean(result?.send);
}

/**
 * Send what an action collected. Never throws: a notification is a side
 * effect, and the change it describes has already been committed.
 */
export async function flush(outbox) {
  let sent = 0;
  for (const item of outbox ?? []) {
    const recipients = [...new Set((item.recipients ?? []).filter(Boolean))].filter((id) => id !== item.actorId);
    for (const userId of recipients) {
      try {
        const allowed = await claim({
          organizationId: item.organizationId,
          userId,
          dedupeKey: item.dedupeKey,
          eventType: item.type,
          assetId: item.assetId,
          windowMinutes: item.windowMinutes ?? WINDOW.SHORT,
        });
        if (!allowed) continue;
        const { title, body } = MESSAGES[item.message](item.data);
        await notify(userId, item.actorId ?? null, {
          type: `learning.${item.type}`,
          title,
          body,
          link: item.link,
        });
        sent += 1;
      } catch (error) {
        console.error('[learning-production] notification not delivered —', error.message);
      }
    }
  }
  return sent;
}
