/**
 * Qodo Projects — notifications.
 *
 * Rides the workspace's existing notification centre, its stream and its push
 * delivery rather than building a second one — §63 asks for exactly that, and a
 * parallel system would mean two unread counts and two places to mute.
 *
 * Two properties this file adds on top:
 *
 * **Deduplicated.** The same event reaching the same person twice — a retry, a
 * rule that fired alongside a manual change — produces one notification. A
 * notification centre that repeats itself is one people stop opening.
 *
 * **Muteable per project.** "Tell me about everything on the tower job and only
 * mentions everywhere else" is the granularity people actually want, and the
 * preference table is keyed to match.
 */

import crypto from 'node:crypto';
import { query, rows, row } from './db.js';
import { notify } from '../notify.js';

/**
 * The categories somebody can mute.
 *
 * Deliberately coarse: a preference screen with forty switches is one nobody
 * configures, and the granularity that matters is "the work I owe" against
 * "everything else happening near me".
 */
export const CATEGORIES = ['assignment', 'mention', 'deadline', 'review', 'timesheet', 'budget', 'sla'];

/**
 * Has this person already been told?
 *
 * The key is the event, not the moment — so a retry collides and a genuinely
 * new occurrence does not. Kept in the audit table rather than a new one
 * because a notification that was sent is a thing that happened.
 */
async function alreadySent(organizationId, key) {
  const seen = await row(
    `SELECT 1 FROM qodo_projects.audit_events
      WHERE organization_id = $1 AND entity_type = 'notification' AND entity_id = $2
      LIMIT 1`,
    [organizationId, key]
  );
  return Boolean(seen);
}

async function remember(organizationId, projectId, key, type) {
  await query(
    `INSERT INTO qodo_projects.audit_events
       (organization_id, project_id, source, entity_type, entity_id, action)
     VALUES ($1, $2, 'system', 'notification', $3, $4)`,
    [organizationId, projectId, key, type]
  ).catch(() => {
    // A failure to record means the next delivery is a duplicate, which is
    // better than not delivering at all.
  });
}

/** Whether this person wants to hear about this, in this project. */
async function wants(organizationId, userId, projectId, category) {
  const preference = await row(
    `SELECT is_muted, in_app FROM qodo_projects.notification_preferences
      WHERE organization_id = $1 AND user_id = $2 AND category = $3
        AND (project_id = $4 OR project_id IS NULL)
      ORDER BY project_id NULLS LAST
      LIMIT 1`,
    [organizationId, userId, category, projectId ?? null]
  );
  // No preference means yes. Somebody who has never opened the settings should
  // still be told their work was assigned.
  if (!preference) return true;
  return !preference.is_muted && preference.in_app;
}

/**
 * Send one project notification, once.
 *
 * `key` identifies the *event*: "this task was assigned to this person in this
 * rework cycle". Two different assignments produce two keys; the same one
 * delivered twice produces one notification.
 */
export async function send({
  organizationId,
  projectId,
  userIds,
  actorId,
  category,
  type,
  title,
  body,
  link,
  key,
}) {
  const recipients = [...new Set((userIds ?? []).filter((id) => id && id !== actorId))];
  if (recipients.length === 0) return { sent: 0 };

  let sent = 0;
  for (const userId of recipients) {
    const eventKey = crypto
      .createHash('sha256')
      .update([key ?? type, userId].join('|'))
      .digest('hex')
      .slice(0, 40);

    if (await alreadySent(organizationId, eventKey)) continue;
    if (!(await wants(organizationId, userId, projectId, category))) continue;

    await notify(userId, actorId, { type, title, body, link });
    await remember(organizationId, projectId, eventKey, type);
    sent += 1;
  }

  return { sent, considered: recipients.length };
}

/* ------------------------------------------------------------------ */
/* The events                                                           */
/* ------------------------------------------------------------------ */

/**
 * Each event is a named function rather than a string somebody passes in.
 *
 * Bilingual titles, because the recipient's language is not known at write
 * time — the same reason the workspace's own notifications store both.
 */
export const events = {
  taskAssigned: (context, task, userIds) =>
    send({
      organizationId: context.organizationId,
      projectId: context.project.id,
      userIds,
      actorId: context.user.id,
      category: 'assignment',
      type: 'project.task.assigned',
      title: { ar: 'مهمة جديدة في مشروع', en: 'A project task is assigned to you' },
      body: task.title,
      link: `/projects/${context.project.id}/tasks`,
      key: `task.assigned:${task.id}:${task.updatedAt ?? ''}`,
    }),

  mentioned: (context, entity, userIds, snippet) =>
    send({
      organizationId: context.organizationId,
      projectId: context.project.id,
      userIds,
      actorId: context.user.id,
      category: 'mention',
      type: 'project.mention',
      title: { ar: 'ذُكر اسمك في تعليق', en: 'You were mentioned in a comment' },
      body: String(snippet ?? '').slice(0, 160),
      link: `/projects/${context.project.id}`,
      key: `mention:${entity}`,
    }),

  issueAssigned: (context, issue, userIds) =>
    send({
      organizationId: context.organizationId,
      projectId: context.project.id,
      userIds,
      actorId: context.user.id,
      category: 'assignment',
      type: 'project.issue.assigned',
      title: { ar: 'مشكلة مُسندة إليك', en: 'An issue is assigned to you' },
      body: `${issue.key} — ${issue.title}`,
      link: `/projects/${context.project.id}/issues`,
      key: `issue.assigned:${issue.id}:${issue.assigneeId}`,
    }),

  timesheetSubmitted: (context, timesheet, approverIds) =>
    send({
      organizationId: context.organizationId,
      projectId: context.project?.id ?? null,
      userIds: approverIds,
      actorId: context.user.id,
      category: 'timesheet',
      type: 'project.timesheet.submitted',
      title: { ar: 'جدول وقت في انتظار مراجعتك', en: 'A timesheet is waiting for your review' },
      body: `${timesheet.periodStart} → ${timesheet.periodEnd}`,
      link: `/projects/${context.project?.id ?? ''}/timesheet`,
      key: `timesheet.submitted:${timesheet.id}`,
    }),

  timesheetReviewed: (context, timesheet) =>
    send({
      organizationId: context.organizationId,
      projectId: context.project?.id ?? null,
      userIds: [timesheet.userId],
      actorId: context.user.id,
      category: 'timesheet',
      type: `project.timesheet.${timesheet.status}`,
      title:
        timesheet.status === 'approved'
          ? { ar: 'تم اعتماد جدول وقتك', en: 'Your timesheet was approved' }
          : { ar: 'تم رفض جدول وقتك', en: 'Your timesheet was sent back' },
      body: timesheet.rejectionReason || `${timesheet.periodStart} → ${timesheet.periodEnd}`,
      link: `/projects/${context.project?.id ?? ''}/timesheet`,
      key: `timesheet.reviewed:${timesheet.id}:${timesheet.status}`,
    }),

  budgetThreshold: (organizationId, crossing) =>
    send({
      organizationId,
      projectId: crossing.projectId,
      userIds: [crossing.ownerId],
      actorId: null,
      category: 'budget',
      type: 'project.budget.threshold',
      title:
        crossing.state === 'overrun'
          ? { ar: 'تجاوزت ميزانية مشروع', en: 'A project budget has been exceeded' }
          : { ar: 'ميزانية مشروع قاربت على الحد', en: 'A project budget is close to its limit' },
      body: `${crossing.projectName} — ${crossing.percent}%`,
      link: `/projects/${crossing.projectId}/budget`,
      key: `budget:${crossing.budgetId}:${crossing.state}`,
    }),

  slaBreached: (organizationId, breach) =>
    send({
      organizationId,
      projectId: breach.projectId,
      userIds: breach.notify ?? [],
      actorId: null,
      category: 'sla',
      type: 'project.sla.breached',
      title: { ar: 'تجاوز اتفاقية مستوى الخدمة', en: 'An SLA has been breached' },
      body: `${breach.issueKey} — ${breach.title}`,
      link: `/projects/${breach.projectId}/issues`,
      key: `sla:${breach.issueId}:${breach.level}`,
    }),

  overdue: (organizationId, projectId, task, userIds) =>
    send({
      organizationId,
      projectId,
      userIds,
      actorId: null,
      category: 'deadline',
      type: 'project.task.overdue',
      title: { ar: 'مهمة تجاوزت موعدها', en: 'A task is past its due date' },
      body: task.title,
      link: `/projects/${projectId}/tasks`,
      // The date is in the key, so somebody is told once per task rather than
      // every time the scheduler runs.
      key: `overdue:${task.id}:${task.endDate}`,
    }),
};

/* ------------------------------------------------------------------ */
/* Preferences                                                          */
/* ------------------------------------------------------------------ */

export async function preferencesFor(organizationId, userId) {
  return rows(
    `SELECT project_id, category, in_app, push, email, is_muted
       FROM qodo_projects.notification_preferences
      WHERE organization_id = $1 AND user_id = $2`,
    [organizationId, userId]
  );
}

export async function setPreference(organizationId, userId, input) {
  if (!CATEGORIES.includes(input?.category)) {
    throw Object.assign(new Error('category_unknown'), {
      status: 400,
      body: { error: 'category_unknown', allowed: CATEGORIES },
    });
  }

  await query(
    `INSERT INTO qodo_projects.notification_preferences
       (organization_id, user_id, project_id, category, in_app, push, email, is_muted)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (organization_id, user_id, project_id, category)
       DO UPDATE SET in_app = EXCLUDED.in_app, push = EXCLUDED.push,
                     email = EXCLUDED.email, is_muted = EXCLUDED.is_muted`,
    [
      organizationId,
      userId,
      input?.projectId ?? null,
      input.category,
      input?.inApp !== false,
      input?.push !== false,
      Boolean(input?.email),
      Boolean(input?.isMuted),
    ]
  );

  return { category: input.category, projectId: input?.projectId ?? null };
}
