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

  const existingApps = await find('apps');
  const known = new Set(existingApps.map((a) => a.id));
  for (const app of DEFAULT_APPS) {
    if (!known.has(app.id)) await create('apps', { ...app, enabled: true, builtin: true });
  }

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
 * The document store intentionally has no rigid SQL schema, so boot migrations
 * fill only missing fields and translate known legacy stage ids. They are
 * idempotent and safe to run on every deploy.
 */
async function migrateOrganisationAndTasks(store) {
  const people = await find('users');
  for (const person of people) {
    const patch = {};
    if (!Object.hasOwn(person, 'subteam')) patch.subteam = null;
    if (!Object.hasOwn(person, 'jobRole')) patch.jobRole = null;
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
    if (!task.department) patch.department = department;
    const stage = normaliseStageId(department, task.stage);
    if (stage !== task.stage) patch.stage = stage;
    if (!Object.hasOwn(task, 'subteam')) patch.subteam = null;
    if (!Object.hasOwn(task, 'taskDate')) patch.taskDate = task.createdAt?.slice(0, 10) ?? today;
    if (!Object.hasOwn(task, 'notes')) patch.notes = '';
    if (!Object.hasOwn(task, 'score')) patch.score = null;
    if (!Object.hasOwn(task, 'scoreBy')) patch.scoreBy = null;
    if (!Object.hasOwn(task, 'scoredAt')) patch.scoredAt = null;
    const closed = isDoneStage(department, stage);
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
    if (!Object.hasOwn(task, 'startedAt')) patch.startedAt = null;
    if (!Object.hasOwn(task, 'submittedAt')) patch.submittedAt = null;
    if (!Object.hasOwn(task, 'submittedBy')) patch.submittedBy = null;
    if (!Object.hasOwn(task, 'submissionNote')) patch.submissionNote = '';
    if (!Object.hasOwn(task, 'reviewNote')) patch.reviewNote = '';
    if (!Object.hasOwn(task, 'reworkCount')) patch.reworkCount = 0;
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
}
