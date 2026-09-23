/**
 * The schedule layout against a real server and a fake Odoo.
 *
 * What only a running process can show:
 *
 *   K. reading is open to the Events tile; changing needs events.manage_layout,
 *      enforced by the API and not just by a hidden button;
 *   L. a save edited from an old revision is refused, never merged silently;
 *   M. reset restores the workbook default as a new revision;
 *   and the layout survives a restart, rejects ids Odoo does not have, flags
 *   the ones Odoo lost, writes an audit row — and never writes to Odoo.
 */

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 47_000 + Math.floor(Math.random() * 2_000);
const ORIGIN = `http://127.0.0.1:${PORT}`;

/* ── a fake Odoo: four seeded Mechanical courses and one new one ─── */

const odooEvents = new Map([
  [101, { id: 101, code: 'E05592', name: 'HVAC - 5592', date_begin: '2026-08-15 16:00:00' }],
  [102, { id: 102, code: 'E05593', name: 'Fire Fighting - 5593', date_begin: '2026-09-14 16:00:00' }],
  [103, { id: 103, code: 'E05594', name: 'Plumbing - 5594', date_begin: '2026-10-07 16:00:00' }],
  [104, { id: 104, code: 'E05595', name: 'Shop Drawing Mec - 5595', date_begin: '2026-10-26 16:00:00' }],
  [200, { id: 200, code: 'E05999', name: 'Brand new course', date_begin: '2026-11-01 16:00:00' }],
]);
const writes = [];

function matchesTerm([field, op, value], event) {
  if (op === 'in') return value.includes(event[field]);
  if (op === 'ilike') return String(event[field] ?? '').toLowerCase().includes(String(value).toLowerCase());
  return true;
}

/** Enough of Odoo's prefix notation for these reads: a leading '|' ORs the next two terms. */
function matchesDomain(domain, event) {
  if (domain[0] === '|') return matchesTerm(domain[1], event) || matchesTerm(domain[2], event);
  return domain.every((term) => matchesTerm(term, event));
}

const fakeOdoo = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    const { params, id } = JSON.parse(body);
    let result = [];
    if (params.service === 'common') result = 2;
    else {
      const [, , , model, method, args] = params.args;
      if (!['search_read', 'read_group', 'fields_get'].includes(method)) writes.push({ model, method });
      if (model === 'event.event' && method === 'search_read') {
        result = [...odooEvents.values()].filter((event) => matchesDomain(args[0], event));
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
  });
});

/* ── the app ─────────────────────────────────────────────────────── */

let dataDirectory;
let server;
let odooPort;
let adminCookie;
let memberCookie;
let editorCookie;

async function startServer() {
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATA_DIR: dataDirectory,
      PORT: String(PORT),
      DATABASE_URL: '',
      ADMIN_EMAIL: 'admin@test.local',
      ADMIN_PASSWORD: 'AdminPass123!',
      SESSION_SECRET: 'events-layout-test-session-secret-123456',
      SSO_SECRET: 'events-layout-test-sso-secret-1234567890',
      OPENAI_API_KEY: '',
      GOOGLE_CLIENT_ID: '',
      ODOO_URL: `http://127.0.0.1:${odooPort}`,
      ODOO_DB: 'test',
      ODOO_LOGIN: 'bot@test.local',
      ODOO_API_KEY: 'test-key',
      ODOO_UID: '',
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
  throw new Error(`Events layout test server did not start.\n${errors}`);
}

async function restartServer() {
  server.kill();
  await new Promise((resolve) => server.once('exit', resolve));
  await startServer();
}

before(async () => {
  dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'qodo-events-layout-test-'));
  await new Promise((resolve) => fakeOdoo.listen(0, '127.0.0.1', resolve));
  odooPort = fakeOdoo.address().port;
  await startServer();
});

after(async () => {
  if (server && !server.killed) server.kill();
  fakeOdoo.close();
  if (dataDirectory?.startsWith(os.tmpdir())) await fs.rm(dataDirectory, { recursive: true, force: true });
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

const mechanical = (layout) => layout.departments.find((d) => d.department === 'Mechanical');
const mechanicalPackage = (layout) => mechanical(layout).packages.find((p) => p.label === 'Mechanical Package');
const order = (layout) => mechanicalPackage(layout).courses.map((c) => c.eventId);

test('K. everybody reads the workbook default; only events.manage_layout may change it', async () => {
  adminCookie = await login('admin@test.local', 'AdminPass123!');
  await createUser({ name: 'Plain Member', email: 'member@test.local', password: 'Member123!', role: 'member', department: 'sales' });
  await createUser({
    name: 'Schedule Editor',
    email: 'editor@test.local',
    password: 'Editor123!',
    role: 'member',
    department: 'sales',
    permissions: ['apps.view', 'tasks.view', 'events.manage_layout'],
  });
  memberCookie = await login('member@test.local', 'Member123!');
  editorCookie = await login('editor@test.local', 'Editor123!');

  const read = await request('/events/layout', { cookie: memberCookie });
  assert.equal(read.status, 200, JSON.stringify(read.data));
  assert.equal(read.data.isDefault, true);
  assert.equal(read.data.revision, 0);
  assert.equal(read.data.canManage, false);
  // Resolved by code: HVAC, Fire Fighting, Plumbing, Shop Drawing, in sheet order.
  assert.deepEqual(order(read.data.layout), [101, 102, 103, 104]);
  assert.deepEqual(
    mechanical(read.data.layout).packages.map((p) => p.label),
    ['Mechanical Package', 'BIM MEP Package', 'Automotive Package Offline', 'Companies Courses']
  );

  const layout = structuredClone(read.data.layout);
  mechanicalPackage(layout).courses.reverse();
  for (const [method, path, body] of [
    ['PUT', '/events/layout', { layout, expectedRevision: 0 }],
    ['POST', '/events/layout/reset', { expectedRevision: 0 }],
    ['GET', '/events/layout/references'],
    ['GET', '/events/layout/search?q=HVAC'],
  ]) {
    const refused = await request(path, { method, body, cookie: memberCookie });
    assert.equal(refused.status, 403, `${method} ${path} must be refused`);
  }

  const editor = await request('/events/layout', { cookie: editorCookie });
  assert.equal(editor.data.canManage, true);
});

test('L. a save from a stale revision is a conflict, not an overwrite', async () => {
  const { data: start } = await request('/events/layout', { cookie: editorCookie });

  // Editor moves Plumbing above Fire Fighting and saves.
  const mine = structuredClone(start.layout);
  const courses = mechanicalPackage(mine).courses;
  courses.splice(1, 0, courses.splice(2, 1)[0]);
  const saved = await request('/events/layout', { method: 'PUT', cookie: editorCookie, body: { layout: mine, expectedRevision: 0 } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.revision, 1);
  assert.equal(saved.data.updatedBy.name, 'Schedule Editor');
  assert.deepEqual(order(saved.data.layout), [101, 103, 102, 104]);

  // The admin had opened the editor at revision 0 too.
  const theirs = structuredClone(start.layout);
  mechanicalPackage(theirs).label = 'Mechanical';
  const conflict = await request('/events/layout', { method: 'PUT', cookie: adminCookie, body: { layout: theirs, expectedRevision: 0 } });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.error, 'layout_conflict');
  assert.equal(conflict.data.current.revision, 1);
  assert.equal(conflict.data.current.updatedBy.name, 'Schedule Editor');

  const still = await request('/events/layout', { cookie: memberCookie });
  assert.deepEqual(order(still.data.layout), [101, 103, 102, 104], 'the first save stands');
  assert.equal(still.data.isDefault, false);
});

test('saves are validated: unknown Odoo ids, duplicates and a missing revision are refused', async () => {
  const { data: current } = await request('/events/layout', { cookie: editorCookie });

  const unknown = structuredClone(current.layout);
  mechanicalPackage(unknown).courses.push({ eventId: 999 });
  const refused = await request('/events/layout', { method: 'PUT', cookie: editorCookie, body: { layout: unknown, expectedRevision: 1 } });
  assert.equal(refused.status, 400);
  assert.equal(refused.data.error, 'layout_unknown_event');
  assert.deepEqual(refused.data.detail, [999]);

  const duplicate = structuredClone(current.layout);
  mechanical(duplicate).packages.find((p) => p.label === 'Companies Courses').courses.push({ eventId: 101 });
  const dup = await request('/events/layout', { method: 'PUT', cookie: editorCookie, body: { layout: duplicate, expectedRevision: 1 } });
  assert.equal(dup.status, 400);
  assert.equal(dup.data.error, 'layout_duplicate_placement');

  const noRevision = await request('/events/layout', { method: 'PUT', cookie: editorCookie, body: { layout: current.layout } });
  assert.equal(noRevision.status, 400);

  // G. The new Odoo course (unassigned until now) is added to Companies Courses.
  const added = structuredClone(current.layout);
  mechanical(added).packages.find((p) => p.label === 'Companies Courses').courses.push({ eventId: 200, code: 'E05999', customLabel: 'New course' });
  const ok = await request('/events/layout', { method: 'PUT', cookie: editorCookie, body: { layout: added, expectedRevision: 1 } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.revision, 2);
});

test('the layout survives a restart; a course Odoo lost is reported, not dropped', async () => {
  await restartServer();
  editorCookie = await login('editor@test.local', 'Editor123!');
  const { data } = await request('/events/layout', { cookie: editorCookie });
  assert.equal(data.revision, 2);
  assert.deepEqual(order(data.layout), [101, 103, 102, 104]);

  odooEvents.delete(104);
  const refs = await request('/events/layout/references', { cookie: editorCookie });
  assert.equal(refs.status, 200, JSON.stringify(refs.data));
  assert.deepEqual(refs.data.missing.map((m) => m.eventId), [104]);

  // A stale reference already in the layout does not block the next save.
  const again = await request('/events/layout', { method: 'PUT', cookie: editorCookie, body: { layout: data.layout, expectedRevision: 2 } });
  assert.equal(again.status, 200, JSON.stringify(again.data));
  assert.equal(again.data.revision, 3);
});

test('M. reset restores the workbook default as a new revision, audited, and Odoo is never written', async () => {
  const stale = await request('/events/layout/reset', { method: 'POST', cookie: editorCookie, body: { expectedRevision: 1 } });
  assert.equal(stale.status, 409);

  const reset = await request('/events/layout/reset', { method: 'POST', cookie: editorCookie, body: { expectedRevision: 3 } });
  assert.equal(reset.status, 200, JSON.stringify(reset.data));
  assert.equal(reset.data.revision, 4);
  // Sheet order again — and Shop Drawing, gone from Odoo, is simply not in it.
  assert.deepEqual(order(reset.data.layout), [101, 102, 103]);

  const search = await request('/events/layout/search?q=5999', { cookie: editorCookie });
  assert.deepEqual(search.data.results.map((r) => r.id), [200]);

  const workspace = JSON.parse(await fs.readFile(path.join(dataDirectory, 'workspace.json'), 'utf8'));
  const audit = workspace.activity.filter((row) => row.action === 'events.layout_updated');
  assert.deepEqual(audit.map((row) => row.meta.revision), [1, 2, 3, 4]);
  assert.equal(audit.at(-1).meta.reset, true);
  assert.deepEqual(audit[0].meta.departments, ['Mechanical']);
  assert.ok(!JSON.stringify(audit).includes('"courses"'), 'the audit row does not carry the layout');
  assert.equal(workspace.eventLayouts.length, 1, 'one document, updated in place');

  assert.deepEqual(writes, [], 'nothing but reads ever reached Odoo');
});
