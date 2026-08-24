import crypto from 'node:crypto';
import { create, createIfAbsent, find, findOne } from './store.js';
import { notifyUser } from './push.js';
import { publishNotification } from './notificationStream.js';
import { HR_PERIODIC_TASKS, hrTaskById, hrTaskCategory, hrTaskFrequency } from '../shared/hrPeriodicTasks.js';
import { hrOccurrenceForDate, hrScheduleForTemplate } from '../shared/hrRecurrence.js';
import { isActiveUser } from '../shared/permissions.js';
import { organizationOf } from '../shared/organization.js';

const DEFAULT_WORKING_DAYS = [0, 1, 2, 3, 4];
const DEFAULT_TIMEZONE = process.env.DIGEST_TIMEZONE || 'Africa/Cairo';

const stableId = (prefix, ...parts) =>
  `${prefix}-${crypto.createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 28)}`;

export const hrPlanId = (organizationId, templateId) =>
  stableId('hrp', organizationId, templateId);

export function localDayInTimezone(timeZone = DEFAULT_TIMEZONE, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export async function hrPlansForOrganization(organizationId) {
  const stored = await find(
    'hrTaskPlans',
    (plan) => organizationOf(plan) === organizationId
  );
  const byTemplate = new Map(stored.map((plan) => [plan.templateId, plan]));
  const generated = await find(
    'tasks',
    (task) => organizationOf(task) === organizationId && task.source === 'hr_recurring'
  );
  const lastByTemplate = new Map();
  for (const task of generated) {
    const current = lastByTemplate.get(task.sourceTemplateId);
    if (!current || (task.generatedAt ?? task.createdAt) > (current.generatedAt ?? current.createdAt)) {
      lastByTemplate.set(task.sourceTemplateId, task);
    }
  }

  return HR_PERIODIC_TASKS.map((template) => {
    const plan = byTemplate.get(template.id);
    const last = lastByTemplate.get(template.id);
    const schedule = hrScheduleForTemplate(template);
    return {
      templateId: template.id,
      enabled: schedule.mode === 'scheduled' && Boolean(plan?.enabled),
      assigneeIds: Array.isArray(plan?.assigneeIds) ? plan.assigneeIds : [],
      configuredBy: plan?.configuredBy ?? null,
      enabledOn: plan?.enabledOn ?? null,
      schedule,
      lastGeneratedAt: last?.generatedAt ?? last?.createdAt ?? null,
      lastTaskId: last?.id ?? null,
      lastOccurrenceKey: last?.recurrenceKey ?? null,
    };
  });
}

/**
 * Generate every enabled HR occurrence whose working window contains `onDate`.
 * A deterministic task id plus `createIfAbsent` makes every call safe to retry.
 */
export async function generateHROperations({
  organizationId,
  onDate,
  templateId = null,
  requestedBy = null,
}) {
  const organization = await findOne(
    'organizations',
    (item) => item.id === organizationId
  );
  if (!organization) return { created: [], existing: [], skipped: [] };

  const workingDays = organization.workingDays ?? DEFAULT_WORKING_DAYS;
  const plans = await find(
    'hrTaskPlans',
    (plan) =>
      organizationOf(plan) === organizationId &&
      plan.enabled === true &&
      (!templateId || plan.templateId === templateId)
  );
  const people = await find(
    'users',
    (user) =>
      organizationOf(user) === organizationId &&
      isActiveUser(user) &&
      (user.department ?? 'general') === 'hr'
  );
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const created = [];
  const existing = [];
  const skipped = [];

  for (const plan of plans) {
    // Enabling a plan today is permission for today forward, never an implicit
    // request to backfill every period that existed before it was switched on.
    if (plan.enabledOn && onDate < plan.enabledOn) continue;
    const template = hrTaskById(plan.templateId);
    if (!template) {
      skipped.push({ templateId: plan.templateId, reason: 'unknown_template' });
      continue;
    }
    const occurrence = hrOccurrenceForDate(template, onDate, workingDays);
    if (!occurrence) continue;

    const assigneeIds = [...new Set(plan.assigneeIds ?? [])].filter((id) => peopleById.has(id));
    if (assigneeIds.length === 0) {
      skipped.push({ templateId: template.id, reason: 'owner_unavailable' });
      continue;
    }

    const id = stableId('hrt', organizationId, template.id, occurrence.key);
    const stamp = new Date().toISOString();
    const assignments = assigneeIds.map((userId) => ({
      userId,
      status: userId === plan.configuredBy ? 'accepted' : 'pending',
      note: '',
      acceptedAt: userId === plan.configuredBy ? stamp : null,
      declinedAt: null,
      proposedDueDate: null,
    }));
    const category = hrTaskCategory(template.category);
    const cadence = hrTaskFrequency(template.frequency);
    const owner = plan.configuredBy ?? requestedBy ?? assigneeIds[0];

    const result = await createIfAbsent('tasks', {
      id,
      organizationId,
      reference: `HR-${template.sourceNumber}-${occurrence.key}`,
      title: template.title,
      description: [
        `الدورية: ${cadence.ar}`,
        `المهلة: ${template.dueRule}`,
        `المسؤول الوظيفي: ${template.owner}`,
      ].join('\n'),
      objective: 'تنفيذ الالتزام الدوري في موعده وإبقاء سجل الموارد البشرية محدثاً وقابلاً للمراجعة.',
      definitionOfDone: template.doneDefinition,
      notes: template.notes,
      department: 'hr',
      subteam: category.subteam,
      stage: 'ready',
      priority: [11, 12, 21, 24, 49, 51].includes(template.sourceNumber) ? 'high' : 'normal',
      assigneeIds,
      assignments,
      assignedAt: stamp,
      assignedBy: owner,
      createdBy: owner,
      taskDate: occurrence.taskDate,
      dueDate: occurrence.dueDate,
      effortPoints: null,
      estimatedMinutes: null,
      progress: 0,
      archivedAt: null,
      archivedBy: null,
      archiveReason: '',
      startedAt: null,
      startedAtInferred: false,
      submittedAt: null,
      firstSubmittedAt: null,
      submittedBy: null,
      submissionNote: '',
      reviewedAt: null,
      reviewedBy: null,
      reviewNote: '',
      reviewDecision: null,
      publishedAt: null,
      publishedBy: null,
      completedAt: null,
      reworkCount: 0,
      reworkAcknowledgedBy: {},
      attachmentCount: 0,
      score: null,
      scoreBeforeReworkPenalty: null,
      scorePenaltyPercent: 0,
      scoreBy: null,
      scoredAt: null,
      overdueNotifiedFor: null,
      appId: null,
      labels: ['HR دوري', cadence.ar],
      order: -Date.now(),
      source: 'hr_recurring',
      sourceTemplateId: template.id,
      recurrenceKey: occurrence.key,
      recurrenceFrequency: template.frequency,
      generatedAt: stamp,
    });

    if (!result.created) {
      existing.push(result.doc);
      continue;
    }

    created.push(result.doc);
    await create('taskAssignments', {
      organizationId,
      taskId: result.doc.id,
      actorId: owner,
      action: 'generated',
      assigneeIds,
      meta: { templateId: template.id, recurrenceKey: occurrence.key },
    });
    await create('activity', {
      organizationId,
      actorId: owner,
      action: 'task.generate.hr_recurring',
      subject: 'task',
      subjectId: result.doc.id,
      meta: { templateId: template.id, recurrenceKey: occurrence.key },
    });

    for (const userId of assigneeIds) {
      const notification = await create('notifications', {
        organizationId,
        userId,
        actorId: owner,
        type: 'task.recurring_due',
        title: {
          ar: 'مهمة HR دورية أصبحت مستحقة',
          en: 'A recurring HR task is now due',
        },
        body: template.title,
        link: `/tasks?task=${result.doc.id}`,
        read: false,
      });
      publishNotification(userId, notification.id);
      await notifyUser(userId, {
        title: notification.title,
        body: template.title,
        link: notification.link,
      });
    }
  }

  return { created, existing, skipped };
}
