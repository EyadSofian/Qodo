/**
 * E-Learning Production — the database-backed guarantees.
 *
 * These walk the module's acceptance scenarios against a real PostgreSQL:
 * a PPT reviewed with slide pins and approved on its second version, a voice
 * over commented at a timestamp, a video with a frame drawing and a QA
 * checklist — plus the properties only a real database can prove: tenant
 * isolation, version immutability, final review decisions and an append-only
 * history.
 *
 * The database comes from the same harness Qodo Projects' tests use
 * (`server/projects/testDatabase.js`) — a test utility that starts PostgreSQL,
 * nothing of the Projects domain. Without a database every suite skips loudly
 * with the reason attached.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { startTestDatabase } from './projects/testDatabase.js';

const documentDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'qodo-learning-docs-'));
process.env.DATA_DIR = documentDirectory;

const database = await startTestDatabase();
const SKIP = database.url ? false : database.reason;

const S = 'qodo_elearning_production';
const ORG_A = 'lp-org-a';
const ORG_B = 'lp-org-b';

const person = (id, name, role, organizationId = ORG_A) => ({
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
  manager: person('lp-mona', 'Mona Manager', 'manager'),
  writer: person('lp-wafa', 'Wafa Writer', 'member'),
  designer: person('lp-ahmed', 'Ahmed Designer', 'member'),
  reviewer: person('lp-sara', 'Sara Reviewer', 'member'),
  voice: person('lp-omar', 'Omar Voice', 'member'),
  editor: person('lp-hana', 'Hana Editor', 'member'),
  outsider: person('lp-nour', 'Nour Outsider', 'member'),
  mallory: person('lp-mallory', 'Mallory', 'admin', ORG_B),
};

let db;
let store;
let access;
let courses;
let lessons;
let assets;
let comments;
let tools;
let team;
let insights;
let notifications;
let errors;

before(async () => {
  if (SKIP) return;
  process.env.DATABASE_URL = database.url;

  db = await import('./learningProduction/db.js');
  store = await import('./store.js');
  access = await import('./learningProduction/access.js');
  courses = await import('./learningProduction/services/courseService.js');
  lessons = await import('./learningProduction/services/lessonService.js');
  assets = await import('./learningProduction/services/assetService.js');
  comments = await import('./learningProduction/services/commentService.js');
  tools = await import('./learningProduction/services/reviewToolsService.js');
  team = await import('./learningProduction/services/teamService.js');
  insights = await import('./learningProduction/services/insightsService.js');
  notifications = await import('./learningProduction/notifications.js');
  errors = await import('./learningProduction/errors.js');

  // A clean schema per run, dropped rather than truncated, so the migration
  // runner itself is exercised every time.
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

const pdf = (label) => Buffer.from(`%PDF-1.4\n% ${label}\n${'0'.repeat(64)}\n%%EOF\n`);
const wav = () => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(128)]);
const mp4 = () => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(128)]);

async function assetsOf(lessonId) {
  const lesson = await lessons.getLesson(actor('manager'), lessonId);
  return Object.fromEntries(lesson.assets.map((entry) => [entry.assetType, entry.id]));
}

describe('E-Learning Production', { skip: SKIP }, () => {
  let courseId;
  let lessonOne;
  let lessonTwo;
  let lessonThree;
  let one;

  /* ── courses and lessons ───────────────────────────────────────── */

  test('a manager creates a course with a module and three lessons, and fifteen assets exist', async () => {
    const created = await courses.createCourse(actor('manager'), {
      name: 'CMRP Certification',
      code: 'CMRP',
      startDate: '2026-09-01',
      targetDate: '2027-03-01',
      modules: [{ name: 'Module 1', lessons: ['Lesson 1', 'Lesson 2', 'Lesson 3'] }],
      team: [{ userId: users.reviewer.id, roles: ['QUALITY_REVIEWER'] }],
    });
    courseId = created.course.id;

    const matrix = await lessons.productionMatrix(actor('manager'), courseId);
    assert.equal(matrix.lessons.length, 3);
    const all = matrix.lessons.flatMap((lesson) => Object.values(lesson.assets));
    assert.equal(all.length, 15);
    assert.ok(all.every((entry) => entry.status === 'NOT_STARTED'));
    [lessonOne, lessonTwo, lessonThree] = matrix.lessons.map((lesson) => lesson.id);
    one = await assetsOf(lessonOne);

    const detail = await courses.getCourse(actor('manager'), courseId);
    const roles = Object.fromEntries(detail.team.map((member) => [member.userId, member.roles]));
    assert.deepEqual(roles[users.manager.id], ['PRODUCTION_MANAGER']);
    assert.deepEqual(roles[users.reviewer.id], ['QUALITY_REVIEWER']);
    assert.equal(detail.course.stats.lessons, 3);
    assert.equal(detail.course.health, 'ON_TRACK');

    const template = await tools.checklistTemplate(actor('manager'), courseId, 'VIDEO');
    assert.equal(template.items.length, 10);
  });

  test('a member cannot create a course, and a course code is unique', async () => {
    await refuses(courses.createCourse(actor('designer'), { name: 'Nope' }), 'FORBIDDEN');
    const duplicate = await courses.createCourse(actor('manager'), { name: 'Again', code: 'cmrp' }).catch((error) => error);
    assert.equal(errors.toResponse(duplicate)?.body.error.code, 'COURSE_CODE_TAKEN');
  });

  test('a new lesson gets its five assets, inheriting the course production defaults', async () => {
    await refuses(
      courses.updateProductionDefaults(actor('manager'), courseId, {
        productionDefaults: { PPT: { assigneeUserId: users.designer.id, reviewerUserId: users.designer.id } },
      }),
      'REVIEWER_IS_ASSIGNEE'
    );
    await courses.updateProductionDefaults(actor('manager'), courseId, {
      productionDefaults: { PPT: { assigneeUserId: users.designer.id, reviewerUserId: users.reviewer.id } },
    });

    const { lessons: [created] } = await lessons.createLessons(actor('manager'), courseId, { name: 'Lesson 4' });
    const lesson = await lessons.getLesson(actor('manager'), created.id);
    assert.equal(lesson.assets.length, 5);
    const ppt = lesson.assets.find((entry) => entry.assetType === 'PPT');
    assert.equal(ppt.status, 'ASSIGNED');
    assert.equal(ppt.assigneeUserId, users.designer.id);
    assert.ok(lesson.assets.filter((entry) => entry.assetType !== 'PPT').every((entry) => entry.status === 'NOT_STARTED'));

    const bulk = await lessons.createLessons(actor('manager'), courseId, {
      items: [
        { name: 'Asset Reliability', moduleName: 'Module 2' },
        { name: 'Preventive Maintenance', moduleName: 'module 2' },
      ],
    });
    assert.equal(bulk.lessons.length, 2);
    assert.equal(bulk.lessons[0].moduleId, bulk.lessons[1].moduleId, 'module names match without regard to case');
  });

  test('a module with lessons in it is refused, never emptied silently', async () => {
    const matrix = await lessons.productionMatrix(actor('manager'), courseId);
    await refuses(lessons.archiveModule(actor('manager'), matrix.modules[0].id), 'MODULE_NOT_EMPTY');
  });

  /* ── isolation and visibility ──────────────────────────────────── */

  test('another organization sees nothing, not even that the course exists', async () => {
    await refuses(courses.getCourse(actor('mallory'), courseId), 'NOT_FOUND');
    await refuses(lessons.productionMatrix(actor('mallory'), courseId), 'NOT_FOUND');
    await refuses(assets.getAsset(actor('mallory'), one.PPT), 'NOT_FOUND');
    await refuses(assets.assign(actor('mallory'), one.PPT, { priority: 'HIGH' }), 'NOT_FOUND');
    await refuses(comments.listComments(actor('mallory'), one.PPT), 'NOT_FOUND');
    assert.equal((await courses.listCourses(actor('mallory'))).courses.length, 0);
    assert.equal((await insights.search(actor('mallory'), 'CMRP')).courses.length, 0);
    assert.equal((await insights.dashboard(actor('mallory'))).kpis.totalLessons, 0);
    await refuses(assets.assign(actor('manager'), one.PPT, { assigneeUserId: users.mallory.id }), 'ASSIGNEE_INVALID');
  });

  test('a colleague with no hand in the course does not see it', async () => {
    await refuses(courses.getCourse(actor('outsider'), courseId), 'NOT_FOUND');
    assert.equal((await courses.listCourses(actor('outsider'))).courses.length, 0);
  });

  /* ── assignment ────────────────────────────────────────────────── */

  test('only somebody with assignment authority assigns; the assignee then sees the course and the work', async () => {
    // The course defaults already put the designer on Lesson 4, so they see the
    // course — and are refused the assignment itself.
    await refuses(assets.assign(actor('designer'), one.PPT, { assigneeUserId: users.designer.id }), 'FORBIDDEN');

    const assigned = await assets.assign(actor('manager'), one.PPT, {
      assigneeUserId: users.designer.id,
      reviewerUserId: users.reviewer.id,
      dueDate: '2030-01-10',
    });
    assert.equal(assigned.asset.status, 'ASSIGNED');

    await refuses(assets.assign(actor('designer'), one.PPT, { dueDate: '2030-02-01' }), 'FORBIDDEN');
    await refuses(assets.assign(actor('reviewer'), one.PPT, { priority: 'URGENT' }), 'FORBIDDEN');
    await refuses(assets.assign(actor('manager'), one.PPT, { reviewerUserId: users.designer.id }), 'REVIEWER_IS_ASSIGNEE');

    const work = await insights.myWork(actor('designer'));
    const item = work.sections.assigned.find((entry) => entry.id === one.PPT);
    assert.ok(item, 'the PPT is in My Work');
    assert.equal(item.course.name, 'CMRP Certification');
    assert.equal(item.lesson.name, 'Lesson 1');
    assert.equal(item.blocked, true);
    assert.deepEqual(item.waitingFor, ['OUTLINE']);
  });

  /* ── dependencies ──────────────────────────────────────────────── */

  test('work cannot start before its dependency is approved; a manager overrides with a recorded reason', async () => {
    const two = await assetsOf(lessonTwo);
    await assets.assign(actor('manager'), two.PPT, { assigneeUserId: users.designer.id });
    await refuses(assets.start(actor('designer'), two.PPT), 'ASSET_BLOCKED');

    const view = await assets.getAsset(actor('designer'), two.PPT);
    assert.equal(view.evaluation.blocked, true);
    assert.deepEqual(view.evaluation.waitingFor.map((entry) => entry.assetType), ['OUTLINE']);
    assert.equal(view.evaluation.waitingFor[0].assetId, two.OUTLINE);

    await refuses(assets.overrideDependency(actor('designer'), two.PPT, { reason: 'please' }), 'FORBIDDEN');
    await refuses(assets.overrideDependency(actor('manager'), two.PPT, { reason: '   ' }), 'REASON_REQUIRED');
    await assets.overrideDependency(actor('manager'), two.PPT, { reason: 'Slides reuse last year’s approved outline' });
    const started = await assets.start(actor('designer'), two.PPT);
    assert.equal(started.asset.status, 'IN_PROGRESS');
    assert.equal(started.asset.dependencyOverrideBy, users.manager.id);

    const history = await insights.assetActivity(actor('manager'), two.PPT);
    const override = history.entries.find((entry) => entry.eventType === 'DEPENDENCY_OVERRIDDEN');
    assert.equal(override.metadata.reason, 'Slides reuse last year’s approved outline');
  });

  /* ── outline: a written asset ──────────────────────────────────── */

  test('an outline is drafted, reviewed with a suggestion, resubmitted and approved on its second version', async () => {
    await assets.assign(actor('manager'), one.OUTLINE, { assigneeUserId: users.writer.id, reviewerUserId: users.reviewer.id });
    const content = { sections: { learningObjectives: 'Understand KPIs', keyTopics: 'MTBF, MTTR' } };

    const saved = await assets.saveDraft(actor('writer'), one.OUTLINE, { content, revision: 0 });
    assert.equal(saved.revision, 1);
    assert.equal(saved.status, 'IN_PROGRESS');
    await refuses(assets.saveDraft(actor('writer'), one.OUTLINE, { content, revision: 0 }), 'DRAFT_CONFLICT');

    const submitted = await assets.submit(actor('writer'), one.OUTLINE, {});
    assert.equal(submitted.asset.status, 'SUBMITTED');
    assert.equal(submitted.currentVersion.versionNumber, 1);
    assert.equal(submitted.currentVersion.content.sections.learningObjectives, 'Understand KPIs');
    await refuses(assets.saveDraft(actor('writer'), one.OUTLINE, { content, revision: 1 }), 'INVALID_TRANSITION');

    const { comment } = await comments.createComment(actor('reviewer'), one.OUTLINE, {
      commentType: 'SUGGESTION',
      body: 'This objective needs to be measurable.',
      anchor: { section: 'learningObjectives', start: 0, end: 15, quote: 'Understand KPIs' },
      suggestionText: 'Calculate three maintenance KPIs',
    });
    await assets.requestChanges(actor('reviewer'), one.OUTLINE, { summary: 'Make the objectives measurable.' });
    await refuses(assets.submit(actor('writer'), one.OUTLINE, {}), 'NEW_VERSION_REQUIRED');

    const applied = await comments.applySuggestion(actor('writer'), comment.id);
    assert.equal(applied.content.sections.learningObjectives, 'Calculate three maintenance KPIs');

    const resubmitted = await assets.submit(actor('writer'), one.OUTLINE, {});
    assert.equal(resubmitted.asset.status, 'RESUBMITTED');
    assert.equal(resubmitted.currentVersion.versionNumber, 2);

    const approved = await assets.approve(actor('reviewer'), one.OUTLINE, {});
    assert.equal(approved.asset.status, 'APPROVED');
    assert.equal(approved.asset.approvedVersionId, approved.currentVersion.id);
    assert.deepEqual(
      approved.approvals.map((entry) => [entry.versionNumber, entry.decision]),
      [
        [2, 'APPROVED'],
        [1, 'CHANGES_REQUESTED'],
      ]
    );
  });

  /* ── PPT: the first acceptance scenario ────────────────────────── */

  let pptVersions = [];

  test('Ahmed uploads PPT v1 and submits; Sara pins slide 4, comments on slide 7 and requests changes', async () => {
    const uploaded = await assets.uploadVersion(actor('designer'), one.PPT, { bytes: pdf('v1'), fileName: 'lesson-1-v1.pdf', notes: 'First draft' });
    assert.equal(uploaded.asset.status, 'IN_PROGRESS');
    assert.equal(uploaded.versions.length, 1);
    await refuses(assets.submit(actor('reviewer'), one.PPT, {}), 'FORBIDDEN');

    const submitted = await assets.submit(actor('designer'), one.PPT, {});
    assert.equal(submitted.asset.status, 'SUBMITTED');
    pptVersions.push(submitted.currentVersion.id);

    const queue = await insights.reviewQueue(actor('reviewer'));
    assert.ok(queue.sections.needsReview.some((entry) => entry.id === one.PPT));

    await refuses(assets.requestChanges(actor('reviewer'), one.PPT, {}), 'FEEDBACK_REQUIRED');
    await refuses(assets.approve(actor('designer'), one.PPT, {}), 'FORBIDDEN');

    const reviewing = await assets.startReview(actor('reviewer'), one.PPT);
    assert.equal(reviewing.asset.status, 'UNDER_REVIEW');

    await refuses(
      comments.createComment(actor('reviewer'), one.PPT, {
        commentType: 'ANNOTATION',
        body: 'Pixels are not positions.',
        annotation: { pageNumber: 4, annotationType: 'PIN', geometry: { x: 412, y: 80 } },
      }),
      'VALIDATION_FAILED'
    );
    await comments.createComment(actor('reviewer'), one.PPT, {
      commentType: 'ANNOTATION',
      body: 'Increase font size.',
      annotation: { pageNumber: 4, annotationType: 'PIN', geometry: { x: 0.42, y: 0.3 } },
    });
    await comments.createComment(actor('reviewer'), one.PPT, {
      commentType: 'ANNOTATION',
      body: 'Replace this image.',
      annotation: { pageNumber: 7, annotationType: 'RECTANGLE', geometry: { x: 0.1, y: 0.2, width: 0.3, height: 0.25 } },
    });

    const requested = await assets.requestChanges(actor('reviewer'), one.PPT, { summary: 'Please address the two slide comments.' });
    assert.equal(requested.asset.status, 'CHANGES_REQUESTED');
    assert.equal(requested.openComments, 2);

    const view = await assets.getAsset(actor('designer'), one.PPT);
    assert.equal(view.primary.action, 'UPLOAD_VERSION', 'the maker is pointed at the new version');
  });

  test('Ahmed uploads v2, resolves the feedback and resubmits; Sara approves v2 and the matrix shows it', async () => {
    await refuses(assets.submit(actor('designer'), one.PPT, {}), 'NEW_VERSION_REQUIRED');
    const second = await assets.uploadVersion(actor('designer'), one.PPT, {
      bytes: pdf('v2'),
      fileName: 'lesson-1-v2.pdf',
      notes: 'Bigger fonts on slide 4, new image on slide 7',
    });
    assert.equal(second.asset.status, 'CHANGES_REQUESTED');
    assert.equal(second.currentVersion.versionNumber, 2);

    const list = await comments.listComments(actor('designer'), one.PPT);
    for (const comment of list.comments) await comments.resolveComment(actor('designer'), comment.id);

    const resubmitted = await assets.submit(actor('designer'), one.PPT, {});
    assert.equal(resubmitted.asset.status, 'RESUBMITTED');
    const queue = await insights.reviewQueue(actor('reviewer'));
    assert.ok(queue.sections.resubmitted.some((entry) => entry.id === one.PPT));

    const approved = await assets.approve(actor('reviewer'), one.PPT, {});
    assert.equal(approved.asset.status, 'APPROVED');
    assert.equal(approved.asset.approvedVersionId, second.currentVersion.id);
    pptVersions.push(second.currentVersion.id);

    const matrix = await lessons.productionMatrix(actor('manager'), courseId);
    assert.equal(matrix.lessons.find((lesson) => lesson.id === lessonOne).assets.PPT.status, 'APPROVED');

    const history = await comments.listComments(actor('manager'), one.PPT);
    assert.equal(history.comments.length, 2);
    assert.ok(history.comments.every((comment) => comment.status === 'RESOLVED' && comment.versionId === pptVersions[0]));
    const pin = history.comments.find((comment) => comment.annotation.pageNumber === 4);
    assert.deepEqual([pin.annotation.x, pin.annotation.y], [0.42, 0.3]);
    assert.equal(approved.versions.length, 2);
  });

  test('a new version after approval does not inherit it', async () => {
    const third = await assets.uploadVersion(actor('designer'), one.PPT, { bytes: pdf('v3'), fileName: 'lesson-1-v3.pdf' });
    assert.equal(third.asset.status, 'IN_PROGRESS');
    assert.equal(third.asset.approvedVersionId, null);
    assert.equal(third.versions.length, 3);
    const v2 = await db.row(`SELECT decision FROM ${S}.learning_asset_approvals WHERE version_id = $1`, [pptVersions[1]]);
    assert.equal(v2.decision, 'APPROVED', 'the approval stays with the version it was given to');
    assert.equal(third.primary.action, 'SUBMIT');
  });

  test('approval with a lock needs the authority to lock; a locked asset takes no edits', async () => {
    await assets.submit(actor('designer'), one.PPT, {});
    await refuses(assets.approve(actor('reviewer'), one.PPT, { lock: true }), 'FORBIDDEN');
    const locked = await assets.approve(actor('manager'), one.PPT, { lock: true });
    assert.equal(locked.asset.status, 'LOCKED');
    assert.ok(locked.asset.lockedAt);

    await refuses(assets.uploadVersion(actor('designer'), one.PPT, { bytes: pdf('v4'), fileName: 'v4.pdf' }), 'ASSET_LOCKED');
    await refuses(comments.createComment(actor('reviewer'), one.PPT, { body: 'One more thing' }), 'ASSET_LOCKED');
    await refuses(assets.assign(actor('manager'), one.PPT, { priority: 'HIGH' }), 'ASSET_LOCKED');
  });

  /* ── Voice Over: the second acceptance scenario ────────────────── */

  test('the script is approved, then a voice over is commented at 01:14, redone and approved, with v1 kept', async () => {
    await assets.assign(actor('manager'), one.SCRIPT, { assigneeUserId: users.writer.id, reviewerUserId: users.reviewer.id });
    await assets.saveDraft(actor('writer'), one.SCRIPT, {
      content: { blocks: [{ id: 'block-intro', title: 'Slide 1', narration: 'Welcome to maintenance KPIs. [pause 2s]' }] },
      revision: 0,
    });
    await assets.submit(actor('writer'), one.SCRIPT, {});
    await assets.approve(actor('reviewer'), one.SCRIPT, {});

    await assets.assign(actor('manager'), one.VOICE_OVER, { assigneeUserId: users.voice.id, reviewerUserId: users.reviewer.id });
    await refuses(
      assets.uploadVersion(actor('voice'), one.VOICE_OVER, { bytes: pdf('not audio'), fileName: 'voice-v1.mp3' }),
      'FILE_TYPE_NOT_ALLOWED'
    );
    const first = await assets.uploadVersion(actor('voice'), one.VOICE_OVER, { bytes: wav(), fileName: 'voice-v1.wav', durationSeconds: 95.5 });
    const v1 = first.currentVersion.id;
    assert.equal(first.currentVersion.durationSeconds, 95.5);
    await assets.submit(actor('voice'), one.VOICE_OVER, {});

    const { comment } = await comments.createComment(actor('reviewer'), one.VOICE_OVER, {
      commentType: 'AUDIO_TIMESTAMP',
      body: 'Pronunciation needs correction.',
      marker: { startSeconds: 74 },
    });
    assert.equal(comment.audioMarker.startSeconds, 74);
    await refuses(
      comments.createComment(actor('reviewer'), one.VOICE_OVER, { commentType: 'AUDIO_TIMESTAMP', body: 'Backwards', marker: { startSeconds: 80, endSeconds: 70 } }),
      'VALIDATION_FAILED'
    );
    await assets.requestChanges(actor('reviewer'), one.VOICE_OVER, {});

    await assets.uploadVersion(actor('voice'), one.VOICE_OVER, { bytes: wav(), fileName: 'voice-v2.wav' });
    await assets.submit(actor('voice'), one.VOICE_OVER, {});
    const approved = await assets.approve(actor('reviewer'), one.VOICE_OVER, {});
    assert.equal(approved.asset.status, 'APPROVED');

    const original = await assets.versionFile(actor('reviewer'), v1, 'original');
    assert.ok(original.bytes.subarray(0, 4).equals(Buffer.from('RIFF')), 'version 1 is still available');
    const positions = await comments.versionPositions(actor('reviewer'), v1, 'audio');
    assert.equal(positions.comments.length, 1, 'the comment stays with the version it was left on');
    await refuses(assets.versionFile(actor('mallory'), v1, 'original'), 'NOT_FOUND');

    const transcript = await tools.saveTranscript(actor('voice'), approved.currentVersion.id, {
      body: 'Welcome to maintenance KPIs.',
      segments: [{ startSeconds: 0, endSeconds: 2.5, text: 'Welcome to maintenance KPIs.' }],
    });
    assert.equal(transcript.transcript.segments.length, 1);
  });

  /* ── Video: the third acceptance scenario ──────────────────────── */

  test('a video is drawn on at 02:14, redone, QA-checked and approved, and the lesson reaches 100%', async () => {
    await assets.assign(actor('manager'), one.VIDEO, { assigneeUserId: users.editor.id, reviewerUserId: users.reviewer.id });
    await assets.uploadVersion(actor('editor'), one.VIDEO, { bytes: mp4(), fileName: 'final-v1.mp4' });
    const submitted = await assets.submit(actor('editor'), one.VIDEO, {});
    assert.deepEqual(
      submitted.references.map((entry) => [entry.assetType, entry.approved]).sort(),
      [
        ['PPT', true],
        ['SCRIPT', true],
        ['VOICE_OVER', true],
      ]
    );

    const { comment } = await comments.createComment(actor('reviewer'), one.VIDEO, {
      commentType: 'VIDEO_TIMESTAMP',
      body: 'Move this lower.',
      marker: {
        startSeconds: 134,
        frameTimestamp: 134,
        drawing: [{ annotationType: 'RECTANGLE', geometry: { x: 0.2, y: 0.05, width: 0.6, height: 0.12 } }],
      },
    });
    assert.equal(comment.videoMarker.frameTimestamp, 134);
    assert.equal(comment.videoMarker.drawing[0].geometry.width, 0.6);
    await comments.createComment(actor('reviewer'), one.VIDEO, {
      commentType: 'VIDEO_TIMESTAMP',
      body: 'Audio synchronization issue.',
      marker: { startSeconds: 272 },
    });
    await assets.requestChanges(actor('reviewer'), one.VIDEO, {});

    const second = await assets.uploadVersion(actor('editor'), one.VIDEO, { bytes: mp4(), fileName: 'final-v2.mp4' });
    await assets.submit(actor('editor'), one.VIDEO, {});
    await refuses(assets.approve(actor('reviewer'), one.VIDEO, {}), 'CHECKLIST_INCOMPLETE');

    const checklist = await tools.versionChecklist(actor('reviewer'), second.currentVersion.id);
    assert.equal(checklist.items.length, 10);
    assert.equal(checklist.canEdit, true);
    await refuses(tools.updateChecklistItem(actor('editor'), checklist.items[0].id, { status: 'PASSED' }), 'FORBIDDEN');
    for (const item of checklist.items) await tools.updateChecklistItem(actor('reviewer'), item.id, { status: 'PASSED' });

    const approved = await assets.approve(actor('reviewer'), one.VIDEO, {});
    assert.equal(approved.asset.status, 'APPROVED');
    const lesson = await lessons.getLesson(actor('manager'), lessonOne);
    assert.equal(lesson.progress.percent, 100);
    assert.equal(lesson.state, 'COMPLETE');
  });

  /* ── the asset board ───────────────────────────────────────────── */

  test('the asset board shows each stage as the thing it is, and never the content itself', async () => {
    const board = await lessons.assetBoard(actor('manager'), lessonOne);
    assert.equal(board.assets.length, 5, 'all five stages, in stage order');
    assert.deepEqual(
      board.assets.map((asset) => asset.assetType),
      ['OUTLINE', 'PPT', 'SCRIPT', 'VOICE_OVER', 'VIDEO']
    );

    const preview = Object.fromEntries(board.assets.map((asset) => [asset.assetType, asset.preview]));
    assert.equal(preview.OUTLINE.kind, 'OUTLINE');
    assert.ok(preview.OUTLINE.sections.length > 0, 'the outline card has something to draw');
    assert.equal(preview.SCRIPT.kind, 'SCRIPT');
    assert.equal(preview.SCRIPT.blockCount, 1);
    assert.ok(preview.SCRIPT.blocks[0].narration.startsWith('Welcome to maintenance KPIs'));
    assert.equal(preview.PPT.kind, 'PPT');
    assert.equal(preview.PPT.fileName, 'lesson-1-v3.pdf', 'the card names the file the designer uploaded');
    assert.equal(preview.VOICE_OVER.kind, 'VOICE_OVER');
    assert.equal(preview.VOICE_OVER.hasTranscript, true);
    assert.equal(preview.VIDEO.kind, 'VIDEO');

    // A card is a way in, not a way to read the work: the board carries an
    // excerpt of each version and none of the versions themselves.
    for (const asset of board.assets) {
      assert.equal(asset.preview.content, undefined);
      assert.ok(JSON.stringify(asset.preview).length < 2000, `${asset.assetType} preview stays small`);
    }

    const ppt = board.assets.find((asset) => asset.assetType === 'PPT');
    assert.equal(ppt.versionCount, 3, 'the board says how many versions there have been');

    await refuses(lessons.assetBoard(actor('mallory'), lessonOne), 'NOT_FOUND');
    await refuses(lessons.assetBoard(actor('outsider'), lessonOne), 'NOT_FOUND');
  });

  /* ── reopening ─────────────────────────────────────────────────── */

  test('reopening locked work needs the authority and a reason, and is recorded', async () => {
    await refuses(assets.reopen(actor('designer'), one.PPT, { reason: 'I want to' }), 'FORBIDDEN');
    await refuses(assets.reopen(actor('manager'), one.PPT, {}), 'REASON_REQUIRED');
    const reopened = await assets.reopen(actor('manager'), one.PPT, { reason: 'Brand colours changed' });
    assert.equal(reopened.asset.status, 'IN_PROGRESS');
    assert.equal(reopened.asset.lockedAt, null);
    assert.equal(reopened.versions.length, 3, 'nothing was removed');
    await refuses(assets.submit(actor('designer'), one.PPT, {}), 'NEW_VERSION_REQUIRED');

    const lesson = await lessons.getLesson(actor('manager'), lessonOne);
    assert.equal(lesson.progress.percent, 80);
    const history = await insights.assetActivity(actor('manager'), one.PPT);
    assert.equal(history.entries.find((entry) => entry.eventType === 'REOPENED').metadata.reason, 'Brand colours changed');
  });

  /* ── the database refuses to lose history ──────────────────────── */

  test('versions are immutable, decisions are final, history is append-only, comments are never deleted', async () => {
    await assert.rejects(db.query(`UPDATE ${S}.learning_asset_versions SET file_name = 'renamed.pdf' WHERE asset_id = $1`, [one.PPT]), /immutable/);
    await assert.rejects(db.query(`DELETE FROM ${S}.learning_asset_versions WHERE asset_id = $1`, [one.PPT]), /never deleted/);
    await assert.rejects(
      db.query(`UPDATE ${S}.learning_asset_approvals SET notes = 'rewritten' WHERE asset_id = $1 AND decision <> 'PENDING'`, [one.PPT]),
      /final/
    );
    await assert.rejects(db.query(`DELETE FROM ${S}.learning_activity_log WHERE asset_id = $1`, [one.PPT]), /append-only/);
    await assert.rejects(db.query(`DELETE FROM ${S}.learning_comments WHERE asset_id = $1`, [one.PPT]), /never deleted|archived/);
    await assert.rejects(db.query(`DELETE FROM ${S}.learning_lessons WHERE id = $1`, [lessonOne]), /archived/);
  });

  /* ── managers' tools ───────────────────────────────────────────── */

  test('bulk assignment skips what it may not touch and reports it', async () => {
    const three = await assetsOf(lessonThree);
    const result = await assets.bulkAssign(actor('manager'), courseId, {
      assetIds: [three.SCRIPT, three.OUTLINE, one.OUTLINE],
      assigneeUserId: users.writer.id,
      dueDate: '2030-02-01',
    });
    assert.deepEqual(result, { updated: 3, skipped: 0 });
    assert.deepEqual(
      await assets.bulkAssign(actor('designer'), courseId, { assetIds: [three.SCRIPT], assigneeUserId: users.designer.id }),
      { updated: 0, skipped: 1 }
    );
  });

  test('a course keeps at least one Production Manager', async () => {
    await refuses(team.removeMember(actor('manager'), courseId, users.manager.id), 'LAST_MANAGER');
    await team.saveMember(actor('manager'), courseId, users.designer.id, { roles: ['PPT_DESIGNER'] });
    const listed = await team.listTeam(actor('manager'), courseId);
    assert.ok(listed.members.some((member) => member.userId === users.designer.id));
    await refuses(team.saveMember(actor('designer'), courseId, users.voice.id, { roles: ['VIEWER'] }), 'FORBIDDEN');
  });

  test('the dashboard, reports and attention lists answer from the same data', async () => {
    const summary = await insights.dashboard(actor('manager'));
    assert.equal(summary.stages.length, 5);
    assert.ok(summary.kpis.totalLessons >= 6);
    assert.equal(summary.managerView, true);
    assert.ok(summary.activity.some((entry) => entry.eventType === 'APPROVED'));

    const report = await insights.reports(actor('manager'), { courseId });
    assert.equal(report.stages.length, 5);
    assert.equal(report.throughput.length, 8);
    assert.ok(report.stages.find((stage) => stage.assetType === 'PPT').avgVersions >= 1 || report.stages.find((stage) => stage.assetType === 'OUTLINE').avgVersions >= 1);
    await refuses(insights.reports(actor('designer'), {}), 'FORBIDDEN');

    const blocked = await insights.attention(actor('manager'), 'blocked');
    assert.ok(blocked.items.every((item) => item.blocked));
  });

  test('archiving a course hides it without deleting it, and restoring brings it back', async () => {
    const extra = await courses.createCourse(actor('manager'), { name: 'Short course' });
    await courses.archiveCourse(actor('manager'), extra.course.id);
    assert.ok(!(await courses.listCourses(actor('manager'))).courses.some((course) => course.id === extra.course.id));
    await refuses(courses.getCourse(actor('manager'), extra.course.id), 'NOT_FOUND');
    await courses.restoreCourse(actor('manager'), extra.course.id);
    assert.ok((await courses.listCourses(actor('manager'))).courses.some((course) => course.id === extra.course.id));
  });

  /* ── notifications ─────────────────────────────────────────────── */

  test('rapid identical notifications are sent once', async () => {
    const outbox = [
      {
        organizationId: ORG_A,
        actorId: null,
        recipients: [users.designer.id],
        type: 'comment',
        message: 'comment',
        dedupeKey: 'test:dedupe',
        windowMinutes: 10,
        link: '/learning-production',
        data: { courseName: 'CMRP Certification', lessonName: 'Lesson 1', assetType: 'PPT' },
      },
    ];
    assert.equal(await notifications.flush(outbox), 1);
    assert.equal(await notifications.flush(outbox), 0);
    const row = await db.row(`SELECT delivered_count, suppressed_count FROM ${S}.learning_notifications WHERE dedupe_key = 'test:dedupe'`);
    assert.deepEqual(row, { delivered_count: 1, suppressed_count: 1 });

    const bell = await store.find('notifications', (entry) => entry.userId === users.designer.id && entry.type.startsWith('learning.'));
    assert.ok(bell.some((entry) => entry.type === 'learning.assigned'), 'the assignment reached the workspace bell');
    assert.ok(bell.some((entry) => entry.type === 'learning.changes_requested'));
  });
});
