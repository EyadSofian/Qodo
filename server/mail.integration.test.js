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

test('a message is deleted by the person who sent it, and takes its file with it', async () => {
  // A pair with no history, so the counts below mean only what this test did.
  const created = await request('/mail/conversations', {
    method: 'POST',
    cookie: memberCookie,
    body: { kind: 'direct', memberIds: [sales.id] },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const conversationId = created.data.conversation.id;

  const file = await upload(conversationId, memberCookie, 'draft.pdf');
  const first = await request(`/mail/conversations/${conversationId}/messages`, {
    method: 'POST',
    cookie: memberCookie,
    body: { body: 'الرسالة الأولى.' },
  });
  const second = await request(`/mail/conversations/${conversationId}/messages`, {
    method: 'POST',
    cookie: memberCookie,
    body: { body: 'أرسلتها بالغلط.', attachmentIds: [file.data.attachment.id] },
  });
  assert.equal(second.status, 201, JSON.stringify(second.data));

  const fileUrl = `${ORIGIN}/api/mail/conversations/${conversationId}/files/${file.data.attachment.id}`;
  assert.equal((await fetch(fileUrl, { headers: { Cookie: salesCookie } })).status, 200);

  // The recipient cannot delete what somebody else wrote in a private thread.
  const byRecipient = await request(
    `/mail/conversations/${conversationId}/messages/${second.data.message.id}`,
    { method: 'DELETE', cookie: salesCookie }
  );
  assert.equal(byRecipient.status, 403, JSON.stringify(byRecipient.data));

  const removed = await request(
    `/mail/conversations/${conversationId}/messages/${second.data.message.id}`,
    { method: 'DELETE', cookie: memberCookie }
  );
  assert.equal(removed.status, 200, JSON.stringify(removed.data));

  // Gone from the thread for everyone, not only for the sender.
  const thread = await request(`/mail/conversations/${conversationId}/messages`, {
    cookie: salesCookie,
  });
  assert.equal(thread.data.messages.length, 1);
  assert.equal(thread.data.messages[0].id, first.data.message.id);

  // The sidebar quote walks back to the message that is now last.
  assert.equal(removed.data.conversation.lastMessagePreview, 'الرسالة الأولى.');
  assert.equal(removed.data.conversation.lastMessageAt, first.data.message.createdAt);

  // The attachment link does not outlive the message that carried it.
  assert.equal((await fetch(fileUrl, { headers: { Cookie: salesCookie } })).status, 404);

  // Deleting twice is not a second delete.
  const again = await request(
    `/mail/conversations/${conversationId}/messages/${second.data.message.id}`,
    { method: 'DELETE', cookie: memberCookie }
  );
  assert.equal(again.status, 404);
});

test('a channel manager can retract any post, but nobody outranks a private thread', async () => {
  const channel = await request('/mail/conversations', {
    method: 'POST',
    cookie: managerCookie,
    body: { kind: 'channel', name: 'حملة الربع', scope: 'department' },
  });
  assert.equal(channel.status, 201, JSON.stringify(channel.data));
  const channelId = channel.data.conversation.id;

  const posted = await request(`/mail/conversations/${channelId}/messages`, {
    method: 'POST',
    cookie: memberCookie,
    body: { body: 'رسالة في المكان الغلط.' },
  });
  assert.equal(posted.status, 201, JSON.stringify(posted.data));

  const byManager = await request(
    `/mail/conversations/${channelId}/messages/${posted.data.message.id}`,
    { method: 'DELETE', cookie: managerCookie }
  );
  assert.equal(byManager.status, 200, JSON.stringify(byManager.data));
  assert.equal(byManager.data.conversation.lastMessageAt, null);
  assert.equal(byManager.data.conversation.lastMessagePreview, '');

  // A direct thread has no manager: the admin holds every permission in the
  // workspace and still cannot reach into a conversation of two other people.
  const direct = await request('/mail/conversations', {
    method: 'POST',
    cookie: managerCookie,
    body: { kind: 'direct', memberIds: [member.id] },
  });
  const privateMessage = await request(
    `/mail/conversations/${direct.data.conversation.id}/messages`,
    { method: 'POST', cookie: managerCookie, body: { body: 'كلام بينا.' } }
  );
  const byAdmin = await request(
    `/mail/conversations/${direct.data.conversation.id}/messages/${privateMessage.data.message.id}`,
    { method: 'DELETE', cookie: adminCookie }
  );
  assert.equal(byAdmin.status, 404, JSON.stringify(byAdmin.data));
});

test('the audit names who removed whose message, and never names a private thread', async () => {
  const channel = await request('/mail/conversations', {
    method: 'POST',
    cookie: managerCookie,
    body: { kind: 'channel', name: 'قناة التدقيق', scope: 'department' },
  });
  const channelId = channel.data.conversation.id;
  const post = await request(`/mail/conversations/${channelId}/messages`, {
    method: 'POST',
    cookie: memberCookie,
    body: { body: 'رسالة هتتشال بالإشراف.' },
  });
  await request(`/mail/conversations/${channelId}/messages/${post.data.message.id}`, {
    method: 'DELETE',
    cookie: managerCookie,
  });

  // A member's own deletion, in a thread the audit must not describe.
  const direct = await request('/mail/conversations', {
    method: 'POST',
    cookie: memberCookie,
    body: { kind: 'direct', memberIds: [sales.id] },
  });
  const own = await request(`/mail/conversations/${direct.data.conversation.id}/messages`, {
    method: 'POST',
    cookie: memberCookie,
    body: { body: 'كلام خاص.' },
  });
  await request(
    `/mail/conversations/${direct.data.conversation.id}/messages/${own.data.message.id}`,
    { method: 'DELETE', cookie: memberCookie }
  );

  // The filter is what makes deletions readable at all: sending writes an entry
  // too, so the unfiltered feed is dominated by traffic.
  const all = await request('/notifications/activity', { cookie: adminCookie });
  assert.ok(all.data.activity.some((row) => row.action === 'mail.message.send'));

  const audit = await request('/notifications/activity?action=mail.message.delete', {
    cookie: adminCookie,
  });
  assert.equal(audit.status, 200, JSON.stringify(audit.data));
  assert.ok(audit.data.activity.length >= 2);
  assert.equal(
    audit.data.activity.every((row) => row.action === 'mail.message.delete'),
    true
  );

  const moderated = audit.data.activity.find((row) => row.meta?.own === false);
  assert.ok(moderated, 'the moderation case must be recorded');
  assert.equal(moderated.meta.authorId, member.id);
  assert.equal(moderated.meta.name, 'قناة التدقيق');
  // Both sides of the pairing must be resolvable to a person, or the log is ids.
  assert.equal(audit.data.actors[moderated.actorId].name, manager.name);
  assert.equal(audit.data.actors[moderated.meta.authorId].name, member.name);

  const privateDelete = audit.data.activity.find((row) => row.meta?.kind === 'direct');
  assert.ok(privateDelete, 'the private deletion is still recorded');
  assert.equal(privateDelete.meta.own, true);
  assert.equal(privateDelete.meta.name, undefined, 'a direct thread is never named');
  assert.equal(privateDelete.meta.authorId, undefined);

  // A prefix answers for the whole module, and never leaks another one.
  const mailOnly = await request('/notifications/activity?action=mail', { cookie: adminCookie });
  assert.ok(mailOnly.data.activity.length > audit.data.activity.length);
  assert.equal(
    mailOnly.data.activity.every((row) => String(row.action).startsWith('mail.')),
    true
  );

  // The log stays behind users.view.
  const bySales = await request('/notifications/activity?action=mail.message.delete', {
    cookie: salesCookie,
  });
  assert.equal(bySales.status, 403);
});

test('a private channel gains and loses members, and the log says who did it', async () => {
  const created = await request('/mail/conversations', {
    method: 'POST',
    cookie: managerCookie,
    body: { kind: 'channel', name: 'غرفة الحملة', scope: 'private', memberIds: [member.id] },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const channelId = created.data.conversation.id;
  assert.equal(created.data.conversation.memberIds.length, 2);

  // Sales is not in it, so the channel does not exist as far as they are told.
  assert.equal((await request(`/mail/conversations/${channelId}/messages`, { cookie: salesCookie })).status, 404);

  const added = await request(`/mail/conversations/${channelId}/members`, {
    method: 'POST',
    cookie: managerCookie,
    body: { memberIds: [sales.id] },
  });
  assert.equal(added.status, 201, JSON.stringify(added.data));
  assert.equal(added.data.conversation.memberIds.includes(sales.id), true);
  assert.equal((await request(`/mail/conversations/${channelId}/messages`, { cookie: salesCookie })).status, 200);

  // The arrival is told, and starts on unread rather than silently caught up.
  const salesInbox = await request('/mail/bootstrap', { cookie: salesCookie });
  assert.ok(salesInbox.data.conversations.some((row) => row.id === channelId));
  const bell = await request('/notifications', { cookie: salesCookie });
  assert.ok(
    bell.data.notifications.some((row) => row.type === 'mail.channel.member'),
    'the new member is notified'
  );

  // A member cannot rewrite the roster.
  const bySales = await request(`/mail/conversations/${channelId}/members`, {
    method: 'POST',
    cookie: salesCookie,
    body: { memberIds: [] },
  });
  assert.equal(bySales.status, 403, JSON.stringify(bySales.data));

  // Removing the owner would strand the channel.
  const strand = await request(
    `/mail/conversations/${channelId}/members/${created.data.conversation.createdBy}`,
    { method: 'DELETE', cookie: managerCookie }
  );
  assert.equal(strand.status, 400);
  assert.equal(strand.data.error, 'channel_owner_required');

  const removed = await request(`/mail/conversations/${channelId}/members/${sales.id}`, {
    method: 'DELETE',
    cookie: managerCookie,
  });
  assert.equal(removed.status, 200, JSON.stringify(removed.data));
  assert.equal((await request(`/mail/conversations/${channelId}/messages`, { cookie: salesCookie })).status, 404);

  const audit = await request('/notifications/activity?action=mail.channel', { cookie: adminCookie });
  const addEntry = audit.data.activity.find((row) => row.action === 'mail.channel.member.add');
  const dropEntry = audit.data.activity.find((row) => row.action === 'mail.channel.member.remove');
  assert.ok(addEntry && dropEntry, 'both sides of the change are recorded');
  assert.deepEqual(addEntry.meta.memberIds, [sales.id]);
  assert.equal(addEntry.meta.name, 'غرفة الحملة');
  assert.deepEqual(dropEntry.meta.memberIds, [sales.id]);
  // Both the actor and the person moved resolve to a name.
  assert.equal(audit.data.actors[addEntry.actorId].name, manager.name);
  assert.equal(audit.data.actors[sales.id].name, sales.name);

  // The opening roster is recorded too, so the founding members have an answer.
  const createEntry = audit.data.activity.find(
    (row) => row.action === 'mail.channel.create' && row.meta?.name === 'غرفة الحملة'
  );
  assert.deepEqual(createEntry.meta.memberIds.sort(), [manager.id, member.id].sort());
});

test('a read receipt reaches the sender, and stops there', async () => {
  const created = await request('/mail/conversations', {
    method: 'POST',
    cookie: managerCookie,
    body: { kind: 'direct', memberIds: [sales.id] },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const conversationId = created.data.conversation.id;

  await request(`/mail/conversations/${conversationId}/messages`, {
    method: 'POST',
    cookie: managerCookie,
    body: { body: 'شوف الملف ده لما تفضى' },
  });

  // Sent, and nobody has opened it yet.
  const beforeRead = await request(`/mail/conversations/${conversationId}/messages`, {
    cookie: managerCookie,
  });
  assert.deepEqual(beforeRead.data.messages[0].readBy, []);

  // The recipient is told nothing about who read what: the field is the
  // sender's, and it is absent rather than empty on somebody else's message.
  const asRecipient = await request(`/mail/conversations/${conversationId}/messages`, {
    cookie: salesCookie,
  });
  assert.equal('readBy' in asRecipient.data.messages[0], false);

  await request(`/mail/conversations/${conversationId}/read`, {
    method: 'POST',
    cookie: salesCookie,
  });

  const afterRead = await request(`/mail/conversations/${conversationId}/messages`, {
    cookie: managerCookie,
  });
  assert.deepEqual(afterRead.data.messages[0].readBy, [sales.id]);

  // A message sent after that reading is not covered by it.
  await request(`/mail/conversations/${conversationId}/messages`, {
    method: 'POST',
    cookie: managerCookie,
    body: { body: 'وكمان الميعاد اتأخر' },
  });
  const latest = await request(`/mail/conversations/${conversationId}/messages`, {
    cookie: managerCookie,
  });
  assert.deepEqual(latest.data.messages.at(-1).readBy, []);
});

test('presence is whoever holds the stream open, and ends when they let go', async () => {
  const controller = new AbortController();
  const stream = await fetch(`${ORIGIN}/api/mail/stream`, {
    headers: { Cookie: salesCookie },
    signal: controller.signal,
  });
  assert.equal(stream.status, 200);
  const reader = stream.body.getReader();
  // The ready frame proves the subscription is installed, not merely routed.
  await reader.read();

  const during = await request('/mail/bootstrap', { cookie: adminCookie });
  assert.ok(during.data.online.includes(sales.id), 'the open tab is present');
  assert.equal(during.data.online.includes(member.id), false, 'a closed one is not');

  controller.abort();
  await reader.cancel().catch(() => undefined);

  let stillOnline = true;
  for (let attempt = 0; attempt < 40 && stillOnline; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const after = await request('/mail/bootstrap', { cookie: adminCookie });
    stillOnline = after.data.online.includes(sales.id);
  }
  assert.equal(stillOnline, false, 'presence ends with the connection');
});

/**
 * A mention is written into the sentence, and it is what reaches one person in
 * a room that is otherwise quiet — without becoming a way to shout into a room
 * somebody was deliberately left out of.
 */
test('a mention rings for the people in the room, and stays a reference for the ones outside', async () => {
  const channel = (await request('/mail/bootstrap', { cookie: managerCookie })).data.conversations.find(
    (row) => row.kind === 'channel' && row.department === 'marketing'
  );

  // An ordinary post in a department channel is deliberately silent, so the
  // mention below has something to be measured against.
  const beforeQuiet = (await request('/notifications', { cookie: memberCookie })).data.notifications.length;
  await request(`/mail/conversations/${channel.id}/messages`, {
    method: 'POST',
    cookie: managerCookie,
    body: { body: 'تحديث عام للقسم' },
  });
  assert.equal(
    (await request('/notifications', { cookie: memberCookie })).data.notifications.length,
    beforeQuiet
  );

  const salesBefore = (await request('/notifications', { cookie: salesCookie })).data.notifications.length;
  const sent = await request(`/mail/conversations/${channel.id}/messages`, {
    method: 'POST',
    cookie: managerCookie,
    body: { body: `@${member.name} راجع الفاتورة مع @${sales.name} لو سمحت` },
  });
  assert.equal(sent.status, 201, JSON.stringify(sent.data));

  // Both names are kept on the message: the one who can read the channel and
  // the one who cannot, because the sentence names them both.
  assert.deepEqual([...sent.data.message.mentionIds].sort(), [member.id, sales.id].sort());

  const mentioned = (await request('/notifications', { cookie: memberCookie })).data.notifications;
  assert.equal(mentioned[0].type, 'mail.mention');
  assert.match(mentioned[0].title.ar, /ذكرك/);
  assert.match(mentioned[0].title.en, /mentioned you/);

  // Sales is named but is not in a marketing channel: no bell, and no link to
  // a conversation that would refuse them anyway.
  assert.equal(
    (await request('/notifications', { cookie: salesCookie })).data.notifications.length,
    salesBefore
  );
});

test('a mention in a private chat cannot be used to reach a third person', async () => {
  const created = await request('/mail/conversations', {
    method: 'POST',
    cookie: managerCookie,
    body: { kind: 'direct', memberIds: [member.id] },
  });
  const conversationId = created.data.conversation.id;
  const salesBefore = (await request('/notifications', { cookie: salesCookie })).data.notifications.length;

  const sent = await request(`/mail/conversations/${conversationId}/messages`, {
    method: 'POST',
    cookie: managerCookie,
    body: { body: `هنسأل @${sales.name} على السعر` },
  });
  assert.equal(sent.status, 201, JSON.stringify(sent.data));
  assert.deepEqual(sent.data.message.mentionIds, [sales.id]);

  assert.equal(
    (await request('/notifications', { cookie: salesCookie })).data.notifications.length,
    salesBefore
  );
  assert.equal(
    (await request(`/mail/conversations/${conversationId}/messages`, { cookie: salesCookie })).status,
    404
  );
});

/**
 * The body is the record. A caller that hands over a list of ids without
 * writing the names gets no mention, and an address in a sentence is not one.
 */
test('a mention is what the message says, not what the request claims', async () => {
  const channel = (await request('/mail/bootstrap', { cookie: managerCookie })).data.conversations.find(
    (row) => row.kind === 'channel' && row.department === 'marketing'
  );
  const before = (await request('/notifications', { cookie: memberCookie })).data.notifications.length;

  const forged = await request(`/mail/conversations/${channel.id}/messages`, {
    method: 'POST',
    cookie: managerCookie,
    body: { body: 'من غير أي منشن', mentionIds: [member.id, sales.id] },
  });
  assert.equal(forged.status, 201, JSON.stringify(forged.data));
  assert.deepEqual(forged.data.message.mentionIds, []);
  assert.equal(
    (await request('/notifications', { cookie: memberCookie })).data.notifications.length,
    before
  );

  const address = await request(`/mail/conversations/${channel.id}/messages`, {
    method: 'POST',
    cookie: managerCookie,
    body: { body: `ابعت على billing@${member.name}.com` },
  });
  assert.deepEqual(address.data.message.mentionIds, []);
});

test('a department channel keeps its department and takes guests on top of it', async () => {
  const marketing = 'mail:engosoft:department:marketing';
  const announcements = 'mail:engosoft:announcements';
  const messages = (cookie) => request(`/mail/conversations/${marketing}/messages`, { cookie });

  // Sales is outside the department, so the channel does not exist for them.
  assert.equal((await messages(salesCookie)).status, 404);

  // Somebody the department already holds gains nothing from a guest row.
  const already = await request(`/mail/conversations/${marketing}/members`, {
    method: 'POST',
    cookie: managerCookie,
    body: { memberIds: [member.id] },
  });
  assert.equal(already.status, 400, JSON.stringify(already.data));
  assert.equal(already.data.error, 'member_already_in_channel');

  const invited = await request(`/mail/conversations/${marketing}/members`, {
    method: 'POST',
    cookie: managerCookie,
    body: { memberIds: [sales.id] },
  });
  assert.equal(invited.status, 201, JSON.stringify(invited.data));
  assert.deepEqual(invited.data.conversation.memberIds, [sales.id]);
  assert.equal((await messages(salesCookie)).status, 200);

  // The department half is not a row to delete, so it is refused here rather
  // than recorded as a removal that the next bootstrap would undo.
  const derived = await request(`/mail/conversations/${marketing}/members/${member.id}`, {
    method: 'DELETE',
    cookie: managerCookie,
  });
  assert.equal(derived.status, 400, JSON.stringify(derived.data));
  assert.equal(derived.data.error, 'channel_member_derived');
  assert.equal((await messages(memberCookie)).status, 200);

  const removed = await request(`/mail/conversations/${marketing}/members/${sales.id}`, {
    method: 'DELETE',
    cookie: managerCookie,
  });
  assert.equal(removed.status, 200, JSON.stringify(removed.data));
  assert.equal((await messages(salesCookie)).status, 404);

  // A public channel already holds everybody; there is nobody left to invite.
  const everyone = await request(`/mail/conversations/${announcements}/members`, {
    method: 'POST',
    cookie: adminCookie,
    body: { memberIds: [sales.id] },
  });
  assert.equal(everyone.status, 400, JSON.stringify(everyone.data));
  assert.equal(everyone.data.error, 'channel_open_to_everyone');
});
