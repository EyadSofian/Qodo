import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canAssignUser, canViewTask, visiblePeople } from './taskAccess.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 32_000 + Math.floor(Math.random() * 4_000);
const ORIGIN = `http://127.0.0.1:${PORT}`;

let dataDirectory;
let server;

before(async () => {
  dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'engosoft-task-test-'));
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATA_DIR: dataDirectory,
      PORT: String(PORT),
      ADMIN_EMAIL: 'admin@test.local',
      ADMIN_PASSWORD: 'AdminPass123!',
      SESSION_SECRET: 'test-session-secret-123456789012345',
      SSO_SECRET: 'test-sso-secret-123456789012345678',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let errorOutput = '';
  server.stderr.on('data', (chunk) => {
    errorOutput += chunk.toString();
  });

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${ORIGIN}/api/health`);
      if (response.ok) return;
    } catch {
      // The child is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Test server did not start.\n${errorOutput}`);
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
    text,
    cookie: response.headers.get('set-cookie')?.split(';')[0] ?? null,
  };
}

/** Deliverables go up as raw bytes, so they need their own helper. */
async function upload(taskId, { name, type = 'application/pdf', bytes = 'demo' }, cookie) {
  const response = await fetch(`${ORIGIN}/api/tasks/${taskId}/attachments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(name),
      'X-File-Type': type,
      Cookie: cookie,
    },
    body: Buffer.from(bytes),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

async function login(email, password) {
  const response = await request('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  assert.equal(response.status, 200);
  assert.ok(response.cookie);
  return response.cookie;
}

async function create(pathname, body, cookie) {
  const response = await request(pathname, { method: 'POST', body, cookie });
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return response.data;
}

let manager;
let creative;
let managerCookie;
let creativeCookie;
let adminCookie;

test('tenant policy rejects cross-organization task and people access', () => {
  const managerA = {
    id: 'manager-a',
    organizationId: 'org-a',
    department: 'marketing',
    role: 'manager',
    status: 'active',
  };
  const adminA = { ...managerA, id: 'admin-a', role: 'admin' };
  const employeeB = {
    id: 'employee-b',
    organizationId: 'org-b',
    department: 'marketing',
    role: 'member',
    status: 'active',
  };
  const taskB = {
    id: 'task-b',
    organizationId: 'org-b',
    department: 'marketing',
    createdBy: employeeB.id,
    assigneeId: employeeB.id,
  };

  assert.equal(canViewTask(managerA, taskB), false);
  assert.equal(canViewTask(adminA, taskB), false);
  assert.equal(canAssignUser(managerA, employeeB, 'marketing'), false);
  assert.deepEqual(visiblePeople(adminA, [managerA, employeeB]).map((person) => person.id), [
    managerA.id,
  ]);
});

test('team boundaries, performance privacy and export', async () => {
  adminCookie = await login('admin@test.local', 'AdminPass123!');

  manager = await create(
    '/users',
    {
      name: 'Marketing Manager',
      email: 'manager@test.local',
      password: 'Manager123!',
      role: 'manager',
      department: 'marketing',
      subteam: 'performance',
      jobRole: 'media_buyer',
    },
    adminCookie
  );
  creative = await create(
    '/users',
    {
      name: 'Creative Employee',
      email: 'creative@test.local',
      password: 'Creative123!',
      role: 'member',
      department: 'marketing',
      subteam: 'creative',
      jobRole: 'designer',
    },
    adminCookie
  );
  await create(
    '/users',
    {
      name: 'Sales Employee',
      email: 'sales@test.local',
      password: 'SalesPass123!',
      role: 'member',
      department: 'sales',
    },
    adminCookie
  );

  await create(
    '/tasks',
    {
      title: 'Launch campaign',
      description: 'Campaign assets',
      notes: 'Use approved brief',
      taskDate: '2026-07-26',
      department: 'marketing',
      subteam: 'creative',
      stage: 'working',
      assigneeId: creative.user.id,
      dueDate: '2026-07-30',
    },
    adminCookie
  );

  creativeCookie = await login('creative@test.local', 'Creative123!');
  const creativeTasks = await request('/tasks', { cookie: creativeCookie });
  assert.equal(creativeTasks.status, 200);
  assert.equal(creativeTasks.data.tasks.length, 1);
  assert.equal(creativeTasks.data.tasks[0].department, 'marketing');
  // A brand-new task carries no verdict of any kind.
  assert.equal(creativeTasks.data.tasks[0].score, null);
  assert.equal(creativeTasks.data.tasks[0].reviewDecision, null);
  assert.equal(creativeTasks.data.tasks[0].attachmentCount, 0);

  const creativeDirectory = await request('/auth/directory', { cookie: creativeCookie });
  assert.ok(creativeDirectory.data.users.every((person) => person.department === 'marketing'));

  const creativeOverview = await request('/tasks/overview?department=marketing', {
    cookie: creativeCookie,
  });
  assert.equal(creativeOverview.data.scope, 'self');
  assert.equal(creativeOverview.data.people.length, 1);
  assert.equal(creativeOverview.data.people[0].user.id, creative.user.id);

  const crossTeam = await request('/tasks', {
    method: 'POST',
    cookie: creativeCookie,
    body: { title: 'Should fail', department: 'sales', stage: 'lead' },
  });
  assert.equal(crossTeam.status, 403);

  managerCookie = await login('manager@test.local', 'Manager123!');
  const managerOverview = await request('/tasks/overview?department=marketing', {
    cookie: managerCookie,
  });
  assert.equal(managerOverview.data.scope, 'team');
  assert.equal(managerOverview.data.people.length, 2);

  const exported = await request('/tasks/export.csv?lang=en&department=marketing', {
    cookie: managerCookie,
  });
  assert.equal(exported.status, 200);
  assert.match(exported.text, /Launch campaign/);
  assert.match(exported.text, /Times returned/);

  const salesCookie = await login('sales@test.local', 'SalesPass123!');
  const salesTasks = await request('/tasks', { cookie: salesCookie });
  assert.equal(salesTasks.data.tasks.length, 0);
});

test('a score cannot be set before the work has been reviewed', async () => {
  const atCreation = await request('/tasks', {
    method: 'POST',
    cookie: adminCookie,
    body: { title: 'Scored too early', department: 'marketing', stage: 'working', score: 90 },
  });
  assert.equal(atCreation.status, 400);
  assert.equal(atCreation.data.error, 'score_before_review');

  const task = await create(
    '/tasks',
    { title: 'Not delivered yet', department: 'marketing', stage: 'working' },
    managerCookie
  );
  const onOpenTask = await request(`/tasks/${task.task.id}`, {
    method: 'PATCH',
    cookie: managerCookie,
    body: { score: 90 },
  });
  assert.equal(onOpenTask.status, 400);
  assert.equal(onOpenTask.data.error, 'score_before_review');
});

test('SSO verification requires the intended application audience', async () => {
  const issued = await request('/auth/sso/token', {
    method: 'POST',
    cookie: adminCookie,
    body: { appId: 'support' },
  });
  assert.equal(issued.status, 200);
  assert.ok(issued.data.token);

  const missingAudience = await request('/auth/sso/verify', {
    method: 'POST',
    body: { token: issued.data.token },
  });
  assert.equal(missingAudience.status, 400);
  assert.equal(missingAudience.data.error, 'audience_required');

  const wrongAudience = await request('/auth/sso/verify', {
    method: 'POST',
    body: { token: issued.data.token, audience: 'hr' },
  });
  assert.equal(wrongAudience.status, 401);

  const verified = await request('/auth/sso/verify', {
    method: 'POST',
    body: { token: issued.data.token, audience: 'support' },
  });
  assert.equal(verified.status, 200);
  assert.equal(verified.data.user.organizationId, 'engosoft');
});

test('the board cannot be dragged past either gate', async () => {
  const { task } = await create(
    '/tasks',
    {
      title: 'Gate test',
      department: 'marketing',
      stage: 'working',
      assigneeId: creative.user.id,
    },
    managerCookie
  );

  // Employee drags it to "done": that is an approval, and not theirs to make.
  const employeeToDone = await request(`/tasks/${task.id}`, {
    method: 'PATCH',
    cookie: creativeCookie,
    body: { stage: 'done' },
  });
  assert.equal(employeeToDone.status, 409);
  assert.equal(employeeToDone.data.error, 'review_required');

  // A manager cannot skip the score either — approving is an action, not a field.
  const managerToDone = await request(`/tasks/${task.id}`, {
    method: 'PATCH',
    cookie: managerCookie,
    body: { stage: 'done' },
  });
  assert.equal(managerToDone.status, 409);
  assert.equal(managerToDone.data.error, 'review_required');

  // And dropping onto the review column is a submission, with what that requires.
  const straightToReview = await request(`/tasks/${task.id}`, {
    method: 'PATCH',
    cookie: creativeCookie,
    body: { stage: 'review' },
  });
  assert.equal(straightToReview.status, 409);
  assert.equal(straightToReview.data.error, 'submit_required');

  // Moving between the open and active columns stays an ordinary drag.
  const ordinaryMove = await request(`/tasks/${task.id}`, {
    method: 'PATCH',
    cookie: creativeCookie,
    body: { stage: 'pending' },
  });
  assert.equal(ordinaryMove.status, 200);
  assert.equal(ordinaryMove.data.task.stage, 'pending');
});

test('assign → deliver → review → approve, including the rework loop', async () => {
  const { task } = await create(
    '/tasks',
    {
      title: 'Ramadan key visual',
      description: 'Three sizes, brand colours',
      objective: 'Create the launch visual',
      definitionOfDone: 'Three approved platform sizes',
      effortPoints: 5,
      estimatedMinutes: 360,
      department: 'marketing',
      subteam: 'creative',
      stage: 'pending',
      assigneeId: creative.user.id,
      dueDate: '2099-01-01',
    },
    managerCookie
  );

  const beforeAcceptance = await request(`/tasks/${task.id}/start`, {
    method: 'POST',
    cookie: creativeCookie,
  });
  assert.equal(beforeAcceptance.status, 403);

  const silentDecline = await request(`/tasks/${task.id}/assignment`, {
    method: 'POST',
    cookie: creativeCookie,
    body: { action: 'decline' },
  });
  assert.equal(silentDecline.status, 400);
  assert.equal(silentDecline.data.error, 'assignment_reason_required');

  const clarification = await request(`/tasks/${task.id}/assignment`, {
    method: 'POST',
    cookie: creativeCookie,
    body: { action: 'request_clarification', note: 'Which brand guideline version?' },
  });
  assert.equal(clarification.status, 200);
  assert.equal(clarification.data.task.assignmentStatus, 'clarification_requested');

  const acceptedAssignment = await request(`/tasks/${task.id}/assignment`, {
    method: 'POST',
    cookie: creativeCookie,
    body: { action: 'accept' },
  });
  assert.equal(acceptedAssignment.status, 200);
  assert.equal(acceptedAssignment.data.task.assignmentStatus, 'accepted');
  assert.ok(acceptedAssignment.data.task.acceptedAt);

  const assignmentHistory = await request(`/tasks/${task.id}/assignments`, {
    cookie: creativeCookie,
  });
  assert.equal(assignmentHistory.status, 200);
  assert.deepEqual(
    assignmentHistory.data.assignments.map((event) => event.action),
    ['assigned', 'request_clarification', 'accept']
  );
  assert.match(task.reference, /^TSK-/);
  assert.equal(task.objective, 'Create the launch visual');
  assert.equal(task.definitionOfDone, 'Three approved platform sizes');
  assert.equal(task.effortPoints, 5);
  assert.equal(task.estimatedMinutes, 360);

  const started = await request(`/tasks/${task.id}/start`, {
    method: 'POST',
    cookie: creativeCookie,
  });
  assert.equal(started.status, 200);
  assert.equal(started.data.task.stage, 'working');
  assert.ok(started.data.task.startedAt);

  // Handing in with nothing attached is the case the whole gate exists for.
  const empty = await request(`/tasks/${task.id}/submit`, {
    method: 'POST',
    cookie: creativeCookie,
    body: { note: 'done' },
  });
  assert.equal(empty.status, 400);
  assert.equal(empty.data.error, 'deliverable_required');

  const uploaded = await upload(task.id, { name: 'كي فيجوال.pdf' }, creativeCookie);
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data));
  assert.equal(uploaded.data.attachmentCount, 1);
  assert.equal(uploaded.data.attachment.name, 'كي فيجوال.pdf');

  const submitted = await request(`/tasks/${task.id}/submit`, {
    method: 'POST',
    cookie: creativeCookie,
    body: { note: 'الثلاث مقاسات جاهزة' },
  });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.data.task.stage, 'review');
  assert.ok(submitted.data.task.submittedAt);
  assert.equal(submitted.data.task.submittedBy, creative.user.id);

  // The employee cannot review their own submission into approval.
  const selfApprove = await request(`/tasks/${task.id}/review`, {
    method: 'POST',
    cookie: creativeCookie,
    body: { decision: 'approved', score: 100 },
  });
  assert.equal(selfApprove.status, 403);

  // Sending it back without saying why helps nobody, so it is refused.
  const silentReturn = await request(`/tasks/${task.id}/review`, {
    method: 'POST',
    cookie: managerCookie,
    body: { decision: 'changes_requested' },
  });
  assert.equal(silentReturn.status, 400);
  assert.equal(silentReturn.data.error, 'review_note_required');

  const returned = await request(`/tasks/${task.id}/review`, {
    method: 'POST',
    cookie: managerCookie,
    body: { decision: 'changes_requested', note: 'اللوجو صغير في مقاس الستوري' },
  });
  assert.equal(returned.status, 200);
  // Marketing names this column itself, so returned work lands there.
  assert.equal(returned.data.task.stage, 'rework');
  assert.equal(returned.data.task.reworkCount, 1);
  assert.equal(returned.data.task.submittedAt, null);
  assert.equal(returned.data.task.score, null);

  const resubmitted = await request(`/tasks/${task.id}/submit`, {
    method: 'POST',
    cookie: creativeCookie,
    body: { note: 'كبّرت اللوجو' },
  });
  assert.equal(resubmitted.status, 200);
  assert.equal(resubmitted.data.task.reviewDecision, null);

  const badScore = await request(`/tasks/${task.id}/review`, {
    method: 'POST',
    cookie: managerCookie,
    body: { decision: 'approved', score: 140 },
  });
  assert.equal(badScore.status, 400);
  assert.equal(badScore.data.error, 'invalid_score');

  const approved = await request(`/tasks/${task.id}/review`, {
    method: 'POST',
    cookie: managerCookie,
    body: { decision: 'approved', score: 88, note: 'تمام بعد التعديل' },
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.data.task.stage, 'done');
  assert.equal(approved.data.task.score, 88);
  assert.equal(approved.data.task.reviewedBy, manager.user.id);
  assert.equal(approved.data.task.reviewDecision, 'approved');
  assert.ok(approved.data.task.completedAt);

  // The assignee sees their own score and the feedback written for them.
  const mine = await request('/tasks', { cookie: creativeCookie });
  const own = mine.data.tasks.find((item) => item.id === task.id);
  assert.equal(own.score, 88);
  assert.equal(own.reviewNote, 'تمام بعد التعديل');

  // A teammate on the same board sees the task, but not the verdict on it.
  const colleague = await create(
    '/users',
    {
      name: 'Other Designer',
      email: 'other@test.local',
      password: 'Other123!',
      role: 'member',
      department: 'marketing',
      subteam: 'creative',
    },
    adminCookie
  );
  assert.ok(colleague.user.id);
  const colleagueCookie = await login('other@test.local', 'Other123!');
  const theirs = await request('/tasks', { cookie: colleagueCookie });
  const seen = theirs.data.tasks.find((item) => item.id === task.id);
  assert.equal(seen.score, null);
  assert.equal(seen.reviewNote, '');

  // The deliverable itself is downloadable, with its Arabic name intact.
  const files = await request(`/tasks/${task.id}/attachments`, { cookie: managerCookie });
  assert.equal(files.data.attachments.length, 1);
  const download = await fetch(
    `${ORIGIN}/api/tasks/${task.id}/attachments/${files.data.attachments[0].id}`,
    { headers: { Cookie: managerCookie } }
  );
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /filename\*=UTF-8''/);
  assert.equal(await download.text(), 'demo');
});

test('the overview counts rework, queue depth and first-pass approvals', async () => {
  const overview = await request('/tasks/overview?department=marketing', { cookie: managerCookie });
  assert.equal(overview.status, 200);
  const row = overview.data.people.find((person) => person.user.id === creative.user.id);

  assert.equal(row.completed, 1);
  assert.equal(row.returned, 1);
  // The one approved task went back once, so nothing was approved first time.
  assert.equal(row.firstPassRate, 0);
  assert.equal(row.averageScore, 88);
  assert.equal(row.onTimeRate, 100);
  assert.equal(typeof overview.data.summary.awaitingReview, 'number');
});

test('a sub-team scope hides the rest of the department but never own work', () => {
  const designer = {
    id: 'designer',
    organizationId: 'engosoft',
    department: 'marketing',
    subteam: 'creative',
    role: 'member',
    status: 'active',
    visibilityScope: 'subteam',
  };
  const buyer = {
    id: 'buyer',
    organizationId: 'engosoft',
    department: 'marketing',
    subteam: 'performance',
    role: 'member',
    status: 'active',
  };
  const base = { organizationId: 'engosoft', department: 'marketing', createdBy: buyer.id };

  const creativeTask = { ...base, id: 't1', subteam: 'creative', assigneeId: null };
  const performanceTask = { ...base, id: 't2', subteam: 'performance', assigneeId: buyer.id };
  const assignedAcross = { ...base, id: 't3', subteam: 'performance', assigneeId: designer.id };
  const departmentWide = { ...base, id: 't4', subteam: null, assigneeId: null };

  assert.equal(canViewTask(designer, creativeTask), true);
  assert.equal(canViewTask(designer, performanceTask), false);
  // Work handed to them personally outranks the scope — hiding it would be a bug.
  assert.equal(canViewTask(designer, assignedAcross), true);
  assert.equal(canViewTask(designer, departmentWide), false);
  // The wider colleague is unaffected by the narrower person's setting.
  assert.equal(canViewTask(buyer, creativeTask), true);

  assert.deepEqual(
    visiblePeople(designer, [designer, buyer]).map((person) => person.id),
    [designer.id]
  );
  assert.equal(canAssignUser(designer, buyer, 'marketing'), false);
});

test('a scope can narrow what a role grants but never widen it', () => {
  const member = {
    id: 'm',
    organizationId: 'engosoft',
    department: 'marketing',
    role: 'member',
    status: 'active',
    // A member has no tasks.view_all, so asking for the company is refused.
    visibilityScope: 'all',
  };
  const otherDepartment = {
    id: 't',
    organizationId: 'engosoft',
    department: 'sales',
    createdBy: 'someone',
    assigneeId: 'someone',
  };
  assert.equal(canViewTask(member, otherDepartment), false);
});

test('an invite link creates a pending account that cannot sign in until approved', async () => {
  const invite = await create(
    '/invites',
    {
      label: 'Marketing intake',
      role: 'member',
      departments: ['marketing'],
      emailDomain: 'test.local',
      maxUses: 2,
      expiresInDays: 7,
      visibilityScope: 'subteam',
    },
    adminCookie
  );
  assert.equal(invite.invite.state, 'active');
  const { token } = invite.invite;

  // The public view must not leak what the link will grant.
  const publicView = await request(`/invites/token/${token}`);
  assert.equal(publicView.status, 200);
  assert.equal(publicView.data.invite.requiresApproval, true);
  assert.equal(publicView.data.invite.departments.length, 1);
  assert.equal(publicView.data.invite.role, undefined);
  assert.equal(publicView.data.invite.permissions, undefined);
  assert.equal(publicView.data.invite.token, undefined);

  const joinBody = {
    name: 'Video Editor',
    email: 'editor@test.local',
    password: 'EditorPass123!',
    department: 'marketing',
    subteam: 'creative',
    jobRole: 'video_editor',
  };
  const joined = await request(`/invites/token/${token}/accept`, {
    method: 'POST',
    body: joinBody,
  });
  assert.equal(joined.status, 201, JSON.stringify(joined.data));
  assert.equal(joined.data.status, 'pending_approval');
  // Nothing that could act as a session comes back from a public endpoint.
  assert.equal(joined.cookie, null);

  // Right password, but the account is not approved yet.
  const earlyLogin = await request('/auth/login', {
    method: 'POST',
    body: { email: 'editor@test.local', password: 'EditorPass123!' },
  });
  assert.equal(earlyLogin.status, 403);
  assert.equal(earlyLogin.data.error, 'account_pending');
  assert.equal(earlyLogin.cookie, null);

  // The same email cannot be taken twice, by the link or by an administrator.
  const duplicate = await request(`/invites/token/${token}/accept`, {
    method: 'POST',
    body: { ...joinBody, name: 'Impostor' },
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.data.error, 'email_taken');

  const duplicateByAdmin = await request('/users', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: 'Impostor',
      email: 'editor@test.local',
      password: 'Another123!',
      role: 'member',
      department: 'marketing',
    },
  });
  assert.equal(duplicateByAdmin.status, 409);

  // The domain rule is enforced server-side, not just in the form.
  const wrongDomain = await request(`/invites/token/${token}/accept`, {
    method: 'POST',
    body: { ...joinBody, email: 'someone@gmail.com' },
  });
  assert.equal(wrongDomain.status, 400);
  assert.equal(wrongDomain.data.error, 'email_domain_mismatch');

  // A department the link does not offer is refused even though it is real.
  const wrongDepartment = await request(`/invites/token/${token}/accept`, {
    method: 'POST',
    body: { ...joinBody, email: 'newbie@test.local', department: 'sales', subteam: null },
  });
  assert.equal(wrongDepartment.status, 400);
  assert.equal(wrongDepartment.data.error, 'invalid_department');

  const pendingUser = (await request('/users', { cookie: adminCookie })).data.users.find(
    (person) => person.email === 'editor@test.local'
  );
  assert.equal(pendingUser.status, 'pending');
  assert.equal(pendingUser.role, 'member');
  // Settings came from the invite, not from the join form.
  assert.equal(pendingUser.visibilityScope, 'subteam');
  assert.equal(pendingUser.subteam, 'creative');

  const approved = await request(`/users/${pendingUser.id}`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { status: 'active' },
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.data.user.status, 'active');

  const cookie = await login('editor@test.local', 'EditorPass123!');
  const counts = await request('/tasks/counts', { cookie });
  assert.equal(counts.status, 200);
  assert.equal(typeof counts.data.mine, 'number');
  // Sub-team scope: the campaign task belongs to creative, and so do they.
  const theirs = await request('/tasks', { cookie });
  assert.ok(theirs.data.tasks.every((task) => task.subteam === 'creative'));
});

test('an invite link cannot grant manager access, and a revoked link is dead', async () => {
  const escalation = await request('/invites', {
    method: 'POST',
    cookie: adminCookie,
    body: { label: 'Nope', role: 'admin' },
  });
  assert.equal(escalation.status, 400);
  assert.equal(escalation.data.error, 'role_not_invitable');

  const invite = await create('/invites', { label: 'Short lived', role: 'viewer' }, adminCookie);
  await request(`/invites/${invite.invite.id}/revoke`, { method: 'POST', cookie: adminCookie });

  const afterRevoke = await request(`/invites/token/${invite.invite.token}`);
  assert.equal(afterRevoke.status, 404);
  assert.equal(afterRevoke.data.error, 'invite_revoked');

  const blocked = await request(`/invites/token/${invite.invite.token}/accept`, {
    method: 'POST',
    body: {
      name: 'Too late',
      email: 'toolate@test.local',
      password: 'TooLate123!',
      department: 'sales',
    },
  });
  assert.equal(blocked.status, 404);

  // Creating and listing links is administrator-only.
  const asEmployee = await request('/invites', { cookie: creativeCookie });
  assert.equal(asEmployee.status, 403);
});
