/**
 * Attendance from the ZKTeco fingerprint service, joined to HR and Odoo.
 *
 * The pure rules (leave laid over a day) are tested directly; the routes and
 * the MCP tools run against a stand-in fingerprint service and a stand-in
 * Odoo, so nothing touches the network.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { effectiveStatus, leavesByDay, reconciledCounts } from './hr/attendance.js';

const ANNUAL = { id: 1, name: 'Annual leave', color: 4, away: false };
const WFH = { id: 2, name: 'Late permission', color: 7, away: true };

describe('time off over attendance days', () => {
  const leaves = [
    { id: 10, odooEmployeeId: 7, type: ANNUAL, from: '2026-11-24', to: '2026-11-24', days: 1, state: 'validate' },
    { id: 11, odooEmployeeId: 7, type: WFH, from: '2026-11-25', to: '2026-11-25', days: 0.25, state: 'validate', hours: true },
    { id: 12, odooEmployeeId: 7, type: ANNUAL, from: '2026-11-26', to: '2026-11-28', days: 3, state: 'confirm' },
    { id: 13, odooEmployeeId: 8, type: ANNUAL, from: '2026-11-23', to: '2026-11-23', days: 1, state: 'validate' },
    { id: 14, odooEmployeeId: 7, type: ANNUAL, from: '2026-11-23', to: '2026-11-23', days: 1, state: 'refuse' },
  ];

  test('maps each covered day of one person, clipped to the range, refused ones left out', () => {
    const days = leavesByDay(leaves, 7, '2026-11-23', '2026-11-27');
    assert.deepEqual([...days.keys()].sort(), ['2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27']);
    assert.equal(days.get('2026-11-24').approved, true);
    assert.equal(days.get('2026-11-25').away, true);
    assert.equal(days.get('2026-11-26').approved, false);
    assert.equal(leavesByDay(leaves, null, '2026-11-23', '2026-11-27').size, 0);
  });

  test('an approved full leave wins over an away type on the same day', () => {
    const both = [
      { id: 1, odooEmployeeId: 7, type: WFH, from: '2026-11-24', to: '2026-11-24', state: 'validate' },
      { id: 2, odooEmployeeId: 7, type: ANNUAL, from: '2026-11-24', to: '2026-11-24', state: 'validate' },
    ];
    assert.equal(leavesByDay(both, 7, '2026-11-24', '2026-11-24').get('2026-11-24').type, 'Annual leave');
  });

  test('absence under approved leave is leave, under an away type is away; pending changes nothing', () => {
    assert.equal(effectiveStatus('absent', { approved: true, away: false }), 'leave');
    assert.equal(effectiveStatus('absent', { approved: true, away: true }), 'away');
    assert.equal(effectiveStatus('pending', { approved: true, away: false }), 'leave');
    assert.equal(effectiveStatus('late', { approved: true, away: true }), 'excused');
    assert.equal(effectiveStatus('incomplete', { approved: true, away: true }), 'excused');
    assert.equal(effectiveStatus('late', { approved: true, away: false }), 'late');
    assert.equal(effectiveStatus('absent', { approved: false, away: false }), 'absent');
    assert.equal(effectiveStatus('absent', null), 'absent');
    assert.equal(effectiveStatus('ontime', { approved: true, away: false }), 'ontime');
  });

  test('counts what is left as unexcused', () => {
    const counts = reconciledCounts([
      { effective: 'leave', timeOff: { approved: true } },
      { effective: 'away', timeOff: { approved: true } },
      { effective: 'excused', timeOff: { approved: true } },
      { effective: 'absent', timeOff: { approved: false } },
      { effective: 'absent', timeOff: null },
      { effective: 'ontime', timeOff: null },
    ]);
    assert.deepEqual(counts, { leaveDays: 1, awayDays: 1, excusedDays: 1, unexcusedAbsences: 2, pendingLeaveDays: 1 });
  });
});

/* ── routes and MCP, against stand-ins ─────────────────────────── */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 49_000 + Math.floor(Math.random() * 900);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TOKEN = 'attendance-mcp-token-0123456789abcdef';
const ATTENDANCE_TOKEN = 'fingerprint-read-token-0123456789';

let dataDirectory;
let server;
let fingerprint;
let odoo;
let cookie = '';
const fingerprintCalls = [];

const day = (date, status, extra = {}) => ({ date, status, count: status === 'absent' ? 0 : 2, first: status === 'absent' ? null : '11:05:00', last: status === 'absent' ? null : '19:02:00', worked: status === 'absent' ? null : 477, late: status === 'late' ? 42 : 0, early: 0, overtime: 0, break: 0, type: 'work', weekday: 0, punches: [], ...extra });

function listen(handler) {
  return new Promise((resolve) => {
    const instance = http.createServer(handler);
    instance.listen(0, '127.0.0.1', () => resolve(instance));
  });
}

function startFingerprint() {
  return listen((req, res) => {
    const url = new URL(req.url, 'http://x');
    fingerprintCalls.push({ path: url.pathname, query: url.search, auth: req.headers.authorization });
    const json = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${ATTENDANCE_TOKEN}`) return json(401, { error: 'unauthorized' });
    const range = { from: '2026-11-23', to: '2026-11-25', today: '2026-11-25', real_today: '2026-11-25', data_until: '2026-11-25T15:00:00', unsynced_days: 0, snapshot: '2026-11-24' };
    if (url.pathname === '/dashboard/api/employees/216') {
      return json(200, {
        range,
        settings: { shift_start: '11:00' },
        shift: { start: 660, end: 1140 },
        employee: { code: '216', name: 'محمود', department: 'العمليات', expected_days: 3, present_days: 2, absent_days: 1, late_days: 1, early_days: 0, incomplete_days: 0, attendance_rate: 2 / 3, punctuality: 0.5, score: 60, in_office: true, shift: '11:00–19:00', effective_schedule: 'fixed', last_seen: '2026-11-25T19:02:00' },
        days: [day('2026-11-23', 'ontime'), day('2026-11-24', 'absent'), day('2026-11-25', 'late')],
        devices: [['zk_k50_01', 4]],
        weekday_arrival: [665, null, null, null, null, null, 670],
      });
    }
    if (url.pathname.startsWith('/dashboard/api/employees/')) return json(404, { error: 'employee not found' });
    if (url.pathname === '/dashboard/api/overview') {
      return json(200, {
        range,
        snapshot: { type: 'work', in_office: 0, people: { absent: [{ code: '216', name: 'محمود', department: 'العمليات', first: null, last: null, late: 0 }], ontime: [{ code: '91', name: 'سارة', department: 'التسويق', first: '10:58:00', last: '19:00:00', late: 0 }], in: [{ code: '64', name: 'علي', department: 'التسويق', first: '11:40:00', last: null, late: 40, in_office: true }, { code: '107', name: 'منى', department: 'التسويق', first: '10:50:00', last: null, late: 0, in_office: true }] } },
        leaders: { late: [{ code: '216', name: 'محمود', department: 'العمليات', value: 1 }] },
        feed: [],
      });
    }
    return json(404, { error: 'not found' });
  });
}

/** A minimal Odoo: one employee (registration 216) with one leave and one away permission. */
function startOdoo() {
  const rows = {
    'hr.employee': [{ id: 7, name: 'Mahmoud Hassan', registration_number: '216', work_email: 'mahmoud@test.local', department_id: [3, 'Operations'], job_title: 'Operations Manager', parent_id: false, active: true }],
    'hr.department': [{ id: 3, name: 'Operations', complete_name: 'Operations', manager_id: false, parent_id: false }],
    'hr.leave.type': [{ id: 1, name: 'Annual leave', color: 4, time_type: 'leave', active: true }, { id: 2, name: 'Late permission', color: 7, time_type: 'other', active: true }],
    'hr.leave': [
      { id: 10, employee_id: [7, 'Mahmoud Hassan'], holiday_status_id: [1, 'Annual leave'], request_date_from: '2026-11-24', request_date_to: '2026-11-24', number_of_days: 1, state: 'validate' },
      { id: 11, employee_id: [7, 'Mahmoud Hassan'], holiday_status_id: [2, 'Late permission'], request_date_from: '2026-11-25', request_date_to: '2026-11-25', number_of_days: 0.25, state: 'validate' },
      { id: 12, employee_id: [7, 'Mahmoud Hassan'], holiday_status_id: [1, 'Annual leave'], request_date_from: '2099-01-04', request_date_to: '2099-01-05', number_of_days: 2, state: 'confirm' },
    ],
    'hr.leave.allocation': [{ id: 20, employee_id: [7, 'Mahmoud Hassan'], holiday_status_id: [1, 'Annual leave'], number_of_days: 21, leaves_taken: 6, state: 'validate', date_from: '2026-01-01', date_to: false }],
  };
  return listen((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const message = JSON.parse(body || '{}');
      const { service, args = [] } = message.params ?? {};
      let result = [];
      if (service === 'common') result = 2;
      else {
        const model = args[3];
        const method = args[4];
        if (method === 'fields_get') {
          const fields = {};
          for (const row of rows[model] ?? []) for (const key of Object.keys(row)) fields[key] = { type: 'char' };
          for (const key of ['name', 'color', 'time_type', 'request_unit', 'requires_allocation', 'active', 'unpaid', 'sequence', 'leaves_taken', 'date_from', 'date_to', 'state']) fields[key] ??= { type: 'char' };
          result = fields;
        } else if (method === 'search_read') result = rows[model] ?? [];
        else if (method === 'read') result = [];
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
    });
  });
}

async function get(pathname) {
  const response = await fetch(`${ORIGIN}${pathname}`, { headers: { cookie } });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function mcpCall(name, args) {
  const response = await fetch(`${ORIGIN}/api/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await response.json();
  const text = body.result?.content?.[0]?.text ?? '';
  let json = null;
  try { json = JSON.parse(text); } catch { /* a plain-text tool error */ }
  return { result: body.result, text, json };
}

describe('attendance routes and MCP tools', () => {
  before(async () => {
    dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'qodo-attendance-test-'));
    fingerprint = await startFingerprint();
    odoo = await startOdoo();
    server = spawn(process.execPath, ['server/index.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        DATA_DIR: dataDirectory,
        PORT: String(PORT),
        NODE_ENV: 'test',
        ADMIN_EMAIL: 'admin@test.local',
        ADMIN_PASSWORD: 'AdminPass123!',
        SESSION_SECRET: 'attendance-test-session-secret-1234567',
        SSO_SECRET: 'attendance-test-sso-secret-12345678901',
        NOD_MCP_TOKEN: TOKEN,
        NOD_MCP_USER_EMAIL: 'admin@test.local',
        ATTENDANCE_API_URL: `http://127.0.0.1:${fingerprint.address().port}`,
        ATTENDANCE_API_TOKEN: ATTENDANCE_TOKEN,
        ODOO_URL: `http://127.0.0.1:${odoo.address().port}`,
        ODOO_DB: 'test',
        ODOO_LOGIN: 'bot@test.local',
        ODOO_API_KEY: 'odoo-test-key',
        HR_FX_LIVE: 'off',
        OPENAI_API_KEY: '',
        DATABASE_URL: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let errors = '';
    server.stderr.on('data', (chunk) => { errors += chunk.toString(); });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        if ((await fetch(`${ORIGIN}/api/health`)).ok) break;
      } catch {
        // still starting
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (attempt === 99) throw new Error(`test server did not start\n${errors}`);
    }
    const login = await fetch(`${ORIGIN}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@test.local', password: 'AdminPass123!' }) });
    cookie = (login.headers.getSetCookie?.() ?? [login.headers.get('set-cookie')]).map((value) => String(value).split(';')[0]).join('; ');
    assert.equal(login.status, 200);
  });

  after(async () => {
    if (server && !server.killed) server.kill();
    fingerprint?.close();
    odoo?.close();
    if (dataDirectory?.startsWith(os.tmpdir())) await fs.rm(dataDirectory, { recursive: true, force: true });
  });

  test('access says the fingerprint service is connected', async () => {
    const { body } = await get('/api/hr/access');
    assert.equal(body.access.attendance, true);
    assert.equal(body.access.attendanceConnected, true);
  });

  test("one person's days carry Odoo leave, and leave comes out of absence", async () => {
    const { status, body } = await get('/api/hr/employees/216/attendance?from=2026-11-23&to=2026-11-25');
    assert.equal(status, 200);
    assert.equal(body.found, true);
    assert.equal(body.hr.odooId, 7);
    assert.deepEqual(body.days.map((item) => item.effective), ['ontime', 'leave', 'excused']);
    assert.equal(body.days[1].timeOff.type, 'Annual leave');
    assert.equal(body.employee.leaveDays, 1);
    assert.equal(body.employee.unexcusedAbsences, 0);
    assert.equal(body.employee.adjusted_expected_days, 2);
    assert.equal(body.employee.adjusted_attendance_rate, 1);
    assert.equal(body.today.effective, 'excused');
    const sent = fingerprintCalls.find((item) => item.path === '/dashboard/api/employees/216');
    assert.equal(sent.auth, `Bearer ${ATTENDANCE_TOKEN}`);
    assert.match(sent.query, /from=2026-11-23/);
  });

  test('a code the devices never saw is found: false, a bad range is refused', async () => {
    assert.equal((await get('/api/hr/employees/999/attendance')).body.found, false);
    assert.equal((await get('/api/hr/employees/216/attendance?from=26-11-01')).status, 400);
  });

  test('the overview moves absent people on leave into their own list', async () => {
    const { body } = await get('/api/hr/attendance');
    assert.equal(body.connected, true);
    assert.equal(body.snapshot.people.absent.length, 0);
    assert.equal(body.snapshot.people.leave.length, 1);
    assert.equal(body.snapshot.people.leave[0].hr.hrCode, '216');
    assert.equal(body.leaders.late[0].hr.nameEnglish, 'Mahmoud Hassan');
    // In with one punch but after shift start + grace: late today, still in.
    assert.deepEqual(body.snapshot.people.late.map((row) => row.code), ['64']);
    assert.equal(body.snapshot.people.late[0].in_office, true);
    assert.deepEqual(body.snapshot.people.in.map((row) => row.code), ['107']);
  });

  test('the summary has job, attendance and leave balances, never pay', async () => {
    const { status, body } = await get('/api/hr/employees/216/summary?from=2026-11-23&to=2026-11-25');
    assert.equal(status, 200);
    assert.equal(body.name.english, 'Mahmoud Hassan');
    assert.equal(body.job.title, 'Operations Manager');
    assert.equal(body.attendance.leaveDays, 1);
    assert.equal(body.attendance.lateDays, 1);
    assert.deepEqual(body.timeOff.balances, [{ type: 'Annual leave', allocated: 21, taken: 6, remaining: 15 }]);
    assert.equal(body.timeOff.pending.length, 1);
    assert.ok(!JSON.stringify(body).includes('salary'));
  });

  test('people search finds by name and by code', async () => {
    assert.equal((await get('/api/hr/people/search?q=mahmoud')).body.matches[0].employeeCode, '216');
    assert.equal((await get('/api/hr/people/search?q=0216')).body.matches[0].score, 100);
  });

  test('hr_employee_profile answers by code and by name over MCP', async () => {
    const byCode = await mcpCall('hr_employee_profile', { employee: '216', from: '2026-11-23', to: '2026-11-25' });
    assert.equal(byCode.result.isError, false, byCode.text);
    assert.equal(byCode.json.employeeCode, '216');
    const byName = await mcpCall('hr_employee_profile', { employee: 'Mahmoud Hassan' });
    assert.equal(byName.json.name.english, 'Mahmoud Hassan');
    const nobody = await mcpCall('hr_employee_profile', { employee: 'Nobody Here' });
    assert.equal(nobody.result.isError, true);
  });

  test('hr_attendance_today lists people by status, narrowed to a department', async () => {
    const all = await mcpCall('hr_attendance_today', {});
    assert.equal(all.result.isError, false, all.text);
    assert.equal(all.json.counts.leave, 1);
    assert.equal(all.json.people.leave[0].timeOff, 'Annual leave');
    const marketing = await mcpCall('hr_attendance_today', { department: 'التسويق' });
    assert.deepEqual(Object.keys(marketing.json.people).sort(), ['in', 'late', 'ontime']);
  });
});
