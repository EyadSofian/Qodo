import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canArchiveTask,
  canAssignUser,
  canDeleteTask,
  canManageTaskPlan,
  canViewTask,
  visiblePeople,
} from './taskAccess.js';
import { PERMISSIONS, can, visibilityFor } from '../shared/permissions.js';
import {
  canApproveWork,
  canReopen,
  canReview,
  canScoreWork,
  canStart,
  canSubmit,
  isDoer,
} from '../shared/workflow.js';
import { DEPARTMENTS, getStage, getSubteam, stageType } from '../shared/departments.js';
import {
  hasSignoffStage,
  stageForApproval,
  stageForReturn,
  stageForState,
} from '../shared/workflow.js';

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

test('every department supports the complete task lifecycle', () => {
  for (const department of DEPARTMENTS) {
    const types = new Set(department.stages.map((stage) => stage.type));
    for (const required of ['open', 'active', 'review', 'done']) {
      assert.ok(types.has(required), `${department.id} is missing a ${required} stage`);
    }
  }
});

test('no column exists that the lifecycle can never move a task into', () => {
  // A stage a gate lands on is reachable, and so is anything a reviewer can drag
  // to. What must not exist is a *second* column of a type whose name promises
  // a lifecycle event — marketing's first "معتمدة" sat in the `open` group beside
  // "قيد الانتظار", so approving never put anything there while its label said
  // it had. The board is the record; a column that lies about the record is worse
  // than no column.
  //
  // The column is back, and this test is what says it is back *correctly*: it
  // carries its own canonical type, the approval gate lands on it, and the
  // publish action is the way out. Those three facts are the difference between
  // this and the trap that was removed.
  const marketing = DEPARTMENTS.find((department) => department.id === 'marketing');
  assert.deepEqual(
    marketing.stages.map((stage) => stage.id),
    ['pending', 'working', 'review', 'approved', 'rework', 'blocked', 'done']
  );
  assert.equal(marketing.stages.filter((stage) => stage.type === 'open').length, 1);
  assert.equal(marketing.stages.filter((stage) => stage.type === 'signoff').length, 1);
  assert.equal(marketing.stages.filter((stage) => stage.type === 'done').length, 1);

  // Approving lands on "معتمدة", publishing on "منجزة", rework on "إعادة عمل".
  assert.equal(stageForApproval('marketing', null), 'approved');
  assert.equal(stageForState('marketing', 'approved', null), 'done');
  assert.equal(stageForState('marketing', 'submitted', null), 'review');
  assert.equal(stageForReturn('marketing', null), 'rework');

  // Every other board is untouched: no sign-off column, so approving still
  // closes the task outright.
  assert.equal(hasSignoffStage('marketing'), true);
  for (const id of ['general', 'sales', 'operations', 'complaints', 'hr', 'training', 'finance', 'it']) {
    assert.equal(hasSignoffStage(id), false, `${id} should not declare a sign-off column`);
    assert.equal(stageForApproval(id, null), stageForState(id, 'approved', null), id);
  }

  // The id was freed when the old column was retired, and reusing it must not
  // resurrect the alias that sent those cards back to the top of the board.
  assert.equal(getStage('marketing', 'approved').id, 'approved');
  assert.equal(stageType('marketing', 'approved'), 'signoff');

  // Marketing gained a moderation sub-team; the tree is what staffing reads.
  assert.equal(getSubteam('marketing', 'moderation')?.en, 'Moderation');
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

  // Filing work is the commissioning half of the contract, so an employee has
  // no route to it — not in another department and not in their own either.
  const crossTeam = await request('/tasks', {
    method: 'POST',
    cookie: creativeCookie,
    body: { title: 'Should fail', department: 'sales', stage: 'lead' },
  });
  assert.equal(crossTeam.status, 403);

  const ownTeam = await request('/tasks', {
    method: 'POST',
    cookie: creativeCookie,
    body: { title: 'A task for myself', department: 'marketing', stage: 'pending' },
  });
  assert.equal(ownTeam.status, 403);
  assert.equal(ownTeam.data.missing, 'tasks.create');

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

  // Employee drags it to "done": approving is not an authority they hold, so
  // this is not "use the review gate", it is simply refused.
  const employeeToDone = await request(`/tasks/${task.id}`, {
    method: 'PATCH',
    cookie: creativeCookie,
    body: { stage: 'done' },
  });
  assert.equal(employeeToDone.status, 403);
  assert.equal(employeeToDone.data.error, 'forbidden');

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

  // For the person doing the work a stage is the result of an action, never a
  // drag — so pushing their own card backwards out of the active column is not
  // an "ordinary move", it is refused outright.
  const employeeBackwards = await request(`/tasks/${task.id}`, {
    method: 'PATCH',
    cookie: creativeCookie,
    body: { stage: 'pending' },
  });
  assert.equal(employeeBackwards.status, 403);
  assert.equal(employeeBackwards.data.error, 'forbidden');

  // Nor sideways within the same canonical type. In marketing that is the move
  // out of "إعادة عمل" — where a manager put it — back into "قيد العمل", or
  // parking it in "متوقفة" to stop the clock on their own.
  for (const stage of ['rework', 'blocked']) {
    const sideways = await request(`/tasks/${task.id}`, {
      method: 'PATCH',
      cookie: creativeCookie,
      body: { stage },
    });
    assert.equal(sideways.status, 403, `employee moved the card to ${stage}`);
  }

  // The manager rearranging the board is exactly what dragging is for.
  const ordinaryMove = await request(`/tasks/${task.id}`, {
    method: 'PATCH',
    cookie: managerCookie,
    body: { stage: 'pending' },
  });
  assert.equal(ordinaryMove.status, 200);
  assert.equal(ordinaryMove.data.task.stage, 'pending');

  const bornInReview = await request('/tasks', {
    method: 'POST',
    cookie: managerCookie,
    body: { title: 'No synthetic submission', department: 'marketing', stage: 'review' },
  });
  assert.equal(bornInReview.status, 409);
  assert.equal(bornInReview.data.error, 'submit_required');

  const bornDone = await request('/tasks', {
    method: 'POST',
    cookie: managerCookie,
    body: { title: 'No synthetic approval', department: 'marketing', stage: 'done' },
  });
  assert.equal(bornDone.status, 409);
  assert.equal(bornDone.data.error, 'review_required');
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

  // Dragging is not a second route around the assignment response gate.
  const draggedBeforeAcceptance = await request(`/tasks/${task.id}`, {
    method: 'PATCH',
    cookie: creativeCookie,
    body: { stage: 'working' },
  });
  assert.equal(draggedBeforeAcceptance.status, 409);
  assert.equal(draggedBeforeAcceptance.data.error, 'assignment_required');

  // The assignee may do the work, but cannot silently unassign themselves or
  // approve their own due-date proposal through the generic edit endpoint.
  const changedPlan = await request(`/tasks/${task.id}`, {
    method: 'PATCH',
    cookie: creativeCookie,
    body: { dueDate: '2099-02-01' },
  });
  assert.equal(changedPlan.status, 403);
  assert.equal(changedPlan.data.error, 'task_plan_forbidden');

  // But the work itself is theirs, and saying so has to keep working: reporting
  // progress must not be read as re-planning just because the form round-trips
  // the brief alongside it.
  const reportedProgress = await request(`/tasks/${task.id}`, {
    method: 'PATCH',
    cookie: creativeCookie,
    body: {
      progress: 40,
      notes: 'شغال على المقاسات',
      // Unchanged plan values, exactly as the dialog echoes them back.
      title: 'Ramadan key visual',
      dueDate: '2099-01-01',
      assigneeId: creative.user.id,
      department: 'marketing',
      subteam: 'creative',
    },
  });
  assert.equal(reportedProgress.status, 200);
  assert.equal(reportedProgress.data.task.progress, 40);
  assert.equal(reportedProgress.data.task.dueDate, '2099-01-01');

  // Assignment creates both a directly fetchable task and an in-app alert for
  // the recipient; this is the contract used by fresh notification deep links.
  const direct = await request(`/tasks/${task.id}`, { cookie: creativeCookie });
  assert.equal(direct.status, 200);
  assert.deepEqual(direct.data.task.assigneeIds, [creative.user.id]);
  const alerts = await request('/notifications', { cookie: creativeCookie });
  assert.equal(alerts.status, 200);
  assert.ok(
    alerts.data.notifications.some(
      (notification) =>
        notification.type === 'task.assigned' && notification.link === `/tasks?task=${task.id}`
    )
  );

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
  // The answer lives on this partner's own row, not on the task.
  assert.equal(
    clarification.data.task.assignments.find((row) => row.userId === creative.user.id).status,
    'clarification_requested'
  );

  const acceptedAssignment = await request(`/tasks/${task.id}/assignment`, {
    method: 'POST',
    cookie: creativeCookie,
    body: { action: 'accept' },
  });
  assert.equal(acceptedAssignment.status, 200);
  const acceptedRow = acceptedAssignment.data.task.assignments.find(
    (row) => row.userId === creative.user.id
  );
  assert.equal(acceptedRow.status, 'accepted');
  assert.ok(acceptedRow.acceptedAt);

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

  // A blank hand-in — no file, no note — is the case the gate still exists for.
  const empty = await request(`/tasks/${task.id}/submit`, {
    method: 'POST',
    cookie: creativeCookie,
    body: {},
  });
  assert.equal(empty.status, 400);
  assert.equal(empty.data.error, 'submission_empty');

  const uploaded = await upload(task.id, { name: 'كي فيجوال.pdf' }, creativeCookie);
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data));
  assert.equal(uploaded.data.attachmentCount, 1);
  assert.equal(uploaded.data.attachment.name, 'كي فيجوال.pdf');

  // An open manager tab gets a live signal; the durable notification endpoint
  // remains the source of the title, body and deep link.
  const streamController = new AbortController();
  const stream = await fetch(`${ORIGIN}/api/notifications/stream`, {
    headers: { Cookie: managerCookie },
    signal: streamController.signal,
  });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get('content-type') ?? '', /text\/event-stream/);
  const streamReader = stream.body.getReader();
  const decoder = new TextDecoder();
  const readyEvent = decoder.decode((await streamReader.read()).value);
  assert.match(readyEvent, /event: ready/);

  const submitted = await request(`/tasks/${task.id}/submit`, {
    method: 'POST',
    cookie: creativeCookie,
    body: { note: 'الثلاث مقاسات جاهزة' },
  });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.data.task.stage, 'review');
  assert.ok(submitted.data.task.submittedAt);
  assert.equal(submitted.data.task.submittedBy, creative.user.id);

  const liveEvent = await Promise.race([
    streamReader.read(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('notification stream did not publish')), 2_000)
    ),
  ]);
  assert.match(decoder.decode(liveEvent.value), /event: notification/);
  streamController.abort();

  const reviewerAlerts = await request('/notifications', { cookie: managerCookie });
  const completionAlert = reviewerAlerts.data.notifications.find(
    (notification) =>
      notification.type === 'task.submitted' && notification.link === `/tasks?task=${task.id}`
  );
  assert.ok(completionAlert);
  assert.deepEqual(completionAlert.title, {
    ar: 'تم تسليم مهمة للمراجعة',
    en: 'Task completed and submitted',
  });
  assert.match(completionAlert.body.ar, new RegExp(creative.user.name));
  assert.match(completionAlert.body.en, /completed/);

  const draggedOutOfReview = await request(`/tasks/${task.id}`, {
    method: 'PATCH',
    cookie: managerCookie,
    body: { stage: 'rework' },
  });
  assert.equal(draggedOutOfReview.status, 409);
  assert.equal(draggedOutOfReview.data.error, 'review_required');

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
  // Marketing separates "the manager said yes" from "it went out", so approving
  // parks the card in "معتمدة" rather than closing it.
  assert.equal(approved.data.task.stage, 'approved');
  assert.equal(approved.data.task.score, 88);
  assert.equal(approved.data.task.reviewedBy, manager.user.id);
  assert.equal(approved.data.task.reviewDecision, 'approved');
  // The work was finished when it was approved — waiting for a publishing slot
  // is not the employee still owing something.
  assert.ok(approved.data.task.completedAt);
  assert.equal(approved.data.task.publishedAt, null);

  const directScoreEdit = await request(`/tasks/${task.id}`, {
    method: 'PATCH',
    cookie: managerCookie,
    body: { score: 99 },
  });
  assert.equal(directScoreEdit.status, 409);
  assert.equal(directScoreEdit.data.error, 'review_required');

  const draggedOutOfSignoff = await request(`/tasks/${task.id}`, {
    method: 'PATCH',
    cookie: managerCookie,
    body: { stage: 'working' },
  });
  assert.equal(draggedOutOfSignoff.status, 409);
  assert.equal(draggedOutOfSignoff.data.error, 'reopen_required');

  // Dragging it to "منجزة" is the publish step and has its own action, so the
  // plain stage write is refused the same way every other gate is.
  const draggedToDone = await request(`/tasks/${task.id}`, {
    method: 'PATCH',
    cookie: managerCookie,
    body: { stage: 'done' },
  });
  assert.equal(draggedToDone.status, 409);
  assert.equal(draggedToDone.data.error, 'publish_required');

  // Publishing is not a gate: the assignee may record that their own approved
  // work went out, and it asks for nothing because the score already exists.
  const published = await request(`/tasks/${task.id}/publish`, {
    method: 'POST',
    cookie: creativeCookie,
  });
  assert.equal(published.status, 200);
  assert.equal(published.data.task.stage, 'done');
  assert.ok(published.data.task.publishedAt);
  assert.equal(published.data.task.publishedBy, creative.user.id);
  // Publishing must not restamp completion, or a post that waited a week for
  // its slot would read as delivered a week late.
  assert.equal(published.data.task.completedAt, approved.data.task.completedAt);

  const draggedOutOfDone = await request(`/tasks/${task.id}`, {
    method: 'PATCH',
    cookie: managerCookie,
    body: { stage: 'working' },
  });
  assert.equal(draggedOutOfDone.status, 409);
  assert.equal(draggedOutOfDone.data.error, 'reopen_required');

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

test('a link satisfies the deliverable gate, and only http(s) links do', async () => {
  const { task } = await create(
    '/tasks',
    {
      title: 'Q3 campaign sheet',
      department: 'marketing',
      subteam: 'creative',
      stage: 'pending',
      assigneeId: creative.user.id,
    },
    managerCookie
  );
  await request(`/tasks/${task.id}/assignment`, {
    method: 'POST',
    cookie: creativeCookie,
    body: { action: 'accept' },
  });

  // A blank hand-in is still refused: no file and nothing said is the "done"
  // with nothing behind it that the lifecycle exists to prevent.
  const blank = await request(`/tasks/${task.id}/submit`, {
    method: 'POST',
    cookie: creativeCookie,
    body: {},
  });
  assert.equal(blank.status, 400);
  assert.equal(blank.data.error, 'submission_empty');

  // A URL comes back out as an href, so anything that could execute is refused.
  for (const url of ['javascript:alert(1)', 'data:text/html,<script>x</script>', 'not a url', '']) {
    const bad = await request(`/tasks/${task.id}/attachments/link`, {
      method: 'POST',
      cookie: creativeCookie,
      body: { url },
    });
    assert.equal(bad.status, 400, `accepted ${url}`);
    assert.equal(bad.data.error, 'invalid_link');
  }

  const linked = await request(`/tasks/${task.id}/attachments/link`, {
    method: 'POST',
    cookie: creativeCookie,
    body: { url: 'https://docs.google.com/spreadsheets/d/abc/edit?gid=1004542274' },
  });
  assert.equal(linked.status, 201, JSON.stringify(linked.data));
  assert.equal(linked.data.attachmentCount, 1);
  assert.equal(linked.data.attachment.kind, 'link');
  // Unnamed, so it is called after its host — the part that says what it is.
  assert.equal(linked.data.attachment.name, 'docs.google.com');
  assert.match(linked.data.attachment.url, /^https:\/\/docs\.google\.com\//);

  // There are no bytes behind a link, and this endpoint must not turn into an
  // open redirect to wherever the employee pasted.
  const asFile = await request(
    `/tasks/${task.id}/attachments/${linked.data.attachment.id}`,
    { cookie: managerCookie }
  );
  assert.equal(asFile.status, 400);
  assert.equal(asFile.data.error, 'link_deliverable');

  // Same gate, now satisfied.
  const submitted = await request(`/tasks/${task.id}/submit`, {
    method: 'POST',
    cookie: creativeCookie,
    body: { note: 'الشيت جاهز' },
  });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.data));
  assert.equal(submitted.data.task.stage, 'review');
});

test('clearing a task away is an archive, and the purge is two authorities deep', async () => {
  const { task } = await create(
    '/tasks',
    {
      title: 'Filed by mistake',
      department: 'marketing',
      subteam: 'creative',
      stage: 'pending',
      assigneeId: creative.user.id,
    },
    managerCookie
  );

  // The assignee cannot make the work they are measured on go away, by either
  // door — not the archive, and not the delete that used to be open to them.
  const employeeArchive = await request(`/tasks/${task.id}/archive`, {
    method: 'POST',
    cookie: creativeCookie,
  });
  assert.equal(employeeArchive.status, 403);
  assert.equal(employeeArchive.data.error, 'archive_forbidden');

  const employeeDelete = await request(`/tasks/${task.id}`, {
    method: 'DELETE',
    cookie: creativeCookie,
  });
  assert.equal(employeeDelete.status, 403);

  const archived = await request(`/tasks/${task.id}/archive`, {
    method: 'POST',
    cookie: managerCookie,
    body: { reason: 'مكررة' },
  });
  assert.equal(archived.status, 200);
  assert.equal(archived.data.task.archivedBy, manager.user.id);
  assert.equal(archived.data.task.archiveReason, 'مكررة');

  // Off the board for everyone, but not gone: the record is still fetchable by
  // id, which is the whole difference between archiving and deleting.
  const board = await request('/tasks', { cookie: managerCookie });
  assert.equal(board.data.tasks.some((item) => item.id === task.id), false);
  const employeeBoard = await request('/tasks', { cookie: creativeCookie });
  assert.equal(employeeBoard.data.tasks.some((item) => item.id === task.id), false);
  const stillThere = await request(`/tasks/${task.id}`, { cookie: managerCookie });
  assert.equal(stillThere.status, 200);
  assert.equal(stillThere.data.task.title, 'Filed by mistake');

  // Nothing carries on inside the archive — no edits, no lifecycle, no comments.
  for (const [pathname, options] of [
    [`/tasks/${task.id}`, { method: 'PATCH', body: { progress: 40 } }],
    [`/tasks/${task.id}/start`, { method: 'POST' }],
    [`/tasks/${task.id}/comments`, { method: 'POST', body: { body: 'hello' } }],
  ]) {
    const blocked = await request(pathname, { ...options, cookie: creativeCookie });
    assert.equal(blocked.status, 409, `${pathname} should be closed while archived`);
    assert.equal(blocked.data.error, 'task_archived');
  }

  // Destroying the record is an administrator's retention call, not the
  // department manager's — even for work they archived themselves.
  const managerPurge = await request(`/tasks/${task.id}`, {
    method: 'DELETE',
    cookie: managerCookie,
  });
  assert.equal(managerPurge.status, 403);

  const restored = await request(`/tasks/${task.id}/restore`, {
    method: 'POST',
    cookie: managerCookie,
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.data.task.archivedAt, null);
  const backOnBoard = await request('/tasks', { cookie: creativeCookie });
  assert.equal(backOnBoard.data.tasks.some((item) => item.id === task.id), true);

  // A live task cannot be purged even by an administrator: the archive is the
  // step in between where somebody still gets the chance to notice.
  const purgeLive = await request(`/tasks/${task.id}`, { method: 'DELETE', cookie: adminCookie });
  assert.equal(purgeLive.status, 409);
  assert.equal(purgeLive.data.error, 'archive_required');

  await request(`/tasks/${task.id}/archive`, { method: 'POST', cookie: adminCookie });
  const purged = await request(`/tasks/${task.id}`, { method: 'DELETE', cookie: adminCookie });
  assert.equal(purged.status, 200);
  const afterPurge = await request(`/tasks/${task.id}`, { cookie: adminCookie });
  assert.equal(afterPurge.status, 404);
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
  // Filing work is a manager's act now, so no employee is the author of their
  // own card — which is what makes the sub-team rule the thing under test here
  // rather than the "always see your own work" fallback.
  const base = { organizationId: 'engosoft', department: 'marketing', createdBy: 'lead' };

  const creativeTask = { ...base, id: 't1', subteam: 'creative', assigneeId: null };
  const performanceTask = { ...base, id: 't2', subteam: 'performance', assigneeId: buyer.id };
  const assignedAcross = { ...base, id: 't3', subteam: 'performance', assigneeId: designer.id };
  const departmentWide = { ...base, id: 't4', subteam: null, assigneeId: null };

  assert.equal(canViewTask(designer, creativeTask), true);
  assert.equal(canViewTask(designer, performanceTask), false);
  // Work handed to them personally outranks the scope — hiding it would be a bug.
  assert.equal(canViewTask(designer, assignedAcross), true);
  assert.equal(canViewTask(designer, departmentWide), false);
  // The colleague who set nothing gets the same sub-team default from their
  // role, so the creative board is not their business either.
  assert.equal(canViewTask(buyer, creativeTask), false);
  assert.equal(canViewTask(buyer, performanceTask), true);

  assert.deepEqual(
    visiblePeople(designer, [designer, buyer]).map((person) => person.id),
    [designer.id]
  );
  assert.equal(canAssignUser(designer, buyer, 'marketing'), false);
});

test('the sub-team default falls through where no sub-team exists', () => {
  // Sales declares no sub-teams at all, so a sub-team default would have left
  // its staff seeing nothing but their own rows. The default degrades to the
  // department; an explicit choice made by an administrator never does.
  const seller = {
    id: 'seller',
    organizationId: 'engosoft',
    department: 'sales',
    role: 'member',
    status: 'active',
  };
  const colleagueTask = {
    id: 's1',
    organizationId: 'engosoft',
    department: 'sales',
    createdBy: 'someone',
    assigneeId: 'someone',
  };

  assert.equal(visibilityFor(seller), 'department');
  assert.equal(canViewTask(seller, colleagueTask), true);
  assert.equal(visibilityFor({ ...seller, visibilityScope: 'subteam' }), 'subteam');
  assert.equal(canViewTask({ ...seller, visibilityScope: 'subteam' }, colleagueTask), false);
});

test('each authority is its own key, and legacy overrides keep all four', () => {
  const base = {
    id: 'x',
    organizationId: 'engosoft',
    department: 'marketing',
    status: 'active',
  };
  const employee = { ...base, role: 'member' };
  const boss = { ...base, role: 'manager' };
  const task = {
    id: 'k',
    organizationId: 'engosoft',
    department: 'marketing',
    createdBy: employee.id,
    assigneeId: employee.id,
    stage: 'review',
  };

  // Nothing on the commissioning side of the contract reaches an employee, and
  // having filed the task grants none of it back.
  for (const permission of [
    PERMISSIONS.TASKS_CREATE,
    PERMISSIONS.TASKS_ASSIGN,
    PERMISSIONS.TASKS_REVIEW,
    PERMISSIONS.TASKS_APPROVE,
    PERMISSIONS.TASKS_SCORE,
    PERMISSIONS.TASKS_ARCHIVE,
  ]) {
    assert.equal(can(employee, permission), false, `member should not hold ${permission}`);
    assert.equal(can(boss, permission), true, `manager should hold ${permission}`);
  }
  assert.equal(canManageTaskPlan(employee, task), false);
  assert.equal(canReview(employee, task), false);
  assert.equal(canReopen(employee, { ...task, stage: 'done' }), false);

  // Clearing the board and destroying the record are different powers. A manager
  // archives; only an administrator purges, so a department manager can never be
  // the one who makes a task's history stop existing.
  const archived = { ...task, archivedAt: '2026-01-01T00:00:00.000Z' };
  assert.equal(canArchiveTask(employee, task), false);
  assert.equal(canArchiveTask(boss, task), true);
  assert.equal(can(boss, PERMISSIONS.TASKS_DELETE_ANY), false);
  assert.equal(canDeleteTask(employee, archived), false);
  assert.equal(canDeleteTask(boss, archived), false);
  assert.equal(canDeleteTask({ ...base, role: 'admin' }, archived), true);

  // The keys are genuinely independent: a reviewer who may send work back need
  // not be able to close it or put a number on anyone's record.
  const readOnlyReviewer = {
    ...base,
    role: 'member',
    permissions: [PERMISSIONS.TASKS_VIEW, PERMISSIONS.TASKS_VIEW_TEAM, PERMISSIONS.TASKS_REVIEW],
  };
  assert.equal(canReview(readOnlyReviewer, task), true);
  assert.equal(canApproveWork(readOnlyReviewer), false);
  assert.equal(canScoreWork(readOnlyReviewer), false);

  // An override saved before the split carries the old key alone, and must not
  // silently lose the three authorities that used to be bundled into it.
  const legacy = {
    ...base,
    role: 'member',
    permissions: [
      PERMISSIONS.TASKS_VIEW,
      PERMISSIONS.TASKS_VIEW_TEAM,
      PERMISSIONS.TASKS_EDIT_ANY,
    ],
  };
  for (const permission of [
    PERMISSIONS.TASKS_ASSIGN,
    PERMISSIONS.TASKS_REVIEW,
    PERMISSIONS.TASKS_APPROVE,
    PERMISSIONS.TASKS_SCORE,
  ]) {
    assert.equal(can(legacy, permission), true, `legacy override lost ${permission}`);
  }
  // A deliberately narrowed override is left exactly as the administrator saved
  // it — the back-fill only applies where none of the new keys were chosen.
  const narrowed = { ...legacy, permissions: [...legacy.permissions, PERMISSIONS.TASKS_REVIEW] };
  assert.equal(can(narrowed, PERMISSIONS.TASKS_REVIEW), true);
  assert.equal(can(narrowed, PERMISSIONS.TASKS_APPROVE), false);
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

test('a task with owners is not free for a manager to pick up', () => {
  // The "nobody owns this, so an assigner may start it" branch used to read the
  // legacy single field. Every task written since the split leaves that field
  // absent, so a shared task read as unowned and any assigner could start or
  // hand in work that belonged to two other people.
  const manager = { id: 'm', role: 'manager', status: 'active' };
  const owner = { id: 'w', role: 'member', status: 'active' };
  const base = { department: 'marketing', stage: 'pending', createdBy: 'm' };
  const shared = {
    ...base,
    assigneeIds: ['w', 'x'],
    assignments: [
      { userId: 'w', status: 'accepted' },
      { userId: 'x', status: 'pending' },
    ],
  };

  assert.equal(canStart(manager, shared), false, 'a manager may not start owned work');
  assert.equal(canSubmit(manager, shared), false, 'nor hand it in for them');
  assert.equal(isDoer(manager, shared), false);
  assert.equal(canStart(owner, shared), true, 'the partner who accepted still can');

  // Genuinely unowned work stays pickup-able, which is the point of the branch.
  const unowned = { ...base, assigneeIds: [], assignments: [] };
  assert.equal(canStart(manager, unowned), true);
});

test('two people can own one task, and both carry its score', async () => {
  // A second designer, so the shared task has a real second party rather than
  // the manager standing in for one.
  const second = await create(
    '/users',
    {
      name: 'عبدالله',
      email: 'abdullah@test.local',
      password: 'DesignPass123!',
      role: 'member',
      department: 'marketing',
      subteam: 'creative',
    },
    adminCookie
  );
  const secondCookie = await login('abdullah@test.local', 'DesignPass123!');

  const { task } = await create(
    '/tasks',
    {
      title: 'حملة مشتركة',
      department: 'marketing',
      subteam: 'creative',
      assigneeIds: [creative.user.id, second.user.id],
      dueDate: '2099-01-01',
    },
    managerCookie
  );
  assert.deepEqual(task.assigneeIds, [creative.user.id, second.user.id]);

  // Each partner answers for themselves — the manager assigned both, so both
  // start pending and neither answer speaks for the other.
  assert.deepEqual(
    task.assignments.map((row) => row.status),
    ['pending', 'pending']
  );

  await request(`/tasks/${task.id}/assignment`, {
    method: 'POST',
    cookie: creativeCookie,
    body: { action: 'accept' },
  });
  const afterOne = await request(`/tasks/${task.id}`, { cookie: managerCookie });
  const rows = afterOne.data.task.assignments;
  assert.equal(rows.find((row) => row.userId === creative.user.id).status, 'accepted');
  assert.equal(
    rows.find((row) => row.userId === second.user.id).status,
    'pending',
    'one partner accepting must not answer for the other'
  );

  // A partner who has not answered their own assignment yet cannot hand the
  // work in — the accept gate is per person, so being on a shared task is not
  // a way around it.
  await upload(task.id, { name: 'shared.pdf' }, creativeCookie);
  const tooEarly = await request(`/tasks/${task.id}/submit`, {
    method: 'POST',
    cookie: secondCookie,
    body: { note: 'لسه مقبلتش' },
  });
  assert.equal(tooEarly.status, 403);

  // The partner who did accept may hand it in for both; one submission covers
  // the task, because the deliverable is the task's, not each person's.
  const submitted = await request(`/tasks/${task.id}/submit`, {
    method: 'POST',
    cookie: creativeCookie,
    body: { note: 'خلصنا الاتنين' },
  });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.data));

  const approved = await request(`/tasks/${task.id}/review`, {
    method: 'POST',
    cookie: managerCookie,
    body: { decision: 'approved', score: 90, note: 'تمام' },
  });
  assert.equal(approved.status, 200);

  // One review closed it for both, and the same number lands on both records —
  // which is what "equal partners" was asked to mean.
  const overview = await request('/tasks/overview?department=marketing', {
    cookie: managerCookie,
  });
  for (const person of [creative.user.id, second.user.id]) {
    const row = overview.data.people.find((entry) => entry.user.id === person);
    assert.ok(
      row.averageScore >= 88 && row.averageScore <= 90,
      `${person} should carry the shared score, got ${row.averageScore}`
    );
  }

  // And a stranger to the task still cannot hand it in.
  const outsider = await request(`/tasks/${task.id}/submit`, {
    method: 'POST',
    cookie: adminCookie,
    body: { note: 'nope' },
  });
  assert.notEqual(outsider.status, 200);
});

test('work with no file to show is handed in on its note alone', async () => {
  // The case the deliverable gate used to have no answer for: a phone call.
  // There is nothing to upload, and the only honest record of it is a sentence.
  const { task } = await create(
    '/tasks',
    {
      title: 'مكالمة مع العميل',
      department: 'marketing',
      subteam: 'creative',
      stage: 'pending',
      assigneeIds: [creative.user.id],
    },
    managerCookie
  );
  await request(`/tasks/${task.id}/assignment`, {
    method: 'POST',
    cookie: creativeCookie,
    body: { action: 'accept' },
  });

  const handedIn = await request(`/tasks/${task.id}/submit`, {
    method: 'POST',
    cookie: creativeCookie,
    body: { note: 'اتصلت بالعميل واتفقنا على ميعاد التسليم الأسبوع الجاي' },
  });
  assert.equal(handedIn.status, 200, JSON.stringify(handedIn.data));
  assert.equal(handedIn.data.task.stage, 'review');
  assert.match(handedIn.data.task.submissionNote, /اتفقنا على ميعاد/);

  // And it reaches the reviewer as an ordinary submission — nothing about the
  // rest of the lifecycle changes just because there was no file.
  const reviewed = await request(`/tasks/${task.id}/review`, {
    method: 'POST',
    cookie: managerCookie,
    body: { decision: 'approved', score: 85, note: 'تمام' },
  });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.data));
  assert.equal(reviewed.data.task.score, 85);
});
