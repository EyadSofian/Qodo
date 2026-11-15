import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignJWT } from 'jose';
import { describeDevice } from './sessions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 48_000 + Math.floor(Math.random() * 1_000);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const SESSION_SECRET = 'sessions-test-secret-12345678901234';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

let dataDirectory;
let server;

before(async () => {
  dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'qodo-sessions-test-'));
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL: '',
      DATA_DIR: dataDirectory,
      PORT: String(PORT),
      ADMIN_EMAIL: 'admin@test.local',
      ADMIN_PASSWORD: 'AdminPass123!',
      SESSION_SECRET,
      SSO_SECRET: 'sessions-test-sso-secret-1234567890',
      HR_FX_LIVE: 'off',
      OPENAI_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let errors = '';
  server.stderr.on('data', (chunk) => { errors += chunk.toString(); });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(`${ORIGIN}/api/health`)).ok) return;
    } catch {
      // still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Sessions test server did not start.\n${errors}`);
});

after(async () => {
  if (server && !server.killed) server.kill();
  if (dataDirectory?.startsWith(os.tmpdir())) await fs.rm(dataDirectory, { recursive: true, force: true });
});

const cookieOf = (response) => String(response.headers.get('set-cookie') || '').split(';')[0];

async function login(userAgent) {
  const response = await fetch(`${ORIGIN}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': userAgent },
    body: JSON.stringify({ email: 'admin@test.local', password: 'AdminPass123!' }),
  });
  assert.equal(response.status, 200);
  return cookieOf(response);
}

const call = (cookie, url, { method = 'GET', userAgent = MAC } = {}) =>
  fetch(`${ORIGIN}/api${url}`, { method, headers: { cookie, 'user-agent': userAgent, 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });

test('reads the device from the browser', () => {
  assert.deepEqual(describeDevice(WINDOWS), { os: 'Windows', browser: 'Chrome' });
  assert.deepEqual(describeDevice(MAC), { os: 'macOS', browser: 'Safari' });
  assert.deepEqual(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1').os, 'iOS');
});

test('one device is signed out and the others keep working', async () => {
  const mac = await login(MAC);
  const windows = await login(WINDOWS);
  const secondMac = await login(MAC);

  const list = await (await call(mac, '/auth/sessions')).json();
  assert.equal(list.sessions.length, 3);
  assert.equal(list.sessions.filter((session) => session.current).length, 1);
  const win = list.sessions.find((session) => session.os === 'Windows');
  assert.ok(win);

  const revoked = await call(mac, `/auth/sessions/${win.id}/revoke`, { method: 'POST' });
  assert.equal(revoked.status, 200);
  assert.equal((await revoked.json()).signedOut, false);

  assert.equal((await call(windows, '/auth/sessions', { userAgent: WINDOWS })).status, 401);
  assert.equal((await call(mac, '/auth/sessions')).status, 200);
  assert.equal((await call(secondMac, '/auth/sessions')).status, 200);
  const after = await (await call(mac, '/auth/sessions')).json();
  assert.deepEqual(after.sessions.map((session) => session.os).sort(), ['macOS', 'macOS']);
});

test('a session of another account cannot be revoked', async () => {
  const mine = await login(MAC);
  const response = await call(mine, '/auth/sessions/not-a-real-session/revoke', { method: 'POST' });
  assert.equal(response.status, 404);
});

test('a cookie signed before devices existed keeps working and becomes a device', async () => {
  const me = await (await call(await login(MAC), '/auth/me')).json();
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const legacy = await new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(me.user.id)
    .setIssuer('engosoft-workspace')
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(SESSION_SECRET));
  // A page load fires requests in parallel; they must share one device row.
  const burst = await Promise.all([1, 2, 3, 4].map(() => call(`engosoft_session=${legacy}`, '/auth/sessions', { userAgent: WINDOWS })));
  const rows = (await burst[0].json()).sessions.filter((session) => session.current);
  assert.equal(rows.length, 1);
  const burstIds = new Set(burst.map((item) => cookieOf(item)));
  assert.equal(burstIds.size, 1);

  const response = await call(`engosoft_session=${legacy}`, '/auth/me', { userAgent: WINDOWS });
  assert.equal(response.status, 200);
  assert.equal((await response.clone().json()).user?.id, me.user.id);
  const upgraded = cookieOf(response);
  assert.match(upgraded, /^engosoft_session=/);

  const list = await (await call(upgraded, '/auth/sessions', { userAgent: WINDOWS })).json();
  const current = list.sessions.find((session) => session.current);
  assert.equal(current.os, 'Windows');
  assert.equal(Math.floor(new Date(current.expiresAt).getTime() / 1000), exp);

  const others = await (await call(upgraded, '/auth/sessions/revoke-others', { method: 'POST', userAgent: WINDOWS })).json();
  assert.ok(others.revoked >= 1);
  assert.equal((await call(upgraded, '/auth/sessions', { userAgent: WINDOWS })).status, 200);
});

test('signing out a not-yet-upgraded device ends its old cookie too', async () => {
  const mac = await login(MAC);
  const me = await (await call(mac, '/auth/me')).json();
  const legacy = await new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(me.user.id)
    .setIssuer('engosoft-workspace')
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
    .sign(new TextEncoder().encode(SESSION_SECRET));
  const old = `engosoft_session=${legacy}`;
  assert.equal((await call(old, '/auth/sessions', { userAgent: WINDOWS })).status, 200);
  const list = await (await call(mac, '/auth/sessions')).json();
  const win = list.sessions.find((session) => session.os === 'Windows' && !session.current);
  await call(mac, `/auth/sessions/${win.id}/revoke`, { method: 'POST' });
  // The browser never stored its upgraded cookie and comes back with the old one.
  assert.equal((await call(old, '/auth/sessions', { userAgent: WINDOWS })).status, 401);
});

test('logging out ends that device', async () => {
  const cookie = await login(MAC);
  assert.equal((await call(cookie, '/auth/logout', { method: 'POST' })).status, 200);
  assert.equal((await call(cookie, '/auth/sessions')).status, 401);
});
