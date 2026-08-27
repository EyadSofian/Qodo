/**
 * First-boot seed: the app registry and the first administrator.
 *
 * Runs on every start but only fills gaps — editing a tile in the UI is never
 * undone by a redeploy, and a new default app added here shows up for everyone.
 */

import crypto from 'node:crypto';
import { create, createIfAbsent, find, findOne, getStore } from './store.js';
import { hashPassword } from './auth.js';
import {
  DEFAULT_DEPARTMENT,
  isDoneStage,
  normaliseStageId,
} from '../shared/departments.js';
import { DEFAULT_ORGANIZATION_ID, organizationOf } from '../shared/organization.js';
import { KPI_SEED_RECORDS } from '../shared/kpiRecords.js';
import { kpiTemplateById } from '../shared/kpi.js';
import { scorecardId } from './kpi.js';
import { PERMISSIONS, permissionsFor } from '../shared/permissions.js';
import { inventoryDocuments, inventoryTally } from '../shared/officeInventory.js';
import {
  TASK_WORKFLOW_PERMISSION_VERSION,
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
    id: 'mail',
    kind: 'internal',
    nameAr: 'Qodo Mail',
    nameEn: 'Qodo Mail',
    descAr: 'الإيميل الداخلي، قنوات الأقسام، والمحادثات المباشرة في مكان واحد.',
    url: '/mail',
    icon: 'mail',
    color: '#0F766E',
    group: 'workspace',
    embed: 'internal',
    order: 4,
  },
  {
    id: 'calendar',
    kind: 'internal',
    nameAr: 'التقويم',
    nameEn: 'Qodo Calendar',
    descAr: 'الاجتماعات والمواعيد، بدعوات ورد من كل مدعو، ومربوطة بالبريد الداخلي.',
    url: '/calendar',
    icon: 'calendar',
    color: '#7C3AED',
    group: 'workspace',
    embed: 'internal',
    order: 6,
  },
  {
    id: 'offices',
    kind: 'internal',
    nameAr: 'المكاتب',
    nameEn: 'Offices',
    descAr: 'مخطط الجلوس: مين قاعد فين، وإيه الوحدات الفاضية في كل مكتب.',
    url: '/offices',
    icon: 'grid',
    color: '#0EA5A5',
    group: 'workspace',
    embed: 'internal',
    order: 7,
  },
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
    kind: 'internal',
    nameAr: 'الموارد البشرية',
    nameEn: 'HR Suite',
    descAr: 'ملف موحّد لكل موظف، الرواتب والتأمينات، التوظيف، والهيكل التنظيمي.',
    url: '/hr',
    repo: null,
    icon: 'people',
    color: '#0EA5A5',
    group: 'people',
    embed: 'internal',
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
  await migrateBuiltinApps(store);
  await seedKPIScorecards();

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

  await seedOfficeInventory();
  await migrateOrganisationAndTasks(store);
  return store;
}

/** Marks the inventory as delivered, so a redeploy is not a second delivery. */
const OFFICE_SEED_KEY = 'offices.inventorySeeded';

/**
 * Hand over the office inventory, once.
 *
 * Unlike `DEFAULT_APPS` above, this is not configuration that should be topped
 * up on every boot. It is a snapshot of a building, and the whole point of the
 * module is that somebody corrects it: a room deleted on Monday must not
 * reappear on Wednesday's deploy, and a desk removed must stay removed. So the
 * delivery is recorded in `settings` and never repeated.
 *
 * The rooms arrive unmeasured, unshaped and unplaced on purpose. Those are the
 * three things only somebody standing in the building can answer, and guessing
 * them would mean whoever knows the floor starts by undoing a guess.
 */
async function seedOfficeInventory() {
  if (await findOne('settings', (row) => row.id === OFFICE_SEED_KEY)) return;

  // An installation that already has rooms — one where the import script was
  // run by hand — is not a fresh one. Record the delivery and leave it alone.
  const existing = await find('offices');
  if (existing.length > 0) {
    await create('settings', { id: OFFICE_SEED_KEY, value: 'pre-existing' });
    return;
  }

  const { offices, seats } = inventoryDocuments(DEFAULT_ORGANIZATION_ID);
  for (const office of offices) await createIfAbsent('offices', office);
  for (const seat of seats) await createIfAbsent('officeSeats', seat);
  await create('settings', { id: OFFICE_SEED_KEY, value: new Date().toISOString() });

  const tally = inventoryTally();
  const line = '─'.repeat(58);
  console.log(`\n${line}\n  Office inventory delivered — ${tally.rooms} rooms, ${tally.units} desks`);
  console.log(`  ${tally.named} named · ${tally.held} held for a joiner · ${tally.unnamed} counted but unnamed`);
  console.log('  Rooms arrive unmeasured; measure and arrange them from Offices → Edit.');
  console.log(`${line}\n`);
}

/**
 * Built-in ids and routes stay stable because user access lists store those ids.
 * Only the labels presented outside the modules change. This migration runs on
 * existing installations too; editing DEFAULT_APPS alone would affect first
 * boot only and production would keep the old names forever.
 */
async function migrateBuiltinApps(store) {
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
    hr: {
      kind: 'internal',
      nameAr: 'الموارد البشرية',
      nameEn: 'HR Suite',
      descAr: 'ملف موحّد لكل موظف، الرواتب والتأمينات، التوظيف، والهيكل التنظيمي.',
      url: '/hr',
      repo: null,
      embed: 'internal',
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

    // Seed the two current desks once, including the new reset permission. From
    // then on the explicit permission array is owned entirely by the Users UI;
    // a restart must never restore a box an administrator deliberately unticked.
    if ((person.taskWorkflowPermissionVersion ?? 0) < TASK_WORKFLOW_PERMISSION_VERSION) {
      if (workflowRoles.includes(TASK_WORKFLOW_ROLES.MARKETING_REVIEWER)) {
        const access = [
          PERMISSIONS.APPS_VIEW,
          PERMISSIONS.TASKS_VIEW,
          PERMISSIONS.TASKS_VIEW_TEAM,
          PERMISSIONS.TASKS_REVIEW,
          PERMISSIONS.TASKS_APPROVE,
          PERMISSIONS.TASKS_SCORE,
          PERMISSIONS.TASKS_RESET_PENDING,
        ];
        patch.permissions = [...new Set([...permissionsFor(person), ...access])].filter(
          (permission) => permission !== PERMISSIONS.TASKS_PUBLISH
        );
        patch.visibilityScope = 'department';
      }
      if (workflowRoles.includes(TASK_WORKFLOW_ROLES.MARKETING_FINAL_APPROVER)) {
        const access = [
          PERMISSIONS.APPS_VIEW,
          PERMISSIONS.TASKS_VIEW,
          PERMISSIONS.TASKS_VIEW_TEAM,
          PERMISSIONS.TASKS_PUBLISH,
          PERMISSIONS.TASKS_SCORE,
          PERMISSIONS.TASKS_RESET_PENDING,
        ];
        patch.permissions = [
          ...new Set([...(patch.permissions ?? permissionsFor(person)), ...access]),
        ];
        patch.visibilityScope = 'department';
      }
      patch.taskWorkflowPermissionVersion = TASK_WORKFLOW_PERMISSION_VERSION;
    }
    if (Object.keys(patch).length) await store.update('users', person.id, patch);
  }

  const today = new Date().toISOString().slice(0, 10);
  const attachments = await find('attachments');
  const filesPerTask = new Map();
  for (const file of attachments) {
    filesPerTask.set(file.taskId, (filesPerTask.get(file.taskId) ?? 0) + 1);
  }

  /*
   * The first hand-in of every task, read back out of the audit log.
   *
   * `submittedAt` is cleared by every send-back, so on a task that came back
   * even once the stored row can no longer say when the work was first
   * delivered — and that date is the one punctuality was ever about. The
   * activity log kept it all along: `task.submit` is written on every hand-in
   * and never edited, so the earliest one per task is the original delivery.
   *
   * Loaded on demand, and once. `find` has no server-side filter — it reads a
   * whole collection into memory — and activity is the largest table here and
   * the fastest growing. Every boot after the backfill has nothing to ask it.
   */
  let firstSubmits = null;
  const firstSubmitFor = async (taskId) => {
    if (!firstSubmits) {
      firstSubmits = new Map();
      for (const row of await find('activity', (entry) => entry.action === 'task.submit')) {
        const known = firstSubmits.get(row.subjectId);
        if (row.createdAt && (!known || row.createdAt < known)) {
          firstSubmits.set(row.subjectId, row.createdAt);
        }
      }
    }
    return firstSubmits.get(taskId) ?? null;
  };

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
    if (!Object.hasOwn(task, 'firstSubmittedAt')) {
      /*
       * Recorded evidence only: the log, or the hand-in the row still carries.
       * A task with neither stays null rather than being handed its completion
       * date — the read path falls back on its own, and a guess written into
       * the column would be indistinguishable from a date somebody delivered on.
       */
      patch.firstSubmittedAt = (await firstSubmitFor(task.id)) ?? task.submittedAt ?? null;
    }
    if (!Object.hasOwn(task, 'startedAtInferred')) {
      /*
       * The fingerprint of an invented start: the hand-in used to write
       * `startedAt = submittedAt` — to the millisecond — for work nobody ever
       * pressed start on. The current hand-in identifies most of them; the
       * logged first one identifies those a send-back has since cleared.
       *
       * Anything else counts as a real start. A task whose log has been pruned
       * must not be read as evidence that nothing happened.
       */
      const handIn = task.submittedAt ?? (await firstSubmitFor(task.id));
      patch.startedAtInferred = Boolean(task.startedAt && handIn && task.startedAt === handIn);
    }
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

/**
 * File the July 2026 scorecards the approved workbooks already carry.
 *
 * `createIfAbsent` on a deterministic id makes this a gap-fill, never an
 * overwrite: once a scorecard exists it belongs to whoever has been editing
 * it, and a redeploy must not push a workbook's figures back over their work.
 *
 * The subjects are `record` — the name as the workbook wrote it. Nothing is
 * invented about who they are, and an administrator can create the same month
 * against a real account whenever those people have one.
 */
async function seedKPIScorecards() {
  for (const record of KPI_SEED_RECORDS) {
    if (!kpiTemplateById(record.templateId)) continue;
    const id = scorecardId(
      DEFAULT_ORGANIZATION_ID,
      record.templateId,
      'record',
      record.subjectName,
      record.period
    );
    await createIfAbsent('kpiScorecards', {
      id,
      organizationId: DEFAULT_ORGANIZATION_ID,
      templateId: record.templateId,
      period: record.period,
      subjectType: 'record',
      subjectId: record.subjectName,
      subjectName: record.subjectName,
      values: record.values,
      checks: record.checks,
      incentives: record.incentives ?? {},
      notes: '',
      status: 'draft',
      origin: 'workbook',
      createdBy: null,
      updatedBy: null,
    });
  }
}
