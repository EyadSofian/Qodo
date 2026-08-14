import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 41_000 + Math.floor(Math.random() * 2_000);
const ORIGIN = `http://127.0.0.1:${PORT}`;

let dataDirectory;
let server;
let adminCookie;
let managerCookie;
let memberCookie;
let salesCookie;
let manager;
let member;
let sales;

before(async () => {
  dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'qodo-mail-test-'));
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATA_DIR: dataDirectory,
      PORT: String(PORT),
      ADMIN_EMAIL: 'admin@test.local',
      ADMIN_PASSWORD: 'AdminPass123!',
      SESSION_SECRET: 'mail-test-session-secret-123456789012',
      SSO_SECRET: 'mail-test-sso-secret-123456789012345',
      OPENAI_API_KEY: '',
      GOOGLE_CLIENT_ID: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let errors = '';
  server.stderr.on('data', (chunk) => {
    errors += chunk.toString();
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`${ORIGIN}/api/health`)).ok) return;
    } catch {
      // still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Mail test server did not start.\n${errors}`);
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
    cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null,
  };
}

async function login(email, password) {
  const result = await request('/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.cookie;
}

async function createUser(body) {
  const result = await request('/users', { method: 'POST', body, cookie: adminCookie });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data.user;
}

async function upload(conversationId, cookie, name = 'brief.pdf') {
  const response = await fetch(
    `${ORIGIN}/api/mail/conversations/${encodeURIComponent(conversationId)}/files`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-File-Name': encodeURIComponent(name),
        'X-File-Type': 'application/pdf',
        Cookie: cookie,
      },
      body: Buffer.from('mail attachment'),
    }
  );
  return { status: response.status, data: await response.json().catch(() => null) };
}

test('default channels follow department visibility and Google login stays optional', async () => {
  adminCookie = await login('admin@test.local', 'AdminPass123!');
  manager = await createUser({
    name: 'Marketing Manager',
    email: 'manager@gmail.com',
    password: 'Manager123!',
    role: 'manager',
    department: 'marketing',
  });
  member = await createUser({
    name: 'Marketing Member',
    email: 'member@gmail.com',
    password: 'Member123!',
    role: 'member',
    department: 'marketing',
    subteam: 'creative',
  });
  sales = await createUser({
    name: 'Sales Member',
    email: 'sales@gmail.com',
    password: 'Sales123!',
    role: 'member',
    department: 'sales',
  });

  managerCookie = await login(manager.email, 'Manager123!');
  memberCookie = await login(member.email, 'Member123!');
  salesCookie = await login(sales.email, 'Sales123!');

  const config = await request('/auth/google/config');
  assert.deepEqual(config.data, { enabled: false, clientId: null });

  const marketing = await request('/mail/bootstrap', { cookie: memberCookie });
  assert.equal(marketing.status, 200, JSON.stringify(marketing.data));
  assert.ok(marketing.data.conversations.some((row) => row.id.endsWith(':announcements')));
  assert.ok(marketing.data.conversations.some((row) => row.department === 'marketing'));
  assert.equal(marketing.data.conversations.some((row) => row.department === 'sales'), false);
  assert.equal(marketing.data.people.find((person) => person.id === member.id)?.subteam, 'creative');

  const admin = await request('/mail/bootstrap', { cookie: adminCookie });
  assert.ok(admin.data.conversations.some((row) => row.department === 'marketing'));
  assert.ok(admin.data.conversations.some((row) => row.department === 'sales'));
});

test('direct conversations are private and read state is per recipient', async () => {
  const forbiddenChannel = await request('/mail/conversations', {
    method: 'POST',
    cookie: memberCookie,
    body: { kind: 'channel', name: 'Member channel', scope: 'department' },
  });
  assert.equal(forbiddenChannel.status, 403);

  const created = await request('/mail/conversations', {
    method: 'POST',
    cookie: managerCookie,
    body: { kind: 'direct', memberIds: [member.id] },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const conversationId = created.data.conversation.id;

  const sent = await request(`/mail/conversations/${conversationId}/messages`, {
    method: 'POST',
    cookie: managerCookie,
    body: { body: 'راجع خطة الحملة من فضلك' },
  });
  assert.equal(sent.status, 201, JSON.stringify(sent.data));

  const recipient = await request('/mail/bootstrap', { cookie: memberCookie });
  const inboxRow = recipient.data.conversations.find((row) => row.id === conversationId);
  assert.equal(inboxRow.unreadCount, 1);

  const intruder = await request(`/mail/conversations/${conversationId}/messages`, {
    cookie: salesCookie,
  });
  assert.equal(intruder.status, 404);

  assert.equal(
    (await request(`/mail/conversations/${conversationId}/read`, { method: 'POST', cookie: memberCookie })).status,
    200
  );
  const afterRead = await request('/mail/bootstrap', { cookie: memberCookie });
  assert.equal(afterRead.data.conversations.find((row) => row.id === conversationId).unreadCount, 0);
});

test('formal mail carries files and AI never runs without configuration', async () => {
  const created = await request('/mail/conversations', {
    method: 'POST',
    cookie: managerCookie,
    body: { kind: 'mail', memberIds: [member.id], subject: 'اعتماد خطة الربع القادم' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const conversationId = created.data.conversation.id;

  const file = await upload(conversationId, managerCookie);
  assert.equal(file.status, 201, JSON.stringify(file.data));
  const sent = await request(`/mail/conversations/${conversationId}/messages`, {
    method: 'POST',
    cookie: managerCookie,
    body: { body: 'الخطة مرفقة للمراجعة.', attachmentIds: [file.data.attachment.id] },
  });
  assert.equal(sent.status, 201, JSON.stringify(sent.data));
  assert.equal(sent.data.message.attachments.length, 1);

  const recipient = await request(`/mail/conversations/${conversationId}/messages`, {
    cookie: memberCookie,
  });
  assert.equal(recipient.status, 200);
  assert.equal(recipient.data.messages[0].attachments[0].name, 'brief.pdf');

  const intruderFile = await fetch(
    `${ORIGIN}/api/mail/conversations/${conversationId}/files/${file.data.attachment.id}`,
    { headers: { Cookie: salesCookie } }
  );
  assert.equal(intruderFile.status, 404);

  const ai = await request(`/mail/conversations/${conversationId}/ai`, {
    method: 'POST',
    cookie: memberCookie,
    body: { action: 'summary', lang: 'ar' },
  });
  assert.equal(ai.status, 503);
  assert.equal(ai.data.error, 'mail_ai_not_configured');
});

test('mail AI defaults to 20 messages and keeps structured summaries bounded', async () => {
  const { aiResponseFormat, normaliseAiMessageLimit, normaliseAiResult } = await import('./routes/mail.js');
  assert.equal(normaliseAiMessageLimit(undefined), 20);
  assert.equal(normaliseAiMessageLimit(2), 5);
  assert.equal(normaliseAiMessageLimit(40), 40);
  assert.equal(normaliseAiMessageLimit(500), 60);

  const summary = normaliseAiResult('summary', {
    headline: 'قرار إطلاق الحملة',
    text: 'تم تحديد موعد الإطلاق.',
    decisions: ['الإطلاق يوم 20 أغسطس'],
    blockers: ['اعتماد الميزانية'],
  });
  assert.deepEqual(summary, {
    headline: 'قرار إطلاق الحملة',
    text: 'تم تحديد موعد الإطلاق.',
    decisions: ['الإطلاق يوم 20 أغسطس'],
    blockers: ['اعتماد الميزانية'],
  });
  const schema = aiResponseFormat('summary').json_schema.schema;
  assert.deepEqual(schema.required, ['headline', 'text', 'decisions', 'blockers']);
  assert.equal(schema.properties.decisions.type, 'array');
  assert.equal(schema.additionalProperties, false);
});
