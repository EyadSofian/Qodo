/**
 * HR V2 recruitment, end to end over HTTP against a real server process.
 *
 * The people mirror production's shape: two recruitment specialists and an HR
 * manager in the employee database (none of them with a Qodo account), a
 * department manager who asks for hires, that department's reviewer, an HR
 * lead with the frozen `hr.manage` array HR staff carry today, and a final
 * approver who alone holds Extend.
 */

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { PERMISSIONS as P } from '../shared/permissions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 48_000 + Math.floor(Math.random() * 1_000);
const ORIGIN = `http://127.0.0.1:${PORT}`;

let dataDirectory;
let server;
const cookies = {};

async function startServer() {
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATA_DIR: dataDirectory,
      PORT: String(PORT),
      ADMIN_EMAIL: 'admin@test.local',
      ADMIN_PASSWORD: 'AdminPass123!',
      SESSION_SECRET: 'recruitment-test-session-secret-123456',
      SSO_SECRET: 'recruitment-test-sso-secret-1234567890',
      HR_FX_LIVE: 'off',
      OPENAI_API_KEY: '',
      DATABASE_URL: '',
      ODOO_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let errors = '';
  server.stderr.on('data', (chunk) => { errors += chunk.toString(); });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(`${ORIGIN}/api/health`)).ok) return;
    } catch {
      // still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`recruitment test server did not start.\n${errors}`);
}

async function stopServer() {
  if (!server || server.killed) return;
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill();
  await exited;
}

before(async () => {
  dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'qodo-recruitment-test-'));
  await startServer();
});

after(async () => {
  await stopServer();
  if (dataDirectory?.startsWith(os.tmpdir())) await fs.rm(dataDirectory, { recursive: true, force: true });
});

async function request(pathname, { method = 'GET', body, as, headers = {}, raw = false } = {}) {
  const response = await fetch(`${ORIGIN}/api${pathname}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': raw ? 'application/octet-stream' : 'application/json' }),
      ...(as ? { Cookie: cookies[as] } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null };
}

async function login(key, email, password) {
  const result = await request('/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  cookies[key] = result.cookie;
}

async function createUser(body) {
  const result = await request('/users', { method: 'POST', body, as: 'admin' });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data.user;
}

async function workbook(kind) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(kind === 'master' ? 'Engosoft Data-Base' : 'Sheet1');
  if (kind === 'master') {
    sheet.addRow(['Company Information']);
    sheet.addRow(['Emp ID', 'Name English', 'Name', 'Sector', 'Department', 'Title', 'Direct Manager', 'Hiring Date', 'Employee Status', 'Company Email address', 'Gender', 'Birth Date', 'Document Rate']);
    sheet.addRow([257, 'Shahinda Samir Shaaban Muhammad', 'شهندا سمير شعبان محمد', 'HR', 'Human Resources', 'Recruitment specialist', 'HR Manager', new Date('2022-11-27'), 'Active', 'shahinda@test.local', 'Female', new Date('1996-03-01'), 1]);
    sheet.addRow([420, 'Yasmin Ashraf Ahmed El sayed', 'ياسمين أشرف أحمد السيد', 'HR', 'Human Resources', 'Recruitment specialist', 'HR Manager', new Date('2024-03-17'), 'Active', 'yasmin@test.local', 'Female', new Date('1998-05-01'), 1]);
    sheet.addRow([389, 'Salah Alddin Muhammad Ragab', 'صلاح الدين محمد رجب', 'HR', 'Human Resources', 'HR Manager', 'CEO', new Date('2023-10-10'), 'Active', 'salah@test.local', 'Male', new Date('1985-01-01'), 1]);
    sheet.addRow([522, 'Aya Tullah Ahmed Hamdy Fouad', 'ايه الله احمد حمدى فوائد', 'Sales B2B', 'Human Resources', 'Recruitment Specialist', 'HR Manager', new Date('2024-12-22'), 'In-Active', 'aya@test.local', 'Female', new Date('1999-01-01'), 1]);
    sheet.addRow([700, 'Omar Trainer', 'عمر المدرب', 'Training', 'Instructor Department', 'Mechanical Instructor', 'Training Manager', new Date('2025-01-01'), 'Active', 'omar@test.local', 'Male', new Date('1990-01-01'), 0.5]);
  } else if (kind === 'payroll') {
    sheet.addRow(['NO.', 'Emp ID', 'Name English', 'Title', 'KPI`S CONT', 'Department', 'Hiring Date', 'status', new Date('2026-09-01')]);
    sheet.addRow([null, null, null, null, null, null, null, null, new Date('2026-09-01'), 'KPI`S ', 'Total']);
    sheet.addRow(['1', 257, 'Shahinda Samir Shaaban Muhammad', 'Recruitment specialist', 'YES', 'Human Resources', new Date('2022-11-27'), 'Active', 18_000, 2_000, 20_000]);
  } else {
    sheet.addRow(['Recruitment Report 8\\9-2026']);
    sheet.addRow(['NO.', 'Total', 'Number needed', 'Accepted NUMB.', 'FeedBack', 'Department', 'Vacancy Reason', 'Status', 'priority', 'Seniority', 'Location', 'Assigned to I', 'Assigned to II', 'Hiring Period', 'Active Date', 'Due date / Time of hire', 'Actual Hiring Date', 'Received Requirements', 'Published', 'Received Candidate', 'Salary Range', 'Actual Salary', 'Interviewer', 'Validation']);
    sheet.addRow([1, 'Telesales(KSA)', 10, 6, '', 'Sales', 'New', 'Active', 'top', 'Noraml', 'EG', 'Yasmin', '', 45, new Date('2026-08-23'), new Date('2026-10-05'), '', 'Done', 'Done', 'Wiat', '20k', '', 'Mahfouz', 'Eng.Taha']);
    sheet.addRow([2, 'CFM Instructor', 1, 0, '', 'Instructor', 'New', 'Active', 'top', 'High', 'KSA', 'Shahinda', 'Salah', 30, new Date('2026-09-10'), new Date('2026-10-12'), '', 'Done', 'Wiat', 'Wiat', '1000 SAR', '', 'Eng.Taha', 'Eng.Taha']);
    sheet.addRow([3, 'Interior', 0, 0, '', '', '', 'Done', 'med', 'Noraml', 'EG', 'Aya', '', 0, new Date('2026-01-15'), new Date('2026-02-10'), '', '', '', '', '', '', '', '']);
    sheet.addRow([4, 'BIM Struc', 0, 0, '', '', '', 'Hold', 'med', 'Noraml', 'EG', 'Fatima', '', 0, new Date('2026-01-15'), new Date('2026-02-01'), '', '', '', '', '', '', '', '']);
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

async function upload(source) {
  const result = await request(`/hr/imports/${source}`, {
    method: 'POST', as: 'admin', raw: true, body: await workbook(source),
    headers: { 'X-File-Name': encodeURIComponent(`${source}.xlsx`) },
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data;
}

const draft = (overrides = {}) => ({
  title: 'Senior Mechanical Instructor',
  department: 'Instructor Department',
  departmentId: 'training',
  location: 'Cairo',
  headcount: 1,
  classification: 'instructor',
  reason: 'new',
  responsibilities: 'Deliver the mechanical maintenance track.',
  requirements: 'Five years of plant maintenance, two of training.',
  salaryRange: { min: 20000, max: 30000, currency: 'EGP' },
  priority: 'critical',
  targetWorkingDays: 15,
  ...overrides,
});

let people;

test('set up the people, the employee database and the legacy workbook', async () => {
  await login('admin', 'admin@test.local', 'AdminPass123!');
  people = {
    requester: await createUser({ name: 'Training Coordinator', email: 'requester@test.local', password: 'Requester123!', role: 'member', department: 'training', permissions: [P.APPS_VIEW, P.TASKS_VIEW, P.HR_RECRUITMENT_REQUEST] }),
    reviewer: await createUser({ name: 'Training Manager', email: 'reviewer@test.local', password: 'Reviewer123!', role: 'manager', department: 'training' }),
    outsider: await createUser({ name: 'Marketing Manager', email: 'outsider@test.local', password: 'Outsider123!', role: 'manager', department: 'marketing' }),
    hrLead: await createUser({ name: 'Salah Mohmed', email: 'salah-account@test.local', password: 'HrLead123!', role: 'manager', department: 'hr', permissions: [P.APPS_VIEW, P.TASKS_VIEW, P.HR_VIEW, P.HR_MANAGE, P.HR_PAYROLL] }),
    viewer: await createUser({ name: 'HR Viewer', email: 'viewer@test.local', password: 'Viewer123!', role: 'member', department: 'hr', permissions: [P.APPS_VIEW, P.TASKS_VIEW, P.HR_VIEW] }),
    approver: await createUser({ name: 'Taha Final', email: 'taha@test.local', password: 'Approver123!', role: 'member', department: 'sales', permissions: [P.APPS_VIEW, P.TASKS_VIEW, P.HR_RECRUITMENT_VIEW, P.HR_RECRUITMENT_APPROVE, P.HR_RECRUITMENT_EXTEND] }),
    member: await createUser({ name: 'Plain Member', email: 'member@test.local', password: 'Member123!', role: 'member', department: 'sales', permissions: [P.APPS_VIEW, P.TASKS_VIEW] }),
    rewards: await createUser({ name: 'Rewards Approver', email: 'rewards@test.local', password: 'Rewards123!', role: 'member', department: 'finance', permissions: [P.APPS_VIEW, P.TASKS_VIEW, P.HR_RECRUITMENT_VIEW, P.HR_RECRUITMENT_REWARDS_MANAGE, P.HR_RECRUITMENT_KPI_REVIEW] }),
  };
  await login('requester', 'requester@test.local', 'Requester123!');
  await login('reviewer', 'reviewer@test.local', 'Reviewer123!');
  await login('outsider', 'outsider@test.local', 'Outsider123!');
  await login('hrLead', 'salah-account@test.local', 'HrLead123!');
  await login('viewer', 'viewer@test.local', 'Viewer123!');
  await login('approver', 'taha@test.local', 'Approver123!');
  await login('member', 'member@test.local', 'Member123!');
  await login('rewards', 'rewards@test.local', 'Rewards123!');

  await upload('master');
  await upload('payroll');
  const recruitment = await upload('recruitment');
  assert.deepEqual({ created: recruitment.migration.created, existing: recruitment.migration.existing }, { created: 4, existing: 0 });
});

test('legacy rows become Qodo requests without inventing history', async () => {
  const list = await request('/hr/recruitment/requests', { as: 'hrLead' });
  assert.equal(list.status, 200, JSON.stringify(list.data));
  const byTitle = Object.fromEntries(list.data.requests.map((item) => [item.title, item]));
  const cfm = byTitle['CFM Instructor'];
  assert.equal(cfm.status, 'hiring');
  assert.equal(cfm.source, 'legacy_workbook');
  assert.equal(cfm.recruiterCode, '257');
  assert.deepEqual(cfm.supportRecruiterCodes, ['389']);
  assert.equal(cfm.priority, 'required', '30 days sits in the Required band');
  assert.equal(cfm.classification, 'instructor');
  assert.equal(cfm.locationCode, 'KSA');
  assert.equal(cfm.legacyValidation, 'Eng.Taha');
  assert.equal(cfm.sla.startDate, '2026-09-10');
  assert.equal(cfm.sla.originalDueDate, '2026-10-12');
  const detail = await request(`/hr/recruitment/requests/${cfm.id}`, { as: 'hrLead' });
  assert.equal(detail.data.approvals.length, 0, 'no approval rows are invented for legacy jobs');

  assert.equal(byTitle['Interior'].status, 'completed');
  assert.equal(byTitle['Interior'].sla.completedAt, null, 'no completion date is invented');
  assert.equal(byTitle['Interior'].recruiterCode, '522', 'Aya resolves inside HR even though she left');
  assert.equal(byTitle['BIM Struc'].status, 'on_hold');
  assert.deepEqual(byTitle['BIM Struc'].unresolvedAssignees, ['Fatima'], '"Fatima" is not guessed to be "Fatma"');
});

test('migration is idempotent across a re-upload and a restart', async () => {
  const again = await upload('recruitment');
  assert.deepEqual({ created: again.migration.created, existing: again.migration.existing }, { created: 0, existing: 4 });
  const run = await request('/hr/settings/migration', { method: 'POST', as: 'admin' });
  assert.equal(run.status, 200);
  assert.equal(run.data.migration.created, 0);
  await stopServer();
  await startServer();
  const list = await request('/hr/recruitment/requests', { as: 'hrLead' });
  assert.equal(list.data.requests.filter((item) => item.source === 'legacy_workbook').length, 4);
  const reconciliation = await request('/hr/settings/reconciliation', { as: 'hrLead' });
  assert.equal(reconciliation.status, 200);
  assert.equal(reconciliation.data.imported, 4);
  assert.equal(reconciliation.data.missing.length, 0);
});

test('the recruitment team comes from the employee database and the assignments', async () => {
  const team = await request('/hr/recruitment/team', { as: 'hrLead' });
  assert.equal(team.status, 200, JSON.stringify(team.data));
  const codes = team.data.team.map((card) => card.member.employeeCode);
  assert.deepEqual(codes.slice(0, 2).sort(), ['257', '420'], 'the two specialists lead the row');
  assert.ok(codes.includes('389'), 'the HR manager is on the desk because he owns a request');
  assert.ok(!codes.includes('522'), 'a person who has left is not on the desk');
  assert.ok(!codes.includes('700'), 'an instructor is not a recruiter');
  const salah = team.data.team.find((card) => card.member.employeeCode === '389');
  assert.deepEqual(salah.member.reasons, ['assignments']);
});

let jobId;

test('request → department review → final approval, and the SLA starts only at approval', async () => {
  const denied = await request('/hr/recruitment/requests', { method: 'POST', as: 'member', body: draft() });
  assert.equal(denied.status, 403);

  const created = await request('/hr/recruitment/requests', { method: 'POST', as: 'requester', body: draft() });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  jobId = created.data.request.id;
  assert.equal(created.data.request.status, 'draft');
  assert.equal(created.data.request.sla, null);

  const submitted = await request(`/hr/recruitment/requests/${jobId}/submit`, { method: 'POST', as: 'requester', body: {} });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.data));
  assert.equal(submitted.data.request.status, 'pending_review');
  assert.equal(submitted.data.request.sla, null, 'no clock at request time');

  const early = await request(`/hr/recruitment/requests/${jobId}/approve`, { method: 'POST', as: 'approver', body: { decision: 'approve' } });
  assert.equal(early.status, 409, 'final approval cannot skip the department review');
  assert.equal(early.data.error, 'recruitment_transition_invalid');

  const wrongDepartment = await request(`/hr/recruitment/requests/${jobId}/review`, { method: 'POST', as: 'outsider', body: { decision: 'approve' } });
  assert.equal(wrongDepartment.status, 403, 'a manager reviews only their own department');

  const reviewed = await request(`/hr/recruitment/requests/${jobId}/review`, { method: 'POST', as: 'reviewer', body: { decision: 'approve', comment: 'Needed for the October intake' } });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.data));
  assert.equal(reviewed.data.request.status, 'pending_approval');
  assert.equal(reviewed.data.request.sla, null, 'no clock at department review either');

  const hrCannotApprove = await request(`/hr/recruitment/requests/${jobId}/approve`, { method: 'POST', as: 'hrLead', body: { decision: 'approve' } });
  assert.equal(hrCannotApprove.status, 403, 'hr.manage never implies final approval');

  const approved = await request(`/hr/recruitment/requests/${jobId}/approve`, { method: 'POST', as: 'approver', body: { decision: 'approve', comment: 'Go' } });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  const job = approved.data.request;
  assert.equal(job.status, 'hiring');
  assert.equal(job.sla.startDate, job.slaSnapshot.startDate);
  assert.equal(job.sla.targetWorkingDays, 15);
  assert.equal(job.slaSnapshot.elapsedWorkingDays, 0);
  assert.equal(job.slaSnapshot.remainingWorkingDays, 15);
  assert.deepEqual(approved.data.timeline.map((step) => step.state), ['done', 'done', 'done', 'current']);
  assert.equal(approved.data.approvals.length, 3);
  assert.ok(approved.data.approvals.every((row) => row.actorName && row.createdAt && row.decision));

  const twice = await request(`/hr/recruitment/requests/${jobId}/approve`, { method: 'POST', as: 'approver', body: { decision: 'approve' } });
  assert.equal(twice.status, 409);
});

test('a "no" always says why, and invalid transitions are refused server-side', async () => {
  const other = await request('/hr/recruitment/requests', { method: 'POST', as: 'requester', body: { ...draft({ title: 'Electrical Instructor' }), submit: true } });
  assert.equal(other.status, 201, JSON.stringify(other.data));
  const noReason = await request(`/hr/recruitment/requests/${other.data.request.id}/review`, { method: 'POST', as: 'reviewer', body: { decision: 'reject' } });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.data.error, 'recruitment_comment_required');
  const hold = await request(`/hr/recruitment/requests/${other.data.request.id}/hold`, { method: 'POST', as: 'hrLead', body: { comment: 'pause' } });
  assert.equal(hold.status, 409, 'a request still in review cannot be held');
  const incomplete = await request('/hr/recruitment/requests', { method: 'POST', as: 'requester', body: { title: 'Half written', submit: true } });
  assert.equal(incomplete.status, 400);
  assert.equal(incomplete.data.error, 'recruitment_request_incomplete');
  assert.ok(incomplete.data.missing.includes('priority'));
  const outOfBand = await request('/hr/recruitment/requests', { method: 'POST', as: 'requester', body: draft({ priority: 'critical', targetWorkingDays: 20 }) });
  assert.equal(outOfBand.status, 400);
  assert.equal(outOfBand.data.error, 'recruitment_target_out_of_band');
});

async function liveJob(overrides = {}) {
  const created = await request('/hr/recruitment/requests', { method: 'POST', as: 'hrLead', body: { ...draft(overrides) } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const id = created.data.request.id;
  // HR's own requests go to the training reviewer, then the approver.
  const submitted = await request(`/hr/recruitment/requests/${id}/submit`, { method: 'POST', as: 'hrLead', body: {} });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.data));
  const reviewed = await request(`/hr/recruitment/requests/${id}/review`, { method: 'POST', as: 'reviewer', body: { decision: 'approve' } });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.data));
  const approved = await request(`/hr/recruitment/requests/${id}/approve`, { method: 'POST', as: 'approver', body: { decision: 'approve' } });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  return id;
}

test('capacity: Critical max 2 is enforced server-side, and an override is permissioned, reasoned and audited', async () => {
  const assign = (id, as, body) => request(`/hr/recruitment/requests/${id}/assign`, { method: 'POST', as, body });
  const first = await assign(jobId, 'hrLead', { recruiterCode: '257' });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  const second = await liveJob({ title: 'CNC Instructor' });
  assert.equal((await assign(second, 'hrLead', { recruiterCode: '257' })).status, 200);

  const third = await liveJob({ title: 'Hydraulics Instructor' });
  const refused = await assign(third, 'hrLead', { recruiterCode: '257' });
  assert.equal(refused.status, 409);
  assert.equal(refused.data.error, 'recruitment_capacity_exceeded');
  assert.equal(refused.data.capacity.current.critical, 2);
  assert.equal(refused.data.capacity.limits.critical, 2);
  assert.deepEqual(refused.data.capacity.exceeded, ['critical']);
  assert.equal(refused.data.canOverride, false);

  const notAllowed = await assign(third, 'hrLead', { recruiterCode: '257', override: true, overrideReason: 'Urgent client deal' });
  assert.equal(notAllowed.status, 403);
  const noReason = await assign(third, 'admin', { recruiterCode: '257', override: true, overrideReason: '' });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.data.error, 'recruitment_override_reason_required');
  const overridden = await assign(third, 'admin', { recruiterCode: '257', override: true, overrideReason: 'Board-approved exception for the KSA contract' });
  assert.equal(overridden.status, 200, JSON.stringify(overridden.data));
  const audit = overridden.data.assignments.at(-1);
  assert.equal(audit.override, true);
  assert.equal(audit.overrideReason, 'Board-approved exception for the KSA contract');
  assert.equal(audit.capacity.projected.critical, 3);

  const alerts = await request('/hr/recruitment/alerts', { as: 'hrLead' });
  const capacity = alerts.data.alerts.find((alert) => alert.id === 'capacity_critical:257');
  assert.equal(capacity.severity, 'critical', 'three of two is past the limit');
  assert.equal(capacity.link, '/hr/recruitment/capacity?recruiter=257');

  const planned = await liveJob({ title: 'Welding Instructor', priority: 'planned', targetWorkingDays: 60 });
  assert.equal((await assign(planned, 'hrLead', { recruiterCode: '420' })).status, 200);
  const upgraded = await request(`/hr/recruitment/requests/${planned}/priority`, { method: 'POST', as: 'hrLead', body: { priority: 'required', targetWorkingDays: 30, reason: 'Client moved the start date' } });
  assert.equal(upgraded.status, 200, JSON.stringify(upgraded.data));
  assert.equal(upgraded.data.request.sla.targetWorkingDays, 30);
  assert.equal(upgraded.data.request.sla.originalDueDate !== upgraded.data.request.sla.currentDueDate, true);
  const toCritical = await request(`/hr/recruitment/requests/${planned}/priority`, { method: 'POST', as: 'hrLead', body: { priority: 'critical', targetWorkingDays: 15, reason: 'Escalated' } });
  assert.equal(toCritical.status, 200, 'Yasmin has room for a Critical job');
  const moveToFull = await request(`/hr/recruitment/requests/${planned}/assign`, { method: 'POST', as: 'hrLead', body: { recruiterCode: '257' } });
  assert.equal(moveToFull.status, 409, 'reassigning a Critical job to a full recruiter is checked too');
});

test('Extend belongs to the dedicated key, is reasoned, and never loses the original date', async () => {
  const hr = await request(`/hr/recruitment/requests/${jobId}/extend`, { method: 'POST', as: 'hrLead', body: { addWorkingDays: 5, reason: 'Candidate asked for time' } });
  assert.equal(hr.status, 403);
  assert.equal(hr.data.missing, P.HR_RECRUITMENT_EXTEND);
  const noReason = await request(`/hr/recruitment/requests/${jobId}/extend`, { method: 'POST', as: 'approver', body: { addWorkingDays: 5, reason: '' } });
  assert.equal(noReason.status, 400);
  const before = (await request(`/hr/recruitment/requests/${jobId}`, { as: 'approver' })).data.request;
  const extended = await request(`/hr/recruitment/requests/${jobId}/extend`, { method: 'POST', as: 'approver', body: { addWorkingDays: 5, reason: 'Two finalists need a second interview', note: 'Agreed with the client' } });
  assert.equal(extended.status, 200, JSON.stringify(extended.data));
  const job = extended.data.request;
  assert.equal(job.sla.originalDueDate, before.sla.originalDueDate);
  assert.equal(job.slaSnapshot.targetWorkingDays, 20);
  const record = extended.data.extensions[0];
  assert.deepEqual(
    { previous: record.previousDueDate, next: record.newDueDate, added: record.addedWorkingDays, reason: record.reason, note: record.note },
    { previous: before.slaSnapshot.dueDate, next: job.slaSnapshot.dueDate, added: 5, reason: 'Two finalists need a second interview', note: 'Agreed with the client' }
  );
  assert.ok(record.actorId && record.createdAt);
  const second = await request(`/hr/recruitment/requests/${jobId}/extend`, { method: 'POST', as: 'approver', body: { addWorkingDays: 3, reason: 'Visa paperwork for the finalist' } });
  assert.equal(second.data.extensions.length, 2, 'extension history is kept, never replaced');
  assert.equal(second.data.request.sla.originalDueDate, before.sla.originalDueDate);
});

test('payroll stays behind hr.payroll on every new endpoint', async () => {
  assert.equal((await request('/hr/payroll', { as: 'viewer' })).status, 403);
  assert.equal((await request('/hr/reports/payroll', { as: 'viewer' })).status, 403);
  const people = await request('/hr/people', { as: 'viewer' });
  assert.equal(people.status, 200);
  assert.ok(people.data.employees.every((employee) => !Object.hasOwn(employee, 'totalSalary')), 'no salary field reaches a non-payroll reader');
  const home = await request('/hr/overview', { as: 'viewer' });
  assert.equal(home.data.metrics.payrollUsd, null);
  const payroll = await request('/hr/payroll', { as: 'hrLead' });
  assert.equal(payroll.status, 200);
  assert.equal(payroll.data.analytics.totalEgp, 20_000);
});

test('KPI deductions need a reviewer, a reason and a job, and a double submit is one deduction', async () => {
  const noPermission = await request('/hr/recruitment/kpi/events', { method: 'POST', as: 'viewer', body: {} });
  assert.equal(noPermission.status, 403);
  const base = { employeeCode: '257', rule: 'candidate_mismatch', requestId: jobId, idempotencyKey: 'kpi-test-0001' };
  const noReason = await request('/hr/recruitment/kpi/events', { method: 'POST', as: 'rewards', body: { ...base, reason: '' } });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.data.error, 'kpi_reason_required');
  const noJob = await request('/hr/recruitment/kpi/events', { method: 'POST', as: 'rewards', body: { ...base, requestId: null, reason: 'Candidate lacked the plant experience' } });
  assert.equal(noJob.status, 400);
  const first = await request('/hr/recruitment/kpi/events', { method: 'POST', as: 'rewards', body: { ...base, reason: 'Candidate lacked the plant experience' } });
  assert.equal(first.status, 201, JSON.stringify(first.data));
  const again = await request('/hr/recruitment/kpi/events', { method: 'POST', as: 'rewards', body: { ...base, reason: 'Candidate lacked the plant experience' } });
  assert.equal(again.status, 200);
  assert.equal(again.data.duplicate, true);
  assert.equal(again.data.event.id, first.data.event.id);
  const presentation = await request('/hr/recruitment/kpi/events', { method: 'POST', as: 'rewards', body: { ...base, rule: 'presentation_requirement', idempotencyKey: 'kpi-test-0002', reason: 'x'.repeat(50) } });
  assert.equal(presentation.status, 400, 'the presentation rule is off unless HR switches it on');

  const detail = await request('/hr/recruitment/kpi/257', { as: 'hrLead' });
  assert.equal(detail.status, 200);
  const review = detail.data.kpi.categories.find((category) => category.id === 'hr_review');
  assert.equal(review.score, 25);
  assert.equal(review.events[0].reason, 'Candidate lacked the plant experience');
  assert.equal(review.events[0].reviewerName, 'Rewards Approver');

  const voidWithoutReason = await request(`/hr/recruitment/kpi/events/${first.data.event.id}/void`, { method: 'POST', as: 'rewards', body: { reason: '' } });
  assert.equal(voidWithoutReason.status, 400);
  const voided = await request(`/hr/recruitment/kpi/events/${first.data.event.id}/void`, { method: 'POST', as: 'rewards', body: { reason: 'Recorded against the wrong candidate' } });
  assert.equal(voided.status, 200);
  const after = await request('/hr/recruitment/kpi/257', { as: 'hrLead' });
  assert.equal(after.data.kpi.categories.find((category) => category.id === 'hr_review').score, 30);
});

test('closing a job at its headcount completes it within SLA, hands off onboarding, and three make a reward batch', async () => {
  const jobs = [];
  for (const title of ['PLC Instructor', 'SCADA Instructor', 'Revit Instructor']) {
    const id = await liveJob({ title, priority: 'planned', targetWorkingDays: 60 });
    const assigned = await request(`/hr/recruitment/requests/${id}/assign`, { method: 'POST', as: 'hrLead', body: { recruiterCode: '420' } });
    assert.equal(assigned.status, 200, JSON.stringify(assigned.data));
    jobs.push(id);
  }
  const partial = await request(`/hr/recruitment/requests/${jobs[0]}/accepted`, { method: 'POST', as: 'hrLead', body: { accepted: 0 } });
  assert.equal(partial.status, 409, 'recording the same count is refused');
  for (const id of jobs) {
    const closed = await request(`/hr/recruitment/requests/${id}/accepted`, { method: 'POST', as: 'hrLead', body: { accepted: 1 } });
    assert.equal(closed.status, 200, JSON.stringify(closed.data));
    assert.equal(closed.data.request.status, 'completed');
    assert.equal(closed.data.request.sla.slaMet, true);
    assert.equal(closed.data.request.sla.actualWorkingDays, 0);
  }

  const onboarding = await request('/hr/personnel?type=onboarding', { as: 'hrLead' });
  assert.equal(onboarding.status, 200);
  assert.equal(onboarding.data.cases.filter((item) => jobs.includes(item.recruitmentRequestId)).length, 3);

  const rewards = await request('/hr/recruitment/rewards', { as: 'rewards' });
  assert.equal(rewards.status, 200, JSON.stringify(rewards.data));
  const batches = rewards.data.batches.filter((batch) => batch.employeeCode === '420');
  assert.equal(batches.length, 1);
  assert.deepEqual([...batches[0].jobIds].sort(), [...jobs].sort());
  assert.equal(batches[0].categoryId, 'instructor_eg');
  assert.equal(batches[0].ruleVersion, 1);
  assert.deepEqual([batches[0].amountMin, batches[0].amountMax], [1200, 1500]);

  const outOfRange = await request(`/hr/recruitment/rewards/batches/${batches[0].id}/decision`, { method: 'POST', as: 'rewards', body: { decision: 'approve', amountApproved: 2000 } });
  assert.equal(outOfRange.status, 400);
  const notManager = await request(`/hr/recruitment/rewards/batches/${batches[0].id}/decision`, { method: 'POST', as: 'hrLead', body: { decision: 'approve' } });
  assert.equal(notManager.status, 403);
  const approved = await request(`/hr/recruitment/rewards/batches/${batches[0].id}/decision`, { method: 'POST', as: 'rewards', body: { decision: 'approve', amountApproved: 1350 } });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  assert.equal(approved.data.batch.status, 'approved');
  assert.equal(approved.data.batch.amountApproved, 1350);
  assert.ok(approved.data.batch.approverId && approved.data.batch.decidedAt);

  const again = await request('/hr/recruitment/rewards', { as: 'rewards' });
  assert.equal(again.data.batches.filter((batch) => batch.employeeCode === '420').length, 1, 'the same three jobs never make a second batch');
  const yasmin = again.data.recruiters.find((item) => item.member.employeeCode === '420');
  assert.equal(yasmin.best.done, 0, 'batched jobs no longer count toward progress');
});

test('a new hire fills the secure form once; the link is useless afterwards', async () => {
  const cases = await request('/hr/personnel?type=onboarding', { as: 'hrLead' });
  const onboarding = cases.data.cases[0];
  const denied = await request(`/hr/personnel/${onboarding.id}/form`, { method: 'POST', as: 'viewer' });
  assert.equal(denied.status, 403);
  const link = await request(`/hr/personnel/${onboarding.id}/form`, { method: 'POST', as: 'hrLead' });
  assert.equal(link.status, 200, JSON.stringify(link.data));
  const token = link.data.url.split('/').at(-1);
  assert.ok(token.length >= 40);
  const reloaded = await request(`/hr/personnel/${onboarding.id}`, { as: 'hrLead' });
  assert.equal(JSON.stringify(reloaded.data).includes(token), false, 'the token is never returned again');

  const open = await request(`/hr-forms/${token}`);
  assert.equal(open.status, 200);
  assert.equal(open.data.form.jobTitle, onboarding.jobTitle);
  const incomplete = await request(`/hr-forms/${token}`, { method: 'POST', body: { fullNameArabic: 'موظف جديد' } });
  assert.equal(incomplete.status, 400);
  const submitted = await request(`/hr-forms/${token}`, {
    method: 'POST',
    body: { fullNameArabic: 'موظف جديد', fullNameEnglish: 'New Hire', nationalId: '29901011234567', birthDate: '1999-01-01', mobile: '01000000000', emergencyContactName: 'Parent', emergencyContactPhone: '01111111111' },
  });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.data));
  assert.equal((await request(`/hr-forms/${token}`)).status, 404, 'a used link answers like one that never existed');
  assert.equal((await request('/hr-forms/not-a-real-token-but-long-enough-to-pass-the-shape')).status, 404);
  const filled = await request(`/hr/personnel/${onboarding.id}`, { as: 'hrLead' });
  assert.equal(filled.data.case.formSubmission.fullNameEnglish, 'New Hire');
});

test('settings validate before saving and conflict on a stale revision', async () => {
  const view = await request('/hr/settings', { as: 'hrLead' });
  assert.equal(view.status, 200);
  assert.equal(view.data.canEdit, false, 'hr.manage reads settings but does not change them');
  const denied = await request('/hr/settings', { method: 'PATCH', as: 'hrLead', body: { patch: { recruitment: { capacity: { critical: 3 } } } } });
  assert.equal(denied.status, 403);
  const bad = await request('/hr/settings', { method: 'PATCH', as: 'admin', body: { patch: { kpi: { weights: { hr_review: 40, hiring_target: 30, commitment: 20, system_quality: 20 } } } } });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error, 'kpi_weights_must_total_100');
  const saved = await request('/hr/settings', { method: 'PATCH', as: 'admin', body: { revision: view.data.revision, patch: { recruitment: { sla: { dueSoonWorkingDays: 4 } } } } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.settings.recruitment.sla.dueSoonWorkingDays, 4);
  const stale = await request('/hr/settings', { method: 'PATCH', as: 'admin', body: { revision: view.data.revision, patch: { recruitment: { sla: { dueSoonWorkingDays: 5 } } } } });
  assert.equal(stale.status, 409);
  const audit = await request('/hr/settings/audit', { as: 'hrLead' });
  assert.equal(audit.status, 200);
  assert.ok(audit.data.rows.some((row) => row.kind === 'capacity_override'));
  assert.ok(audit.data.rows.some((row) => row.kind === 'extension'));
});

test('a new form link retires the one before it, and two racing submissions land once', async () => {
  const created = await request('/hr/personnel', { method: 'POST', as: 'hrLead', body: { type: 'onboarding', jobTitle: 'Race Tester', department: 'QA' } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const id = created.data.case.id;
  const first = await request(`/hr/personnel/${id}/form`, { method: 'POST', as: 'hrLead' });
  const second = await request(`/hr/personnel/${id}/form`, { method: 'POST', as: 'hrLead' });
  assert.equal(second.status, 200, JSON.stringify(second.data));
  const retired = first.data.url.split('/').at(-1);
  const token = second.data.url.split('/').at(-1);
  assert.equal((await request(`/hr-forms/${retired}`)).status, 404, 'the replaced link no longer opens');
  assert.equal((await request(`/hr-forms/${token}`)).status, 200);
  const body = { fullNameArabic: 'موظف ثانٍ', fullNameEnglish: 'Second Hire', nationalId: '29902021234567', birthDate: '1999-02-02', mobile: '01000000001', emergencyContactName: 'Parent', emergencyContactPhone: '01111111112' };
  const results = await Promise.all([
    request(`/hr-forms/${token}`, { method: 'POST', body }),
    request(`/hr-forms/${token}`, { method: 'POST', body }),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 404], 'exactly one submission is accepted');
});

test('every report headline that counts rows opens exactly those rows', async () => {
  const { countReportRows } = await import('../shared/hrReportFilter.js');
  const list = await request('/hr/reports', { as: 'hrLead' });
  assert.equal(list.status, 200);
  assert.ok(list.data.reports.includes('recruitment_sla'));
  // Productivity and funnel headlines are sums of jobs or candidates, and
  // averages and rates drill into the rows they were computed from.
  const sums = new Set(['recruiter_productivity', 'recruitment_funnel']);
  for (const id of list.data.reports.filter((entry) => !sums.has(entry))) {
    const report = await request(`/hr/reports/${id}`, { as: 'hrLead' });
    assert.equal(report.status, 200, `${id}: ${JSON.stringify(report.data)}`);
    for (const entry of report.data.headline) {
      if (!entry.filter || entry.unit || entry.key === 'avg') continue;
      assert.equal(countReportRows(report.data.rows, entry.filter), entry.value, `${id}.${entry.key}`);
    }
  }
  const denied = await request('/hr/reports/payroll', { as: 'viewer' });
  assert.equal(denied.status, 403, 'the payroll report stays behind hr.payroll');
  const badRange = await request('/hr/reports/workforce?from=2026-09-10&to=2026-09-01', { as: 'hrLead' });
  assert.equal(badRange.status, 400);
});

test('HR access names the caller\'s own record, and staff without HR rights keep the seat plan', async () => {
  const access = await request('/hr/access', { as: 'member' });
  assert.equal(access.status, 200);
  assert.equal(access.data.access.employeeCode, null);
  assert.equal(access.data.access.people, false);
  assert.equal((await request('/hr/organization', { as: 'member' })).status, 403, 'the structure stays behind hr.view');
  assert.equal((await request('/offices', { as: 'member' })).status, 200, 'anyone signed in can find a seat');
  const lead = await request('/hr/access', { as: 'hrLead' });
  assert.equal(lead.data.access.personnelManage, true, 'hr.manage carries personnel management');
});

test('leave balances show everyone to HR and only yourself to anyone else', async () => {
  const hr = await request('/hr/personnel/leave', { as: 'viewer' });
  assert.equal(hr.status, 200, JSON.stringify(hr.data));
  assert.equal(hr.data.selfOnly, false);
  const own = await request('/hr/personnel/leave', { as: 'member' });
  assert.equal(own.status, 200);
  assert.equal(own.data.selfOnly, true);
  assert.deepEqual(own.data.balances, []);
});

test('payroll names its gaps, and reconciliation lists people gaps beside the workbook', async () => {
  const payroll = await request('/hr/payroll', { as: 'hrLead' });
  assert.equal(payroll.status, 200, JSON.stringify(payroll.data));
  const yasmin = payroll.data.gaps.activeWithoutPayroll.find((person) => person.employeeCode === '420');
  assert.ok(yasmin, 'an active employee with no payroll row is listed');
  assert.equal(yasmin.nameEnglish, 'Yasmin Ashraf Ahmed El sayed');
  assert.equal((await request('/hr/payroll', { as: 'viewer' })).status, 403);
  const reconciliation = await request('/hr/settings/reconciliation', { as: 'hrLead' });
  assert.equal(reconciliation.status, 200);
  assert.ok(reconciliation.data.people.unlinkedAccounts.some((person) => person.employeeCode === '257'));
  assert.ok(Array.isArray(reconciliation.data.people.activeWithoutPayroll), 'a payroll holder sees the payroll gaps');
});

test('the final-approver setting is validated, and reward rules save as a new version', async () => {
  const view = await request('/hr/settings', { as: 'admin' });
  const bad = await request('/hr/settings', { method: 'PATCH', as: 'admin', body: { revision: view.data.revision, patch: { recruitment: { approvals: { finalApproverUserId: 'not an id!' } } } } });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error, 'hr_settings_invalid');
  const good = await request('/hr/settings', { method: 'PATCH', as: 'admin', body: { revision: view.data.revision, patch: { recruitment: { approvals: { finalApproverUserId: people.approver.id } } } } });
  assert.equal(good.status, 200, JSON.stringify(good.data));
  assert.equal(good.data.settings.recruitment.approvals.finalApproverUserId, people.approver.id);

  const before = view.data.rewardRules.version;
  assert.equal((await request('/hr/settings/reward-rules', { method: 'POST', as: 'hrLead', body: { jobsPerBatch: 4 } })).status, 403, 'amounts are policy: hr.manage cannot change them');
  const saved = await request('/hr/settings/reward-rules', { method: 'POST', as: 'admin', body: { jobsPerBatch: 4, note: 'Quarterly review' } });
  assert.equal(saved.status, 201, JSON.stringify(saved.data));
  assert.equal(saved.data.rules.version, before + 1);
  assert.equal(saved.data.rules.jobsPerBatch, 4);
  const versions = (await request('/hr/settings', { as: 'admin' })).data.rewardVersions.map((entry) => entry.version);
  assert.ok(versions.includes(before), 'the previous version is kept');
  const audit = await request('/hr/settings/audit', { as: 'admin' });
  const kinds = new Set(audit.data.rows.map((row) => row.kind));
  assert.ok(kinds.has('hr.settings.update'), 'a settings change is in the audit trail');
  assert.ok(kinds.has('hr.rewards.rules'), 'a new reward-rule version is in the audit trail');
  assert.ok(kinds.has('hr.recruitment.migration'), 'a manual migration run is in the audit trail');
});
