/**
 * The seating plan against a real server.
 *
 * These are worth a running process rather than a unit test, because every one
 * of them is a property the spreadsheet this module replaces could not hold and
 * a mock would happily pretend to:
 *
 *   1. reading is open to everybody and moving people is not;
 *   2. the counts really are derived — nobody can write one that disagrees;
 *   3. a desk held for a new joiner stays reserved across the round trip;
 *   4. seating a person empties whichever desk they were on before;
 *   5. the scaled plan refuses coordinates until the room has been measured;
 *   6. a room nobody has left cannot be deleted out from under them.
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
let memberCookie;
let facilitiesCookie;
let member;
let facilities;

before(async () => {
  dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'qodo-offices-test-'));
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATA_DIR: dataDirectory,
      PORT: String(PORT),
      ADMIN_EMAIL: 'admin@test.local',
      ADMIN_PASSWORD: 'AdminPass123!',
      SESSION_SECRET: 'offices-test-session-secret-1234567890',
      SSO_SECRET: 'offices-test-sso-secret-123456789012345',
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
  throw new Error(`Offices test server did not start.\n${errors}`);
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

const roomNamed = (plan, name) => plan.offices.find((office) => office.nameAr === name);

test('anybody may read the plan; only offices.manage may change it', async () => {
  adminCookie = await login('admin@test.local', 'AdminPass123!');

  member = await createUser({
    name: 'Ordinary Member',
    email: 'member@test.local',
    password: 'Member123!',
    role: 'member',
    department: 'sales',
  });
  memberCookie = await login('member@test.local', 'Member123!');

  const created = await request('/offices', {
    method: 'POST',
    cookie: adminCookie,
    body: { nameAr: 'المبيعات', zone: 'مكتب 1', department: 'sales', seats: 4 },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));

  // Reading needs a session and nothing else — that is the whole point of not
  // giving the plan a view permission.
  const read = await request('/offices', { cookie: memberCookie });
  assert.equal(read.status, 200);
  assert.equal(roomNamed(read.data, 'المبيعات').counts.units, 4);

  const seat = roomNamed(read.data, 'المبيعات').seats[0];
  const refused = await request(`/offices/${seat.officeId}/seats/${seat.id}`, {
    method: 'PATCH',
    cookie: memberCookie,
    body: { userId: member.id },
  });
  assert.equal(refused.status, 403);
  assert.equal(refused.data.missing, 'offices.manage');

  // The key belongs to no role, so it has to be granted by name. A manager who
  // was not named still cannot move anybody.
  facilities = await createUser({
    name: 'Facilities Lead',
    email: 'facilities@test.local',
    password: 'Facilities123!',
    role: 'manager',
    department: 'operations',
  });
  const asManager = await login('facilities@test.local', 'Facilities123!');
  const stillRefused = await request(`/offices/${seat.officeId}/seats/${seat.id}`, {
    method: 'PATCH',
    cookie: asManager,
    body: { userId: member.id },
  });
  assert.equal(stillRefused.status, 403);

  const granted = await request(`/users/${facilities.id}`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: {
      permissions: ['apps.view', 'tasks.view', 'users.view', 'offices.manage'],
    },
  });
  assert.equal(granted.status, 200, JSON.stringify(granted.data));
  facilitiesCookie = await login('facilities@test.local', 'Facilities123!');

  const allowed = await request(`/offices/${seat.officeId}/seats/${seat.id}`, {
    method: 'PATCH',
    cookie: facilitiesCookie,
    body: { userId: member.id },
  });
  assert.equal(allowed.status, 200, JSON.stringify(allowed.data));
});

test('counts are derived, and always add back up to the desks that exist', async () => {
  const plan = (await request('/offices', { cookie: memberCookie })).data;
  const room = roomNamed(plan, 'المبيعات');

  assert.equal(room.counts.units, 4);
  assert.equal(room.counts.occupied, 1);
  assert.equal(room.counts.free, 3);
  assert.equal(
    room.counts.occupied + room.counts.free + room.counts.reserved + room.counts.blocked,
    room.counts.units,
    'the four buckets must partition the desks — this is what a spreadsheet cannot promise'
  );

  // No request can set "occupied" directly; it is what carrying an occupant
  // means. Asking for it is rejected rather than quietly stored.
  const seat = room.seats.find((row) => row.state === 'free');
  const refused = await request(`/offices/${room.id}/seats/${seat.id}`, {
    method: 'PATCH',
    cookie: facilitiesCookie,
    body: { status: 'occupied' },
  });
  assert.equal(refused.status, 400);
  assert.equal(refused.data.error, 'unknown_status');

  // Emptying the desk moves the number with it, with no second write.
  const taken = room.seats.find((row) => row.state === 'occupied');
  const cleared = await request(`/offices/${room.id}/seats/${taken.id}`, {
    method: 'PATCH',
    cookie: facilitiesCookie,
    body: { userId: null, occupantName: null },
  });
  assert.equal(cleared.status, 200);
  assert.equal(roomNamed(cleared.data, 'المبيعات').counts.occupied, 0);
  assert.equal(roomNamed(cleared.data, 'المبيعات').counts.free, 4);
});

test('a desk held for a new joiner survives the round trip as reserved', async () => {
  const plan = (await request('/offices', { cookie: memberCookie })).data;
  const room = roomNamed(plan, 'المبيعات');
  const seat = room.seats[0];

  const held = await request(`/offices/${room.id}/seats/${seat.id}`, {
    method: 'PATCH',
    cookie: facilitiesCookie,
    body: { status: 'reserved' },
  });
  assert.equal(held.status, 200);

  // This is «موظف جديد» in the IT room: a desk that is neither free nor sat at.
  // Presentation renames `status` to `state`, and counting off the presented
  // shape instead of the stored one used to report it as free — with the
  // arithmetic still adding up, so nothing looked wrong.
  const after = roomNamed(held.data, 'المبيعات');
  assert.equal(after.seats.find((row) => row.id === seat.id).state, 'reserved');
  assert.equal(after.counts.reserved, 1);
  assert.equal(after.counts.free, 3);
  assert.equal(after.counts.occupied, 0);
  assert.equal(
    after.counts.occupied + after.counts.free + after.counts.reserved + after.counts.blocked,
    after.counts.units
  );

  // Seating somebody there fills the reservation rather than leaving both true.
  const filled = await request(`/offices/${room.id}/seats/${seat.id}`, {
    method: 'PATCH',
    cookie: facilitiesCookie,
    body: { occupantName: 'موظف وصل' },
  });
  assert.equal(filled.status, 200);
  const settled = roomNamed(filled.data, 'المبيعات');
  assert.equal(settled.counts.reserved, 0);
  assert.equal(settled.counts.occupied, 1);

  // Put it back so the next test starts from an empty room.
  const reset = await request(`/offices/${room.id}/seats/${seat.id}`, {
    method: 'PATCH',
    cookie: facilitiesCookie,
    body: { userId: null, occupantName: null },
  });
  assert.equal(reset.status, 200);
  assert.equal(roomNamed(reset.data, 'المبيعات').counts.free, 4);
});

test('one person, one desk — seating somebody empties where they were', async () => {
  const second = await request('/offices', {
    method: 'POST',
    cookie: facilitiesCookie,
    body: { nameAr: 'مبيعات كبير', zone: 'مكتب 3', department: 'sales', seats: 2 },
  });
  assert.equal(second.status, 201, JSON.stringify(second.data));

  const first = roomNamed(second.data, 'المبيعات');
  const seated = await request(`/offices/${first.id}/seats/${first.seats[0].id}`, {
    method: 'PATCH',
    cookie: facilitiesCookie,
    body: { userId: member.id },
  });
  assert.equal(seated.status, 200);

  const bigRoom = roomNamed(seated.data, 'مبيعات كبير');
  const moved = await request(`/offices/${bigRoom.id}/seats/${bigRoom.seats[0].id}`, {
    method: 'PATCH',
    cookie: facilitiesCookie,
    body: { userId: member.id },
  });
  assert.equal(moved.status, 200);

  // «أحمد شعبان» sat in three rooms at once in the spreadsheet. Here the old
  // desk empties in the same write that fills the new one.
  const everywhere = moved.data.offices.flatMap((office) =>
    office.seats.filter((seat) => seat.userId === member.id)
  );
  assert.equal(everywhere.length, 1);
  assert.equal(roomNamed(moved.data, 'المبيعات').counts.occupied, 0);
  assert.equal(roomNamed(moved.data, 'مبيعات كبير').counts.occupied, 1);

  const mine = await request('/offices/me', { cookie: memberCookie });
  assert.equal(mine.status, 200);
  assert.equal(mine.data.office.nameAr, 'مبيعات كبير');
});

test('a desk cannot be placed on a plan of a room nobody has measured', async () => {
  const plan = (await request('/offices', { cookie: facilitiesCookie })).data;
  const room = roomNamed(plan, 'مبيعات كبير');
  assert.equal(room.dimensions, null);
  assert.equal(room.plan.measured, false);
  assert.equal(room.plan.ready, false, 'an unmeasured room is never drawn to scale');

  const early = await request(`/offices/${room.id}/seats/${room.seats[0].id}`, {
    method: 'PATCH',
    cookie: facilitiesCookie,
    body: { point: { x: 1, y: 1 } },
  });
  assert.equal(early.status, 409);
  assert.equal(early.data.error, 'room_not_measured');

  const measured = await request(`/offices/${room.id}`, {
    method: 'PATCH',
    cookie: facilitiesCookie,
    body: { dimensions: { width: 6, height: 4 } },
  });
  assert.equal(measured.status, 200, JSON.stringify(measured.data));

  const outside = await request(`/offices/${room.id}/seats/${room.seats[0].id}`, {
    method: 'PATCH',
    cookie: facilitiesCookie,
    body: { point: { x: 9, y: 1 } },
  });
  assert.equal(outside.status, 400);
  assert.equal(outside.data.error, 'point_outside_room');

  // Measured but only half placed is still not drawable: the desks that are
  // missing would read as desks that do not exist.
  const half = await request(`/offices/${room.id}/seats/${room.seats[0].id}`, {
    method: 'PATCH',
    cookie: facilitiesCookie,
    body: { point: { x: 1.5, y: 1 } },
  });
  assert.equal(half.status, 200);
  assert.equal(roomNamed(half.data, 'مبيعات كبير').plan.ready, false);
  assert.equal(roomNamed(half.data, 'مبيعات كبير').plan.placed, 1);

  const rest = roomNamed(half.data, 'مبيعات كبير').seats.find((seat) => !seat.point);
  const full = await request(`/offices/${room.id}/seats/${rest.id}`, {
    method: 'PATCH',
    cookie: facilitiesCookie,
    body: { point: { x: 4, y: 2.5 } },
  });
  assert.equal(full.status, 200);
  assert.equal(roomNamed(full.data, 'مبيعات كبير').plan.ready, true);
});

test('a room holding somebody cannot be deleted out from under them', async () => {
  const plan = (await request('/offices', { cookie: facilitiesCookie })).data;
  const room = roomNamed(plan, 'مبيعات كبير');

  const refused = await request(`/offices/${room.id}`, {
    method: 'DELETE',
    cookie: facilitiesCookie,
  });
  assert.equal(refused.status, 409);
  assert.equal(refused.data.error, 'office_occupied');

  const empty = roomNamed(plan, 'المبيعات');
  const removed = await request(`/offices/${empty.id}`, {
    method: 'DELETE',
    cookie: facilitiesCookie,
  });
  assert.equal(removed.status, 200);
  assert.equal(roomNamed(removed.data, 'المبيعات'), undefined);
});
