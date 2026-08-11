/**
 * First-boot seed: the app registry and the first administrator.
 *
 * Runs on every start but only fills gaps — editing a tile in the UI is never
 * undone by a redeploy, and a new default app added here shows up for everyone.
 */

import crypto from 'node:crypto';
import { create, find, getStore } from './store.js';
import { hashPassword } from './auth.js';
import {
  DEFAULT_DEPARTMENT,
  isDoneStage,
  normaliseStageId,
} from '../shared/departments.js';
import { DEFAULT_ORGANIZATION_ID, organizationOf } from '../shared/organization.js';
import { PERMISSIONS, permissionsFor } from '../shared/permissions.js';
import {
  TASK_WORKFLOW_ROLES,
  inferredMarketingWorkflowRoles,
} from '../shared/marketingWorkflow.js';

export const DEFAULT_ORGANIZATION = {
  id: DEFAULT_ORGANIZATION_ID,
  name: 'Engosoft',
  slug: 'engosoft',
  timezone: process.env.DIGEST_TIMEZONE || 'Africa/Cairo',
  defaultCurrency: 'EGP',
  defaultLanguage: 'ar',
  workingDays: [0, 1, 2, 3, 4],
  workingHours: { start: '09:00', end: '17:00' },
  status: 'active',
};

/**
 * The four production dashboards, plus the modules that live inside the hub.
 * `kind: 'internal'` routes in-app; `external` opens the URL (framed or in a
 * new tab, per `embed`).
 */
export const DEFAULT_APPS = [
  {
    id: 'sla',
    kind: 'external',
    nameAr: 'أداء الأقسام',
    nameEn: 'Departments & SLA',
    descAr: 'الهيلب ديسك ومستوى الخدمة والمبيعات والتوظيف — لحظة بلحظة.',
    url: 'https://sla-engosoft-production.up.railway.app/',
    repo: 'https://github.com/EyadSofian/SLA-Engosoft',
    icon: 'gauge',
    color: '#1D6FB8',
    group: 'operations',
    embed: 'auto',
    order: 10,
  },
  {
    id: 'insights',
    kind: 'external',
    nameAr: 'التسويق والمبيعات',
    nameEn: 'Insights Hub',
    descAr: 'مصروف الإعلانات على ميتا وسناب مقابل العملاء والإيراد.',
    url: 'https://engosoft-insights-hub-production.up.railway.app/',
    repo: 'https://github.com/EyadSofian/Engosoft-Insights-Hub',
    icon: 'funnel',
    color: '#F5821F',
    group: 'growth',
    embed: 'auto',
    order: 20,
  },
  {
    id: 'hr',
    kind: 'external',
    nameAr: 'الموارد البشرية',
    nameEn: 'HR Suite',
    descAr: 'التوظيف والموظفين والهيكل الوظيفي وتقييمات الأداء.',
    url: 'https://engosoft-hr-production.up.railway.app/',
    repo: 'https://github.com/EyadSofian/engosoft-hr',
    icon: 'people',
    color: '#0EA5A5',
    group: 'people',
    embed: 'auto',
    order: 30,
  },
  {
    id: 'support',
    kind: 'external',
    nameAr: 'تحليلات خدمة العملاء',
    nameEn: 'Support Analytics',
    descAr: 'تقارير المحادثات وزمن الرد والكامبينات وبوت فهد.',
    url: 'https://chatwootdashpoard-production.up.railway.app/',
    repo: 'https://github.com/EyadSofian/chatwoot_dashpoard',
    icon: 'chat',
    color: '#6366F1',
    group: 'operations',
    embed: 'auto',
    order: 40,
  },
  {
    id: 'chatwoot',
    kind: 'external',
    nameAr: 'شات وت',
    nameEn: 'Chatwoot',
    descAr: 'صندوق المحادثات نفسه — الرد على العملاء.',
    url: 'https://chat.engosoft.com',
    icon: 'headset',
    color: '#7C3AED',
    group: 'operations',
    embed: 'newtab',
    order: 50,
  },
  {
    id: 'events',
    kind: 'internal',
    nameAr: 'الإيفينتات',
    nameEn: 'Events',
    descAr: 'التدريب اللي بميعاد: الطلب والحجوزات، محاضرات النهاردة، والتحليل.',
    url: '/events',
    icon: 'calendar',
    color: '#0EA5A5',
    group: 'operations',
    embed: 'internal',
    order: 55,
  },
  {
    id: 'elearning',
    kind: 'internal',
    nameAr: 'الكورسات',
    nameEn: 'Courses',
    descAr: 'التعلّم الإلكتروني: الإقبال، الاشتراكات، التقدم، ونسب الإكمال.',
    url: '/elearning',
    icon: 'folder',
    color: '#7C3AED',
    group: 'operations',
    embed: 'internal',
    order: 56,
  },
  {
    id: 'tasks',
    kind: 'internal',
    nameAr: 'المهام',
    nameEn: 'Tasks',
    descAr: 'بورد المهام: مين مسؤول، وإيه اللي متأخر.',
    url: '/tasks',
    icon: 'kanban',
    color: '#16A34A',
    group: 'workspace',
    embed: 'internal',
    order: 5,
  },
  {
    id: 'users',
    kind: 'internal',
    nameAr: 'المستخدمون',
    nameEn: 'Users',
    descAr: 'إضافة الموظفين وتحديد صلاحياتهم والتطبيقات المسموح بيها.',
    url: '/users',
    icon: 'shield',
    color: '#0B2545',
    group: 'admin',
    embed: 'internal',
    order: 60,
    requires: 'users.view',
  },
  {
    id: 'settings',
    kind: 'internal',
    nameAr: 'الإعدادات',
    nameEn: 'Settings',
    descAr: 'تطبيقات المساحة، الروابط، والربط بين الأنظمة.',
    url: '/settings',
    icon: 'sliders',
    color: '#64748B',
    group: 'admin',
    embed: 'internal',
    order: 70,
    requires: 'settings.manage',
  },
];

export async function seed() {
  const store = await getStore();

  const organizations = await find('organizations');
  if (!organizations.some((organization) => organization.id === DEFAULT_ORGANIZATION_ID)) {
    await create('organizations', DEFAULT_ORGANIZATION);
  }

  const existingApps = await find('apps');
  const known = new Set(existingApps.map((a) => a.id));
  for (const app of DEFAULT_APPS) {
    if (!known.has(app.id)) await create('apps', { ...app, enabled: true, builtin: true });
  }
  await migrateTrainingAppLabels(store);

  const users = await find('users');
  if (users.length === 0) {
    const email = (process.env.ADMIN_EMAIL || 'admin@engosoft.com').toLowerCase();
    const generated = !process.env.ADMIN_PASSWORD;
    const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');

    await create('users', {
      name: process.env.ADMIN_NAME || 'مدير النظام',
      email,
      passwordHash: await hashPassword(password),
      role: 'admin',
      organizationId: DEFAULT_ORGANIZATION_ID,
      status: 'active',
      permissions: null,
      appIds: null,
      department: 'general',
      subteam: null,
      jobRole: null,
      title: 'Administrator',
      avatarColor: '#1D6FB8',
      lastLoginAt: null,
    });

    const line = '─'.repeat(58);
    console.log(`\n${line}\n  Engosoft Workspace — first administrator created`);
    console.log(`  Email:    ${email}`);
    if (generated) {
      console.log(`  Password: ${password}`);
      console.log('  ↑ shown once. Change it from the profile menu after signing in,');
      console.log('    or set ADMIN_PASSWORD before the first boot to pick your own.');
    } else {
      console.log('  Password: (from ADMIN_PASSWORD)');
    }
    console.log(`${line}\n`);
  }

  await migrateOrganisationAndTasks(store);
  return store;
}

/**
 * Built-in ids and routes stay stable because user access lists store those ids.
 * Only the labels presented outside the modules change. This migration runs on
 * existing installations too; editing DEFAULT_APPS alone would affect first
 * boot only and production would keep the old names forever.
 */
async function migrateTrainingAppLabels(store) {
  const labels = {
    events: {
      nameAr: 'الإيفينتات',
      nameEn: 'Events',
      descAr: 'التدريب اللي بميعاد: الطلب والحجوزات، محاضرات النهاردة، والتحليل.',
    },
    elearning: {
      nameAr: 'الكورسات',
      nameEn: 'Courses',
      descAr: 'التعلّم الإلكتروني: الإقبال، الاشتراكات، التقدم، ونسب الإكمال.',
    },
  };
  const apps = await find('apps');
  for (const app of apps) {
    const patch = labels[app.id];
    if (!patch) continue;
    const changed = Object.entries(patch).some(([key, value]) => app[key] !== value);
    if (changed) await store.update('apps', app.id, patch);
  }
}

/**
 * The document store intentionally has no rigid SQL schema, so boot migrations
 * fill only missing fields and translate known legacy stage ids. They are
 * idempotent and safe to run on every deploy.
 */
async function migrateOrganisationAndTasks(store) {
  const people = await find('users');
  for (const person of people) {
    const patch = {};
    if (!Object.hasOwn(person, 'organizationId')) {
      patch.organizationId = DEFAULT_ORGANIZATION_ID;
    }
    if (!Object.hasOwn(person, 'subteam')) patch.subteam = null;
    if (!Object.hasOwn(person, 'jobRole')) patch.jobRole = null;
    const inferredRoles = inferredMarketingWorkflowRoles(person);
    const workflowRoles = [
      ...new Set([...(person.taskWorkflowRoles ?? []), ...inferredRoles]),
    ];
    if (
      !Object.hasOwn(person, 'taskWorkflowRoles') ||
      workflowRoles.length !== (person.taskWorkflowRoles ?? []).length
    ) {
      patch.taskWorkflowRoles = workflowRoles;
    }

    // Mirna's review desk is intentionally narrow: she may inspect, return,
    // approve and score Marketing submissions without inheriting task planning.
    // Seddik's separate responsibility is only the final move to Done. The
    // durable roles above are what runtime checks; display names are only the
    // deployment-time bridge to the accounts that already exist.
    if (inferredRoles.includes(TASK_WORKFLOW_ROLES.MARKETING_REVIEWER)) {
      const access = [
        PERMISSIONS.APPS_VIEW,
        PERMISSIONS.TASKS_VIEW,
        PERMISSIONS.TASKS_VIEW_TEAM,
        PERMISSIONS.TASKS_REVIEW,
        PERMISSIONS.TASKS_APPROVE,
        PERMISSIONS.TASKS_SCORE,
      ];
      patch.permissions = [...new Set([...permissionsFor(person), ...access])].filter(
        (permission) => permission !== PERMISSIONS.TASKS_PUBLISH
      );
      patch.visibilityScope = 'department';
    }
    if (inferredRoles.includes(TASK_WORKFLOW_ROLES.MARKETING_FINAL_APPROVER)) {
      const access = [
        PERMISSIONS.APPS_VIEW,
        PERMISSIONS.TASKS_VIEW,
        PERMISSIONS.TASKS_VIEW_TEAM,
        PERMISSIONS.TASKS_PUBLISH,
      ];
      patch.permissions = [...new Set([...(patch.permissions ?? permissionsFor(person)), ...access])];
      patch.visibilityScope = 'department';
    }
    if (Object.keys(patch).length) await store.update('users', person.id, patch);
  }

  const today = new Date().toISOString().slice(0, 10);
  const attachments = await find('attachments');
  const filesPerTask = new Map();
  for (const file of attachments) {
    filesPerTask.set(file.taskId, (filesPerTask.get(file.taskId) ?? 0) + 1);
  }

  const tasks = await find('tasks');
  for (const task of tasks) {
    const department = task.department ?? DEFAULT_DEPARTMENT;
    const patch = {};
    if (!Object.hasOwn(task, 'organizationId')) {
      patch.organizationId = DEFAULT_ORGANIZATION_ID;
    }
    if (!task.department) patch.department = department;
    const stage = normaliseStageId(department, task.stage);
    if (stage !== task.stage) patch.stage = stage;
    if (!Object.hasOwn(task, 'subteam')) patch.subteam = null;
    if (!Object.hasOwn(task, 'taskDate')) patch.taskDate = task.createdAt?.slice(0, 10) ?? today;
    if (!Object.hasOwn(task, 'notes')) patch.notes = '';
    if (!Object.hasOwn(task, 'reference')) {
      patch.reference = `TSK-${String(task.id).slice(0, 8).toUpperCase()}`;
    }
    if (!Object.hasOwn(task, 'objective')) patch.objective = '';
    if (!Object.hasOwn(task, 'definitionOfDone')) patch.definitionOfDone = '';
    if (!Object.hasOwn(task, 'effortPoints')) patch.effortPoints = null;
    if (!Object.hasOwn(task, 'estimatedMinutes')) patch.estimatedMinutes = null;
    if (!Object.hasOwn(task, 'score')) patch.score = null;
    if (!Object.hasOwn(task, 'scoreBy')) patch.scoreBy = null;
    if (!Object.hasOwn(task, 'scoredAt')) patch.scoredAt = null;
    if (!Object.hasOwn(task, 'assignedAt')) {
      patch.assignedAt = task.assigneeId ? (task.createdAt ?? null) : null;
    }
    if (!Object.hasOwn(task, 'assignedBy')) {
      patch.assignedBy = task.assigneeId ? (task.createdBy ?? null) : null;
    }

    /*
     * A task used to name one person, and its answer to the assignment lived in
     * flat fields beside them. Shared work needs both to be lists — an answer
     * per partner, because one shared status would let whoever accepts first
     * answer for everybody and hide the second person's silence.
     *
     * The old fields are read here and then left alone rather than deleted:
     * `assigneesOf` and `assignmentRows` still fall back to them, so a row this
     * migration has not reached yet behaves identically either way, and a
     * rollback does not lose the answers people already gave.
     */
    if (!Object.hasOwn(task, 'assigneeIds')) {
      patch.assigneeIds = task.assigneeId ? [task.assigneeId] : [];
    }
    if (!Object.hasOwn(task, 'assignments')) {
      patch.assignments = task.assigneeId
        ? [
            {
              userId: task.assigneeId,
              status: task.assignmentStatus ?? 'accepted',
              note: task.assignmentNote ?? '',
              acceptedAt: task.acceptedAt ?? task.startedAt ?? task.createdAt ?? null,
              declinedAt: task.declinedAt ?? null,
              proposedDueDate: task.proposedDueDate ?? null,
            },
          ]
        : [];
    }
    const closed = isDoneStage(department, stage);
    if (!Object.hasOwn(task, 'progress')) patch.progress = closed ? 100 : 0;
    if (closed && !task.completedAt) {
      patch.completedAt = task.updatedAt ?? task.createdAt ?? new Date().toISOString();
    }

    /*
     * Lifecycle fields arrived with the review gate. Tasks that predate it have
     * no submission history to invent, so they start empty — except a task that
     * is already closed and already scored, which is exactly what an approval
     * produces. Reading that as an approval keeps the old board's numbers
     * meaningful instead of showing every finished task as never reviewed.
     */
    // Everything that already exists is on a board, so it archives as null. The
    // field has to be present rather than merely absent because it is what
    // `livePredicate` reads on every listing.
    if (!Object.hasOwn(task, 'archivedAt')) patch.archivedAt = null;
    if (!Object.hasOwn(task, 'archivedBy')) patch.archivedBy = null;
    if (!Object.hasOwn(task, 'archiveReason')) patch.archiveReason = '';
    if (!Object.hasOwn(task, 'startedAt')) patch.startedAt = null;
    if (!Object.hasOwn(task, 'submittedAt')) patch.submittedAt = null;
    if (!Object.hasOwn(task, 'submittedBy')) patch.submittedBy = null;
    if (!Object.hasOwn(task, 'submissionNote')) patch.submissionNote = '';
    if (!Object.hasOwn(task, 'reviewNote')) patch.reviewNote = '';
    // The sign-off column is newer than every stored task, so nothing that
    // exists can have been published through it.
    if (!Object.hasOwn(task, 'publishedAt')) patch.publishedAt = null;
    if (!Object.hasOwn(task, 'publishedBy')) patch.publishedBy = null;
    if (!Object.hasOwn(task, 'reworkCount')) patch.reworkCount = 0;
    if (!Object.hasOwn(task, 'scoreBeforeReworkPenalty')) patch.scoreBeforeReworkPenalty = null;
    if (!Object.hasOwn(task, 'scorePenaltyPercent')) {
      patch.scorePenaltyPercent = Math.min(100, (task.reworkCount ?? 0) * 10);
    }
    if (!Object.hasOwn(task, 'reworkAcknowledgedBy')) patch.reworkAcknowledgedBy = {};
    if (!Object.hasOwn(task, 'reviewedAt')) {
      const scored = Number.isFinite(task.score);
      patch.reviewedAt = closed && scored ? (task.scoredAt ?? patch.completedAt ?? null) : null;
      patch.reviewedBy = closed && scored ? (task.scoreBy ?? null) : null;
      patch.reviewDecision = closed && scored ? 'approved' : null;
    }

    const fileCount = filesPerTask.get(task.id) ?? 0;
    if (task.attachmentCount !== fileCount) patch.attachmentCount = fileCount;

    if (Object.keys(patch).length) await store.update('tasks', task.id, patch);
  }

  // Child records inherit the task's tenant. Notifications and activity inherit
  // their user's tenant. This one-time backfill closes the cross-tenant hole for
  // legacy documents without inventing a second organization.
  const taskOrganizations = new Map(
    (await find('tasks')).map((task) => [task.id, organizationOf(task)])
  );
  const userOrganizations = new Map(
    (await find('users')).map((user) => [user.id, organizationOf(user)])
  );
  for (const collection of ['comments', 'attachments', 'taskAssignments']) {
    const rows = await find(collection);
    for (const row of rows) {
      if (Object.hasOwn(row, 'organizationId')) continue;
      await store.update(collection, row.id, {
        organizationId: taskOrganizations.get(row.taskId) ?? DEFAULT_ORGANIZATION_ID,
      });
    }
  }
  for (const collection of ['notifications', 'activity']) {
    const rows = await find(collection);
    for (const row of rows) {
      if (Object.hasOwn(row, 'organizationId')) continue;
      await store.update(collection, row.id, {
        organizationId:
          userOrganizations.get(row.userId ?? row.actorId) ?? DEFAULT_ORGANIZATION_ID,
      });
    }
  }
}
