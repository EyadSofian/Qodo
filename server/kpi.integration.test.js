import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERMISSIONS } from '../shared/permissions.js';
import { kpiTemplateById } from '../shared/kpi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 48_000 + Math.floor(Math.random() * 1_000);
const ORIGIN = `http://127.0.0.1:${PORT}`;

let dataDirectory;
let server;
let adminCookie;
let memberCookie;
let observerCookie;
let memberId;

before(async () => {
  dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'qodo-kpi-test-'));
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATA_DIR: dataDirectory,
      PORT: String(PORT),
      ADMIN_EMAIL: 'admin@test.local',
      ADMIN_PASSWORD: 'AdminPass123!',
      SESSION_SECRET: 'kpi-test-session-secret-1234567890123',
      SSO_SECRET: 'kpi-test-sso-secret-1234567890123456',
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
  throw new Error(`KPI test server did not start.\n${errors}`);
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
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null };
}

async function login(email, password) {
  const result = await request('/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.cookie;
}

test('the catalogue is readable by anyone signed in and filing a card is not', async () => {
  adminCookie = await login('admin@test.local', 'AdminPass123!');

  const created = await request('/users', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: 'KPI Member', email: 'member@test.local', password: 'Member123!',
      role: 'member', department: 'hr',
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  memberId = created.data.user.id;

  const observer = await request('/users', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: 'KPI Observer', email: 'observer@test.local', password: 'Observer123!',
      role: 'member', department: 'hr',
      permissions: [PERMISSIONS.APPS_VIEW, PERMISSIONS.TASKS_VIEW, PERMISSIONS.HR_VIEW],
    },
  });
  assert.equal(observer.status, 201, JSON.stringify(observer.data));

  memberCookie = await login('member@test.local', 'Member123!');
  observerCookie = await login('observer@test.local', 'Observer123!');

  assert.equal((await request('/kpi/catalogue')).status, 401);
  const catalogue = await request('/kpi/catalogue', { cookie: memberCookie });
  assert.equal(catalogue.status, 200);
  assert.equal(catalogue.data.templates.length, 5);

  // Reading the catalogue is not permission to grade anyone with it.
  const refused = await request('/kpi/scorecards', {
    method: 'POST', cookie: memberCookie,
    body: { templateId: 'hr_manager', period: '2026-07', subjectType: 'user', subjectId: memberId },
  });
  assert.equal(refused.status, 403);
  const observerRefused = await request('/kpi/scorecards', {
    method: 'POST', cookie: observerCookie,
    body: { templateId: 'hr_manager', period: '2026-07', subjectType: 'user', subjectId: memberId },
  });
  assert.equal(observerRefused.status, 403, 'hr.view alone must not be able to file a scorecard');
});

test('a scorecard scores what was recorded and refuses what the template does not declare', async () => {
  const created = await request('/kpi/scorecards', {
    method: 'POST', cookie: adminCookie,
    body: { templateId: 'hr_manager', period: '2026-07', subjectType: 'user', subjectId: memberId },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const { id } = created.data.scorecard;
  assert.equal(created.data.scorecard.status, 'draft');
  assert.equal(created.data.scorecard.result.approved.percent, null);

  // The same person, template and month is one record, not two.
  const duplicate = await request('/kpi/scorecards', {
    method: 'POST', cookie: adminCookie,
    body: { templateId: 'hr_manager', period: '2026-07', subjectType: 'user', subjectId: memberId },
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.data.error, 'kpi_scorecard_exists');

  const bogus = await request(`/kpi/scorecards/${id}`, {
    method: 'PATCH', cookie: adminCookie, body: { values: { 'kpi-not-real': { actual: 1 } } },
  });
  assert.equal(bogus.status, 400);
  assert.equal(bogus.data.error, 'kpi_unknown_indicator');

  const badState = await request(`/kpi/scorecards/${id}`, {
    method: 'PATCH', cookie: adminCookie, body: { checks: { 'chk-1-1': 'excellent' } },
  });
  assert.equal(badState.status, 400);
  assert.equal(badState.data.error, 'kpi_check_state_invalid');

  const scored = await request(`/kpi/scorecards/${id}`, {
    method: 'PATCH', cookie: adminCookie,
    body: {
      values: {
        'kpi-1-1': { actual: 5 }, 'kpi-1-2': { actual: 3 },
        'kpi-1-3': { actual: 4 }, 'kpi-1-4': { actual: 5 },
      },
    },
  });
  assert.equal(scored.status, 200, JSON.stringify(scored.data));
  const planning = scored.data.scorecard.result.groups.find((group) => group.id === 'axis-1');
  assert.ok(Math.abs(planning.score - 19) < 1e-6, `planning axis scored ${planning.score}`);
  // The four untouched axes stay out of the denominator instead of scoring zero.
  assert.equal(scored.data.scorecard.result.approved.max, 20);
  assert.equal(Math.round(scored.data.scorecard.result.approved.percent), 95);
  assert.equal(scored.data.scorecard.result.completeness.complete, false);
});

test('finalising is refused until every row is answered, and then the record locks', async () => {
  const template = kpiTemplateById('personnel_specialist');
  const created = await request('/kpi/scorecards', {
    method: 'POST', cookie: adminCookie,
    body: { templateId: template.id, period: '2026-07', subjectType: 'user', subjectId: memberId },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const { id } = created.data.scorecard;

  const tooEarly = await request(`/kpi/scorecards/${id}/status`, {
    method: 'POST', cookie: adminCookie, body: { status: 'final' },
  });
  assert.equal(tooEarly.status, 409);
  assert.equal(tooEarly.data.error, 'kpi_scorecard_incomplete');

  const filled = await request(`/kpi/scorecards/${id}`, {
    method: 'PATCH', cookie: adminCookie,
    body: {
      values: Object.fromEntries(
        template.groups.flatMap((group) => group.kpis.map((kpi) => [kpi.id, { actual: 1 }]))
      ),
      checks: Object.fromEntries(
        template.groups.flatMap((group) => group.checklist.map((item) => [item.id, 'done']))
      ),
    },
  });
  assert.equal(filled.status, 200, JSON.stringify(filled.data));
  assert.equal(filled.data.scorecard.result.completeness.complete, true);
  assert.equal(Math.round(filled.data.scorecard.result.approved.percent), 100);

  const finalised = await request(`/kpi/scorecards/${id}/status`, {
    method: 'POST', cookie: adminCookie, body: { status: 'final' },
  });
  assert.equal(finalised.status, 200, JSON.stringify(finalised.data));
  assert.equal(finalised.data.scorecard.status, 'final');
  assert.ok(finalised.data.scorecard.finalizedAt);

  // A signed month does not quietly accept another edit, or a delete.
  const locked = await request(`/kpi/scorecards/${id}`, {
    method: 'PATCH', cookie: adminCookie, body: { values: { [template.groups[0].kpis[0].id]: { actual: 0 } } },
  });
  assert.equal(locked.status, 409);
  assert.equal(locked.data.error, 'kpi_scorecard_final');
  assert.equal((await request(`/kpi/scorecards/${id}`, { method: 'DELETE', cookie: adminCookie })).status, 409);

  const reopened = await request(`/kpi/scorecards/${id}/status`, {
    method: 'POST', cookie: adminCookie, body: { status: 'draft' },
  });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.data.scorecard.status, 'draft');
  assert.equal(reopened.data.scorecard.finalizedAt, null);
});

test('a member reads their own scorecard and nobody else’s', async () => {
  const other = await request('/users', {
    method: 'POST', cookie: adminCookie,
    body: { name: 'Other Person', email: 'other@test.local', password: 'Other1234!', role: 'member', department: 'hr' },
  });
  assert.equal(other.status, 201, JSON.stringify(other.data));

  const theirs = await request('/kpi/scorecards', {
    method: 'POST', cookie: adminCookie,
    body: { templateId: 'marketing_manager', period: '2026-07', subjectType: 'user', subjectId: other.data.user.id },
  });
  assert.equal(theirs.status, 201);

  const overview = await request('/kpi/overview', { cookie: memberCookie });
  assert.equal(overview.status, 200);
  assert.equal(overview.data.permissions.selfOnly, true);
  assert.equal(overview.data.templates.length, 5, 'the catalogue is not a secret');
  assert.ok(overview.data.scorecards.length >= 1);
  assert.ok(
    overview.data.scorecards.every((card) => card.subjectId === memberId),
    'a self-only member must not see another person in the list'
  );
  // The list view withholds the raw entry, and a direct read of somebody
  // else's card is refused outright.
  assert.equal(overview.data.scorecards[0].values, undefined);
  assert.equal((await request(`/kpi/scorecards/${theirs.data.scorecard.id}`, { cookie: memberCookie })).status, 403);

  // hr.view is enough to read the whole organisation's cards.
  const observed = await request('/kpi/overview', { cookie: observerCookie });
  assert.equal(observed.status, 200);
  assert.equal(observed.data.permissions.selfOnly, false);
  assert.ok(observed.data.scorecards.length >= 3);
  assert.equal(
    (await request(`/kpi/scorecards/${theirs.data.scorecard.id}`, { cookie: observerCookie })).status,
    200
  );
});

test('an unknown template, month or subject is rejected before anything is stored', async () => {
  const cases = [
    [{ templateId: 'nope', period: '2026-07', subjectType: 'user', subjectId: memberId }, 400, 'kpi_template_unknown'],
    [{ templateId: 'hr_manager', period: '2026-13', subjectType: 'user', subjectId: memberId }, 400, 'kpi_period_invalid'],
    [{ templateId: 'hr_manager', period: 'July', subjectType: 'user', subjectId: memberId }, 400, 'kpi_period_invalid'],
    [{ templateId: 'hr_manager', period: '2026-07', subjectType: 'ghost', subjectId: memberId }, 400, 'kpi_subject_type_invalid'],
    [{ templateId: 'hr_manager', period: '2026-07', subjectType: 'user', subjectId: 'missing' }, 404, 'kpi_subject_not_found'],
    [{ templateId: 'hr_manager', period: '2026-07', subjectType: 'employee', subjectId: '611' }, 404, 'kpi_subject_not_found'],
  ];
  for (const [body, status, code] of cases) {
    const result = await request('/kpi/scorecards', { method: 'POST', cookie: adminCookie, body });
    assert.equal(result.status, status, `${JSON.stringify(body)} -> ${JSON.stringify(result.data)}`);
    assert.equal(result.data.error, code);
  }
});
