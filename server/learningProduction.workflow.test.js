/**
 * E-Learning Production — the rules, without a database.
 *
 * Everything here is a pure function the server enforces and the browser
 * renders: the transitions, the dependencies, who may do what, progress,
 * health, narration timing, anchors, geometry, the diff, the lesson import and
 * the file sniffing. The database-backed guarantees are in
 * learningProduction.integration.test.js.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import * as C from '../shared/learningProduction/constants.js';
import { LP_PERMISSION_LIST, LP_PERMISSIONS as P, buildGrants, lpPermissionsOf } from '../shared/learningProduction/permissions.js';
import {
  LEGAL_FROM,
  courseHealth,
  currentStage,
  dependencyState,
  dueState,
  evaluateAsset,
  lessonProgress,
  lessonState,
  nextStatus,
  normalizeSettings,
  primaryAction,
  statusAfterAssignment,
} from '../shared/learningProduction/workflow.js';
import {
  annotationGeometryError,
  contentHasText,
  countWords,
  diffScriptBlocks,
  diffText,
  estimateNarrationSeconds,
  formatTimecode,
  locateQuote,
  normalizeContent,
  sameContent,
} from '../shared/learningProduction/review.js';
import { parseLessonList } from '../shared/learningProduction/lessonImport.js';
import { ALL_PERMISSIONS, ROLES } from '../shared/permissions.js';
import { detectKind } from './learningProduction/fileTypes.js';
import { parseRange } from './learningProduction/blobs.js';
import { DomainError, toResponse } from './learningProduction/errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ */
/* The vocabulary and the database agree                                */
/* ------------------------------------------------------------------ */

describe('constants match the migration', () => {
  const sqlFor = async () => {
    const directory = path.join(__dirname, 'learningProduction', 'migrations');
    const files = (await fs.readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
    return (await Promise.all(files.map((name) => fs.readFile(path.join(directory, name), 'utf8')))).join('\n');
  };
  const listIn = (sql, column) => {
    const matches = [...sql.matchAll(new RegExp(`${column} IN \\(([^)]*)\\)`, 'g'))];
    assert.ok(matches.length > 0, `no CHECK list found for ${column}`);
    const last = matches[matches.length - 1][1];
    return [...last.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]);
  };

  test('every enum the services use is the one the database enforces', async () => {
    const sql = await sqlFor();
    assert.deepEqual(listIn(sql, 'asset_type'), [...C.ASSET_TYPES]);
    assert.deepEqual(listIn(sql, 'status'), ['PENDING', 'PASSED', 'ISSUE'], 'checklist item status is the last status list');
    assert.ok(sql.includes(`CHECK (status IN (${C.ASSET_STATUSES.map((s) => `'${s}'`).join(', ')}))`));
    assert.deepEqual(listIn(sql, 'priority'), [...C.PRIORITIES]);
    assert.deepEqual(listIn(sql, 'comment_type'), [...C.COMMENT_TYPES]);
    assert.deepEqual(listIn(sql, 'annotation_type'), [...C.ANNOTATION_TYPES]);
    assert.deepEqual(listIn(sql, 'event_type'), [...C.ACTIVITY_EVENTS]);
    assert.deepEqual(listIn(sql, 'decision'), [...C.APPROVAL_DECISIONS]);
    assert.deepEqual(listIn(sql, 'source_kind'), [...C.VERSION_SOURCES]);
    assert.deepEqual(listIn(sql, 'source'), [...C.TRANSCRIPT_SOURCES]);
    const roles = /roles <@ ARRAY\[([^\]]*)\]/.exec(sql)[1];
    assert.deepEqual([...roles.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]), [...C.COURSE_ROLES]);
  });

  test('every module permission is grantable from the Users screen', () => {
    for (const key of LP_PERMISSION_LIST) assert.ok(ALL_PERMISSIONS.includes(key), `${key} missing from the workspace catalogue`);
    assert.deepEqual(lpPermissionsOf(ROLES.admin.permissions).sort(), [...LP_PERMISSION_LIST].sort());
    assert.deepEqual(lpPermissionsOf(ROLES.member.permissions), []);
    assert.deepEqual(lpPermissionsOf(ROLES.manager.permissions).sort(), [P.COURSE_CREATE, P.REPORT_VIEW, P.VIEW].sort());
  });
});

/* ------------------------------------------------------------------ */
/* Transitions                                                          */
/* ------------------------------------------------------------------ */

describe('transitions', () => {
  test('the production path moves one named step at a time', () => {
    assert.equal(statusAfterAssignment('NOT_STARTED', 'u1'), 'ASSIGNED');
    assert.equal(nextStatus('START', 'ASSIGNED'), 'IN_PROGRESS');
    assert.equal(nextStatus('SUBMIT', 'IN_PROGRESS'), 'SUBMITTED');
    assert.equal(nextStatus('START_REVIEW', 'SUBMITTED'), 'UNDER_REVIEW');
    assert.equal(nextStatus('REQUEST_CHANGES', 'UNDER_REVIEW'), 'CHANGES_REQUESTED');
    assert.equal(nextStatus('SUBMIT', 'CHANGES_REQUESTED'), 'RESUBMITTED');
    assert.equal(nextStatus('START_REVIEW', 'RESUBMITTED'), 'UNDER_REVIEW');
    assert.equal(nextStatus('APPROVE', 'UNDER_REVIEW'), 'APPROVED');
    assert.equal(nextStatus('LOCK', 'APPROVED'), 'LOCKED');
    assert.equal(nextStatus('REOPEN', 'LOCKED'), 'IN_PROGRESS');
  });

  test('nothing jumps: illegal starting states return null', () => {
    assert.equal(nextStatus('APPROVE', 'IN_PROGRESS'), null);
    assert.equal(nextStatus('SUBMIT', 'SUBMITTED'), null);
    assert.equal(nextStatus('LOCK', 'UNDER_REVIEW'), null);
    assert.equal(nextStatus('UPLOAD_VERSION', 'UNDER_REVIEW'), null, 'content is frozen while it is reviewed');
    assert.equal(nextStatus('UPLOAD_VERSION', 'LOCKED'), null);
    assert.equal(nextStatus('SAVE_DRAFT', 'APPROVED'), null);
    assert.ok(!LEGAL_FROM.ASSIGN.includes('LOCKED'));
  });

  test('an upload over approved work starts a new cycle', () => {
    assert.equal(nextStatus('UPLOAD_VERSION', 'APPROVED'), 'IN_PROGRESS');
    assert.equal(nextStatus('UPLOAD_VERSION', 'CHANGES_REQUESTED'), 'CHANGES_REQUESTED');
  });

  test('removing the assignee from unstarted work returns it to Not Started', () => {
    assert.equal(statusAfterAssignment('ASSIGNED', null), 'NOT_STARTED');
    assert.equal(statusAfterAssignment('IN_PROGRESS', null), 'IN_PROGRESS');
  });
});

/* ------------------------------------------------------------------ */
/* Dependencies                                                         */
/* ------------------------------------------------------------------ */

describe('dependencies', () => {
  test('PPT and Script wait for the Outline; Voice for the Script; Video for all three', () => {
    const none = {};
    assert.deepEqual(dependencyState('PPT', 'ASSIGNED', none).waitingFor, ['OUTLINE']);
    assert.deepEqual(dependencyState('SCRIPT', 'ASSIGNED', { OUTLINE: 'APPROVED' }).waitingFor, []);
    assert.deepEqual(dependencyState('VOICE_OVER', 'ASSIGNED', { SCRIPT: 'UNDER_REVIEW' }).waitingFor, ['SCRIPT']);
    assert.deepEqual(
      dependencyState('VIDEO', 'NOT_STARTED', { PPT: 'APPROVED', SCRIPT: 'LOCKED', VOICE_OVER: 'IN_PROGRESS' }).waitingFor,
      ['VOICE_OVER']
    );
    assert.equal(dependencyState('OUTLINE', 'NOT_STARTED', none).blocked, false);
  });

  test('only unstarted work is blocked, and an override or a course switch lifts it', () => {
    assert.equal(dependencyState('PPT', 'IN_PROGRESS', {}).blocked, false);
    assert.equal(dependencyState('PPT', 'ASSIGNED', {}).blocked, true);
    assert.equal(dependencyState('PPT', 'ASSIGNED', {}, { overridden: true }).blocked, false);
    assert.equal(dependencyState('PPT', 'ASSIGNED', {}, { enforce: false }).blocked, false);
  });
});

/* ------------------------------------------------------------------ */
/* Authority                                                            */
/* ------------------------------------------------------------------ */

const asset = (overrides = {}) => ({
  assetType: 'PPT',
  status: 'ASSIGNED',
  assigneeUserId: 'ahmed',
  reviewerUserId: 'sara',
  submittedBy: null,
  dependencyOverrideAt: null,
  ...overrides,
});
const approvedOutline = { OUTLINE: 'APPROVED' };
const nobody = buildGrants();

describe('grants', () => {
  test('a course role reaches only its stages', () => {
    const designer = buildGrants({ roles: ['PPT_DESIGNER'] });
    assert.equal(designer.has(P.ASSET_EDIT, 'PPT'), true);
    assert.equal(designer.has(P.ASSET_EDIT, 'SCRIPT'), false);
    assert.equal(designer.has(P.ASSET_APPROVE, 'PPT'), false);
    const quality = buildGrants({ roles: ['QUALITY_REVIEWER'] });
    assert.ok(C.ASSET_TYPES.every((stage) => quality.has(P.ASSET_APPROVE, stage)));
    assert.equal(buildGrants({ roles: ['VIEWER'] }).has(P.ASSET_EDIT), false);
  });

  test('a workspace key and the module administrator reach everything', () => {
    assert.equal(buildGrants({ orgPermissions: [P.ASSET_ASSIGN] }).has(P.ASSET_ASSIGN, 'VIDEO'), true);
    const admin = buildGrants({ orgPermissions: [P.ADMIN] });
    assert.equal(admin.isAdmin, true);
    assert.equal(admin.has(P.TEAM_MANAGE), true);
  });
});

describe('evaluateAsset', () => {
  test('the assignee may start once the outline is approved, and is told why not before', () => {
    const blocked = evaluateAsset({ asset: asset(), grants: nobody, userId: 'ahmed' });
    assert.deepEqual(blocked.actions.START, { allowed: false, reason: 'ASSET_BLOCKED' });
    assert.equal(blocked.blocked, true);

    const ready = evaluateAsset({ asset: asset(), siblingStatuses: approvedOutline, grants: nobody, userId: 'ahmed' });
    assert.equal(ready.actions.START.allowed, true);
    assert.equal(ready.actions.UPLOAD_VERSION.allowed, true);
    assert.deepEqual(ready.actions.SAVE_DRAFT, { allowed: false, reason: 'NOT_SUPPORTED' });
  });

  test('somebody with no hand in the work may do nothing', () => {
    const outsider = evaluateAsset({ asset: asset(), siblingStatuses: approvedOutline, grants: nobody, userId: 'mallory' });
    for (const action of ['ASSIGN', 'START', 'UPLOAD_VERSION', 'LOCK', 'REOPEN']) {
      assert.equal(outsider.actions[action].allowed, false, action);
    }
    assert.equal(outsider.canResolveComments, false);
  });

  test('a manager may override a block, with no block there is nothing to override', () => {
    const manager = buildGrants({ roles: ['PRODUCTION_MANAGER'] });
    assert.equal(evaluateAsset({ asset: asset(), grants: manager, userId: 'boss' }).actions.OVERRIDE_DEPENDENCY.allowed, true);
    assert.deepEqual(
      evaluateAsset({ asset: asset(), siblingStatuses: approvedOutline, grants: manager, userId: 'boss' }).actions.OVERRIDE_DEPENDENCY,
      { allowed: false, reason: 'NOT_BLOCKED' }
    );
    assert.equal(evaluateAsset({ asset: asset({ dependencyOverrideAt: '2026-09-01' }), grants: nobody, userId: 'ahmed' }).actions.START.allowed, true);
  });

  test('submitting needs something to submit, and something new after a decision', () => {
    const inProgress = asset({ status: 'IN_PROGRESS' });
    assert.equal(evaluateAsset({ asset: inProgress, grants: nobody, userId: 'ahmed' }).actions.SUBMIT.reason, 'CONTENT_REQUIRED');
    assert.equal(evaluateAsset({ asset: inProgress, grants: nobody, userId: 'ahmed', hasContent: true }).actions.SUBMIT.allowed, true);
    assert.equal(
      evaluateAsset({ asset: asset({ status: 'CHANGES_REQUESTED' }), grants: nobody, userId: 'ahmed', hasContent: true, versionSinceChanges: false })
        .actions.SUBMIT.reason,
      'NEW_VERSION_REQUIRED'
    );
  });

  test('the named reviewer decides; the submitter never approves their own work unless module administrator', () => {
    const submitted = asset({ status: 'SUBMITTED', submittedBy: 'ahmed' });
    const reviewer = evaluateAsset({ asset: submitted, grants: nobody, userId: 'sara' });
    assert.equal(reviewer.actions.APPROVE.allowed, true);
    assert.equal(reviewer.actions.REQUEST_CHANGES.allowed, true);

    const selfReview = evaluateAsset({ asset: submitted, grants: buildGrants({ roles: ['QUALITY_REVIEWER'] }), userId: 'ahmed' });
    assert.deepEqual(selfReview.actions.APPROVE, { allowed: false, reason: 'OWN_WORK' });
    assert.deepEqual(selfReview.actions.START_REVIEW, { allowed: false, reason: 'OWN_WORK' });

    const admin = evaluateAsset({ asset: submitted, grants: buildGrants({ orgPermissions: [P.ADMIN] }), userId: 'ahmed' });
    assert.equal(admin.actions.APPROVE.allowed, true);
  });

  test('a locked asset refuses everything but reopening, and says it is locked', () => {
    const locked = evaluateAsset({ asset: asset({ status: 'LOCKED' }), grants: buildGrants({ roles: ['PRODUCTION_MANAGER'] }), userId: 'boss' });
    assert.deepEqual(locked.actions.UPLOAD_VERSION, { allowed: false, reason: 'ASSET_LOCKED' });
    assert.deepEqual(locked.actions.ASSIGN, { allowed: false, reason: 'ASSET_LOCKED' });
    assert.equal(locked.actions.REOPEN.allowed, true);
  });
});

describe('primaryAction', () => {
  const primary = (overrides, options = {}) =>
    primaryAction(
      evaluateAsset({ asset: asset(overrides), siblingStatuses: approvedOutline, grants: nobody, userId: options.userId ?? 'ahmed', ...options }),
      { assetType: overrides.assetType ?? 'PPT' }
    );

  test('says Start, then Upload, then Submit, then Waiting', () => {
    assert.deepEqual(primary({}), { kind: 'action', action: 'START', disabledReason: null });
    assert.equal(primary({ status: 'IN_PROGRESS' }).action, 'UPLOAD_VERSION');
    assert.equal(primary({ status: 'IN_PROGRESS' }, { hasContent: true }).action, 'SUBMIT');
    assert.equal(primary({ status: 'SUBMITTED', submittedBy: 'ahmed' }).kind, 'waiting');
  });

  test('after changes are requested the maker is pointed at the new version, not at Submit', () => {
    assert.equal(primary({ status: 'CHANGES_REQUESTED' }, { hasContent: true, versionSinceChanges: false }).action, 'UPLOAD_VERSION');
    const text = primary({ assetType: 'SCRIPT', status: 'CHANGES_REQUESTED' }, { hasContent: true, versionSinceChanges: false });
    assert.deepEqual(text, { kind: 'action', action: 'SUBMIT', disabledReason: 'NEW_VERSION_REQUIRED' });
  });

  test('the reviewer sees the decision, and approved work never still says Submit', () => {
    assert.equal(primary({ status: 'SUBMITTED', submittedBy: 'ahmed' }, { userId: 'sara' }).kind, 'review');
    assert.deepEqual(primary({ status: 'APPROVED' }), { kind: 'done', action: null, disabledReason: null });
  });
});

/* ------------------------------------------------------------------ */
/* Progress, dates and health                                           */
/* ------------------------------------------------------------------ */

describe('progress', () => {
  test('approved and locked stages count; in progress counts for nothing', () => {
    const statuses = { OUTLINE: 'APPROVED', PPT: 'LOCKED', SCRIPT: 'APPROVED', VOICE_OVER: 'IN_PROGRESS', VIDEO: 'NOT_STARTED' };
    assert.deepEqual(lessonProgress(statuses), { complete: 3, total: 5, percent: 60 });
    assert.equal(currentStage(statuses), 'VOICE_OVER');
    assert.equal(lessonState(statuses), 'IN_PRODUCTION');
    assert.equal(lessonState({ ...statuses, VOICE_OVER: 'CHANGES_REQUESTED', VIDEO: 'SUBMITTED' }), 'CHANGES_REQUESTED');
    const done = Object.fromEntries(C.ASSET_TYPES.map((type) => [type, 'APPROVED']));
    assert.equal(lessonProgress(done).percent, 100);
    assert.equal(lessonState(done), 'COMPLETE');
    assert.equal(currentStage(done), null);
  });

  test('due dates distinguish overdue, today and soon, and finished work is never late', () => {
    const today = '2026-09-15';
    assert.equal(dueState('2026-09-14', 'IN_PROGRESS', today), 'OVERDUE');
    assert.equal(dueState('2026-09-15', 'IN_PROGRESS', today), 'DUE_TODAY');
    assert.equal(dueState('2026-09-17', 'ASSIGNED', today), 'DUE_SOON');
    assert.equal(dueState('2026-09-30', 'ASSIGNED', today), null);
    assert.equal(dueState('2026-09-01', 'APPROVED', today), null);
  });

  test('health is explained, and its thresholds are the course’s own', () => {
    const today = '2026-09-15';
    assert.equal(courseHealth({ totalAssets: 10, completeAssets: 10, today }).health, 'COMPLETED');
    const passed = courseHealth({ totalAssets: 10, completeAssets: 5, openAssets: 5, targetDate: '2026-09-01', today });
    assert.equal(passed.health, 'DELAYED');
    assert.equal(passed.reasons[0].code, 'TARGET_PASSED');
    const late = courseHealth({ totalAssets: 100, completeAssets: 10, openAssets: 90, overdueAssets: 2, today });
    assert.equal(late.health, 'AT_RISK');
    assert.deepEqual(late.reasons[0], { code: 'SOME_OVERDUE', count: 2 });
    const behind = courseHealth({ totalAssets: 10, completeAssets: 1, openAssets: 9, startDate: '2026-09-01', targetDate: '2026-10-01', today });
    assert.equal(behind.health, 'AT_RISK');
    assert.equal(behind.reasons[0].code, 'BEHIND_SCHEDULE');
    assert.equal(courseHealth({ totalAssets: 10, completeAssets: 5, openAssets: 5, today }).health, 'ON_TRACK');
    const lenient = normalizeSettings({ delayedOverdueShare: 0.5 });
    assert.equal(courseHealth({ totalAssets: 10, completeAssets: 0, openAssets: 10, overdueAssets: 2, today, settings: lenient }).health, 'AT_RISK');
  });

  test('settings are clamped to sense and fall back to defaults', () => {
    const settings = normalizeSettings({ wordsPerMinute: 9000, enforceDependencies: false, unknown: 1 });
    assert.equal(settings.wordsPerMinute, 300);
    assert.equal(settings.enforceDependencies, false);
    assert.equal('unknown' in settings, false);
    assert.equal(normalizeSettings(null).wordsPerMinute, C.DEFAULT_COURSE_SETTINGS.wordsPerMinute);
  });
});

/* ------------------------------------------------------------------ */
/* Review helpers                                                       */
/* ------------------------------------------------------------------ */

describe('review helpers', () => {
  test('narration length follows the course reading speed and the written pauses', () => {
    assert.equal(countWords('Maintenance KPIs measure reliability.'), 4);
    assert.equal(countWords('كَتَبَ المهندسُ التقريرَ'), 3, 'diacritics do not split Arabic words');
    assert.equal(estimateNarrationSeconds('word '.repeat(130), 130), 60);
    assert.equal(estimateNarrationSeconds('word '.repeat(130), 260), 30);
    assert.equal(estimateNarrationSeconds('word '.repeat(130) + '[pause 2s] [وقفة 3]', 130), 65);
    assert.equal(formatTimecode(74), '01:14');
    assert.equal(formatTimecode(3725), '1:02:05');
  });

  test('a quoted passage is found where it moved to, and lost only when it is gone', () => {
    const anchor = { start: 0, end: 9, quote: 'objective' };
    assert.deepEqual(locateQuote('objective one', anchor), { start: 0, end: 9 });
    assert.deepEqual(locateQuote('A new first line. objective one', anchor), { start: 18, end: 27 });
    assert.equal(locateQuote('rewritten entirely', anchor), null);
  });

  test('annotation shapes are fractions of the page', () => {
    assert.equal(annotationGeometryError('PIN', { x: 0.4, y: 0.2 }), null);
    assert.equal(annotationGeometryError('RECTANGLE', { x: 0.1, y: 0.1, width: 0.5, height: 0.2 }), null);
    assert.equal(annotationGeometryError('RECTANGLE', { x: 0.8, y: 0.1, width: 0.5, height: 0.2 }), 'ANNOTATION_SIZE_INVALID');
    assert.equal(annotationGeometryError('PIN', { x: 412, y: 80 }), 'ANNOTATION_POSITION_INVALID', 'pixels are refused');
    assert.equal(annotationGeometryError('ARROW', { x: 0.1, y: 0.1, points: [[0.1, 0.1], [0.9, 0.9]] }), null);
    assert.equal(annotationGeometryError('FREEHAND', { x: 0.1, y: 0.1, points: [[0.1, 0.1]] }), 'ANNOTATION_POINTS_INVALID');
    assert.equal(annotationGeometryError('STAR', { x: 0, y: 0 }), 'ANNOTATION_TYPE_INVALID');
  });

  test('the diff shows the changed words inside a changed line', () => {
    const segments = diffText('Objectives:\nExplain MTBF clearly.\n', 'Objectives:\nExplain MTTR clearly.\n');
    assert.deepEqual(
      segments.filter((segment) => segment.type !== 'equal'),
      [
        { type: 'delete', text: 'MTBF' },
        { type: 'insert', text: 'MTTR' },
      ]
    );
    assert.deepEqual(diffText('same', 'same'), [{ type: 'equal', text: 'same' }]);
  });

  test('script blocks are compared by their id', () => {
    const before = { blocks: [{ id: 'block-one', narration: 'Hello' }, { id: 'block-two', narration: 'Bye' }] };
    const after = { blocks: [{ id: 'block-one', narration: 'Hello there' }, { id: 'block-new', narration: 'New' }] };
    const result = Object.fromEntries(diffScriptBlocks(before, after).map((entry) => [entry.id, entry]));
    assert.equal(result['block-one'].status, 'changed');
    assert.deepEqual(result['block-one'].changedFields, ['narration']);
    assert.equal(result['block-new'].status, 'added');
    assert.equal(result['block-two'].status, 'removed');
  });

  test('content keeps only the fields it knows', () => {
    const outline = normalizeContent('OUTLINE', { sections: { learningObjectives: 'Measure', injected: '<script>' }, extra: 1 });
    assert.deepEqual(Object.keys(outline), ['sections']);
    assert.equal(outline.sections.learningObjectives, 'Measure');
    assert.equal('injected' in outline.sections, false);
    assert.equal(contentHasText('OUTLINE', outline), true);
    assert.equal(contentHasText('SCRIPT', { blocks: [{ id: 'abcdef', narration: '  ' }] }), false);
    assert.equal(sameContent('OUTLINE', { sections: { keyTopics: 'a' } }, { sections: { keyTopics: 'a' }, noise: true }), true);
  });
});

describe('lesson import', () => {
  test('a pasted syllabus becomes lessons, numbering stripped', () => {
    assert.deepEqual(parseLessonList('01 - Introduction\n2. Maintenance Strategy\n\n• Maintenance KPIs\n5S Methodology'), [
      { name: 'Introduction', moduleName: null },
      { name: 'Maintenance Strategy', moduleName: null },
      { name: 'Maintenance KPIs', moduleName: null },
      { name: '5S Methodology', moduleName: null },
    ]);
  });

  test('a CSV or spreadsheet paste keeps its module column', () => {
    assert.deepEqual(parseLessonList('Module,Lesson\nStrategy,"Maintenance KPIs, part 1"\nReliability,Asset Reliability'), [
      { name: 'Maintenance KPIs, part 1', moduleName: 'Strategy' },
      { name: 'Asset Reliability', moduleName: 'Reliability' },
    ]);
    assert.deepEqual(parseLessonList('الوحدة\tالدرس\nالاستراتيجية\tمؤشرات الأداء'), [{ name: 'مؤشرات الأداء', moduleName: 'الاستراتيجية' }]);
  });
});

/* ------------------------------------------------------------------ */
/* Files and errors                                                     */
/* ------------------------------------------------------------------ */

describe('files', () => {
  const padded = (head) => Buffer.concat([Buffer.from(head), Buffer.alloc(64)]);

  test('the bytes decide the type, not the name', () => {
    assert.equal(detectKind(padded('%PDF-1.7'), 'slides.pdf', 'PPT'), 'pdf');
    const pptx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('....ppt/presentation.xml....')]);
    assert.equal(detectKind(pptx, 'deck.pptx', 'PPT'), 'pptx');
    const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('....word/document.xml........')]);
    assert.equal(detectKind(docx, 'renamed.pptx', 'PPT'), null, 'a Word file renamed to .pptx is not slides');
    assert.equal(detectKind(padded('MZ this is a program'), 'voice.mp3', 'VOICE_OVER'), null);
    assert.equal(detectKind(padded('RIFF\0\0\0\0WAVEfmt '), 'voice.wav', 'VOICE_OVER'), 'wav');
    assert.equal(detectKind(padded('ID3'), 'voice.mp3', 'VOICE_OVER'), 'mp3');
    assert.equal(detectKind(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), padded('ftypmp42')]), 'final.mp4', 'VIDEO'), 'mp4');
    assert.equal(detectKind(Buffer.concat([Buffer.from([0, 0, 0, 0x14]), padded('ftypqt  ')]), 'final.mov', 'VIDEO'), 'mov');
  });

  test('byte ranges for seeking', () => {
    assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
    assert.deepEqual(parseRange('bytes=900-', 1000), { start: 900, end: 999 });
    assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 });
    assert.equal(parseRange('bytes=2000-', 1000), 'invalid');
    assert.equal(parseRange(undefined, 1000), null);
  });
});

describe('errors', () => {
  test('every refusal has the same shape, and an unplanned error is not described', () => {
    const response = toResponse(new DomainError(409, 'ASSET_BLOCKED', 'Waiting for the outline.', { waitingFor: ['OUTLINE'] }));
    assert.deepEqual(response, {
      status: 409,
      body: { error: { code: 'ASSET_BLOCKED', message: 'Waiting for the outline.', details: { waitingFor: ['OUTLINE'] } } },
    });
    assert.equal(toResponse(new Error('relation "learning_assets" does not exist')), null);
  });
});
