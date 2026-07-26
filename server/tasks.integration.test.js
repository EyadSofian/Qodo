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

test('team boundaries, performance privacy, scoring and export', async () => {
  const adminCookie = await login('admin@test.local', 'AdminPass123!');

  const manager = await create(
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
  const creative = await create(
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
      score: 88,
    },
    adminCookie
  );

  const creativeCookie = await login('creative@test.local', 'Creative123!');
  const creativeTasks = await request('/tasks', { cookie: creativeCookie });
  assert.equal(creativeTasks.status, 200);
  assert.equal(creativeTasks.data.tasks.length, 1);
  assert.equal(creativeTasks.data.tasks[0].department, 'marketing');
  assert.equal(creativeTasks.data.tasks[0].score, 88);

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

  const managerCookie = await login('manager@test.local', 'Manager123!');
  const managerTasks = await request('/tasks', { cookie: managerCookie });
  assert.equal(managerTasks.data.tasks.length, 1);
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

  const salesCookie = await login('sales@test.local', 'SalesPass123!');
  const salesTasks = await request('/tasks', { cookie: salesCookie });
  assert.equal(salesTasks.data.tasks.length, 0);

  // A score on somebody else's task is not exposed to a regular teammate.
  const managerTask = await create(
    '/tasks',
    {
      title: 'Performance report',
      department: 'marketing',
      subteam: 'performance',
      stage: 'done',
      assigneeId: manager.user.id,
      dueDate: '2099-07-26',
      score: 94,
    },
    adminCookie
  );
  assert.equal(managerTask.task.score, 94);
  assert.ok(managerTask.task.completedAt);
  const managerOverviewAfterDone = await request('/tasks/overview?department=marketing', {
    cookie: managerCookie,
  });
  const managerPerformance = managerOverviewAfterDone.data.people.find(
    (person) => person.user.id === manager.user.id
  );
  assert.equal(managerPerformance.onTimeRate, 100);
  const creativeAfter = await request('/tasks', { cookie: creativeCookie });
  const colleagueTask = creativeAfter.data.tasks.find((item) => item.title === 'Performance report');
  assert.equal(colleagueTask.score, null);
});
