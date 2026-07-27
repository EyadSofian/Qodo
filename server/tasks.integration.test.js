import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 32_000 + Math.floor(Math.random() * 4_000);
const ORIGIN = `http://127.0.0.1:${PORT}`;

let dataDirectory;
let server;

before(async () => {
  dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'engosoft-task-test-'));
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATA_DIR: dataDirectory,
      PORT: String(PORT),
      ADMIN_EMAIL: 'admin@test.local',
      ADMIN_PASSWORD: 'AdminPass123!',
      SESSION_SECRET: 'test-session-secret-123456789012345',
      SSO_SECRET: 'test-sso-secret-123456789012345678',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let errorOutput = '';
  server.stderr.on('data', (chunk) => {
    errorOutput += chunk.toString();
  });

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${ORIGIN}/api/health`);
      if (response.ok) return;
    } catch {
      // The child is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Test server did not start.\n${errorOutput}`);
});

after(async () => {
  if (server && !server.killed) server.kill();
  if (dataDirectory?.startsWith(os.tmpdir())) {
    await fs.rm(dataDirectory, { recursive: true, force: true });
  }
});

async function request(pathname, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(`${ORIGIN}/api${pathname}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return {
    status: response.status,
    data,
    text,
    cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null,
  };
}

/** Deliverables go up as raw bytes, so they need their own helper. */
async function upload(taskId, { name, type = 'application/pdf', bytes = 'demo' }, cookie) {
  const response = await fetch(`${ORIGIN}/api/tasks/${taskId}/attachments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(name),
      'X-File-Type': type,
      Cookie: cookie,
    },
    body: Buffer.from(bytes),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

async function login(email, password) {
  const response = await request('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  assert.equal(response.status, 200);
  assert.ok(response.cookie);
  return response.cookie;
}

async function create(pathname, body, cookie) {
  const response = await request(pathname, { method: 'POST', body, cookie });
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return response.data;
}

let manager;
let creative;
let managerCookie;
let creativeCookie;
let adminCookie;

test('team boundaries, performance privacy and export', async () => {
  adminCookie = await login('admin@test.local', 'AdminPass123!');

  manager = await create(
    '/users',
    {
      name: 'Marketing Manager',
      email: 'manager@test.local',
      password: 'Manager123!',
      role: 'manager',
      department: 'marketing',
      subteam: 'performance',
      jobRole: 'media_buyer',
    },
    adminCookie
  );
  creative = await create(
    '/users',
    {
      name: 'Creative Employee',
      email: 'creative@test.local',
      password: 'Creative123!',
      role: 'member',
      department: 'marketing',
      subteam: 'creative',
      jobRole: 'designer',
    },
    adminCookie
  );
  await create(
    '/users',
    {
      name: 'Sales Employee',
      email: 'sales@test.local',
      password: 'SalesPass123!',
      role: 'member',
      department: 'sales',
    },
    adminCookie
  );

  await create(
    '/tasks',
    {
      title: 'Launch campaign',
      description: 'Campaign assets',
      notes: 'Use approved brief',
      taskDate: '2026-07-26',
      department: 'marketing',
      subteam: 'creative',
      stage: 'working',
      assigneeId: creative.user.id,
      dueDate: '2026-07-30',
    },
    adminCookie
  );

  creativeCookie = await login('creative@test.local', 'Creative123!');
  const creativeTasks = await request('/tasks', { cookie: creativeCookie });
  assert.equal(creativeTasks.status, 200);
  assert.equal(creativeTasks.data.tasks.length, 1);
  assert.equal(creativeTasks.data.tasks[0].department, 'marketing');
  // A brand-new task carries no verdict of any kind.
  assert.equal(creativeTasks.data.tasks[0].score, null);
  assert.equal(creativeTasks.data.tasks[0].reviewDecision, null);
  assert.equal(creativeTasks.data.tasks[0].attachmentCount, 0);

  const creativeDirectory = await request('/auth/directory', { cookie: creativeCookie });
  assert.ok(creativeDirectory.data.users.every((person) => person.department === 'marketing'));

  const creativeOverview = await request('/tasks/overview?department=marketing', {
    cookie: creativeCookie,
  });
  assert.equal(creativeOverview.data.scope, 'self');
  assert.equal(creativeOverview.data.people.length, 1);
  assert.equal(creativeOverview.data.people[0].user.id, creative.user.id);

  const crossTeam = await request('/tasks', {
    method: 'POST',
    cookie: creativeCookie,
    body: { title: 'Should fail', department: 'sales', stage: 'lead' },
  });
  assert.equal(crossTeam.status, 403);

  managerCookie = await login('manager@test.local', 'Manager123!');
  const managerOverview = await request('/tasks/overview?department=marketing', {
    cookie: managerCookie,
  });
  assert.equal(managerOverview.data.scope, 'team');
  assert.equal(managerOverview.data.people.length, 2);

  const exported = await request('/tasks/export.csv?lang=en&department=marketing', {
    cookie: managerCookie,
  });
  assert.equal(exported.status, 200);
  assert.match(exported.text, /Launch campaign/);
  assert.match(exported.text, /Times returned/);

  const salesCookie = await login('sales@test.local', 'SalesPass123!');
  const salesTasks = await request('/tasks', { cookie: salesCookie });
  assert.equal(salesTasks.data.tasks.length, 0);
});

test('a score cannot be set before the work has been reviewed', async () => {
  const atCreation = await request('/tasks', {
    method: 'POST',
    cookie: adminCookie,
    body: { title: 'Scored too early', department: 'marketing', stage: 'working', score: 90 },
  });
  assert.equal(atCreation.status, 400);
  assert.equal(atCreation.data.error, 'score_before_review');

  const task = await create(
    '/tasks',
    { title: 'Not delivered yet', department: 'marketing', stage: 'working' },
    managerCookie
  );
  const onOpenTask = await request(`/tasks/${task.task.id}`, {
    method: 'PATCH',
    cookie: managerCookie,
    body: { score: 90 },
  });
  assert.equal(onOpenTask.status, 400);
  assert.equal(onOpenTask.data.error, 'score_before_review');
});

test('the board cannot be dragged past either gate', async () => {
  const { task } = await create(
    '/tasks',
    {
      title: 'Gate test',
      department: 'marketing',
      stage: 'working',
      assigneeId: creative.user.id,
    },
    managerCookie
  );

  // Employee drags it to "done": that is an approval, and not theirs to make.
  const employeeToDone = await request(`/tasks/${task.id}`, {
    method: 'PATCH',
    cookie: creativeCookie,
    body: { stage: 'done' },
  });
  assert.equal(employeeToDone.status, 409);
  assert.equal(employeeToDone.data.error, 'review_required');

  // A manager cannot skip the score either — approving is an action, not a field.
  const managerToDone = await request(`/tasks/${task.id}`, {
    method: 'PATCH',
    cookie: managerCookie,
    body: { stage: 'done' },
  });
  assert.equal(managerToDone.status, 409);
  assert.equal(managerToDone.data.error, 'review_required');

  // And dropping onto the review column is a submission, with what that requires.
  const straightToReview = await request(`/tasks/${task.id}`, {
    method: 'PATCH',
    cookie: creativeCookie,
    body: { stage: 'review' },
  });
  assert.equal(straightToReview.status, 409);
  assert.equal(straightToReview.data.error, 'submit_required');

  // Moving between the open and active columns stays an ordinary drag.
  const ordinaryMove = await request(`/tasks/${task.id}`, {
    method: 'PATCH',
    cookie: creativeCookie,
    body: { stage: 'pending' },
  });
  assert.equal(ordinaryMove.status, 200);
  assert.equal(ordinaryMove.data.task.stage, 'pending');
});

test('assign → deliver → review → approve, including the rework loop', async () => {
  const { task } = await create(
    '/tasks',
    {
      title: 'Ramadan key visual',
      description: 'Three sizes, brand colours',
      department: 'marketing',
      subteam: 'creative',
      stage: 'pending',
      assigneeId: creative.user.id,
      dueDate: '2099-01-01',
    },
    managerCookie
  );

  const started = await request(`/tasks/${task.id}/start`, {
    method: 'POST',
    cookie: creativeCookie,
  });
  assert.equal(started.status, 200);
  assert.equal(started.data.task.stage, 'working');
  assert.ok(started.data.task.startedAt);

  // Handing in with nothing attached is the case the whole gate exists for.
  const empty = await request(`/tasks/${task.id}/submit`, {
    method: 'POST',
    cookie: creativeCookie,
    body: { note: 'done' },
  });
  assert.equal(empty.status, 400);
  assert.equal(empty.data.error, 'deliverable_required');

  const uploaded = await upload(task.id, { name: 'كي فيجوال.pdf' }, creativeCookie);
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data));
  assert.equal(uploaded.data.attachmentCount, 1);
  assert.equal(uploaded.data.attachment.name, 'كي فيجوال.pdf');

  const submitted = await request(`/tasks/${task.id}/submit`, {
    method: 'POST',
    cookie: creativeCookie,
    body: { note: 'الثلاث مقاسات جاهزة' },
  });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.data.task.stage, 'review');
  assert.ok(submitted.data.task.submittedAt);
  assert.equal(submitted.data.task.submittedBy, creative.user.id);

  // The employee cannot review their own submission into approval.
  const selfApprove = await request(`/tasks/${task.id}/review`, {
    method: 'POST',
    cookie: creativeCookie,
    body: { decision: 'approved', score: 100 },
  });
  assert.equal(selfApprove.status, 403);

  // Sending it back without saying why helps nobody, so it is refused.
  const silentReturn = await request(`/tasks/${task.id}/review`, {
    method: 'POST',
    cookie: managerCookie,
    body: { decision: 'changes_requested' },
  });
  assert.equal(silentReturn.status, 400);
  assert.equal(silentReturn.data.error, 'review_note_required');

  const returned = await request(`/tasks/${task.id}/review`, {
    method: 'POST',
    cookie: managerCookie,
    body: { decision: 'changes_requested', note: 'اللوجو صغير في مقاس الستوري' },
  });
  assert.equal(returned.status, 200);
  // Marketing names this column itself, so returned work lands there.
  assert.equal(returned.data.task.stage, 'rework');
  assert.equal(returned.data.task.reworkCount, 1);
  assert.equal(returned.data.task.submittedAt, null);
  assert.equal(returned.data.task.score, null);

  const resubmitted = await request(`/tasks/${task.id}/submit`, {
    method: 'POST',
    cookie: creativeCookie,
    body: { note: 'كبّرت اللوجو' },
  });
  assert.equal(resubmitted.status, 200);
  assert.equal(resubmitted.data.task.reviewDecision, null);

  const badScore = await request(`/tasks/${task.id}/review`, {
    method: 'POST',
    cookie: managerCookie,
    body: { decision: 'approved', score: 140 },
  });
  assert.equal(badScore.status, 400);
  assert.equal(badScore.data.error, 'invalid_score');

  const approved = await request(`/tasks/${task.id}/review`, {
    method: 'POST',
    cookie: managerCookie,
    body: { decision: 'approved', score: 88, note: 'تمام بعد التعديل' },
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.data.task.stage, 'done');
  assert.equal(approved.data.task.score, 88);
  assert.equal(approved.data.task.reviewedBy, manager.user.id);
  assert.equal(approved.data.task.reviewDecision, 'approved');
  assert.ok(approved.data.task.completedAt);

  // The assignee sees their own score and the feedback written for them.
  const mine = await request('/tasks', { cookie: creativeCookie });
  const own = mine.data.tasks.find((item) => item.id === task.id);
  assert.equal(own.score, 88);
  assert.equal(own.reviewNote, 'تمام بعد التعديل');

  // A teammate on the same board sees the task, but not the verdict on it.
  const colleague = await create(
    '/users',
    {
      name: 'Other Designer',
      email: 'other@test.local',
      password: 'Other123!',
      role: 'member',
      department: 'marketing',
      subteam: 'creative',
    },
    adminCookie
  );
  assert.ok(colleague.user.id);
  const colleagueCookie = await login('other@test.local', 'Other123!');
  const theirs = await request('/tasks', { cookie: colleagueCookie });
  const seen = theirs.data.tasks.find((item) => item.id === task.id);
  assert.equal(seen.score, null);
  assert.equal(seen.reviewNote, '');

  // The deliverable itself is downloadable, with its Arabic name intact.
  const files = await request(`/tasks/${task.id}/attachments`, { cookie: managerCookie });
  assert.equal(files.data.attachments.length, 1);
  const download = await fetch(
    `${ORIGIN}/api/tasks/${task.id}/attachments/${files.data.attachments[0].id}`,
    { headers: { Cookie: managerCookie } }
  );
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /filename\*=UTF-8''/);
  assert.equal(await download.text(), 'demo');
});

test('the overview counts rework, queue depth and first-pass approvals', async () => {
  const overview = await request('/tasks/overview?department=marketing', { cookie: managerCookie });
  assert.equal(overview.status, 200);
  const row = overview.data.people.find((person) => person.user.id === creative.user.id);

  assert.equal(row.completed, 1);
  assert.equal(row.returned, 1);
  // The one approved task went back once, so nothing was approved first time.
  assert.equal(row.firstPassRate, 0);
  assert.equal(row.averageScore, 88);
  assert.equal(row.onTimeRate, 100);
  assert.equal(typeof overview.data.summary.awaitingReview, 'number');
});
