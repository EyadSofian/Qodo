/**
 * Client booking against a real server.
 *
 * The slot arithmetic is covered without a process in `booking.slots.test.js`.
 * What needs a running server is everything about the boundary: that the public
 * routes really are reachable without a session, that they say nothing about an
 * employee beyond what was published, that a page stops working the moment the
 * person behind it does, and that two clients cannot take the same hour.
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
const PORT = 45_000 + Math.floor(Math.random() * 2_000);
const ORIGIN = `http://127.0.0.1:${PORT}`;

let dataDirectory;
let server;
let adminCookie;
let ownerCookie;
let strangerCookie;
let owner;
let stranger;
let slug;

before(async () => {
  dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'qodo-booking-test-'));
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATA_DIR: dataDirectory,
      PORT: String(PORT),
      ADMIN_EMAIL: 'admin@test.local',
      ADMIN_PASSWORD: 'AdminPass123!',
      SESSION_SECRET: 'booking-test-session-secret-1234567890',
      SSO_SECRET: 'booking-test-sso-secret-12345678901234',
      OPENAI_API_KEY: '',
      GOOGLE_CLIENT_ID: '',
      SMTP_HOST: '',
      SMTP_USER: '',
      SMTP_PASS: '',
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
  throw new Error(`Booking test server did not start.\n${errors}`);
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
  return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null };
}

const login = async (email, password) => {
  const result = await request('/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.cookie;
};

/** Every day open, so the test never depends on which weekday it runs. */
const ALWAYS_OPEN = Object.fromEntries(
  ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((day) => [
    day,
    [{ start: '00:00', end: '23:30' }],
  ])
);

test('publishing needs a granted key, not a senior role', async () => {
  adminCookie = await login('admin@test.local', 'AdminPass123!');

  const created = await request('/users', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: 'Sara Consultant',
      email: 'sara@test.local',
      password: 'SaraPass123!',
      role: 'manager',
      department: 'marketing',
      title: 'Senior Consultant',
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  owner = created.data.user;

  const other = await request('/users', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: 'Omar Member',
      email: 'omar@test.local',
      password: 'OmarPass123!',
      role: 'member',
      department: 'sales',
    },
  });
  stranger = other.data.user;
  strangerCookie = await login('omar@test.local', 'OmarPass123!');
  ownerCookie = await login('sara@test.local', 'SaraPass123!');

  // A manager is senior and still cannot publish: the key is granted, not earned.
  const refused = await request('/booking', { cookie: ownerCookie });
  assert.equal(refused.status, 403);
  assert.equal(refused.data.missing, 'calendar.booking');

  const granted = await request(`/users/${owner.id}`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { permissions: ['apps.view', 'tasks.view', 'calendar.booking'] },
  });
  assert.equal(granted.status, 200, JSON.stringify(granted.data));

  const opened = await request('/booking', { cookie: ownerCookie });
  assert.equal(opened.status, 200, JSON.stringify(opened.data));
  assert.equal(opened.data.page, null, 'granted the key, but nothing published yet');
});

test('an unpublished page is invisible, and publishing needs real hours', async () => {
  const empty = await request('/booking', {
    method: 'PUT',
    cookie: ownerCookie,
    body: {
      title: 'استشارة',
      durationMinutes: 30,
      availability: Object.fromEntries(
        ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((day) => [day, []])
      ),
      active: true,
    },
  });
  assert.equal(empty.status, 400);
  assert.equal(empty.data.error, 'no_availability', 'a page with no hours is a dead link');

  const draft = await request('/booking', {
    method: 'PUT',
    cookie: ownerCookie,
    body: {
      title: 'استشارة',
      description: 'نص ساعة نراجع فيها احتياجك.',
      location: 'أونلاين',
      durationMinutes: 30,
      noticeMinutes: 0,
      horizonDays: 14,
      availability: ALWAYS_OPEN,
      active: false,
    },
  });
  assert.equal(draft.status, 200, JSON.stringify(draft.data));
  slug = draft.data.page.slug;
  assert.match(slug, /^[a-z0-9-]+$/);
  assert.ok(slug.length > 6, 'the slug carries a random tail, so it is not a guess');

  // Saved but not published: the internet gets the same answer as for a slug
  // that was never real.
  const hidden = await request(`/book/${slug}`);
  assert.equal(hidden.status, 404);
  const nonsense = await request('/book/definitely-not-a-page');
  assert.equal(hidden.status, nonsense.status, 'unpublished and non-existent are indistinguishable');

  const published = await request('/booking', {
    method: 'PUT',
    cookie: ownerCookie,
    body: { active: true },
  });
  assert.equal(published.status, 200, JSON.stringify(published.data));
  assert.equal(published.data.page.active, true);
});

test('the public page carries a name and free hours — and nothing else', async () => {
  const page = await request(`/book/${slug}`);
  assert.equal(page.status, 200, JSON.stringify(page.data));
  assert.deepEqual(Object.keys(page.data.page.owner).sort(), ['avatarColor', 'name', 'title']);
  assert.equal(page.data.page.owner.name, 'Sara Consultant');

  // The two fields that would turn a booking page into a directory entry.
  const serialised = JSON.stringify(page.data);
  assert.equal(serialised.includes('sara@test.local'), false, 'no email address');
  assert.equal(serialised.includes(owner.id), false, 'no user id');
  assert.equal(serialised.includes('marketing'), false, 'no department');

  const slots = await request(`/book/${slug}/slots`);
  assert.equal(slots.status, 200, JSON.stringify(slots.data));
  assert.ok(slots.data.slots.length > 0, 'an open week offers hours');
  assert.deepEqual(Object.keys(slots.data.slots[0]).sort(), ['endAt', 'startAt']);

  const tooWide = await request(
    `/book/${slug}/slots?from=2026-01-01T00:00:00.000Z&to=2026-06-01T00:00:00.000Z`
  );
  assert.equal(tooWide.status, 400);
  assert.equal(tooWide.data.error, 'range_too_wide');
});

test('an hour already spoken for is never offered, whatever fills it', async () => {
  const slots = (await request(`/book/${slug}/slots`)).data.slots;
  const target = slots[6];

  // A private appointment in the owner's own calendar, with a title the booking
  // page must never repeat.
  const secret = await request('/calendar/events', {
    method: 'POST',
    cookie: ownerCookie,
    body: {
      kind: 'appointment',
      title: 'كشف طبي',
      startAt: target.startAt,
      endAt: target.endAt,
      inviteeIds: [],
    },
  });
  assert.equal(secret.status, 201, JSON.stringify(secret.data));

  const after = await request(`/book/${slug}/slots`);
  assert.equal(
    after.data.slots.some((slot) => slot.startAt === target.startAt),
    false,
    'the hour is gone'
  );
  assert.equal(
    JSON.stringify(after.data).includes('كشف طبي'),
    false,
    'and the page never says what took it'
  );
});

test('a booking lands in the calendar, and the same hour cannot be taken twice', async () => {
  const slots = (await request(`/book/${slug}/slots`)).data.slots;
  const wanted = slots[20];

  const booked = await request(`/book/${slug}/book`, {
    method: 'POST',
    body: {
      startAt: wanted.startAt,
      endAt: wanted.endAt,
      clientName: 'شركة النور',
      clientEmail: 'client@example.com',
      clientPhone: '01000000000',
      clientCompany: 'النور للمقاولات',
      clientNote: 'محتاجين نتكلم عن عرض السعر.',
    },
  });
  assert.equal(booked.status, 201, JSON.stringify(booked.data));
  const manageToken = booked.data.booking.manageToken;
  assert.ok(manageToken?.length > 20);

  // Same slot, second client, no session — the loser is told, not double-booked.
  const raced = await request(`/book/${slug}/book`, {
    method: 'POST',
    body: {
      startAt: wanted.startAt,
      endAt: wanted.endAt,
      clientName: 'عميل تاني',
      clientEmail: 'second@example.com',
    },
  });
  assert.equal(raced.status, 409);
  assert.equal(raced.data.error, 'slot_unavailable');

  const bad = await request(`/book/${slug}/book`, {
    method: 'POST',
    body: { startAt: wanted.startAt, endAt: wanted.endAt, clientName: 'x', clientEmail: 'not-an-email' },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error, 'invalid_client_email');

  // The owner sees the whole client record; it reached their calendar as a
  // private appointment, so nobody else does.
  const mine = await request('/booking/bookings', { cookie: ownerCookie });
  assert.equal(mine.data.bookings.length, 1);
  assert.equal(mine.data.bookings[0].clientPhone, '01000000000');

  const eventId = mine.data.bookings[0].eventId;
  const ownerSees = await request(`/calendar/events/${eventId}`, { cookie: ownerCookie });
  assert.equal(ownerSees.status, 200);
  assert.match(ownerSees.data.event.details, /01000000000/);
  const adminSees = await request(`/calendar/events/${eventId}`, { cookie: adminCookie });
  assert.equal(adminSees.status, 404, 'a client appointment is not the admin’s business');

  // The client's token is the only proof of who they are, and it works.
  const view = await request(`/book/manage/${manageToken}`);
  assert.equal(view.status, 200, JSON.stringify(view.data));
  assert.equal(view.data.booking.status, 'confirmed');

  const cancelled = await request(`/book/manage/${manageToken}/cancel`, { method: 'POST' });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
  assert.equal(cancelled.data.booking.status, 'cancelled');

  // Cancelling gives the hour back rather than losing it.
  const reopened = await request(`/book/${slug}/slots`);
  assert.equal(
    reopened.data.slots.some((slot) => slot.startAt === wanted.startAt),
    true
  );

  const stolen = await request('/book/manage/not-a-real-token-but-long-enough-to-pass');
  assert.equal(stolen.status, 404);
});

test('a page stops working the moment the person behind it does', async () => {
  assert.equal((await request(`/book/${slug}`)).status, 200);

  // The key is taken away; the page was never unpublished.
  const revoked = await request(`/users/${owner.id}`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { permissions: ['apps.view', 'tasks.view'] },
  });
  assert.equal(revoked.status, 200, JSON.stringify(revoked.data));

  assert.equal((await request(`/book/${slug}`)).status, 404, 'revoking the key closes the page');
  assert.equal((await request(`/book/${slug}/slots`)).status, 404);

  const attempted = await request(`/book/${slug}/book`, {
    method: 'POST',
    body: {
      startAt: new Date(Date.now() + 86_400_000).toISOString(),
      endAt: new Date(Date.now() + 88_200_000).toISOString(),
      clientName: 'late client',
      clientEmail: 'late@example.com',
    },
  });
  assert.equal(attempted.status, 404);
});

test('nobody can publish, read or cancel on somebody else’s behalf', async () => {
  const nosy = await request('/booking', { cookie: strangerCookie });
  assert.equal(nosy.status, 403, 'no key, no page');

  const anonymous = await request('/booking');
  assert.equal(anonymous.status, 401);

  const anonymousList = await request('/booking/bookings');
  assert.equal(anonymousList.status, 401, 'the client list is never public');
});
