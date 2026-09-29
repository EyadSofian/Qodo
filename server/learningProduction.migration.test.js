/**
 * E-Learning Production — migrating existing courses into production runs.
 *
 * The database starts at migration 001 with courses written the way the
 * module wrote them before runs existed: lessons, five assets each, approved
 * versions, review decisions, comments and history. Then the application
 * starts, applies 002, and these tests check what the backfill promised:
 *
 *   - every course gets exactly one LEGACY run, labelled as such;
 *   - no version, decision, comment or history row is lost or changed;
 *   - nothing about curriculum, UAT or publication is inferred from approved
 *     assets — a legacy run is "not assessed" for release;
 *   - the old asset workflow keeps working;
 *   - a legacy course can adopt a workflow (nothing marked done for it) or be
 *     revamped from a recorded baseline.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';

import { startTestDatabase } from './projects/testDatabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const documentDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'qodo-learning-migration-'));
process.env.DATA_DIR = documentDirectory;

const database = await startTestDatabase();
const SKIP = database.url ? false : database.reason;
const S = 'qodo_elearning_production';
const ORG = 'lp-legacy';

const users = {
  manager: { id: 'l-mona', name: 'Mona', role: 'manager', organizationId: ORG, email: 'l-mona@test.local', status: 'active', permissions: null },
  maker: { id: 'l-wafa', name: 'Wafa', role: 'member', organizationId: ORG, email: 'l-wafa@test.local', status: 'active', permissions: null },
  checker: { id: 'l-sara', name: 'Sara', role: 'member', organizationId: ORG, email: 'l-sara@test.local', status: 'active', permissions: null },
};

let db;
let store;
let access;
let runs;
let lessons;
let assets;
let releases;
let legacy = {};
let counts = {};

const TYPES = ['OUTLINE', 'PPT', 'SCRIPT', 'VOICE_OVER', 'VIDEO'];

async function seedLegacy(client) {
  const course = async (name) =>
    (
      await client.query(
        `INSERT INTO ${S}.learning_courses (organization_id, name, manager_user_id, created_by) VALUES ($1, $2, $3, $3) RETURNING id`,
        [ORG, name, users.manager.id]
      )
    ).rows[0].id;
  const lesson = async (courseId, name, order) =>
    (
      await client.query(
        `INSERT INTO ${S}.learning_lessons (organization_id, course_id, name, sort_order, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [ORG, courseId, name, order, users.manager.id]
      )
    ).rows[0].id;
  const asset = async (courseId, lessonId, type) =>
    (
      await client.query(
        `INSERT INTO ${S}.learning_assets (organization_id, course_id, lesson_id, asset_type, status, assignee_user_id, reviewer_user_id)
         VALUES ($1, $2, $3, $4, 'ASSIGNED', $5, $6) RETURNING id`,
        [ORG, courseId, lessonId, type, users.maker.id, users.checker.id]
      )
    ).rows[0].id;
  const approve = async (courseId, lessonId, assetId) => {
    const version = (
      await client.query(
        `INSERT INTO ${S}.learning_asset_versions (organization_id, asset_id, version_number, source_kind, external_url, created_by)
         VALUES ($1, $2, 1, 'LINK', 'https://files.example.com/v1', $3) RETURNING id`,
        [ORG, assetId, users.maker.id]
      )
    ).rows[0].id;
    await client.query(
      `INSERT INTO ${S}.learning_asset_approvals (organization_id, asset_id, version_id, submitted_by, reviewer_user_id, decision, reviewed_by, reviewed_at)
       VALUES ($1, $2, $3, $4, $5, 'APPROVED', $5, now())`,
      [ORG, assetId, version, users.maker.id, users.checker.id]
    );
    await client.query(
      `UPDATE ${S}.learning_assets SET status = 'APPROVED', current_version_id = $2, approved_version_id = $2, approved_at = now(), approved_by = $3 WHERE id = $1`,
      [assetId, version, users.checker.id]
    );
    await client.query(
      `INSERT INTO ${S}.learning_comments (organization_id, asset_id, version_id, user_id, body, status, resolved_by, resolved_at)
       VALUES ($1, $2, $3, $4, 'Looks right', 'RESOLVED', $4, now())`,
      [ORG, assetId, version, users.checker.id]
    );
    await client.query(
      `INSERT INTO ${S}.learning_activity_log (organization_id, course_id, lesson_id, asset_id, version_id, actor_user_id, event_type)
       VALUES ($1, $2, $3, $4, $5, $6, 'APPROVED')`,
      [ORG, courseId, lessonId, assetId, version, users.checker.id]
    );
  };

  // Course A: one lesson fully approved, one untouched.
  const courseA = await course('Legacy Welding');
  const doneLesson = await lesson(courseA, 'Safety', 0);
  const openLesson = await lesson(courseA, 'Joints', 1);
  const doneAssets = {};
  for (const type of TYPES) {
    doneAssets[type] = await asset(courseA, doneLesson, type);
    await approve(courseA, doneLesson, doneAssets[type]);
  }
  const openAssets = {};
  for (const type of TYPES) openAssets[type] = await asset(courseA, openLesson, type);

  // Course B: fully approved, to be revamped from a recorded baseline.
  const courseB = await course('Legacy Boilers');
  const lessonB = await lesson(courseB, 'Water chemistry', 0);
  for (const type of TYPES) await approve(courseB, lessonB, await asset(courseB, lessonB, type));

  return { courseA, courseB, doneLesson, openLesson, doneAssets, openAssets, lessonB };
}

before(async () => {
  if (SKIP) return;
  process.env.DATABASE_URL = database.url;

  // Build the pre-runs database by hand: migration 001 only, recorded as applied.
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: database.url });
  await client.connect();
  await client.query(`DROP SCHEMA IF EXISTS ${S} CASCADE`);
  await client.query(`CREATE SCHEMA ${S}`);
  await client.query(`CREATE TABLE ${S}.schema_migrations (filename text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const foundation = await fs.readFile(path.join(__dirname, 'learningProduction', 'migrations', '001_foundation.sql'), 'utf8');
  await client.query('BEGIN');
  await client.query(foundation);
  await client.query(`INSERT INTO ${S}.schema_migrations VALUES ('001_foundation.sql', $1)`, [
    crypto.createHash('sha256').update(foundation).digest('hex'),
  ]);
  await client.query('COMMIT');
  legacy = await seedLegacy(client);
  for (const table of ['learning_asset_versions', 'learning_asset_approvals', 'learning_comments', 'learning_activity_log', 'learning_assets']) {
    counts[table] = (await client.query(`SELECT count(*)::int AS n FROM ${S}.${table}`)).rows[0].n;
  }
  await client.end();

  // Now the application starts and migrates.
  db = await import('./learningProduction/db.js');
  store = await import('./store.js');
  access = await import('./learningProduction/access.js');
  runs = await import('./learningProduction/services/runService.js');
  lessons = await import('./learningProduction/services/lessonService.js');
  assets = await import('./learningProduction/services/assetService.js');
  releases = await import('./learningProduction/services/releaseService.js');
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

describe('legacy courses after migration 002', { skip: SKIP }, () => {
  test('every existing course gets exactly one legacy run, recorded in its history', async () => {
    const found = await db.rows(`SELECT course_id, scenario, status, is_legacy, run_number, template_version_id FROM ${S}.learning_production_runs`);
    assert.equal(found.length, 2);
    assert.ok(found.every((run) => run.scenario === 'LEGACY' && run.is_legacy && run.run_number === 1 && run.status === 'ACTIVE' && !run.template_version_id));
    const events = await db.rows(`SELECT metadata_json FROM ${S}.learning_activity_log WHERE event_type = 'RUN_CREATED'`);
    assert.equal(events.length, 2);
    assert.ok(events.every((event) => event.metadata_json.backfill === true));
  });

  test('no version, decision, comment, asset or history row was lost or changed', async () => {
    for (const [table, before] of Object.entries(counts)) {
      const now = (await db.row(`SELECT count(*)::int AS n FROM ${S}.${table}`)).n;
      if (table === 'learning_activity_log') assert.equal(now, before + 2, 'only the two backfill entries were added');
      else assert.equal(now, before, table);
    }
    const all = await db.rows(`SELECT applicable FROM ${S}.learning_assets`);
    assert.ok(all.every((row) => row.applicable), 'every existing asset stays applicable');
    const decisions = await db.rows(`SELECT decision FROM ${S}.learning_asset_approvals`);
    assert.ok(decisions.every((row) => row.decision === 'APPROVED'));
  });

  test('a legacy run claims nothing: no stages, and release readiness is not assessed', async () => {
    const list = await runs.listRuns(actor('manager'), legacy.courseA);
    assert.equal(list.runs.length, 1);
    const view = await runs.getRun(actor('manager'), list.currentRunId);
    assert.equal(view.run.scenario, 'LEGACY');
    assert.deepEqual(view.stages, []);
    assert.equal(view.progress.content.percent, 50, 'five of ten assets approved');
    assert.equal(view.progress.readiness.assessed, false);
    assert.equal(view.progress.readiness.readyToPublish, false);
    assert.equal(view.progress.published, null);
    const matrix = await lessons.productionMatrix(actor('manager'), legacy.courseA);
    assert.equal(matrix.lessons.length, 2);
    assert.ok(matrix.lessons.every((lesson) => Object.keys(lesson.assets).length === 5));
  });

  test('the old asset workflow still works on a legacy course', async () => {
    const outline = legacy.openAssets.OUTLINE;
    await assets.start(actor('maker'), outline);
    await assets.saveDraft(actor('maker'), outline, { content: { sections: { learningObjectives: 'Weld safely' } }, revision: 0 });
    await assets.submit(actor('maker'), outline, {});
    const approved = await assets.approve(actor('checker'), outline, {});
    assert.equal(approved.asset.status, 'APPROVED');
    const created = await lessons.createLessons(actor('manager'), legacy.courseA, { items: [{ name: 'Inspection' }] });
    const lesson = await lessons.getLesson(actor('manager'), created.lessons[0].id);
    assert.equal(lesson.assets.length, 5, 'a legacy course keeps giving lessons all five assets');
  });

  test('adopting a workflow marks nothing done that was not done: gates read the real assets, the rest waits for evidence', async () => {
    const list = await runs.listRuns(actor('manager'), legacy.courseA);
    const adopted = await runs.adoptTemplate(actor('manager'), list.currentRunId, { scenario: 'EXPERT_NEW' });
    assert.equal(adopted.run.scenario, 'EXPERT_NEW');
    assert.equal(adopted.run.isLegacy, true);
    assert.equal(adopted.stages[0].key, 'RESEARCH');
    assert.equal(adopted.stages[0].status, 'READY');
    const allTasks = adopted.stages.flatMap((stage) => stage.tasks);
    assert.ok(allTasks.filter((task) => task.kind !== 'AUTO').every((task) => task.status === 'NOT_STARTED'), 'no curriculum, deployment or UAT task is presumed');
    const media = adopted.stages.find((stage) => stage.key === 'MEDIA_PRODUCTION');
    assert.equal(media.status, 'BLOCKED');
    assert.equal(media.tasks[0].status, 'NOT_STARTED', 'the gate waits for its stage, whatever the assets say');
    assert.equal(adopted.progress.readiness.readyForSignoff, false);
  });

  test('a legacy course can be revamped from a baseline recorded as recorded — not as verified', async () => {
    const legacyRun = (await runs.listRuns(actor('manager'), legacy.courseB)).currentRunId;
    const created = await runs.createRun(actor('manager'), { scenario: 'REVAMP', courseId: legacy.courseB, baseline: 'CURRENT_CONTENT' });
    assert.equal(created.run.runNumber, 2);
    const closed = await db.row(`SELECT status, close_reason FROM ${S}.learning_production_runs WHERE id = $1`, [legacyRun]);
    assert.equal(closed.status, 'CLOSED');
    assert.match(closed.close_reason, /Superseded by run #2/);

    const history = await releases.listReleases(actor('manager'), legacy.courseB);
    assert.equal(history.releases.length, 1);
    const baseline = history.releases[0];
    assert.equal(baseline.kind, 'LEGACY_BASELINE');
    assert.match(baseline.deploymentNotes, /not tracked in this system/);
    assert.equal(baseline.signoffAt, null, 'a baseline is never presented as signed off');
    assert.equal(history.currentReleaseId, baseline.id);
    const detail = await releases.getRelease(actor('manager'), baseline.id);
    assert.equal(detail.release.snapshot.lessons[0].assets.filter((asset) => asset.approvedVersionId).length, 5);
  });
});
