/**
 * E-Learning Production over HTTP.
 *
 * The service suite proves the rules; this proves the edges a browser meets —
 * the session, the one error shape, raw uploads, byte-range streaming for
 * media, and the workspace search palette — against the real server process.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { startTestDatabase } from './projects/testDatabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 36_000 + Math.floor(Math.random() * 3_000);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const API = `${ORIGIN}/api/learning-production`;

const database = await startTestDatabase();
const SKIP = database.url ? false : database.reason;

let dataDirectory;
let server;
let adminCookie;
let memberCookie;
let adminId;

async function call(url, { method = 'GET', body, cookie, headers = {}, raw } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { status: response.status, headers: response.headers, payload };
}

async function signIn(email, password) {
  const response = await fetch(`${ORIGIN}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200, `sign-in failed for ${email}`);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const { user } = await response.json();
  return { cookie, user };
}

before(async () => {
  if (SKIP) return;
  dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'engosoft-learning-http-'));
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATA_DIR: dataDirectory,
      DATABASE_URL: database.url,
      PORT: String(PORT),
      ADMIN_EMAIL: 'admin@learning.test',
      ADMIN_PASSWORD: 'AdminPass123!',
      SESSION_SECRET: 'learning-session-secret-1234567890',
      SSO_SECRET: 'learning-sso-secret-12345678901234',
      GOOGLE_CLIENT_ID: '',
      VAPID_PUBLIC_KEY: '',
      VAPID_PRIVATE_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  server.stdout.on('data', (chunk) => (output += chunk));
  server.stderr.on('data', (chunk) => (output += chunk));

  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      const response = await fetch(`${ORIGIN}/api/health`);
      if (response.ok && output.includes('[learning-production] schema ready')) break;
    } catch {
      /* still starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (attempt === 299) throw new Error(`server did not start:\n${output}`);
  }

  const admin = await signIn('admin@learning.test', 'AdminPass123!');
  adminCookie = admin.cookie;
  adminId = admin.user.id;

  const created = await call(`${ORIGIN}/api/users`, {
    method: 'POST',
    cookie: adminCookie,
    body: { name: 'Member Person', email: 'member@learning.test', password: 'MemberPass123!', role: 'member' },
  });
  assert.equal(created.status, 201);
  memberCookie = (await signIn('member@learning.test', 'MemberPass123!')).cookie;
});

after(async () => {
  if (server && !server.killed) {
    server.kill();
    await new Promise((resolve) => server.once('exit', resolve));
  }
  await database.stop?.();
  if (dataDirectory) await fs.rm(dataDirectory, { recursive: true, force: true }).catch(() => {});
});

describe('E-Learning Production API', { skip: SKIP }, () => {
  let courseId;
  let pptId;
  let versionId;

  test('a request without a session is refused', async () => {
    const response = await call(`${API}/courses`);
    assert.equal(response.status, 401);
  });

  test('refusals share one shape: validation, malformed JSON, bad ids and unknown routes', async () => {
    const invalid = await call(`${API}/courses`, { method: 'POST', cookie: adminCookie, body: { name: '' } });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.payload.error.code, 'VALIDATION_FAILED');
    assert.equal(invalid.payload.error.details.field, 'name');
    assert.equal(typeof invalid.payload.error.message, 'string');

    const malformed = await call(`${API}/courses`, {
      method: 'POST',
      cookie: adminCookie,
      headers: { 'Content-Type': 'application/json' },
      raw: '{"name": ',
    });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.payload.error.code, 'VALIDATION_FAILED');

    const badId = await call(`${API}/courses/not-a-uuid`, { cookie: adminCookie });
    assert.equal(badId.status, 404);
    assert.equal(badId.payload.error.code, 'NOT_FOUND');

    const unknown = await call(`${API}/nothing-here`, { cookie: adminCookie });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.payload.error.code, 'NOT_FOUND');
  });

  test('an administrator creates a course and reads its matrix; a member cannot see or create one', async () => {
    const created = await call(`${API}/courses`, {
      method: 'POST',
      cookie: adminCookie,
      body: { name: 'HTTP Reliability Course', code: 'HTTP-REL', modules: [{ name: 'Module 1', lessons: ['Lesson 1'] }] },
    });
    assert.equal(created.status, 201);
    courseId = created.payload.course.id;

    const matrix = await call(`${API}/courses/${courseId}/production-matrix`, { cookie: adminCookie });
    assert.equal(matrix.status, 200);
    assert.equal(matrix.payload.lessons.length, 1);
    pptId = matrix.payload.lessons[0].assets.PPT.id;

    const hidden = await call(`${API}/courses/${courseId}`, { cookie: memberCookie });
    assert.equal(hidden.status, 404);
    const forbidden = await call(`${API}/courses`, { method: 'POST', cookie: memberCookie, body: { name: 'Mine' } });
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.payload.error.code, 'FORBIDDEN');

    const me = await call(`${API}/me`, { cookie: adminCookie });
    assert.equal(me.payload.isAdmin, true);
    assert.equal(me.payload.canCreateCourse, true);
  });

  test('a workflow refusal names its reason', async () => {
    await call(`${API}/assets/${pptId}`, { method: 'PATCH', cookie: adminCookie, body: { assigneeUserId: adminId } });
    const blocked = await call(`${API}/assets/${pptId}/start`, { method: 'POST', cookie: adminCookie, body: {} });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.payload.error.code, 'ASSET_BLOCKED');
    const override = await call(`${API}/assets/${pptId}/override-dependency`, {
      method: 'POST',
      cookie: adminCookie,
      body: { reason: 'HTTP test' },
    });
    assert.equal(override.status, 200);
  });

  test('a file uploads as raw bytes, the wrong kind is refused, and media streams by byte range', async () => {
    const bytes = Buffer.from(`%PDF-1.4\n% http test\n${'0'.repeat(200)}\n%%EOF\n`);
    const uploaded = await call(`${API}/assets/${pptId}/versions`, {
      method: 'POST',
      cookie: adminCookie,
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-File-Name': encodeURIComponent('شرائح الدرس.pdf'),
        'X-Version-Notes': encodeURIComponent('First draft'),
      },
      raw: bytes,
    });
    assert.equal(uploaded.status, 201);
    assert.equal(uploaded.payload.versions.length, 1);
    assert.equal(uploaded.payload.versions[0].fileName, 'شرائح الدرس.pdf');
    versionId = uploaded.payload.versions[0].id;

    const wrong = await call(`${API}/assets/${pptId}/versions`, {
      method: 'POST',
      cookie: adminCookie,
      headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'notes.pdf' },
      raw: Buffer.from('this is just some text pretending to be a pdf'),
    });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.payload.error.code, 'FILE_TYPE_NOT_ALLOWED');

    const ranged = await fetch(`${API}/versions/${versionId}/file`, { headers: { Cookie: adminCookie, Range: 'bytes=0-4' } });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get('content-range'), `bytes 0-4/${bytes.length}`);
    assert.equal(await ranged.text(), '%PDF-');

    const stranger = await fetch(`${API}/versions/${versionId}/file`, { headers: { Cookie: memberCookie } });
    assert.equal(stranger.status, 404);
  });

  test('the workspace search palette finds the course for those who can see it', async () => {
    const found = await call(`${ORIGIN}/api/search?q=HTTP%20Reliability`, { cookie: adminCookie });
    assert.ok(found.payload.results.some((result) => result.type === 'learning_course' && result.id === courseId));
    const hidden = await call(`${ORIGIN}/api/search?q=HTTP%20Reliability`, { cookie: memberCookie });
    assert.ok(!hidden.payload.results.some((result) => result.type === 'learning_course'));
  });
});
