/**
 * Qodo Calendar against a real server.
 *
 * The three things worth a running process rather than a unit test are the
 * three that would be silently wrong in a mock: that privacy holds against an
 * administrator, that busy time answers without leaking what fills it, and that
 * a meeting arranged from a mail thread really lands in that thread.
 */

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 43_000 + Math.floor(Math.random() * 2_000);
const ORIGIN = `http://127.0.0.1:${PORT}`;

let dataDirectory;
let server;
let adminCookie;
let organizerCookie;
let guestCookie;
let outsiderCookie;
let organizer;
let guest;
let outsider;

before(async () => {
  dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'qodo-calendar-test-'));
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATA_DIR: dataDirectory,
      PORT: String(PORT),
      ADMIN_EMAIL: 'admin@test.local',
      ADMIN_PASSWORD: 'AdminPass123!',
      SESSION_SECRET: 'calendar-test-session-secret-1234567890',
      SSO_SECRET: 'calendar-test-sso-secret-12345678901234',
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
  throw new Error(`Calendar test server did not start.\n${errors}`);
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

const hoursFromNow = (hours) => new Date(Date.now() + hours * 3_600_000).toISOString();
const WINDOW = `from=${encodeURIComponent(hoursFromNow(-1))}&to=${encodeURIComponent(hoursFromNow(72))}`;

test('an invitation reaches its invitee, answers stick, and a stranger sees nothing', async () => {
  adminCookie = await login('admin@test.local', 'AdminPass123!');
  organizer = await createUser({
    name: 'Meeting Organizer',
    email: 'organizer@test.local',
    password: 'Organizer123!',
    role: 'manager',
    department: 'marketing',
  });
  guest = await createUser({
    name: 'Meeting Guest',
    email: 'guest@test.local',
    password: 'Guest123!',
    role: 'member',
    department: 'marketing',
  });
  outsider = await createUser({
    name: 'Sales Outsider',
    email: 'outsider@test.local',
    password: 'Outsider123!',
    role: 'member',
    department: 'sales',
  });

  organizerCookie = await login(organizer.email, 'Organizer123!');
  guestCookie = await login(guest.email, 'Guest123!');
  outsiderCookie = await login(outsider.email, 'Outsider123!');

  const bootstrap = await request('/calendar/bootstrap', { cookie: guestCookie });
  assert.equal(bootstrap.status, 200, JSON.stringify(bootstrap.data));
  assert.ok(bootstrap.data.people.some((person) => person.id === organizer.id));

  const created = await request('/calendar/events', {
    method: 'POST',
    cookie: organizerCookie,
    body: {
      kind: 'meeting',
      title: 'مراجعة خطة الحملة',
      details: 'نراجع الميزانية والجدول.',
      location: 'قاعة الاجتماعات',
      onlineUrl: 'javascript:alert(1)',
      startAt: hoursFromNow(4),
      endAt: hoursFromNow(5),
      inviteeIds: [guest.id],
      reminderMinutes: 30,
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const event = created.data.event;
  // A non-http link is dropped rather than stored for an href to trust later.
  assert.equal(event.onlineUrl, null);
  assert.equal(event.myResponse, 'accepted', 'the organizer is counted as attending');
  assert.equal(event.canManage, true);

  const invited = await request(`/calendar/events?${WINDOW}`, { cookie: guestCookie });
  assert.equal(invited.data.events.length, 1);
  assert.equal(invited.data.events[0].myResponse, 'needs_action');
  assert.equal(invited.data.events[0].canManage, false);

  // Private by default: neither another department nor the administrator who
  // holds every permission in the workspace is on this invite list.
  const stranger = await request(`/calendar/events?${WINDOW}`, { cookie: outsiderCookie });
  assert.deepEqual(stranger.data.events, []);
  const adminView = await request(`/calendar/events/${event.id}`, { cookie: adminCookie });
  assert.equal(adminView.status, 404);

  const declined = await request(`/calendar/events/${event.id}/respond`, {
    method: 'POST',
    cookie: guestCookie,
    body: { response: 'declined' },
  });
  assert.equal(declined.status, 200, JSON.stringify(declined.data));
  assert.equal(declined.data.event.myResponse, 'declined');

  const uninvited = await request(`/calendar/events/${event.id}/respond`, {
    method: 'POST',
    cookie: outsiderCookie,
    body: { response: 'accepted' },
  });
  assert.equal(uninvited.status, 404);

  const notOrganizer = await request(`/calendar/events/${event.id}`, {
    method: 'PATCH',
    cookie: guestCookie,
    body: { title: 'عنوان مختطف' },
  });
  assert.equal(notOrganizer.status, 403);
});

test('a moved meeting asks everybody again, and a cancelled one stops being an announcement', async () => {
  const created = await request('/calendar/events', {
    method: 'POST',
    cookie: organizerCookie,
    body: {
      kind: 'meeting',
      title: 'وقفة الصباح',
      startAt: hoursFromNow(24),
      endAt: hoursFromNow(25),
      inviteeIds: [guest.id],
      visibility: 'department',
      department: 'marketing',
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const id = created.data.event.id;

  await request(`/calendar/events/${id}/respond`, {
    method: 'POST',
    cookie: guestCookie,
    body: { response: 'accepted' },
  });

  const renamed = await request(`/calendar/events/${id}`, {
    method: 'PATCH',
    cookie: organizerCookie,
    body: { title: 'وقفة الصباح — القاعة الكبيرة' },
  });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.data));
  assert.equal(
    renamed.data.event.responses.find((row) => row.userId === guest.id)?.response,
    'accepted',
    'renaming does not throw away an answer'
  );

  const moved = await request(`/calendar/events/${id}`, {
    method: 'PATCH',
    cookie: organizerCookie,
    body: { startAt: hoursFromNow(30), endAt: hoursFromNow(31) },
  });
  assert.equal(
    moved.data.event.responses.find((row) => row.userId === guest.id)?.response,
    'needs_action',
    'a new hour is a new question'
  );

  // Published to the department, so a marketing colleague who was never invited
  // can see it — and the sales member still cannot.
  const departmentView = await request(`/calendar/events/${id}`, { cookie: adminCookie });
  assert.equal(departmentView.status, 404, 'admin is not in marketing');
  const outsiderView = await request(`/calendar/events/${id}`, { cookie: outsiderCookie });
  assert.equal(outsiderView.status, 404);

  const badTime = await request(`/calendar/events/${id}`, {
    method: 'PATCH',
    cookie: organizerCookie,
    body: { startAt: hoursFromNow(30), endAt: hoursFromNow(29) },
  });
  assert.equal(badTime.status, 400);
  assert.equal(badTime.data.error, 'event_end_before_start');

  const cancelled = await request(`/calendar/events/${id}`, {
    method: 'DELETE',
    cookie: organizerCookie,
  });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
  assert.equal(cancelled.data.event.status, 'cancelled');
  // The invitee still sees that it is off; nobody else sees it at all.
  const guestAfter = await request(`/calendar/events/${id}`, { cookie: guestCookie });
  assert.equal(guestAfter.status, 200);
  assert.equal(guestAfter.data.event.status, 'cancelled');
});

test('busy time says an hour is taken without saying what fills it', async () => {
  const secret = await request('/calendar/events', {
    method: 'POST',
    cookie: guestCookie,
    body: {
      kind: 'appointment',
      title: 'كشف طبي',
      startAt: hoursFromNow(50),
      endAt: hoursFromNow(51),
      inviteeIds: [],
    },
  });
  assert.equal(secret.status, 201, JSON.stringify(secret.data));

  const hidden = await request(`/calendar/events?${WINDOW}`, { cookie: organizerCookie });
  assert.equal(
    hidden.data.events.some((row) => row.title === 'كشف طبي'),
    false,
    'a private appointment is not on somebody else’s calendar'
  );

  const busy = await request(`/calendar/busy?${WINDOW}&userIds=${guest.id}`, {
    cookie: organizerCookie,
  });
  assert.equal(busy.status, 200, JSON.stringify(busy.data));
  const block = busy.data.busy.find((row) => row.userId === guest.id);
  assert.ok(block, 'the hour shows as taken');
  assert.deepEqual(Object.keys(block).sort(), ['endAt', 'startAt', 'userId']);

  // Moving your own meeting must not warn that the room is busy — with the very
  // meeting you are moving. The entry is excused only for the person who
  // organizes it, so it cannot be used to ask whether somebody else's event
  // fills a given hour.
  const own = await request('/calendar/events', {
    method: 'POST',
    cookie: organizerCookie,
    body: {
      kind: 'meeting',
      title: 'مراجعة قابلة للنقل',
      startAt: hoursFromNow(60),
      endAt: hoursFromNow(61),
      inviteeIds: [guest.id],
    },
  });
  assert.equal(own.status, 201, JSON.stringify(own.data));
  const movable = own.data.event.id;
  const takenBy = (payload) =>
    payload.busy.some((row) => row.userId === guest.id && row.startAt === own.data.event.startAt);

  const beforeIgnoring = await request(`/calendar/busy?${WINDOW}&userIds=${guest.id}`, {
    cookie: organizerCookie,
  });
  assert.equal(takenBy(beforeIgnoring.data), true, 'the guest is busy with it');

  const ignoring = await request(
    `/calendar/busy?${WINDOW}&userIds=${guest.id}&ignoreEventId=${movable}`,
    { cookie: organizerCookie }
  );
  assert.equal(takenBy(ignoring.data), false, 'and free of it while its organizer moves it');

  const notOrganizer = await request(
    `/calendar/busy?${WINDOW}&userIds=${organizer.id}&ignoreEventId=${movable}`,
    { cookie: guestCookie }
  );
  assert.equal(
    notOrganizer.data.busy.some(
      (row) => row.userId === organizer.id && row.startAt === own.data.event.startAt
    ),
    true,
    'an invitee cannot excuse an entry they do not organize'
  );

  // A window nobody could render is refused rather than answered slowly.
  const tooWide = await request(
    '/calendar/busy?from=2020-01-01T00:00:00.000Z&to=2026-01-01T00:00:00.000Z',
    { cookie: organizerCookie }
  );
  assert.equal(tooWide.status, 400);
  assert.equal(tooWide.data.error, 'range_too_wide');

  const anonymous = await request(`/calendar/busy?${WINDOW}&userIds=${guest.id}`);
  assert.equal(anonymous.status, 401, 'and none of it without a session');
});

test('a meeting arranged from a mail thread lands in that thread', async () => {
  const thread = await request('/mail/conversations', {
    method: 'POST',
    cookie: organizerCookie,
    body: { kind: 'mail', subject: 'ميزانية الربع', memberIds: [guest.id] },
  });
  assert.equal(thread.status, 201, JSON.stringify(thread.data));
  const conversationId = thread.data.conversation.id;

  const created = await request('/calendar/events', {
    method: 'POST',
    cookie: organizerCookie,
    body: {
      kind: 'meeting',
      title: 'نقاش الميزانية',
      startAt: hoursFromNow(6),
      endAt: hoursFromNow(7),
      inviteeIds: [guest.id],
      conversationId,
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.event.conversationId, conversationId);

  const messages = await request(`/mail/conversations/${conversationId}/messages`, {
    cookie: guestCookie,
  });
  const card = messages.data.messages.find((row) => row.eventId === created.data.event.id);
  assert.ok(card, 'the thread carries a card for the meeting');
  assert.equal(messages.data.events[created.data.event.id].title, 'نقاش الميزانية');

  // A thread the organizer cannot open is not a thread they may post into.
  const foreign = await request('/calendar/events', {
    method: 'POST',
    cookie: outsiderCookie,
    body: {
      kind: 'meeting',
      title: 'محاولة',
      startAt: hoursFromNow(8),
      endAt: hoursFromNow(9),
      inviteeIds: [organizer.id],
      conversationId,
    },
  });
  assert.equal(foreign.status, 400);
  assert.equal(foreign.data.error, 'invalid_conversation');
});
