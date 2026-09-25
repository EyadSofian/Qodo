import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ORG = 'org-recruitment-clock';

const job = (id, title) => ({
  id,
  organizationId: ORG,
  reference: id.toUpperCase(),
  source: 'qodo',
  status: 'hiring',
  title,
  department: 'Sales',
  departmentId: 'sales',
  location: 'EG',
  locationCode: 'EG',
  headcount: 1,
  accepted: 0,
  priority: 'critical',
  classification: 'agent',
  recruiterCode: null,
  supportRecruiterCodes: [],
  // Long past due, unassigned and not linked to Odoo: three alerts per job.
  sla: { startDate: '2026-01-04', targetWorkingDays: 15, originalDueDate: '2026-01-25', currentDueDate: '2026-01-25', extendedWorkingDays: 0, pausedWorkingDays: 0, pausedSince: null, completedAt: null, actualWorkingDays: null, slaMet: null },
});

test('the first clock run records what is already open without a notification burst; new alerts are pushed once', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qodo-recruitment-clock-'));
  process.env.DATA_DIR = directory;
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const { create, find } = await import('./store.js');
  const { runRecruitmentClock } = await import('./hr/recruitment/clock.js');
  const { PERMISSIONS } = await import('../shared/permissions.js');

  await create('organizations', { id: ORG, name: 'Clock test' });
  await create('users', {
    id: 'u-desk',
    organizationId: ORG,
    name: 'Recruitment Desk',
    email: 'desk@clock.test',
    role: 'member',
    status: 'active',
    department: 'hr',
    permissions: [PERMISSIONS.APPS_VIEW, PERMISSIONS.HR_RECRUITMENT_VIEW, PERMISSIONS.HR_RECRUITMENT_ASSIGN],
  });
  const deskNotes = async () => (await find('notifications', (row) => row.userId === 'u-desk')).filter((row) => String(row.type).startsWith('recruitment.alert.'));

  await create('recruitmentRequests', job('rrq-known', 'Known overdue job'));
  const first = await runRecruitmentClock(ORG, { withKpiChecks: false });
  assert.equal(first.alerts, 0, 'go-live day: open problems are recorded, not pushed');
  assert.equal((await deskNotes()).length, 0);

  await create('recruitmentRequests', job('rrq-new', 'New overdue job'));
  const second = await runRecruitmentClock(ORG, { withKpiChecks: false });
  assert.ok(second.alerts >= 1, 'an alert that appears after go-live is pushed');
  const pushed = await deskNotes();
  assert.ok(pushed.length >= 1);
  assert.ok(pushed.every((row) => String(row.link).includes('rrq-new')), 'only the new job is announced');

  const third = await runRecruitmentClock(ORG, { withKpiChecks: false });
  assert.equal(third.alerts, 0, 'nothing is announced twice');
  assert.equal((await deskNotes()).length, pushed.length);
});
