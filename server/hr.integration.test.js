import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { PERMISSIONS } from '../shared/permissions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 47_000 + Math.floor(Math.random() * 1_000);
const ORIGIN = `http://127.0.0.1:${PORT}`;

let dataDirectory;
let server;
let adminCookie;
let employeeCookie;
let observerCookie;
let payrollCookie;

before(async () => {
  dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'qodo-hr-test-'));
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATA_DIR: dataDirectory,
      PORT: String(PORT),
      ADMIN_EMAIL: 'admin@test.local',
      ADMIN_PASSWORD: 'AdminPass123!',
      SESSION_SECRET: 'hr-test-session-secret-1234567890123',
      SSO_SECRET: 'hr-test-sso-secret-1234567890123456',
      HR_TELEGRAM_WEBHOOK_SECRET: 'hr-webhook-secret-123456',
      HR_TELEGRAM_CHAT_IDS: '12345',
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
  throw new Error(`HR test server did not start.\n${errors}`);
});

after(async () => {
  if (server && !server.killed) server.kill();
  if (dataDirectory?.startsWith(os.tmpdir())) {
    await fs.rm(dataDirectory, { recursive: true, force: true });
  }
});

async function request(pathname, { method = 'GET', body, cookie, headers = {}, raw = false } = {}) {
  const response = await fetch(`${ORIGIN}/api${pathname}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': raw ? 'application/octet-stream' : 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
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

async function workbookBuffer(kind) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(kind === 'master' ? 'Engosoft Data-Base' : 'Sheet1');
  if (kind === 'master') {
    sheet.addRow(['Company Information']);
    sheet.addRow([
      'Emp ID', 'Name English', 'Name', 'Sector', 'Department', 'Title', 'Direct Manager',
      'Hiring Date', 'Employee Status', 'Company Email address', 'Personal Mail', 'Mobile Number',
      'National ID', 'Gender', 'Birth Date', 'Address', 'CIB Name', 'CIB Status', 'CIB Number',
      'Document Rate', 'ID', 'Photo', 'CV',
    ]);
    sheet.addRow([
      611, 'Eyad Employee', 'إياد الموظف', 'Technology', 'AI', 'AI Engineer', 'CEO',
      new Date('2026-01-15'), 'Active', 'member@test.local', 'personal@test.local', '01000000000',
      '29901011234567', 'Male', new Date('1999-01-01'), 'Cairo', 'CIB', 'Active', '10001',
      0.6, 1, 1, 1,
    ]);
    sheet.addRow([
      307, 'Former Employee', 'موظف سابق', 'Development', 'Odoo', 'Implementor', 'Manager',
      new Date('2024-01-01'), 'In-Active', 'former@test.local', '', '', '28801011234567',
      'Male', new Date('1988-01-01'), 'Giza', '', '', '', 0.2, 1, 0, 0,
    ]);
  } else {
    sheet.addRow(['NO.', 'Emp ID', 'Name English', 'Title', 'KPI`S CONT', 'Department', 'Hiring Date', 'status', new Date('2026-08-01')]);
    sheet.addRow([null, null, null, null, null, null, null, null, new Date('2026-08-01'), 'KPI`S ', 'Total']);
    sheet.addRow(['1', 611, 'Eyad Employee', 'AI Engineer', 'YES', 'AI', new Date('2026-01-15'), 'Active', 27_500, 2_500, 30_000]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test('HR imports reconcile on employee code and preserve least-privilege profiles', async () => {
  adminCookie = await login('admin@test.local', 'AdminPass123!');
  const employee = await createUser({
    name: 'Eyad Employee', email: 'member@test.local', password: 'Member123!', role: 'member', department: 'general',
  });
  await createUser({
    name: 'HR Observer', email: 'observer@test.local', password: 'Observer123!', role: 'member', department: 'hr',
    permissions: [PERMISSIONS.APPS_VIEW, PERMISSIONS.TASKS_VIEW, PERMISSIONS.HR_VIEW],
  });
  await createUser({
    name: 'Payroll Owner', email: 'payroll@test.local', password: 'Payroll123!', role: 'member', department: 'hr',
    permissions: [
      PERMISSIONS.APPS_VIEW,
      PERMISSIONS.TASKS_VIEW,
      PERMISSIONS.HR_VIEW,
      PERMISSIONS.HR_MANAGE,
      PERMISSIONS.HR_PAYROLL,
    ],
  });

  const master = await request('/hr/imports/master', {
    method: 'POST', cookie: adminCookie, body: await workbookBuffer('master'), raw: true,
    headers: { 'X-File-Name': encodeURIComponent('employees.xlsx') },
  });
  assert.equal(master.status, 200, JSON.stringify(master.data));
  assert.equal(master.data.dataset.summary.rows, 2);
  assert.equal(master.data.dataset.summary.active, 1);

  const payroll = await request('/hr/imports/payroll', {
    method: 'POST', cookie: adminCookie, body: await workbookBuffer('payroll'), raw: true,
    headers: { 'X-File-Name': encodeURIComponent('payroll-2026-08.xlsx') },
  });
  assert.equal(payroll.status, 200, JSON.stringify(payroll.data));
  assert.equal(payroll.data.dataset.summary.totalPayroll, 30_000);

  employeeCookie = await login(employee.email, 'Member123!');
  observerCookie = await login('observer@test.local', 'Observer123!');
  payrollCookie = await login('payroll@test.local', 'Payroll123!');

  const selfDashboard = await request('/hr/dashboard', { cookie: employeeCookie });
  assert.equal(selfDashboard.status, 200);
  assert.equal(selfDashboard.data.permissions.selfOnly, true);
  assert.deepEqual(selfDashboard.data.employees.map((row) => row.employeeCode), ['611']);
  assert.equal(selfDashboard.data.summary.employees, 1);
  assert.deepEqual(selfDashboard.data.recruitment, []);

  const ownProfile = await request('/hr/employees/611', { cookie: employeeCookie });
  assert.equal(ownProfile.status, 200);
  assert.equal(ownProfile.data.employee.payroll.totalSalary, 30_000);
  assert.equal(ownProfile.data.employee.nationalId, '29901011234567');

  const forbiddenProfile = await request('/hr/employees/307', { cookie: employeeCookie });
  assert.equal(forbiddenProfile.status, 403);

  const observerDashboard = await request('/hr/dashboard', { cookie: observerCookie });
  assert.equal(observerDashboard.data.employees.length, 2);
  assert.equal(Object.hasOwn(observerDashboard.data.employees[0], 'totalSalary'), false);
  const observerProfile = await request('/hr/employees/611', { cookie: observerCookie });
  assert.equal(observerProfile.data.employee.nationalId, '••••4567');
  assert.equal(observerProfile.data.employee.payroll, null);

  const updated = await request('/hr/employees/611/payroll', {
    method: 'PATCH', cookie: payrollCookie, body: { totalSalary: 31_500, baseSalary: 28_500 },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.data));
  assert.equal(updated.data.employee.payroll.totalSalary, 31_500);

  const mismatch = await request('/hr/imports/payroll', {
    method: 'POST', cookie: adminCookie, body: await workbookBuffer('master'), raw: true,
    headers: { 'X-File-Name': encodeURIComponent('wrong.xlsx') },
  });
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.data.error, 'hr_source_mismatch');
});

test('the Telegram endpoint rejects unauthorised webhook calls before downloading files', async () => {
  const missingSecret = await request('/hr/telegram', {
    method: 'POST',
    body: { message: { chat: { id: 12345 }, document: { file_id: 'never-downloaded', file_name: 'payroll.xlsx' } } },
  });
  assert.equal(missingSecret.status, 403);

  const wrongChat = await request('/hr/telegram', {
    method: 'POST',
    headers: { 'X-Telegram-Bot-Api-Secret-Token': 'hr-webhook-secret-123456' },
    body: { message: { chat: { id: 99999 }, document: { file_id: 'never-downloaded', file_name: 'payroll.xlsx' } } },
  });
  assert.equal(wrongChat.status, 403);
  assert.equal(wrongChat.data.error, 'hr_telegram_chat_forbidden');
});
