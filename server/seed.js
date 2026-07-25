/**
 * First-boot seed: the app registry and the first administrator.
 *
 * Runs on every start but only fills gaps — editing a tile in the UI is never
 * undone by a redeploy, and a new default app added here shows up for everyone.
 */

import crypto from 'node:crypto';
import { create, find, getStore } from './store.js';
import { hashPassword } from './auth.js';

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

  return store;
}
