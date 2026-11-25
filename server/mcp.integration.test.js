import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 48_000 + Math.floor(Math.random() * 1_000);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TOKEN = 'mcp-test-token-0123456789abcdef';
const UPSTREAM_TOKEN = 'upstream-token-0123456789';

let dataDirectory;
let server;
let upstream;
let upstreamCalls = [];

/** A stand-in for the Insights Hub MCP, so the gateway is tested without the network. */
function startUpstream() {
  return new Promise((resolve) => {
    upstream = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        if (req.headers.authorization !== `Bearer ${UPSTREAM_TOKEN}`) {
          res.writeHead(401).end('{}');
          return;
        }
        const message = JSON.parse(body);
        upstreamCalls.push(message);
        const result = message.method === 'tools/list'
          ? { tools: [
            { name: 'insights_get', title: 'Read', description: 'Reads.', inputSchema: { type: 'object', properties: {} } },
            { name: 'insights_read', description: 'Reads a surface.', inputSchema: { type: 'object', properties: {} } },
            { name: 'insights_refresh_data', description: 'Refresh.', annotations: { readOnlyHint: false } },
            { name: 'list_team', description: 'Collides with a workspace tool and must be skipped.' },
          ] }
          : { content: [{ type: 'text', text: 'from upstream' }], isError: false, structuredContent: { echoed: message.params } };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
      });
    });
    upstream.listen(0, '127.0.0.1', () => resolve(upstream.address().port));
  });
}

async function rpc(method, params = {}, token = TOKEN) {
  const response = await fetch(`${ORIGIN}/api/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return { status: response.status, body: await response.json() };
}

const call = async (name, args = {}) => {
  const { body } = await rpc('tools/call', { name, arguments: args });
  const text = body.result?.content?.[0]?.text ?? '';
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* plain-text tool error */ }
  return { result: body.result, text, json: parsed };
};

before(async () => {
  dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'qodo-mcp-test-'));
  const upstreamPort = await startUpstream();
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATA_DIR: dataDirectory,
      PORT: String(PORT),
      ADMIN_EMAIL: 'admin@test.local',
      ADMIN_PASSWORD: 'AdminPass123!',
      SESSION_SECRET: 'mcp-test-session-secret-123456789012',
      SSO_SECRET: 'mcp-test-sso-secret-12345678901234567',
      NOD_MCP_TOKEN: TOKEN,
      NOD_MCP_USER_EMAIL: 'admin@test.local',
      // The gateway only accepts https upstreams; the test points it at a local http
      // stand-in through the override below.
      INSIGHTS_MCP_URL: `http://127.0.0.1:${upstreamPort}/mcp`,
      INSIGHTS_MCP_TOKEN: UPSTREAM_TOKEN,
      MCP_GATEWAY_ALLOW_HTTP: '1',
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
  throw new Error(`MCP test server did not start.\n${errors}`);
});

after(async () => {
  if (server && !server.killed) server.kill();
  upstream?.close();
  if (dataDirectory?.startsWith(os.tmpdir())) await fs.rm(dataDirectory, { recursive: true, force: true });
});

test('refuses a missing or wrong token', async () => {
  assert.equal((await rpc('tools/list', {}, 'wrong')).status, 401);
});

test('lists the workspace tools, the full-read tools and the upstream tools once', async () => {
  const { body } = await rpc('tools/list');
  const names = body.result.tools.map((tool) => tool.name);
  for (const name of ['list_team', 'create_task', 'qodo_list_endpoints', 'qodo_get', 'insights_get']) {
    assert.ok(names.includes(name), `${name} missing`);
  }
  assert.equal(names.filter((name) => name === 'list_team').length, 1);
  assert.match(body.result.tools.find((tool) => tool.name === 'insights_get').description, /Insights Hub/);
});

test('catalogues every module, HR first among them, and leaves mail and files out', async () => {
  const { json } = await call('qodo_list_endpoints');
  const all = Object.values(json.modules).flatMap((module) => module.endpoints);
  for (const route of [
    '/api/hr/people',
    '/api/hr/overview',
    '/api/hr/payroll',
    '/api/hr/personnel/leave',
    '/api/hr/employees/:employeeCode',
    '/api/hr/recruitment/requests',
    '/api/hr/recruitment/offers',
    '/api/kpi/overview',
    '/api/tasks',
    '/api/events/elearning/analytics',
    '/api/learning-production/courses',
  ]) {
    assert.ok(all.includes(route), `${route} missing`);
  }
  for (const route of ['/api/projects/:projectId/tasks', '/api/projects/:projectId/budget', '/api/projects/:projectId/issues']) {
    assert.ok(all.includes(route), `${route} missing`);
  }
  assert.equal(all.filter((route) => route.includes('(?:')).length, 0, 'a mount path was not rebuilt');
  assert.equal(all.filter((route) => route.startsWith('/api/mail')).length, 0);
  assert.equal(all.filter((route) => /\/(files|attachments)(\/|$)|\/stream$|\/photo$/.test(route)).length, 0);
  assert.equal(all.filter((route) => route.startsWith('/api/auth') || route.startsWith('/api/mcp')).length, 0);
});

test('reads HR and other modules as the MCP account', async () => {
  for (const endpoint of ['/api/hr/overview', '/api/hr/people', '/api/kpi/overview', '/api/users']) {
    const { json, text } = await call('qodo_get', { endpoint });
    assert.ok(json, `${endpoint}: ${text}`);
    assert.equal(json.httpStatus, 200, `${endpoint}: ${text.slice(0, 300)}`);
  }
});

test('refuses excluded and unknown endpoints', async () => {
  for (const endpoint of ['/api/mail/bootstrap', '/api/auth/me', '/api/mcp', 'http://evil.example/api/users', '/api/../api/users', '/api/nope']) {
    const { result } = await call('qodo_get', { endpoint });
    assert.equal(result.isError, true, endpoint);
  }
});

test('pages a large list without dropping items', async () => {
  const first = await call('qodo_get', { endpoint: '/api/users', path: 'users', limit: 1 });
  assert.equal(first.json.kind, 'array');
  assert.equal(first.json.returned, 1);
});

test('an outside request cannot pose as the internal caller', async () => {
  const response = await fetch(`${ORIGIN}/api/users`, {
    headers: { 'x-engosoft-internal-key': 'guess', 'x-engosoft-internal-user': 'anything' },
  });
  assert.equal(response.status, 401);
});

test('forwards upstream tool calls untouched', async () => {
  upstreamCalls = [];
  const { result } = await call('insights_get', { endpoint: '/api/ads' });
  assert.equal(result.content[0].text, 'from upstream');
  assert.deepEqual(result.structuredContent.echoed, { name: 'insights_get', arguments: { endpoint: '/api/ads' } });
  assert.equal(upstreamCalls.at(-1).method, 'tools/call');
});

test('every call lands in the activity log under mcp.*, refused tokens too', async () => {
  await call('qodo_get', { endpoint: '/api/hr/overview' });
  await call('qodo_get', { endpoint: '/api/mail/bootstrap' });
  await rpc('tools/list', {}, 'definitely-wrong');
  await new Promise((resolve) => setTimeout(resolve, 300));
  const { json } = await call('qodo_get', { endpoint: '/api/notifications/activity', params: { action: 'mcp' }, path: 'activity', limit: 200 });
  const entries = json.data;
  const read = entries.find((entry) => entry.action === 'mcp.read' && entry.meta?.target === '/api/hr/overview');
  assert.ok(read, 'the HR read is logged');
  assert.equal(read.meta.tool, 'qodo_get');
  assert.equal(read.meta.ok, true);
  assert.equal(read.meta.httpStatus, 200);
  assert.ok(Number.isInteger(read.meta.ms));
  assert.ok(entries.some((entry) => entry.action === 'mcp.failed' && entry.meta?.target === '/api/mail/bootstrap'), 'the refused read is logged');
  assert.ok(entries.some((entry) => entry.action === 'mcp.write' || entry.action === 'mcp.read'));
  assert.ok(entries.some((entry) => entry.action === 'mcp.unauthorized' && entry.actorId === null), 'the wrong token is logged');
  assert.ok(entries.some((entry) => entry.meta?.tool === 'insights_get'), 'forwarded calls are logged');
});

/* ── Personal keys ──────────────────────────────────────────────────── */

async function adminCookie() {
  const response = await fetch(`${ORIGIN}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@test.local', password: 'AdminPass123!' }),
  });
  assert.equal(response.status, 200);
  return (response.headers.get('set-cookie') || '').split(';')[0];
}

async function keysApi(cookie, path = '', body) {
  const response = await fetch(`${ORIGIN}/api/mcp-keys${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json() };
}

async function callWith(token, name, args = {}) {
  const { body, status } = await rpc('tools/call', { name, arguments: args }, token);
  const text = body?.result?.content?.[0]?.text ?? '';
  let json = null;
  try { json = JSON.parse(text); } catch { /* text */ }
  return { status, result: body?.result, error: body?.error, text, json };
}

test('the keys API is admin only and never readable through the MCP', async () => {
  assert.equal((await fetch(`${ORIGIN}/api/mcp-keys`)).status, 401);
  const { result } = await call('qodo_get', { endpoint: '/api/mcp-keys' });
  assert.equal(result.isError, true);
});

test('an HR-only key sees and reads HR, and nothing else', async () => {
  const cookie = await adminCookie();
  const created = await keysApi(cookie, '', { name: 'HR reader', scopes: { qodo: ['hr'] } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const token = created.data.token;
  assert.match(token, /^qmk_/);
  assert.equal(JSON.stringify((await keysApi(cookie)).data).includes(token), false, 'the key is never listed again');

  const names = (await rpc('tools/list', {}, token)).body.result.tools.map((tool) => tool.name);
  assert.ok(names.includes('qodo_get') && names.includes('qodo_list_endpoints'));
  for (const hidden of ['list_projects', 'create_task', 'decision_brief', 'list_team', 'insights_get']) {
    assert.ok(!names.includes(hidden), `${hidden} should be hidden`);
  }

  const listing = await callWith(token, 'qodo_list_endpoints');
  const all = Object.values(listing.json.modules).flatMap((module) => module.endpoints);
  assert.ok(all.length > 0 && all.every((path) => path.startsWith('/api/hr')), 'only HR endpoints are listed');

  assert.equal((await callWith(token, 'qodo_get', { endpoint: '/api/hr/overview' })).json.httpStatus, 200);
  for (const endpoint of ['/api/tasks', '/api/kpi/overview', '/api/users', '/api/search', '/api/hr%2F..%2Ftasks', '/api/hr/../tasks']) {
    const refused = await callWith(token, 'qodo_get', { endpoint });
    assert.equal(refused.result?.isError, true, endpoint);
  }
  assert.ok((await callWith(token, 'create_task', { title: 'x' })).error, 'a hidden tool cannot be called');
});

test('an Insights-only key reaches the upstream and nothing in Qodo', async () => {
  const cookie = await adminCookie();
  const { data } = await keysApi(cookie, '', { name: 'Insights ads', scopes: { insights: ['marketing'] } });
  const names = (await rpc('tools/list', {}, data.token)).body.result.tools.map((tool) => tool.name);
  assert.ok(names.includes('insights_get'));
  assert.ok(!names.some((name) => name.startsWith('qodo_') || name === 'list_team'));
  assert.equal((await callWith(data.token, 'insights_get', { endpoint: '/api/ads' })).result.isError, false);
  assert.equal((await callWith(data.token, 'insights_get', { endpoint: '/api/profitability' })).result.isError, true);
  assert.equal((await callWith(data.token, 'insights_read', { surface: 'accounting', view: 'profitability' })).result.isError, true);
  assert.equal((await callWith(data.token, 'insights_read', { surface: 'ads' })).result.isError, false);
  assert.ok(!names.includes('insights_refresh_data'), 'actions stay hidden without the actions switch');
  const withActions = await keysApi(cookie, '', { name: 'Insights admin', scopes: { insights: null, actions: true } });
  const actionNames = (await rpc('tools/list', {}, withActions.data.token)).body.result.tools.map((tool) => tool.name);
  assert.ok(actionNames.includes('insights_refresh_data'));
});

test('revoking a key stops it at once and logs who used which key', async () => {
  const cookie = await adminCookie();
  const { data } = await keysApi(cookie, '', { name: 'Leaver', scopes: { qodo: null } });
  assert.equal((await callWith(data.token, 'qodo_get', { endpoint: '/api/hr/overview' })).json.httpStatus, 200);
  const revoked = await keysApi(cookie, `/${data.key.id}/revoke`, {});
  assert.equal(revoked.data.key.status, 'revoked');
  assert.equal((await rpc('tools/list', {}, data.token)).status, 401);
  // The master key keeps working.
  assert.equal((await rpc('tools/list')).status, 200);

  await new Promise((resolve) => setTimeout(resolve, 300));
  const log = await call('qodo_get', { endpoint: '/api/notifications/activity', params: { action: 'mcp' }, path: 'activity', limit: 300 });
  const entries = log.json.data;
  assert.ok(entries.some((entry) => entry.meta?.keyName === 'Leaver' && entry.meta?.target === '/api/hr/overview'));
  assert.ok(entries.some((entry) => entry.action === 'mcp.key.revoke' && entry.meta?.name === 'Leaver'));
  assert.ok(entries.some((entry) => entry.meta?.keyName === 'HR reader' && entry.meta?.refused === true));
});

test('an expired or unknown key is refused', async () => {
  assert.equal((await rpc('tools/list', {}, 'qmk_not-a-real-key')).status, 401);
  const cookie = await adminCookie();
  assert.equal((await keysApi(cookie, '', { name: 'bad', scopes: {} })).status, 400, 'a key needs at least one dashboard');
  assert.equal((await keysApi(cookie, '', { name: 'bad', scopes: { qodo: null }, expiresInDays: 0 })).status, 400);
});
