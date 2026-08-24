import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HR_PERIODIC_TASKS, hrTaskById } from '../shared/hrPeriodicTasks.js';
import {
  hrAutomationSummary,
  hrOccurrenceForDate,
  hrScheduleForTemplate,
} from '../shared/hrRecurrence.js';

const WORKING_DAYS = [0, 1, 2, 3, 4]; // Sunday through Thursday

test('calendar automation never turns event work into invented tasks', () => {
  assert.deepEqual(hrAutomationSummary(HR_PERIODIC_TASKS), { scheduled: 44, event: 7 });
  for (const id of ['hr-013', 'hr-014', 'hr-015', 'hr-024', 'hr-034', 'hr-036', 'hr-046']) {
    const template = hrTaskById(id);
    assert.equal(hrScheduleForTemplate(template).mode, 'event');
    assert.equal(hrOccurrenceForDate(template, '2026-08-24', WORKING_DAYS), null);
  }
});

test('daily work follows organization working days', () => {
  const daily = hrTaskById('hr-001');
  assert.deepEqual(hrOccurrenceForDate(daily, '2026-08-23', WORKING_DAYS), {
    key: '2026-08-23',
    taskDate: '2026-08-23',
    dueDate: '2026-08-23',
  });
  assert.equal(hrOccurrenceForDate(daily, '2026-08-21', WORKING_DAYS), null, 'Friday is off');
});

test('Thursday work opens on Sunday and keeps one recurrence key all week', () => {
  const weekly = hrTaskById('hr-008');
  const sunday = hrOccurrenceForDate(weekly, '2026-08-23', WORKING_DAYS);
  const wednesday = hrOccurrenceForDate(weekly, '2026-08-26', WORKING_DAYS);
  assert.deepEqual(sunday, {
    key: '2026-08-27',
    taskDate: '2026-08-23',
    dueDate: '2026-08-27',
  });
  assert.deepEqual(wednesday, sunday);
  assert.equal(hrOccurrenceForDate(weekly, '2026-08-30', WORKING_DAYS)?.key, '2026-09-03');
});

test('month-end reports belong to the month that closed', () => {
  const monthly = hrTaskById('hr-009');
  assert.deepEqual(hrOccurrenceForDate(monthly, '2026-08-03', WORKING_DAYS), {
    key: '2026-07',
    taskDate: '2026-08-02',
    dueDate: '2026-08-04',
  });

  const payroll = hrTaskById('hr-011');
  assert.deepEqual(hrOccurrenceForDate(payroll, '2026-08-24', WORKING_DAYS), {
    key: '2026-08',
    taskDate: '2026-08-20',
    dueDate: '2026-08-27',
  });
});

test('a generated occurrence is inserted and notified exactly once across retries', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qodo-hr-recurrence-'));
  process.env.DATA_DIR = directory;
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const storeModule = await import('./store.js');
  const operations = await import('./hrOperations.js');
  const { create, find } = storeModule;

  await create('organizations', {
    id: 'org-hr-test',
    name: 'HR Test',
    workingDays: WORKING_DAYS,
  });
  await create('users', {
    id: 'manager-hr-test',
    organizationId: 'org-hr-test',
    name: 'HR Manager',
    email: 'hr@example.test',
    role: 'manager',
    status: 'active',
    department: 'hr',
    subteam: 'hr_management',
  });
  await create('users', {
    id: 'recruiter-hr-test',
    organizationId: 'org-hr-test',
    name: 'Recruiter',
    email: 'recruiter@example.test',
    role: 'member',
    status: 'active',
    department: 'hr',
    subteam: 'recruitment',
  });
  await create('hrTaskPlans', {
    id: operations.hrPlanId('org-hr-test', 'hr-001'),
    organizationId: 'org-hr-test',
    templateId: 'hr-001',
    enabled: true,
    enabledOn: '2026-08-23',
    assigneeIds: ['recruiter-hr-test'],
    configuredBy: 'manager-hr-test',
  });

  const first = await operations.generateHROperations({
    organizationId: 'org-hr-test',
    onDate: '2026-08-23',
  });
  const retry = await operations.generateHROperations({
    organizationId: 'org-hr-test',
    onDate: '2026-08-23',
  });

  assert.equal(first.created.length, 1);
  assert.equal(retry.created.length, 0);
  assert.equal(retry.existing.length, 1);
  assert.equal((await find('tasks')).length, 1);
  assert.equal((await find('notifications')).length, 1);
  assert.equal((await find('taskAssignments')).length, 1);
  assert.equal(first.created[0].recurrenceKey, '2026-08-23');
  assert.equal(first.created[0].stage, 'ready');
  assert.deepEqual(first.created[0].assigneeIds, ['recruiter-hr-test']);
});
