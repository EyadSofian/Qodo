/**
 * Qodo Projects — the demo data, and the promises made about it.
 *
 * The demo loader writes a few hundred rows into the same tables as real work.
 * Everything worth testing here is about the blast radius of that, not about
 * whether the fixture looks nice:
 *
 *   • it removes exactly what it created, and nothing that it did not;
 *   • the accounts it creates cannot be signed into;
 *   • it is invisible and unremovable from another organization;
 *   • it never runs except when somebody with both keys asks it to.
 *
 * These need a real PostgreSQL for the same reason the rest of the Projects
 * suite does — cascades, constraints and the append-only audit trigger are
 * database behaviour, and an emulator that skips them would report a pass on a
 * loader that leaves orphans behind.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { startTestDatabase } from './projects/testDatabase.js';

/**
 * Task documents live in the workspace store, so a demo load would otherwise
 * write into ./data/workspace.json — the developer's own dev data. This has to
 * happen before anything imports store.js.
 */
const documentDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'qodo-demo-docs-'));
process.env.DATA_DIR = documentDirectory;

const database = await startTestDatabase();
const SKIP = database.url ? false : database.reason;

let db;
let demo;
let store;
let projectService;
let access;
let metadata;
let budgetService;
let verifyPassword;
let isActiveUser;

const ORG_A = 'demo-org-a';
const ORG_B = 'demo-org-b';

/** The only person who may load the demo: workspace admin *and* Projects admin. */
const admin = {
  id: 'u-admin',
  role: 'admin',
  organizationId: ORG_A,
  name: 'Administrator',
  department: 'general',
};

/** A workspace admin in the other organization, used to try to reach across. */
const otherAdmin = {
  id: 'u-other-admin',
  role: 'admin',
  organizationId: ORG_B,
  name: 'Other Administrator',
  department: 'general',
};

before(async () => {
  if (SKIP) return;
  process.env.DATABASE_URL = database.url;

  db = await import('./projects/db.js');
  demo = await import('./projects/demoDataService.js');
  projectService = await import('./projects/projectService.js');
  access = await import('./projects/projectAccess.js');
  metadata = await import('./projects/metadataService.js');
  budgetService = await import('./projects/budgetService.js');
  ({ verifyPassword } = await import('./auth.js'));
  ({ isActiveUser } = await import('../shared/permissions.js'));
  store = await (await import('./store.js')).getStore();

  await db.init();
  await db.query('DROP SCHEMA IF EXISTS qodo_projects CASCADE');
  await db.close();
  await db.init();

  await metadata.ensureDefaults(ORG_A);
  await metadata.ensureDefaults(ORG_B);
});

after(async () => {
  if (db) await db.close();
  await store?.pool?.end?.().catch(() => {});
  await database.stop?.();
  await fs.rm(documentDirectory, { recursive: true, force: true }).catch(() => {});
});

/* ------------------------------------------------------------------ */
/* Loading                                                              */
/* ------------------------------------------------------------------ */

describe('loading the demo data', { skip: SKIP }, () => {
  test('nothing is loaded until somebody asks', async () => {
    const before = await demo.status(admin);
    assert.equal(before.loaded, false, 'a fresh database reported demo data it was never given');
    assert.equal(before.batch, null);
    // And it can say what a load would create, before creating any of it.
    assert.ok(before.willCreate.projects >= 3);
  });

  test('a load creates the projects and records every one in the manifest', async () => {
    const result = await demo.load(admin);

    assert.ok(result.batchId, 'a load with no batch id cannot be unloaded');
    assert.equal(result.created.length, 4);

    const names = result.created.map((project) => project.name);
    assert.ok(names.includes('إطلاق متجر إلكتروني'));
    assert.ok(names.includes('تطوير تطبيق موبايل'));
    assert.ok(names.includes('حملة تسويق خريفية'));
    assert.ok(names.includes('تحسين موقع الشركة'));

    // Every project that exists is claimed. An unclaimed project is one the
    // unloader would leave behind forever.
    const orphans = await db.rows(
      `SELECT p.id FROM qodo_projects.projects p
        WHERE p.organization_id = $1
          AND NOT EXISTS (SELECT 1 FROM qodo_projects.demo_seeds s
                           WHERE s.entity_type = 'project' AND s.entity_id = p.id::text)`,
      [ORG_A]
    );
    assert.equal(orphans.length, 0, 'a demo project was created without a manifest row');
  });

  test('the demo contains work in every state a reader needs to see', async () => {
    const { projects } = await projectService.list(admin, { scope: 'active', limit: 50 });
    const byName = new Map(projects.map((project) => [project.name, project]));

    // Overdue work exists — the whole point of the troubled project.
    const overdue = await db.row(
      `SELECT count(*)::int AS n
         FROM qodo_projects.project_task_extensions t
         LEFT JOIN qodo_projects.statuses s ON s.id = t.status_id
        WHERE t.organization_id = $1 AND t.deleted_at IS NULL
          AND t.end_date < CURRENT_DATE AND COALESCE(s.category, 'active') <> 'done'`,
      [ORG_A]
    );
    assert.ok(overdue.n > 0, 'no overdue task — the late project would render as healthy');

    // And finished work, so "done" is not an empty state either.
    const done = await db.row(
      `SELECT count(*)::int AS n
         FROM qodo_projects.project_task_extensions t
         JOIN qodo_projects.statuses s ON s.id = t.status_id
        WHERE t.organization_id = $1 AND s.category = 'done'`,
      [ORG_A]
    );
    assert.ok(done.n > 0);

    // Dependencies, or the Gantt has no critical path to draw.
    const dependencies = await db.row(
      'SELECT count(*)::int AS n FROM qodo_projects.task_dependencies WHERE organization_id = $1',
      [ORG_A]
    );
    assert.ok(dependencies.n >= 10, 'too few dependencies for a critical path to be visible');

    assert.ok(byName.has('إطلاق متجر إلكتروني'));
  });

  test('earned value computes rather than reporting itself unavailable', async () => {
    // This is the assertion that catches an unpriced demo: without cost rates
    // frozen onto the time entries, actual cost is null and every finance
    // screen shows "not enough data" — which is exactly what the demo exists
    // to avoid.
    const { projects } = await projectService.list(admin, { scope: 'active', limit: 50 });
    const shop = projects.find((project) => project.name === 'إطلاق متجر إلكتروني');
    const context = await access.contextFor(admin, shop.id);

    const value = await budgetService.earnedValue(context);
    assert.equal(value.available, true, `earned value was unavailable: ${JSON.stringify(value.missing)}`);
    assert.ok(value.actualCost > 0, 'logged hours cost nothing — the rates were never frozen');
    assert.ok(value.plannedValue > 0);
    assert.ok(value.progressPercent > 0);
  });

  test('a second load is refused rather than doubling the data', async () => {
    await assert.rejects(
      () => demo.load(admin),
      (error) => error.body?.error === 'demo_data_already_loaded'
    );
  });
});

/* ------------------------------------------------------------------ */
/* The accounts                                                         */
/* ------------------------------------------------------------------ */

describe('the demo accounts', { skip: SKIP }, () => {
  test('cannot be signed into', async () => {
    const people = (await store.all('users')).filter((person) => person.isDemo === true);
    assert.equal(people.length, 6);

    for (const person of people) {
      assert.equal(isActiveUser(person), false, `${person.name} is active and could sign in`);
      assert.equal(person.passwordHash, null, `${person.name} has a password hash`);

      // The empty-hash comparison is the one that actually runs at the login
      // route, so it is the one worth asserting rather than trusting.
      assert.equal(await verifyPassword('', person.passwordHash), false);
      assert.equal(await verifyPassword('password', person.passwordHash), false);
    }
  });

  test('use an address that can never be delivered to', async () => {
    const people = (await store.all('users')).filter((person) => person.isDemo === true);
    for (const person of people) {
      assert.match(person.email, /@demo\.qodo\.invalid$/);
    }
  });

  test('are kept out of the member picker on a real project', async () => {
    // `candidates()` filters to active users, and the demo people are inactive.
    // Without that, every real project's "add member" list would be padded with
    // six people who do not work here.
    const real = await projectService.create(admin, { name: 'مشروع حقيقي', key: 'REAL' });
    const context = await access.contextFor(admin, real.id);
    const candidates = await projectService.candidates(context);

    const demoNames = candidates.filter((person) => String(person.email).endsWith('demo.qodo.invalid'));
    assert.equal(demoNames.length, 0, 'demo staff appeared in a real project’s member picker');
  });
});

/* ------------------------------------------------------------------ */
/* Isolation                                                            */
/* ------------------------------------------------------------------ */

describe('demo data is confined to the organization that loaded it', { skip: SKIP }, () => {
  test('another organization sees none of it', async () => {
    const theirs = await demo.status(otherAdmin);
    assert.equal(theirs.loaded, false, 'organization B could see organization A’s demo batch');

    const { projects, total } = await projectService.list(otherAdmin, { scope: 'active', limit: 50 });
    assert.equal(total, 0);
    assert.equal(projects.length, 0);
  });

  test('another organization cannot unload it', async () => {
    const result = await demo.unload(otherAdmin);
    assert.deepEqual(result.removed, { projects: 0, customers: 0, groups: 0, people: 0, tasks: 0 });

    // And organization A still has everything.
    const mine = await demo.status(admin);
    assert.equal(mine.loaded, true, 'organization B’s unload removed organization A’s data');
    assert.equal(mine.batch.liveProjects, 4);
  });
});

/* ------------------------------------------------------------------ */
/* Unloading                                                            */
/* ------------------------------------------------------------------ */

describe('removing the demo data', { skip: SKIP }, () => {
  test('a user row that is not marked as demo is refused, not deleted', async () => {
    // The manifest could name an account that is not a demo account — a bad
    // restore, a future edit of the blueprint, a mistake. Deleting a real
    // person's login is not a recoverable error, so the second check has to
    // hold even when the manifest is wrong.
    const impostor = await store.insert('users', {
      id: 'u-impostor',
      name: 'موظّف حقيقي',
      email: 'real.person@engosoft.com',
      organizationId: ORG_A,
      status: 'active',
      role: 'member',
      department: 'general',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const { batch } = await demo.status(admin);
    await db.query(
      `INSERT INTO qodo_projects.demo_seeds (organization_id, batch_id, entity_type, entity_id, created_by)
       VALUES ($1,$2,'user',$3,$4)`,
      [ORG_A, batch.id, impostor.id, admin.id]
    );

    const result = await demo.unload(admin);

    assert.ok(
      result.skipped.some((row) => row.entityId === 'u-impostor' && row.reason === 'not_marked_demo'),
      'the unloader did not report refusing the unmarked account'
    );
    assert.ok(await store.get('users', 'u-impostor'), 'the unloader deleted a real employee’s account');

    // The six real demo accounts still went.
    assert.equal(result.removed.people, 6);
  });

  test('every trace of the demo is gone', async () => {
    const after = await demo.status(admin);
    assert.equal(after.loaded, false);

    const leftovers = await db.row(
      `SELECT
         (SELECT count(*)::int FROM qodo_projects.projects       WHERE organization_id = $1 AND key <> 'REAL') AS projects,
         (SELECT count(*)::int FROM qodo_projects.customers      WHERE organization_id = $1) AS customers,
         (SELECT count(*)::int FROM qodo_projects.project_groups WHERE organization_id = $1) AS groups,
         (SELECT count(*)::int FROM qodo_projects.demo_seeds     WHERE organization_id = $1) AS seeds,
         (SELECT count(*)::int FROM qodo_projects.cost_rates     WHERE organization_id = $1) AS cost_rates,
         (SELECT count(*)::int FROM qodo_projects.time_entries   WHERE organization_id = $1) AS time_entries,
         (SELECT count(*)::int FROM qodo_projects.issues         WHERE organization_id = $1) AS issues`,
      [ORG_A]
    );

    assert.deepEqual(leftovers, {
      projects: 0,
      customers: 0,
      groups: 0,
      seeds: 0,
      cost_rates: 0,
      time_entries: 0,
      issues: 0,
    });

    const demoPeople = (await store.all('users')).filter((person) => person.isDemo === true);
    assert.equal(demoPeople.length, 0, 'demo accounts survived the unload');
  });

  test('the task documents went with the projects', async () => {
    // A project task is a workspace task (ADR-3). Deleting the project cascades
    // the extension row but not the document, and a document with no extension
    // is a task that appears in My Work forever with no project behind it.
    const orphans = (await store.all('tasks')).filter((task) => task.source === 'project');
    assert.equal(orphans.length, 0, `${orphans.length} project task documents were left behind`);
  });

  test('the real project created alongside the demo is untouched', async () => {
    const { projects } = await projectService.list(admin, { scope: 'active', limit: 50 });
    assert.equal(projects.length, 1);
    assert.equal(projects[0].name, 'مشروع حقيقي');
  });

  test('unloading again is a no-op rather than an error', async () => {
    const result = await demo.unload(admin);
    assert.equal(result.removed.projects, 0);
    assert.equal(result.skipped.length, 0);
  });
});

/* ------------------------------------------------------------------ */
/* The audit trail                                                      */
/* ------------------------------------------------------------------ */

describe('the audit trail', { skip: SKIP }, () => {
  test('records the load and the removal, without leaking anything', async () => {
    const events = await db.rows(
      `SELECT action, after_state, before_state FROM qodo_projects.audit_events
        WHERE organization_id = $1 AND entity_type = 'demo_data' ORDER BY occurred_at`,
      [ORG_A]
    );

    assert.ok(events.some((event) => event.action === 'demo.load'));
    assert.ok(events.some((event) => event.action === 'demo.unload'));

    // Nothing in these rows should carry a credential, an address or anything
    // else a person reading the audit log has no business seeing.
    const serialised = JSON.stringify(events);
    assert.ok(!/passwordHash|password|secret|token/i.test(serialised), serialised);
  });
});
