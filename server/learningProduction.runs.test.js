/**
 * E-Learning Production — production runs against a real PostgreSQL.
 *
 * The acceptance scenarios, walked through the services exactly as the API
 * calls them:
 *
 *   1. an expert-led new program from research to a published release;
 *   2. an AI-assisted new program, human-reviewed, through the Docki and
 *      Think handoffs to its configured release gates;
 *   3. a revamp of the first program's release — change impact, two dry-run
 *      cycles, a new release — with the old release's history intact;
 *   4. the contributor/reviewer loop on a task: assignment alert, submission,
 *      changes requested, resubmission, approval bound to one submission.
 *
 * Plus what only a database can prove: tenant isolation, sensitive expert
 * records, reviewer separation, waivers and skips, notification recipients,
 * de-duplication and preferences, append-only history, and progress that
 * never calls a program complete because its lesson assets are.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { startTestDatabase } from './projects/testDatabase.js';

const documentDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'qodo-learning-runs-'));
process.env.DATA_DIR = documentDirectory;

const database = await startTestDatabase();
const SKIP = database.url ? false : database.reason;

const S = 'qodo_elearning_production';
const ORG_A = 'lp-runs-a';
const ORG_B = 'lp-runs-b';

const person = (id, name, role = 'member', organizationId = ORG_A) => ({
  id,
  name,
  role,
  organizationId,
  email: `${id}@test.local`,
  status: 'active',
  permissions: null,
  department: 'general',
  avatarColor: '#1D6FB8',
});

const users = {
  manager: person('r-mona', 'Mona Manager', 'manager'),
  courseManager: person('r-carl', 'Carl Course'),
  researcher: person('r-rana', 'Rana Research'),
  designer: person('r-ibrahim', 'Ibrahim ID'),
  coordinator: person('r-eman', 'Eman Experts'),
  consultant: person('r-tarek', 'Tarek Consultant'),
  sme: person('r-sami', 'Sami SME'),
  techPm: person('r-tim', 'Tim Tech PM'),
  ops: person('r-leila', 'Leila Ops'),
  marketing: person('r-mark', 'Mark Marketing'),
  uat: person('r-uma', 'Uma UAT'),
  qa: person('r-quinn', 'Quinn QA'),
  writer: person('r-wafa', 'Wafa Writer'),
  slides: person('r-ahmed', 'Ahmed Slides'),
  voice: person('r-omar', 'Omar Voice'),
  editor: person('r-hana', 'Hana Editor'),
  viewer: person('r-viv', 'Viv Viewer'),
  outsider: person('r-nour', 'Nour Outsider'),
  root: person('r-root', 'Root Admin', 'admin'),
  mallory: person('r-mallory', 'Mallory', 'admin', ORG_B),
};
const keyOf = Object.fromEntries(Object.entries(users).map(([key, user]) => [user.id, key]));

const TEAM = [
  { userId: users.courseManager.id, roles: ['COURSE_MANAGER'] },
  { userId: users.researcher.id, roles: ['RESEARCHER'] },
  { userId: users.designer.id, roles: ['INSTRUCTIONAL_DESIGNER'] },
  { userId: users.coordinator.id, roles: ['EXPERT_COORDINATOR'] },
  { userId: users.consultant.id, roles: ['TECHNICAL_CONSULTANT'] },
  { userId: users.sme.id, roles: ['SUBJECT_MATTER_EXPERT'] },
  { userId: users.techPm.id, roles: ['TECHNICAL_PM'] },
  { userId: users.ops.id, roles: ['LEARNING_OPERATIONS'] },
  { userId: users.marketing.id, roles: ['MARKETING'] },
  { userId: users.uat.id, roles: ['UAT_COORDINATOR'] },
  { userId: users.qa.id, roles: ['QUALITY_REVIEWER'] },
  { userId: users.writer.id, roles: ['SCRIPT_WRITER', 'OUTLINE_WRITER'] },
  { userId: users.slides.id, roles: ['PPT_DESIGNER'] },
  { userId: users.voice.id, roles: ['VOICE_OVER_ARTIST'] },
  { userId: users.editor.id, roles: ['VIDEO_EDITOR'] },
  { userId: users.viewer.id, roles: ['VIEWER'] },
];

let db;
let store;
let access;
let runs;
let tasks;
let issues;
let releases;
let impact;
let experts;
let work;
let templates;
let lessons;
let assets;
let comments;
let tools;

before(async () => {
  if (SKIP) return;
  process.env.DATABASE_URL = database.url;
  db = await import('./learningProduction/db.js');
  store = await import('./store.js');
  access = await import('./learningProduction/access.js');
  runs = await import('./learningProduction/services/runService.js');
  tasks = await import('./learningProduction/services/taskService.js');
  issues = await import('./learningProduction/services/issueService.js');
  releases = await import('./learningProduction/services/releaseService.js');
  impact = await import('./learningProduction/services/impactService.js');
  experts = await import('./learningProduction/services/expertService.js');
  work = await import('./learningProduction/services/workService.js');
  templates = await import('./learningProduction/services/templateService.js');
  lessons = await import('./learningProduction/services/lessonService.js');
  assets = await import('./learningProduction/services/assetService.js');
  comments = await import('./learningProduction/services/commentService.js');
  tools = await import('./learningProduction/services/reviewToolsService.js');

  await db.init();
  await db.query(`DROP SCHEMA IF EXISTS ${S} CASCADE`);
  await db.close();
  await db.init();
  for (const user of Object.values(users)) await store.create('users', user);
});

after(async () => {
  if (db) await db.close();
  const workspaceStore = store ? await store.getStore() : null;
  await workspaceStore?.pool?.end().catch(() => {});
  await database.stop?.();
  await fs.rm(documentDirectory, { recursive: true, force: true }).catch(() => {});
});

const actor = (key) => access.actorFor(users[key]);

async function refuses(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `expected ${code}, got ${error.code}: ${error.message}`);
    return true;
  });
}

const dayFromToday = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const pdf = (label) => Buffer.from(`%PDF-1.4\n% ${label}\n${'0'.repeat(64)}\n%%EOF\n`);
const wav = () => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(128)]);
const mp4 = () => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(128)]);

async function taskId(runId, key) {
  const row = await db.row(`SELECT id FROM ${S}.learning_task_instances WHERE run_id = $1 AND task_key = $2`, [runId, key]);
  assert.ok(row, `no task ${key}`);
  return row.id;
}

async function stageOf(runId, key) {
  const view = await runs.getRun(actor('manager'), runId);
  return view.stages.find((stage) => stage.key === key);
}

/** Do one task the way its people would: tick, attach, then complete or submit and have it approved. */
async function finishTask(id, { reviewer } = {}) {
  const detail = await tasks.getTask(actor('manager'), id);
  const task = detail.task;
  if (task.kind === 'AUTO' || ['DONE', 'APPROVED', 'WAIVED'].includes(task.status)) return detail;
  const maker = task.assigneeUserId ? keyOf[task.assigneeUserId] : 'manager';
  for (const item of detail.checklist) {
    if (item.status === 'PENDING') await tasks.updateChecklistItem(actor(maker), item.id, { status: 'DONE' });
  }
  if (task.requiresEvidence && detail.evaluation.evidenceCount === 0) {
    await tasks.addEvidence(actor(maker), id, { url: `https://docs.example.com/${task.key}` });
  }
  if (!task.requiresApproval) return tasks.completeTask(actor(maker), id, {});
  await tasks.submitTask(actor(maker), id, {});
  const decider = reviewer ?? (task.reviewerUserId ? keyOf[task.reviewerUserId] : maker === 'manager' ? 'courseManager' : 'manager');
  return tasks.approveTask(actor(decider), id, {});
}

/** Finish every gating task of a stage, in order. Returns the stage afterwards. */
async function finishStage(runId, key, { except = [] } = {}) {
  const stage = await stageOf(runId, key);
  assert.notEqual(stage.status, 'BLOCKED', `${key} is blocked by ${JSON.stringify(stage.blockers)}`);
  for (const entry of stage.tasks) {
    if (entry.kind === 'AUTO' || entry.classification === 'OPTIONAL' || except.includes(entry.key)) continue;
    await finishTask(entry.id);
  }
  return stageOf(runId, key);
}

/** One lesson's assets, each made, reviewed and approved by the right people. */
async function produceLesson(lessonId, { ai = false } = {}) {
  const detail = await lessons.getLesson(actor('manager'), lessonId);
  const id = Object.fromEntries(detail.assets.map((entry) => [entry.assetType, entry.id]));
  const provenance = ai ? { aiAssisted: true, aiTool: 'GPT' } : {};
  const assign = (type, assignee, reviewer) =>
    id[type] && assets.assign(actor('manager'), id[type], { assigneeUserId: users[assignee].id, reviewerUserId: users[reviewer].id });

  if (id.OUTLINE) {
    await assign('OUTLINE', 'writer', 'sme');
    await assets.saveDraft(actor('writer'), id.OUTLINE, { content: { sections: { learningObjectives: 'Measure MTBF' } }, revision: 0 });
    await assets.submit(actor('writer'), id.OUTLINE, provenance);
    await assets.approve(actor('sme'), id.OUTLINE, {});
  }
  if (id.PPT) {
    await assign('PPT', 'slides', 'qa');
    await assets.uploadVersion(actor('slides'), id.PPT, { bytes: pdf('deck'), fileName: 'deck.pdf', ...provenance });
    await assets.submit(actor('slides'), id.PPT, {});
    await assets.approve(actor('qa'), id.PPT, {});
  }
  if (id.SCRIPT) {
    await assign('SCRIPT', 'writer', 'sme');
    await assets.saveDraft(actor('writer'), id.SCRIPT, { content: { blocks: [{ id: 'b1', title: 'Slide 1', narration: 'Welcome.' }] }, revision: 0 });
    await assets.submit(actor('writer'), id.SCRIPT, provenance);
    await assets.approve(actor('sme'), id.SCRIPT, {});
  }
  if (id.VOICE_OVER) {
    await assign('VOICE_OVER', 'voice', 'qa');
    await assets.uploadVersion(actor('voice'), id.VOICE_OVER, { bytes: wav(), fileName: 'vo.wav', ...provenance });
    await assets.submit(actor('voice'), id.VOICE_OVER, {});
    await assets.approve(actor('qa'), id.VOICE_OVER, {});
  }
  if (id.VIDEO) {
    await assign('VIDEO', 'editor', 'qa');
    const uploaded = await assets.uploadVersion(actor('editor'), id.VIDEO, { bytes: mp4(), fileName: 'final.mp4', ...provenance });
    await assets.submit(actor('editor'), id.VIDEO, {});
    const checklist = await tools.versionChecklist(actor('qa'), uploaded.currentVersion.id);
    for (const item of checklist.items) await tools.updateChecklistItem(actor('qa'), item.id, { status: 'PASSED' });
    await assets.approve(actor('qa'), id.VIDEO, {});
  }
  return id;
}

async function outboxFor(recipientKey, where = '') {
  return db.rows(
    `SELECT recipient_user_id, actor_user_id, event_type, message_key, link, dedupe_key, entity_type, entity_id,
            delivered_at, suppressed_reason
       FROM ${S}.learning_notification_outbox WHERE recipient_user_id = $1 ${where} ORDER BY id`,
    [users[recipientKey].id]
  );
}

describe('E-Learning Production — runs', { skip: SKIP }, () => {
  let expertRun;
  let expertCourse;
  let lessonA;
  let lessonB;
  let firstRelease;

  /* ── scenario 1: expert-led new program ────────────────────────── */

  test('the creation preview shows the scenario\'s stages and tasks without writing anything', async () => {
    const preview = await templates.previewTemplate(actor('manager'), { scenario: 'EXPERT_NEW' });
    assert.equal(preview.summary.stages[0].key, 'RESEARCH');
    assert.ok(preview.summary.counts.required > 20);
    assert.ok(preview.summary.roles.includes('EXPERT_COORDINATOR'));
    const count = await db.row(`SELECT count(*)::int AS n FROM ${S}.learning_production_runs`);
    assert.equal(count.n, 0);
  });

  test('a manager starts an expert-led program: stages, tasks and default assignments in one transaction', async () => {
    await refuses(runs.createRun(actor('researcher'), { scenario: 'EXPERT_NEW', course: { name: 'Nope' } }), 'FORBIDDEN');
    const created = await runs.createRun(actor('manager'), {
      scenario: 'EXPERT_NEW',
      course: { name: 'Reliability Engineering', code: 'REL' },
      startDate: dayFromToday(0),
      targetDate: dayFromToday(120),
      team: TEAM,
    });
    expertRun = created.run.id;
    expertCourse = created.course.id;

    assert.equal(created.run.scenario, 'EXPERT_NEW');
    assert.equal(created.template.versionNumber, 1);
    assert.equal(created.stages[0].key, 'RESEARCH');
    assert.equal(created.stages[0].status, 'READY');
    assert.equal(created.stages.find((stage) => stage.key === 'CURRICULUM_DRAFT').status, 'BLOCKED');
    assert.equal(created.stages.find((stage) => stage.key === 'EXPERT_ACQUISITION').status, 'BLOCKED');
    assert.equal(created.progress.workflow.done, 0);
    assert.equal(created.progress.content.total, 0, 'no lessons are forced before the curriculum');

    const research = created.stages[0].tasks;
    assert.ok(research.every((entry) => entry.assigneeUserId === users.researcher.id), 'the only researcher gets the research');
    const apply = created.stages[1].tasks.find((entry) => entry.key === 'draft.apply');
    assert.equal(apply.reviewerUserId, users.designer.id, 'the ID reviews the applied changes');
    assert.equal(apply.display, 'BLOCKED');
    assert.ok(apply.blockers.some((blocker) => blocker.type === 'STAGE' && blocker.key === 'RESEARCH'), 'the plan says why');

    const alerts = await outboxFor('researcher');
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].message_key, 'tasksAssigned');
    assert.equal(alerts[0].link, '/learning-production/my-work');
    assert.ok(alerts[0].delivered_at, 'delivered after the commit');
    assert.equal((await outboxFor('manager')).length, 0, 'nobody is told about their own action');

    const history = await db.rows(`SELECT event_type FROM ${S}.learning_activity_log WHERE run_id = $1`, [expertRun]);
    assert.ok(history.some((entry) => entry.event_type === 'RUN_CREATED'));
  });

  test('research runs first; finishing it hands the draft and expert sourcing over in parallel', async () => {
    const assigned = await work.myWork(actor('researcher'));
    assert.ok(assigned.sections.now.some((item) => item.key === 'research.define' && item.display === 'READY'));
    assert.ok(assigned.sections.blocked.some((item) => item.key === 'draft.structure'), 'blocked work is listed with its reason');
    const blockedDraft = assigned.sections.blocked.find((item) => item.key === 'draft.structure');
    assert.ok(blockedDraft.blockers.length > 0);
    assert.match(blockedDraft.link, new RegExp(`/courses/${expertCourse}/plan\\?task=`));

    await refuses(tasks.startTask(actor('researcher'), await taskId(expertRun, 'draft.structure')), 'TASK_BLOCKED');
    const research = await finishStage(expertRun, 'RESEARCH');
    assert.equal(research.status, 'DONE');
    assert.equal((await stageOf(expertRun, 'CURRICULUM_DRAFT')).status, 'READY');
    assert.equal((await stageOf(expertRun, 'EXPERT_ACQUISITION')).status, 'READY', 'expert sourcing overlaps the draft');
    const completed = await db.row(`SELECT count(*)::int AS n FROM ${S}.learning_activity_log WHERE run_id = $1 AND event_type = 'STAGE_COMPLETED'`, [expertRun]);
    assert.equal(completed.n, 1);
    const handoff = await outboxFor('coordinator', `AND message_key = 'taskUnblocked'`);
    assert.ok(handoff.length > 0, 'the coordinator hears the sourcing is ready to start');
  });

  test('the contributor/reviewer loop: a decision binds to one submission, and history is never rewritten', async () => {
    await finishTask(await taskId(expertRun, 'draft.structure'));
    await finishTask(await taskId(expertRun, 'draft.fill'));
    await finishTask(await taskId(expertRun, 'draft.fonts'));
    await finishTask(await taskId(expertRun, 'draft.id_review'));

    const apply = await taskId(expertRun, 'draft.apply');
    let detail = await tasks.getTask(actor('researcher'), apply);
    for (const item of detail.checklist) await tasks.updateChecklistItem(actor('researcher'), item.id, { status: 'DONE' });
    await refuses(tasks.submitTask(actor('researcher'), apply, {}), 'EVIDENCE_REQUIRED');
    await tasks.addEvidence(actor('researcher'), apply, { url: 'https://docs.example.com/draft-v1' });
    await refuses(tasks.completeTask(actor('researcher'), apply, {}), 'APPROVAL_REQUIRED');
    detail = await tasks.submitTask(actor('researcher'), apply, { notes: 'Applied the ID comments' });
    assert.equal(detail.task.status, 'SUBMITTED');

    const toReviewer = await outboxFor('designer', `AND message_key = 'taskSubmitted'`);
    assert.equal(toReviewer.length, 1);
    assert.equal(toReviewer[0].link, `/learning-production/courses/${expertCourse}/plan?task=${apply}`);
    const queue = await work.reviews(actor('designer'));
    assert.ok(queue.groups.curriculum.some((item) => item.id === apply), 'a curriculum approval is grouped as one');

    await refuses(tasks.approveTask(actor('researcher'), apply, {}), 'FORBIDDEN');
    await refuses(tasks.requestTaskChanges(actor('designer'), apply, {}), 'FEEDBACK_REQUIRED');
    await tasks.requestTaskChanges(actor('designer'), apply, { notes: 'Objectives need action verbs' });
    await refuses(tasks.submitTask(actor('researcher'), apply, {}), 'NEW_EVIDENCE_REQUIRED');
    await tasks.addEvidence(actor('researcher'), apply, { url: 'https://docs.example.com/draft-v2' });
    await tasks.submitTask(actor('researcher'), apply, {});
    const resubmitted = await work.reviews(actor('designer'));
    assert.ok(resubmitted.groups.curriculum.find((item) => item.id === apply).isResubmission);
    detail = await tasks.approveTask(actor('designer'), apply, { notes: 'Good' });
    assert.equal(detail.task.status, 'APPROVED');

    const [second, first] = detail.submissions;
    assert.equal(first.decision, 'CHANGES_REQUESTED');
    assert.equal(first.evidenceIds.length, 1);
    assert.equal(second.decision, 'APPROVED');
    assert.equal(second.evidenceIds.length, 2, 'the approval covers exactly the evidence submitted with it');

    await refuses(tasks.addEvidence(actor('researcher'), apply, { url: 'https://docs.example.com/late' }), 'INVALID_TRANSITION');
    await assert.rejects(
      db.query(`UPDATE ${S}.learning_task_submissions SET decision = 'PENDING', reviewed_at = NULL WHERE id = $1`, [second.id]),
      /final once made/
    );
    await assert.rejects(db.query(`DELETE FROM ${S}.learning_task_evidence WHERE task_id = $1`, [apply]), /withdrawn, never deleted/);
    assert.equal((await stageOf(expertRun, 'CURRICULUM_DRAFT')).status, 'DONE');

    await refuses(tasks.reopenTask(actor('researcher'), apply, { reason: 'x' }), 'FORBIDDEN');
    detail = await tasks.reopenTask(actor('manager'), apply, { reason: 'Consultant asked for one more module' });
    assert.equal(detail.task.status, 'IN_PROGRESS');
    assert.equal(detail.submissions.find((entry) => entry.id === second.id).decision, 'APPROVED', 'the old approval stays with its submission');
    assert.equal((await stageOf(expertRun, 'CURRICULUM_DRAFT')).status, 'IN_PROGRESS', 'a reopened task reopens its stage');
    const reopened = await db.row(`SELECT count(*)::int AS n FROM ${S}.learning_activity_log WHERE run_id = $1 AND event_type = 'STAGE_REOPENED'`, [expertRun]);
    assert.equal(reopened.n, 1);
    await tasks.addEvidence(actor('researcher'), apply, { url: 'https://docs.example.com/draft-v3' });
    await tasks.submitTask(actor('researcher'), apply, {});
    await tasks.approveTask(actor('designer'), apply, {});
    assert.equal((await stageOf(expertRun, 'CURRICULUM_DRAFT')).status, 'DONE');

    const trail = await db.rows(`SELECT event_type FROM ${S}.learning_activity_log WHERE task_id = $1 ORDER BY id`, [apply]);
    const events = trail.map((entry) => entry.event_type);
    for (const event of ['TASK_SUBMITTED', 'TASK_CHANGES_REQUESTED', 'TASK_RESUBMITTED', 'TASK_APPROVED', 'TASK_REOPENED']) {
      assert.ok(events.includes(event), `${event} is in the task history`);
    }
    await assert.rejects(db.query(`DELETE FROM ${S}.learning_activity_log WHERE task_id = $1`, [apply]), /append-only/);
  });

  test('candidate records and contract evidence are for the coordinator and the production manager only', async () => {
    await experts.createCandidate(actor('coordinator'), expertRun, { fullName: 'Dr. Hala Nasser', email: 'hala@example.com', source: 'LINKEDIN', yearsExperience: 12 });
    const list = await experts.listCandidates(actor('coordinator'), expertRun);
    assert.equal(list.candidates.length, 1);
    await experts.updateCandidate(actor('coordinator'), list.candidates[0].id, { status: 'TECHNICAL_DISCUSSION', assessment: { technical: 5, english: 4 } });
    await experts.addCandidateFile(actor('coordinator'), list.candidates[0].id, { bytes: pdf('cv'), fileName: 'hala-cv.pdf', kind: 'CV' });
    assert.equal((await experts.listCandidates(actor('manager'), expertRun)).candidates[0].files.length, 1);

    for (const key of ['courseManager', 'designer', 'sme', 'viewer']) await refuses(experts.listCandidates(actor(key), expertRun), 'NOT_FOUND');
    await refuses(experts.listCandidates(actor('mallory'), expertRun), 'NOT_FOUND');

    await finishStage(expertRun, 'EXPERT_ACQUISITION', { except: ['experts.contract'] });
    const contract = await taskId(expertRun, 'experts.contract');
    const detail = await tasks.getTask(actor('coordinator'), contract);
    for (const item of detail.checklist.filter((line) => line.required)) await tasks.updateChecklistItem(actor('coordinator'), item.id, { status: 'DONE' });
    await tasks.addEvidence(actor('coordinator'), contract, { bytes: pdf('sow'), fileName: 'signed-sow.pdf', note: 'Signed by both parties' });
    const withEvidence = await tasks.getTask(actor('coordinator'), contract);
    const evidenceId = withEvidence.evidence[0].id;
    assert.equal(withEvidence.evidence[0].fileName, 'signed-sow.pdf');

    const asCourseManager = await tasks.getTask(actor('courseManager'), contract);
    assert.equal(asCourseManager.evidence[0].redacted, true);
    assert.equal(asCourseManager.evidence[0].fileName, null);
    await refuses(tasks.evidenceFile(actor('courseManager'), evidenceId), 'NOT_FOUND');
    assert.ok((await tasks.evidenceFile(actor('manager'), evidenceId)).bytes.length > 0);

    const history = await db.rows(`SELECT metadata_json FROM ${S}.learning_activity_log WHERE run_id = $1 AND event_type LIKE 'CANDIDATE%'`, [expertRun]);
    assert.ok(history.every((entry) => !JSON.stringify(entry.metadata_json).includes('Hala')), 'history never names a candidate');

    await tasks.completeTask(actor('coordinator'), contract, {});
    assert.equal((await stageOf(expertRun, 'EXPERT_ACQUISITION')).status, 'DONE', 'optional performance tracking does not hold the stage');
  });

  test('final curriculum and instructional design close on their approvals', async () => {
    assert.equal((await finishStage(expertRun, 'FINAL_CURRICULUM')).status, 'DONE');
    assert.equal((await finishStage(expertRun, 'INSTRUCTIONAL_DESIGN')).status, 'DONE');
  });

  test('media production is the lesson pipeline; approved assets alone do not complete the program', async () => {
    const created = await lessons.createLessons(actor('manager'), expertCourse, {
      items: [
        { name: 'MTBF basics', moduleName: 'Reliability' },
        { name: 'Weibull analysis', moduleName: 'Reliability' },
      ],
    });
    [lessonA, lessonB] = created.lessons.map((lesson) => lesson.id);
    const matrix = await lessons.productionMatrix(actor('manager'), expertCourse);
    assert.equal(Object.keys(matrix.lessons[0].assets).length, 5);
    assert.deepEqual(matrix.assetTypes, ['OUTLINE', 'PPT', 'SCRIPT', 'VOICE_OVER', 'VIDEO']);

    await produceLesson(lessonA);
    let media = await stageOf(expertRun, 'MEDIA_PRODUCTION');
    assert.equal(media.status, 'IN_PROGRESS');
    assert.deepEqual([media.tasks[0].gate.done, media.tasks[0].gate.total], [5, 10]);

    await produceLesson(lessonB);
    media = await stageOf(expertRun, 'MEDIA_PRODUCTION');
    assert.equal(media.status, 'DONE');

    const view = await runs.getRun(actor('manager'), expertRun);
    assert.equal(view.progress.content.percent, 100);
    assert.ok(view.progress.workflow.percent < 100, 'deployment, dry run and UAT are still open');
    assert.equal(view.progress.readiness.readyForSignoff, false);
    assert.equal(view.currentStage, 'PLATFORM_DEPLOYMENT');
    await refuses(releases.prepareRelease(actor('manager'), expertRun, {}), 'RELEASE_NOT_READY');
  });

  test('deployment is verified by hand with evidence; the dry run logs issues that gate the next stage', async () => {
    assert.equal((await finishStage(expertRun, 'PLATFORM_DEPLOYMENT')).status, 'DONE');

    const content = await taskId(expertRun, 'dry.content');
    await finishTask(await taskId(expertRun, 'dry.freeze'));
    await finishTask(await taskId(expertRun, 'dry.landing'));
    const detail = await tasks.getTask(actor('manager'), content);
    const videos = detail.checklist.find((item) => item.key === 'r18');
    await tasks.updateChecklistItem(actor('manager'), videos.id, {
      status: 'ISSUE',
      comment: 'Lesson 2 video plays without sound',
      issue: { title: 'Weibull video has no audio', severity: 'HIGH', area: 'MEDIA', ownerUserId: users.ops.id },
    });
    for (const item of detail.checklist) if (item.id !== videos.id) await tasks.updateChecklistItem(actor('manager'), item.id, { status: 'DONE' });
    await tasks.completeTask(actor('manager'), content, {});
    await finishTask(await taskId(expertRun, 'dry.report'));
    assert.equal((await stageOf(expertRun, 'DRY_RUN_1')).status, 'DONE');

    const logged = await issues.listIssues(actor('manager'), expertRun);
    assert.equal(logged.issues.length, 1);
    const issue = logged.issues[0];
    assert.equal(issue.checklistItemId, videos.id);
    assert.equal((await outboxFor('ops', `AND message_key = 'issueAssigned'`)).length, 1);
    assert.equal((await outboxFor('courseManager', `AND message_key = 'issueReported'`)).length, 1, 'a high issue reaches the managers');

    await finishTask(await taskId(expertRun, 'fix.triage'));
    let fixes = await stageOf(expertRun, 'DRY_RUN_FIXES');
    assert.equal(fixes.status, 'IN_PROGRESS', 'the issue is still open');
    const opsWork = await work.myWork(actor('ops'));
    assert.ok(opsWork.sections.now.some((item) => item.kind === 'ISSUE' && item.id === issue.id && item.action === 'FIX'));

    await refuses(issues.transitionIssue(actor('ops'), issue.id, 'fix', {}), 'VALIDATION_FAILED');
    await issues.transitionIssue(actor('ops'), issue.id, 'fix', { note: 'Re-exported with audio' });
    await refuses(issues.transitionIssue(actor('ops'), issue.id, 'verify', {}), 'FORBIDDEN');
    const reporterQueue = await work.reviews(actor('manager'));
    assert.ok(reporterQueue.groups.signoff.some((item) => item.kind === 'ISSUE' && item.id === issue.id));
    await issues.transitionIssue(actor('manager'), issue.id, 'verify', { note: 'Plays with sound' });
    fixes = await stageOf(expertRun, 'DRY_RUN_FIXES');
    assert.equal(fixes.status, 'DONE');
    assert.equal((await finishStage(expertRun, 'REDEPLOYMENT')).status, 'DONE');
  });

  test('UAT: an open high issue blocks release readiness until it is fixed and verified; sign-off is approved by another person', async () => {
    await finishTask(await taskId(expertRun, 'uat.testers'));
    await finishTask(await taskId(expertRun, 'uat.scenarios'));
    const execute = await taskId(expertRun, 'uat.execute');
    const detail = await tasks.getTask(actor('uat'), execute);
    const compatibility = detail.checklist.find((item) => item.key === 'r23');
    assert.equal(compatibility.group.en, 'Compatibility');
    await tasks.updateChecklistItem(actor('uat'), compatibility.id, {
      status: 'ISSUE',
      issue: { title: 'Quiz breaks on Safari mobile', severity: 'CRITICAL', area: 'PLATFORM', ownerUserId: users.ops.id },
    });
    const captions = detail.checklist.find((item) => item.key === 'r29');
    await refuses(tasks.updateChecklistItem(actor('uat'), captions.id, { status: 'NOT_APPLICABLE' }), 'REASON_REQUIRED');
    await tasks.updateChecklistItem(actor('uat'), captions.id, { status: 'NOT_APPLICABLE', comment: 'No captions in this program' });
    for (const item of detail.checklist) if (![compatibility.id, captions.id].includes(item.id)) await tasks.updateChecklistItem(actor('uat'), item.id, { status: 'DONE' });
    await tasks.completeTask(actor('uat'), execute, {});

    let view = await runs.getRun(actor('manager'), expertRun);
    assert.equal(view.progress.readiness.checks.find((check) => check.id === 'NO_BLOCKING_ISSUES').ok, false);
    const uat = view.stages.find((stage) => stage.key === 'UAT');
    assert.equal(uat.issues.blocking, 1);
    assert.equal(uat.tasks.find((entry) => entry.key === 'uat.signoff').display, 'BLOCKED');

    const critical = (await issues.listIssues(actor('manager'), expertRun, { status: 'OPEN' })).issues[0];
    await issues.transitionIssue(actor('ops'), critical.id, 'start', {});
    await issues.transitionIssue(actor('ops'), critical.id, 'fix', { note: 'Patched the quiz widget' });
    await issues.transitionIssue(actor('uat'), critical.id, 'verify', {});

    const signoff = await taskId(expertRun, 'uat.signoff');
    const signoffDetail = await tasks.getTask(actor('uat'), signoff);
    for (const item of signoffDetail.checklist) await tasks.updateChecklistItem(actor('uat'), item.id, { status: 'DONE' });
    await tasks.addEvidence(actor('uat'), signoff, { note: '14 scenarios, 2 issues, both verified' });
    await tasks.submitTask(actor('uat'), signoff, {});
    const signoffQueue = await work.reviews(actor('manager'));
    assert.ok(signoffQueue.groups.signoff.some((item) => item.id === signoff), 'UAT sign-off is its own review group');
    await tasks.approveTask(actor('manager'), signoff, {});
    view = await runs.getRun(actor('manager'), expertRun);
    assert.equal(view.stages.find((stage) => stage.key === 'UAT').status, 'DONE');
    assert.equal(view.progress.readiness.readyForSignoff, true);
    assert.equal(view.progress.readiness.readyToPublish, false, 'nothing is published without an explicit sign-off');
  });

  test('a release is prepared, signed off by someone else, and published with deployment evidence', async () => {
    const prepared = await releases.prepareRelease(actor('manager'), expertRun, { notes: 'First cohort' });
    firstRelease = prepared.release.id;
    assert.equal(prepared.release.versionLabel, 'r1.0.0');
    assert.equal(prepared.release.summary.approvedAssets, 10);
    assert.equal(prepared.release.snapshot.lessons.length, 2);
    assert.ok(prepared.release.snapshot.deliverables.some((entry) => entry.taskKey === 'final.document'));
    await refuses(releases.prepareRelease(actor('manager'), expertRun, {}), 'RELEASE_IN_PROGRESS');

    await refuses(releases.publishRelease(actor('manager'), firstRelease, { platformUrl: 'https://lms.example.com/rel' }), 'SIGNOFF_REQUIRED');
    await refuses(releases.signoffRelease(actor('manager'), firstRelease, {}), 'OWN_WORK');
    await refuses(releases.signoffRelease(actor('researcher'), firstRelease, {}), 'FORBIDDEN');
    await releases.signoffRelease(actor('courseManager'), firstRelease, { notes: 'Checked' });
    await refuses(releases.publishRelease(actor('manager'), firstRelease, { platformUrl: 'http://insecure.example.com' }), 'VALIDATION_FAILED');
    const published = await releases.publishRelease(actor('manager'), firstRelease, {
      platformUrl: 'https://lms.example.com/programs/rel-r1',
      deploymentNotes: 'Cloned to the learner release; no learners inside the dry-run copy.',
    });
    assert.equal(published.release.status, 'PUBLISHED');

    const view = await runs.getRun(actor('manager'), expertRun);
    assert.equal(view.run.status, 'RELEASED');
    assert.equal(view.stages.find((stage) => stage.key === 'RELEASE').status, 'DONE');
    assert.equal(view.progress.workflow.percent, 100);
    assert.equal(view.progress.published.versionLabel, 'r1.0.0');
    assert.equal(view.course.currentReleaseId, firstRelease);
    await refuses(tasks.startTask(actor('manager'), await taskId(expertRun, 'experts.performance')), 'RUN_CLOSED');
    await assert.rejects(db.query(`UPDATE ${S}.learning_releases SET snapshot_json = '{}'::jsonb WHERE id = $1`, [firstRelease]), /fixed once prepared/);
  });

  /* ── skips, waivers and authority ──────────────────────────────── */

  test('expert acquisition is skipped only with a reason when an expert is already contracted', async () => {
    await refuses(
      runs.createRun(actor('manager'), { scenario: 'EXPERT_NEW', course: { name: 'Pumps' }, expertContracted: { userId: users.sme.id } }),
      'REASON_REQUIRED'
    );
    const created = await runs.createRun(actor('manager'), {
      scenario: 'EXPERT_NEW',
      course: { name: 'Pumps and Seals' },
      team: TEAM,
      expertContracted: { userId: users.sme.id, reason: 'Dr. Sami is on the 2026 framework contract' },
    });
    const experts = created.stages.find((stage) => stage.key === 'EXPERT_ACQUISITION');
    assert.equal(experts.status, 'SKIPPED');
    assert.equal(experts.skipReason, 'Dr. Sami is on the 2026 framework contract');
    assert.ok(created.stages.find((stage) => stage.key === 'FINAL_CURRICULUM').after.includes('EXPERT_ACQUISITION'));

    const research = created.stages.find((stage) => stage.key === 'RESEARCH');
    await refuses(runs.skipStage(actor('researcher'), research.id, { reason: 'no' }), 'FORBIDDEN');
    await refuses(runs.skipStage(actor('manager'), research.id, { reason: 'We know the market' }), 'STAGE_NOT_SKIPPABLE');
    const skipped = await runs.skipStage(actor('root'), research.id, { reason: 'Research reused from the 2025 program' });
    assert.equal(skipped.stages.find((stage) => stage.key === 'RESEARCH').status, 'SKIPPED');
    assert.equal(skipped.stages.find((stage) => stage.key === 'CURRICULUM_DRAFT').status, 'READY');
    const restored = await runs.unskipStage(actor('manager'), research.id);
    assert.equal(restored.stages.find((stage) => stage.key === 'RESEARCH').status, 'READY');

    const define = restored.stages[0].tasks.find((entry) => entry.key === 'research.define');
    await refuses(tasks.waiveTask(actor('manager'), define.id, { reason: 'Not needed' }), 'REQUIRED_TASK');
    await refuses(tasks.waiveTask(actor('root'), define.id, {}), 'REASON_REQUIRED');
    const waived = await tasks.waiveTask(actor('root'), define.id, { reason: 'Program definition fixed by the client brief' });
    assert.equal(waived.task.status, 'WAIVED');
    const entry = await db.row(`SELECT metadata_json FROM ${S}.learning_activity_log WHERE task_id = $1 AND event_type = 'TASK_WAIVED'`, [define.id]);
    assert.equal(entry.metadata_json.adminOverride, true);
  });

  test('another organization cannot reach any of it, by any id', async () => {
    const view = await runs.getRun(actor('manager'), expertRun);
    const someTask = view.stages[0].tasks[0].id;
    await refuses(runs.getRun(actor('mallory'), expertRun), 'NOT_FOUND');
    await refuses(tasks.getTask(actor('mallory'), someTask), 'NOT_FOUND');
    await refuses(tasks.approveTask(actor('mallory'), someTask, {}), 'NOT_FOUND');
    await refuses(issues.listIssues(actor('mallory'), expertRun), 'NOT_FOUND');
    await refuses(releases.getRelease(actor('mallory'), firstRelease), 'NOT_FOUND');
    await refuses(runs.createRun(actor('mallory'), { scenario: 'REVAMP', courseId: expertCourse, sourceReleaseId: firstRelease }), 'NOT_FOUND');
    await refuses(runs.getRun(actor('outsider'), expertRun), 'NOT_FOUND');
    const portfolio = await work.portfolio(actor('mallory'));
    assert.equal(portfolio.runs.length, 0);
  });

  /* ── scenario 2: AI-assisted new program ───────────────────────── */

  test('an AI-assisted program: human-reviewed outlines, manual Docki and Think handoffs, the proposed release gates', async () => {
    const created = await runs.createRun(actor('manager'), { scenario: 'AI_NEW', course: { name: 'Lean Basics (AI)' }, team: TEAM });
    const runId = created.run.id;
    const courseId = created.course.id;
    assert.equal(created.stages.find((stage) => stage.key === 'PLATFORM_DEPLOYMENT').origin, 'PROPOSED');

    await finishStage(runId, 'AI_INPUT');
    const { lessons: [lesson] } = await lessons.createLessons(actor('manager'), courseId, { items: [{ name: 'What is waste?' }] });
    await finishTask(await taskId(runId, 'ai.outlines.generate'));

    const detail = await lessons.getLesson(actor('manager'), lesson.id);
    const outline = detail.assets.find((entry) => entry.assetType === 'OUTLINE').id;
    await assets.assign(actor('manager'), outline, { assigneeUserId: users.manager.id, reviewerUserId: users.sme.id });
    await assets.saveDraft(actor('manager'), outline, { content: { sections: { learningObjectives: 'Name the 8 wastes' } }, revision: 0 });
    const submitted = await assets.submit(actor('manager'), outline, { aiAssisted: true, aiTool: 'GPT' });
    assert.equal(submitted.currentVersion.aiAssisted, true);
    assert.equal(submitted.currentVersion.aiTool, 'GPT');
    await refuses(assets.approve(actor('manager'), outline, {}), 'OWN_WORK');
    assert.equal((await stageOf(runId, 'AI_OUTLINES')).status, 'DONE', 'every outline was sent for review');
    assert.equal((await stageOf(runId, 'AI_OUTLINE_REVIEW')).status, 'IN_PROGRESS');
    await assets.approve(actor('sme'), outline, {});
    await finishTask(await taskId(runId, 'ai.outlines.accuracy'));
    assert.equal((await stageOf(runId, 'AI_OUTLINE_REVIEW')).status, 'DONE');

    const expertFeedback = await taskId(runId, 'final.expert_feedback');
    await refuses(tasks.waiveTask(actor('manager'), expertFeedback, {}), 'REASON_REQUIRED');
    await tasks.waiveTask(actor('manager'), expertFeedback, { reason: 'No external expert on the AI track' });
    await tasks.waiveTask(actor('manager'), await taskId(runId, 'final.presentations'), { reason: 'Slides come from Docki' });
    assert.equal((await finishStage(runId, 'FINAL_CURRICULUM')).status, 'DONE');

    await finishTask(await taskId(runId, 'ai.scripts.generate'));
    const script = detail.assets.find((entry) => entry.assetType === 'SCRIPT').id;
    await assets.assign(actor('manager'), script, { assigneeUserId: users.writer.id, reviewerUserId: users.sme.id });
    await assets.saveDraft(actor('writer'), script, { content: { blocks: [{ id: 'b1', title: 'Muda', narration: 'Waste is anything the customer does not pay for.' }] }, revision: 0 });
    await assets.submit(actor('writer'), script, { aiAssisted: true, aiTool: 'GPT' });
    await assets.approve(actor('sme'), script, {});
    assert.equal((await stageOf(runId, 'AI_SCRIPTS')).status, 'DONE');
    await tasks.waiveTask(actor('manager'), await taskId(runId, 'ai.scripts.expert_review'), { reason: 'Scripts approved by the SME already' });
    assert.equal((await stageOf(runId, 'AI_SCRIPT_REVIEW')).status, 'DONE');

    const docki = await taskId(runId, 'ai.slides.handoff');
    const handoff = await tasks.getTask(actor('slides'), docki);
    assert.equal(handoff.task.externalTool, 'Docki');
    for (const item of handoff.checklist) await tasks.updateChecklistItem(actor('slides'), item.id, { status: 'DONE' });
    await refuses(tasks.completeTask(actor('slides'), docki, {}), 'EVIDENCE_REQUIRED');
    await tasks.addEvidence(actor('slides'), docki, { url: 'https://docki.example.com/jobs/881' });
    await tasks.completeTask(actor('slides'), docki, {});

    const ppt = detail.assets.find((entry) => entry.assetType === 'PPT').id;
    await assets.assign(actor('manager'), ppt, { assigneeUserId: users.slides.id, reviewerUserId: users.qa.id });
    await assets.uploadVersion(actor('slides'), ppt, { bytes: pdf('docki'), fileName: 'docki.pdf', aiAssisted: true, aiTool: 'Docki' });
    await assets.submit(actor('slides'), ppt, {});
    await assets.approve(actor('qa'), ppt, {});
    assert.equal((await stageOf(runId, 'AI_SLIDES')).status, 'DONE');

    await finishTask(await taskId(runId, 'ai.vo.generate'));
    const vo = detail.assets.find((entry) => entry.assetType === 'VOICE_OVER').id;
    await assets.assign(actor('manager'), vo, { assigneeUserId: users.voice.id, reviewerUserId: users.qa.id });
    await assets.uploadVersion(actor('voice'), vo, { bytes: wav(), fileName: 'vo.wav', aiAssisted: true, aiTool: 'TTS' });
    await assets.submit(actor('voice'), vo, {});
    await assets.approve(actor('qa'), vo, {});
    await finishTask(await taskId(runId, 'ai.video.handoff'));
    const video = detail.assets.find((entry) => entry.assetType === 'VIDEO').id;
    await assets.assign(actor('manager'), video, { assigneeUserId: users.editor.id, reviewerUserId: users.qa.id });
    await assets.uploadVersion(actor('editor'), video, { bytes: mp4(), fileName: 'think-v1.mp4', aiAssisted: true, aiTool: 'Think' });
    await assets.submit(actor('editor'), video, {});
    assert.equal((await stageOf(runId, 'AI_VOICE_VIDEO')).status, 'DONE');
    assert.equal((await stageOf(runId, 'AI_VIDEO_REVIEW')).status, 'IN_PROGRESS', 'nobody has reviewed the video yet');

    const note = await comments.createComment(actor('qa'), video, { body: 'Title overlaps the logo at 00:12' });
    await assets.requestChanges(actor('qa'), video, { summary: 'One overlap to fix' });
    assert.equal((await stageOf(runId, 'AI_VIDEO_REVIEW')).status, 'DONE', 'every video reviewed, comments recorded');
    assert.equal((await stageOf(runId, 'AI_COMMENTS_FIX')).status, 'IN_PROGRESS');
    const second = await assets.uploadVersion(actor('editor'), video, { bytes: mp4(), fileName: 'think-v2.mp4', aiAssisted: true, aiTool: 'Think' });
    await comments.resolveComment(actor('editor'), note.comment.id);
    await assets.submit(actor('editor'), video, {});
    // Stage 10 ("implement all comments") is done once every comment is resolved and
    // the fix is resubmitted; stage 11 ("check all comments") is the verification.
    assert.equal((await stageOf(runId, 'AI_COMMENTS_FIX')).status, 'DONE');
    assert.equal((await stageOf(runId, 'AI_COMMENTS_VERIFY')).status, 'IN_PROGRESS', 'resubmitted, not yet checked');
    const checklist = await tools.versionChecklist(actor('qa'), second.currentVersion.id);
    for (const item of checklist.items) await tools.updateChecklistItem(actor('qa'), item.id, { status: 'PASSED' });
    await assets.approve(actor('qa'), video, {});
    assert.equal((await stageOf(runId, 'AI_COMMENTS_VERIFY')).status, 'DONE');

    await finishStage(runId, 'PLATFORM_DEPLOYMENT');
    await finishStage(runId, 'UAT');
    const prepared = await releases.prepareRelease(actor('manager'), runId, {});
    await releases.signoffRelease(actor('courseManager'), prepared.release.id, {});
    await releases.publishRelease(actor('manager'), prepared.release.id, { platformUrl: 'https://lms.example.com/lean' });
    const view = await runs.getRun(actor('manager'), runId);
    assert.equal(view.run.status, 'RELEASED');
    const versions = await db.rows(`SELECT ai_assisted, ai_tool FROM ${S}.learning_asset_versions v JOIN ${S}.learning_assets a ON a.id = v.asset_id WHERE a.lesson_id = $1`, [lesson.id]);
    assert.ok(versions.every((entry) => entry.ai_assisted), 'every AI version is labelled');
  });

  /* ── scenario 3: revamp ────────────────────────────────────────── */

  test('a revamp starts from the published release, records change impact, and never copies an approval', async () => {
    await refuses(runs.createRun(actor('manager'), { scenario: 'REVAMP', courseId: expertCourse }), 'VALIDATION_FAILED');
    const created = await runs.createRun(actor('manager'), { scenario: 'REVAMP', courseId: expertCourse, sourceReleaseId: firstRelease, team: [] });
    const runId = created.run.id;
    assert.equal(created.run.runNumber, 2);
    assert.equal(created.run.sourceReleaseId, firstRelease);
    await refuses(runs.createRun(actor('manager'), { scenario: 'REVAMP', courseId: expertCourse, sourceReleaseId: firstRelease }), 'RUN_ALREADY_OPEN');

    const lessonAssets = await lessons.getLesson(actor('manager'), lessonA);
    const pptA = lessonAssets.assets.find((entry) => entry.assetType === 'PPT').id;
    const approvalsBefore = await db.rows(`SELECT id, version_id, decision FROM ${S}.learning_asset_approvals WHERE asset_id = $1`, [pptA]);

    const impactView = await impact.getImpact(actor('manager'), runId);
    assert.equal(impactView.snapshot.lessons.length, 2);
    await impact.saveImpact(actor('manager'), runId, {
      items: [
        { lessonId: lessonA, assetType: 'PPT', decision: 'CHANGE', note: 'New failure-mode diagram' },
        { lessonId: lessonA, decision: 'KEEP' },
        { lessonId: lessonB, decision: 'KEEP' },
      ],
    });
    await refuses(impact.applyImpact(actor('manager'), runId), 'APPROVAL_REQUIRED');
    await finishTask(await taskId(runId, 'impact.review'));
    await refuses(impact.saveImpact(actor('manager'), runId, { items: [{ lessonId: lessonB, decision: 'CHANGE' }] }), 'IMPACT_LOCKED');
    await impact.applyImpact(actor('manager'), runId);

    const reopened = await assets.getAsset(actor('manager'), pptA);
    assert.equal(reopened.asset.status, 'IN_PROGRESS');
    const approvalsAfter = await db.rows(`SELECT id, version_id, decision FROM ${S}.learning_asset_approvals WHERE asset_id = $1`, [pptA]);
    assert.deepEqual(approvalsAfter, approvalsBefore, 'the old approval stays with the old version; nothing is copied');
    const keptScript = (await lessons.getLesson(actor('manager'), lessonA)).assets.find((entry) => entry.assetType === 'SCRIPT');
    assert.equal(keptScript.status, 'APPROVED', 'kept assets are referenced, untouched');

    await finishStage(runId, 'INSTRUCTIONAL_DESIGN');
    assert.equal((await stageOf(runId, 'MEDIA_PRODUCTION')).status, 'IN_PROGRESS');
    await assets.uploadVersion(actor('slides'), pptA, { bytes: pdf('deck-v2'), fileName: 'deck-v2.pdf', notes: 'New failure-mode diagram' });
    await assets.submit(actor('slides'), pptA, {});
    await assets.approve(actor('qa'), pptA, {});
    assert.equal((await stageOf(runId, 'MEDIA_PRODUCTION')).status, 'DONE');

    await finishStage(runId, 'PLATFORM_DEPLOYMENT');
    await finishStage(runId, 'DRY_RUN_1');
    await tasks.waiveTask(actor('manager'), await taskId(runId, 'change.apply'), { reason: 'No changes beyond the dry run' });
    assert.equal((await stageOf(runId, 'APPLY_CHANGES')).status, 'DONE');
    await finishStage(runId, 'APPLY_DRY_RUN_COMMENTS');
    await finishStage(runId, 'DRY_RUN_2');
    await finishStage(runId, 'UAT');

    const prepared = await releases.prepareRelease(actor('manager'), runId, {});
    assert.equal(prepared.release.versionLabel, 'r2.0.0', 'a revamp is a new major release');
    await releases.signoffRelease(actor('courseManager'), prepared.release.id, {});

    // The content moves after sign-off: publishing is refused, the candidate withdrawn.
    await assets.reopen(actor('manager'), pptA, { reason: 'Typo on slide 3' });
    await refuses(releases.publishRelease(actor('manager'), prepared.release.id, { platformUrl: 'https://lms.example.com/rel-r2' }), 'RELEASE_STALE');
    await releases.withdrawRelease(actor('manager'), prepared.release.id, { reason: 'Slide 3 typo found after sign-off' });
    await assets.uploadVersion(actor('slides'), pptA, { bytes: pdf('deck-v3'), fileName: 'deck-v3.pdf' });
    await assets.submit(actor('slides'), pptA, {});
    await assets.approve(actor('qa'), pptA, {});
    const second = await releases.prepareRelease(actor('manager'), runId, { versionLabel: 'r2.0.1' });
    await releases.signoffRelease(actor('courseManager'), second.release.id, {});
    await releases.publishRelease(actor('manager'), second.release.id, { platformUrl: 'https://lms.example.com/rel-r2' });

    const history = await releases.listReleases(actor('manager'), expertCourse);
    const byLabel = Object.fromEntries(history.releases.map((release) => [release.versionLabel, release]));
    assert.equal(byLabel['r1.0.0'].status, 'SUPERSEDED');
    assert.equal(byLabel['r2.0.0'].status, 'WITHDRAWN');
    assert.equal(byLabel['r2.0.1'].status, 'PUBLISHED');
    assert.equal(history.currentReleaseId, second.release.id);

    const oldSnapshot = (await releases.getRelease(actor('manager'), firstRelease)).release.snapshot;
    const oldPpt = oldSnapshot.lessons.find((lesson) => lesson.id === lessonA).assets.find((asset) => asset.type === 'PPT');
    assert.equal(oldPpt.versionNumber, 1, 'the old release still names the version it shipped');
    const newPpt = (await releases.getRelease(actor('manager'), second.release.id)).release.snapshot.lessons
      .find((lesson) => lesson.id === lessonA)
      .assets.find((asset) => asset.type === 'PPT');
    assert.equal(newPpt.versionNumber, 3);

    await refuses(releases.rollbackRelease(actor('manager'), second.release.id, {}), 'REASON_REQUIRED');
    await releases.rollbackRelease(actor('manager'), second.release.id, { reason: 'Learners report a broken quiz' });
    const rolled = await releases.listReleases(actor('manager'), expertCourse);
    assert.equal(rolled.currentReleaseId, firstRelease, 'rolling back restores the release it superseded');
    await assert.rejects(db.query(`DELETE FROM ${S}.learning_releases WHERE id = $1`, [firstRelease]), /never deleted/);
  });

  /* ── notifications ─────────────────────────────────────────────── */

  test('comment alerts are de-duplicated inside their window, and a muted kind is recorded but not sent', async () => {
    const created = await runs.createRun(actor('manager'), { scenario: 'EXPERT_NEW', course: { name: 'Vibration Analysis' }, team: TEAM });
    const define = await taskId(created.run.id, 'research.define');
    await tasks.addTaskComment(actor('manager'), define, { body: 'Please include the ISO 10816 limits' });
    await tasks.addTaskComment(actor('manager'), define, { body: 'And the new 20816 series' });
    const rows = await outboxFor('researcher', `AND message_key = 'taskComment'`);
    assert.equal(rows.length, 2);
    assert.ok(rows[0].delivered_at);
    assert.equal(rows[1].suppressed_reason, 'DUPLICATE');

    await work.savePreferences(actor('researcher'), { mutedEvents: ['mention'] });
    await tasks.addTaskComment(actor('manager'), define, { body: '@Rana Research can you confirm?' });
    const mention = await outboxFor('researcher', `AND message_key = 'taskMention'`);
    assert.equal(mention.length, 1);
    assert.equal(mention[0].suppressed_reason, 'MUTED');
    assert.equal(mention[0].entity_type, 'TASK');
    assert.equal(mention[0].entity_id, define);

    const bell = await store.find('notifications', (entry) => entry.userId === users.researcher.id && String(entry.type).startsWith('learning.'));
    assert.ok(bell.every((entry) => entry.title.ar && entry.title.en && entry.link), 'one bell, bilingual, with a deep link');
  });

  test('templates are versioned: a new version never rewrites a run already on the old one', async () => {
    await refuses(templates.publishTemplateVersion(actor('manager'), { scenario: 'AI_NEW', options: { aiDryRun: true } }), 'FORBIDDEN');
    const before = await db.row(
      `SELECT r.id, count(st.id)::int AS stages FROM ${S}.learning_production_runs r JOIN ${S}.learning_stage_instances st ON st.run_id = r.id
        WHERE r.scenario = 'AI_NEW' GROUP BY r.id LIMIT 1`
    );
    const published = await templates.publishTemplateVersion(actor('root'), { scenario: 'AI_NEW', options: { aiDryRun: true }, notes: 'Add a dry run' });
    assert.equal(published.version.versionNumber, 2);
    assert.ok(published.summary.stages.some((stage) => stage.key === 'DRY_RUN_1'));
    const after = await db.row(`SELECT count(*)::int AS stages FROM ${S}.learning_stage_instances WHERE run_id = $1`, [before.id]);
    assert.equal(after.stages, before.stages);
    const listed = await templates.listTemplates(actor('manager'));
    const ai = listed.templates.find((entry) => entry.scenario === 'AI_NEW');
    assert.equal(ai.current.versionNumber, 2);
    assert.equal(ai.versions.find((version) => version.versionNumber === 1).runs, 1);
    await assert.rejects(
      db.query(`UPDATE ${S}.learning_workflow_template_versions SET definition_json = '{}'::jsonb WHERE version_number = 1`),
      /frozen/
    );
  });

  test('a lesson asset can be marked not applicable with a reason, and leaves the count', async () => {
    const detail = await lessons.getLesson(actor('manager'), lessonB);
    const vo = detail.assets.find((entry) => entry.assetType === 'VOICE_OVER').id;
    await refuses(assets.setApplicability(actor('manager'), vo, { applicable: false }), 'REASON_REQUIRED');
    await refuses(assets.setApplicability(actor('writer'), vo, { applicable: false, reason: 'x' }), 'FORBIDDEN');
    const marked = await assets.setApplicability(actor('manager'), vo, { applicable: false, reason: 'Silent screencast lesson' });
    assert.equal(marked.asset.applicable, false);
    assert.equal(marked.evaluation.actions.START.reason, 'NOT_APPLICABLE');
    const lesson = await lessons.getLesson(actor('manager'), lessonB);
    assert.equal(lesson.progress.total, 4);
    const restored = await assets.setApplicability(actor('manager'), vo, { applicable: true });
    assert.equal(restored.asset.applicable, true);
  });
});
