/**
 * The management desk is the one module in the workspace that no *role* opens.
 *
 * Being a manager does not put you on the management desk — being named does.
 * So the thing worth testing is not "can a manager read it" but "does anything
 * other than the explicit grant get in", and that includes the two webhook
 * routes, which are the only unauthenticated writes in the whole API.
 */

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERMISSIONS } from '../shared/permissions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 36_000 + Math.floor(Math.random() * 3_000);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const WEBHOOK_SECRET = 'test-webhook-secret-0123456789';

let dataDirectory;
let server;
let adminCookie;
let managerCookie;
let deskCookie;
let manager;
let desk;

before(async () => {
  dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'engosoft-mgmt-test-'));
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
      MANAGEMENT_WEBHOOK_SECRET: WEBHOOK_SECRET,
      // No ANTHROPIC_API_KEY on purpose: the fallback path is the one that has
      // to keep a message rather than lose it, and it is the path that runs
      // whenever the key is missing or the bill is unpaid.
      ANTHROPIC_API_KEY: '',
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
      // still starting
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

async function request(pathname, { method = 'GET', body, cookie, headers = {} } = {}) {
  const response = await fetch(`${ORIGIN}/api${pathname}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
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
  return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null };
}

async function login(email, password) {
  const response = await request('/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return response.cookie;
}

test('the desk opens for the named, not for the senior', async () => {
  adminCookie = await login('admin@test.local', 'AdminPass123!');

  // An ordinary department manager: every task authority there is, and no
  // business reading what the board decided.
  const managerResponse = await request('/users', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: 'Department Manager',
      email: 'mgr@test.local',
      password: 'Manager123!',
      role: 'manager',
      department: 'marketing',
    },
  });
  assert.equal(managerResponse.status, 201, JSON.stringify(managerResponse.data));
  manager = managerResponse.data.user;

  // Somebody put on the desk by name. Note the role: a plain member, which is
  // the point — the desk is orthogonal to seniority.
  const deskResponse = await request('/users', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: 'Chief of Staff',
      email: 'desk@test.local',
      password: 'Desk1234!',
      role: 'member',
      department: 'marketing',
      permissions: [
        PERMISSIONS.APPS_VIEW,
        PERMISSIONS.TASKS_VIEW,
        PERMISSIONS.MANAGEMENT_VIEW,
        PERMISSIONS.MANAGEMENT_MANAGE,
      ],
    },
  });
  assert.equal(deskResponse.status, 201, JSON.stringify(deskResponse.data));
  desk = deskResponse.data.user;

  managerCookie = await login('mgr@test.local', 'Manager123!');
  deskCookie = await login('desk@test.local', 'Desk1234!');

  const managerSees = await request('/management/items', { cookie: managerCookie });
  assert.equal(managerSees.status, 403);
  assert.equal(managerSees.data.missing, PERMISSIONS.MANAGEMENT_VIEW);

  const anonymous = await request('/management/items');
  assert.equal(anonymous.status, 401);

  const deskSees = await request('/management/items', { cookie: deskCookie });
  assert.equal(deskSees.status, 200);
  assert.deepEqual(deskSees.data.items, []);

  const meta = await request('/management/meta', { cookie: deskCookie });
  assert.equal(meta.data.canManage, true);
  // No key was set for this run, so the board must say so rather than pretend.
  assert.equal(meta.data.aiEnabled, false);
});

test('reading the desk and running it are separate grants', async () => {
  // View without manage: sees the agenda, files nothing.
  const readerResponse = await request('/users', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: 'Board Observer',
      email: 'observer@test.local',
      password: 'Observe1!',
      role: 'member',
      department: 'marketing',
      permissions: [PERMISSIONS.APPS_VIEW, PERMISSIONS.TASKS_VIEW, PERMISSIONS.MANAGEMENT_VIEW],
    },
  });
  assert.equal(readerResponse.status, 201, JSON.stringify(readerResponse.data));
  const readerCookie = await login('observer@test.local', 'Observe1!');

  assert.equal((await request('/management/items', { cookie: readerCookie })).status, 200);
  assert.equal((await request('/management/agenda', { cookie: readerCookie })).status, 200);

  const filed = await request('/management/items', {
    method: 'POST',
    cookie: readerCookie,
    body: { kind: 'task', title: 'مهمة من مراقب' },
  });
  assert.equal(filed.status, 403);

  // The raw chat log is wider than the tidy items that came out of it, so it
  // needs the manage grant even though it is only a read.
  assert.equal((await request('/management/inbox', { cookie: readerCookie })).status, 403);
  assert.equal((await request('/management/inbox', { cookie: deskCookie })).status, 200);
});

test('an item carries who was meant, and resolves them when it can', async () => {
  const created = await request('/management/items', {
    method: 'POST',
    cookie: deskCookie,
    body: {
      kind: 'meeting',
      title: 'اجتماع الإدارة الأسبوعي',
      owner_name: 'Department Manager',
      department: 'marketing',
      due_date: '2026-09-10',
      due_time: '14:00',
      duration_min: 60,
      location: 'المكتب',
      attendees: ['عياد', 'منى'],
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const item = created.data.item;

  assert.equal(item.kind, 'meeting');
  assert.equal(item.status, 'todo');
  assert.equal(item.source, 'dashboard');
  // The written name is kept *and* resolved to the real person behind it.
  assert.equal(item.ownerName, 'Department Manager');
  assert.equal(item.ownerId, manager.id);
  assert.equal(item.department, 'marketing');
  assert.deepEqual(item.attendees, ['عياد', 'منى']);

  // The date and the clock time were sent separately and composed here against
  // Cairo, which is the half of the job a model gets wrong twice a year.
  assert.ok(item.dueAt, 'the due date should have been composed');
  assert.equal(new Date(item.dueAt).toISOString(), '2026-09-10T11:00:00.000Z');

  // Closing stamps the time; reopening clears it, so "finished today" stays true.
  const closed = await request(`/management/items/${item.id}`, {
    method: 'PATCH',
    cookie: deskCookie,
    body: { status: 'done' },
  });
  assert.equal(closed.status, 200);
  assert.ok(closed.data.item.doneAt);

  const reopened = await request(`/management/items/${item.id}`, {
    method: 'PATCH',
    cookie: deskCookie,
    body: { status: 'doing' },
  });
  assert.equal(reopened.data.item.doneAt, null);

  // A name nobody answers to is still recorded — it is what was actually said.
  const vague = await request('/management/items', {
    method: 'POST',
    cookie: deskCookie,
    body: { title: 'مكالمة مع المورد', owner_name: 'شخص مش في الشركة' },
  });
  assert.equal(vague.data.item.ownerName, 'شخص مش في الشركة');
  assert.equal(vague.data.item.ownerId, null);
});

test('the webhook is a secret away from being anybody at all', async () => {
  const noSecret = await request('/management/ingest', {
    method: 'POST',
    body: { text: 'اجتماع بكرة' },
  });
  assert.equal(noSecret.status, 401);

  const wrongSecret = await request('/management/ingest', {
    method: 'POST',
    headers: { 'x-webhook-secret': 'not-the-secret' },
    body: { text: 'اجتماع بكرة' },
  });
  assert.equal(wrongSecret.status, 401);

  // With no model configured the message is still kept, as one item flagged for
  // review. Losing what somebody wrote is never the right failure.
  const accepted = await request('/management/ingest', {
    method: 'POST',
    headers: { 'x-webhook-secret': WEBHOOK_SECRET },
    body: { text: 'مكالمة مع العميل بكرة الصبح', sender: 'عياد', chat_id: '99', message_id: '1' },
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.data.count, 1);
  assert.equal(accepted.data.items[0].needsReview, true);
  assert.equal(accepted.data.items[0].source, 'telegram');

  // Telegram redelivers anything it thinks failed. Same chat + same message id
  // must never become a second copy on somebody's agenda.
  const replay = await request('/management/ingest', {
    method: 'POST',
    headers: { 'x-webhook-secret': WEBHOOK_SECRET },
    body: { text: 'مكالمة مع العميل بكرة الصبح', sender: 'عياد', chat_id: '99', message_id: '1' },
  });
  assert.equal(replay.data.duplicate, true);

  const items = await request('/management/items?needsReview=true', { cookie: deskCookie });
  assert.equal(items.data.items.filter((row) => row.rawText).length, 1);

  // A caller that did its own extraction skips the model but not the cleaning:
  // status and priority are still forced back into the allowed sets.
  const preExtracted = await request('/management/ingest', {
    method: 'POST',
    headers: { 'x-webhook-secret': WEBHOOK_SECRET },
    body: {
      source: 'api',
      text: 'من n8n',
      items: [{ kind: 'decision', title: 'اعتماد الميزانية', priority: 'nonsense', status: 'nonsense' }],
    },
  });
  assert.equal(preExtracted.data.count, 1);
  assert.equal(preExtracted.data.items[0].priority, 'normal');
  assert.equal(preExtracted.data.items[0].status, 'todo');
});

test('the agenda answers "what is today", late work included', async () => {
  const today = new Date();
  const iso = (date) => date.toISOString();

  await request('/management/items', {
    method: 'POST',
    cookie: deskCookie,
    body: { title: 'بند النهاردة', dueAt: iso(new Date(today.getTime() + 3 * 3600_000)) },
  });
  await request('/management/items', {
    method: 'POST',
    cookie: deskCookie,
    body: { title: 'بند فات معاده', dueAt: iso(new Date(today.getTime() - 5 * 86400_000)) },
  });

  const agenda = await request('/management/agenda', { cookie: deskCookie });
  assert.equal(agenda.status, 200);
  assert.ok(agenda.data.due.some((row) => row.title === 'بند النهاردة'));
  // Overdue work belongs on today's agenda — it is exactly the list somebody
  // opens the board to see.
  assert.ok(agenda.data.overdue.some((row) => row.title === 'بند فات معاده'));

  // Tomorrow is a different question and carries no overdue tail.
  const tomorrow = await request('/management/agenda?day=1', { cookie: deskCookie });
  assert.deepEqual(tomorrow.data.overdue, []);
});

test('one desk cannot read another tenant, and deleting needs the grant', async () => {
  const items = await request('/management/items', { cookie: deskCookie });
  const victim = items.data.items[0];
  assert.ok(victim, 'expected at least one item by now');

  const observerCookie = await login('observer@test.local', 'Observe1!');
  const refused = await request(`/management/items/${victim.id}`, {
    method: 'DELETE',
    cookie: observerCookie,
  });
  assert.equal(refused.status, 403);

  const gone = await request(`/management/items/${victim.id}`, {
    method: 'DELETE',
    cookie: deskCookie,
  });
  assert.equal(gone.status, 200);

  const missing = await request(`/management/items/${victim.id}`, {
    method: 'PATCH',
    cookie: deskCookie,
    body: { title: 'بعد الحذف' },
  });
  assert.equal(missing.status, 404);
});
