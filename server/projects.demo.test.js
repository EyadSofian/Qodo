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
// The expected project count comes from the blueprint rather than from a
// literal in this file. It was a literal, and adding two projects to the demo
// failed four assertions that had no opinion about those projects — the number
// is a property of the content, and only the content should get to change it.
import { PROJECTS } from './projects/demoBlueprint.js';

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
    assert.equal(result.created.length, PROJECTS.length);

    // Every project the blueprint describes, by name. Named rather than
    // counted, because a load that created the right *number* of projects out
    // of the wrong halves of the blueprint would pass a count.
    const names = result.created.map((project) => project.name);
    for (const blueprint of PROJECTS) {
      assert.ok(names.includes(blueprint.name), `the load did not create ${blueprint.name}`);
    }

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

  /**
   * The projects list has five tabs and the demo has to answer all five.
   *
   * Active, Mine and Favorites were always populated because every demo project
   * was live. Archived and Recycle bin were not, and an empty tab is the one
   * outcome this whole feature exists to prevent: a reader who clicks Archived
   * to find out what archiving looks like learns nothing from an empty state.
   *
   * Asserted through `projectService.list` with the scopes the interface
   * actually sends, rather than by reading `archived_at` directly — the columns
   * being set is not the claim; the tab having rows in it is.
   */
  test('every scope tab in the projects list has something in it', async () => {
    const scopes = ['active', 'archived', 'trashed'];
    for (const scope of scopes) {
      const { projects } = await projectService.list(admin, { scope, limit: 50 });
      assert.ok(projects.length > 0, `the "${scope}" tab of the projects list is empty`);
    }

    // Archived and trashed are different states, not two names for one. A
    // project in the bin must not also be counted as archived, or "restore"
    // and "unarchive" become the same button.
    const { projects: archived } = await projectService.list(admin, { scope: 'archived', limit: 50 });
    const { projects: trashed } = await projectService.list(admin, { scope: 'trashed', limit: 50 });
    const archivedIds = new Set(archived.map((project) => project.id));
    for (const project of trashed) {
      assert.ok(!archivedIds.has(project.id), 'a trashed project is also being listed as archived');
    }

    // And neither of them leaks into the active list, which is the tab
    // everybody lands on.
    const { projects: active } = await projectService.list(admin, { scope: 'active', limit: 50 });
    const activeIds = new Set(active.map((project) => project.id));
    for (const project of [...archived, ...trashed]) {
      assert.ok(!activeIds.has(project.id), `${project.name} is closed but still on the active list`);
    }
  });

  /**
   * "My projects" has to be a filter, not a second copy of "Active".
   *
   * The loader creates every project under one administrator, and creating a
   * project makes you a manager of it — so without intervention that
   * administrator is on all of them and the tab filters nothing. It also must
   * not swing the other way into an empty tab, which is the failure this whole
   * feature exists to prevent.
   */
  test('the loading administrator is on some demo projects, not all and not none', async () => {
    const { projects: active } = await projectService.list(admin, { scope: 'active', limit: 50 });
    const { projects: mine } = await projectService.list(admin, {
      scope: 'active',
      memberOf: admin.id,
      limit: 50,
    });

    assert.ok(mine.length > 0, 'the "My projects" tab is empty for the person who loaded the demo');
    assert.ok(
      mine.length < active.length,
      '"My projects" returned every active project — the tab is a duplicate of "Active"'
    );

    // And the projects they are not on are still visible to them, because an
    // administrator sees the whole organization. Dropping the membership must
    // not have hidden anything.
    assert.equal(active.length, PROJECTS.filter((p) => !p.lifecycle).length);
  });

  /**
   * The project that has not started is the one most likely to render as
   * broken, because "nothing has happened yet" and "this screen is empty" look
   * identical. Its tasks are legitimately untouched; its planning artefacts are
   * not, and those are what keep the Documents, Issues and Gantt tabs legible.
   */
  test('the not-started project still has its planning artefacts', async () => {
    const { projects } = await projectService.list(admin, { scope: 'active', limit: 50 });
    const website = projects.find((project) => project.name === 'إعادة تصميم موقع الشركة');
    assert.ok(website, 'the not-started project is missing from the demo');

    for (const [table, label] of [
      ['document_files', 'Documents'],
      ['issues', 'Issues'],
      ['project_baselines', 'the Gantt baseline overlay'],
    ]) {
      const found = await db.row(
        `SELECT count(*)::int AS n FROM qodo_projects.${table} WHERE project_id = $1`,
        [website.id]
      );
      assert.ok(found.n > 0, `${label} is empty on the project that has not started yet`);
    }

    // But it genuinely has no logged time — that emptiness is the point of
    // this project, and filling it would be a lie about work nobody has done.
    const hours = await db.row(
      'SELECT count(*)::int AS n FROM qodo_projects.time_entries WHERE project_id = $1',
      [website.id]
    );
    assert.equal(hours.n, 0, 'the not-started project has hours logged against it');
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

  test('a second load changes nothing', async () => {
    // Idempotency, and the specific thing it protects: clicking the button
    // twice because the first toast was missed must not produce twelve demo
    // staff and ten projects.
    const before = await db.row(
      `SELECT (SELECT count(*)::int FROM qodo_projects.projects WHERE organization_id = $1) AS projects,
              (SELECT count(*)::int FROM qodo_projects.customers WHERE organization_id = $1) AS customers,
              (SELECT count(*)::int FROM qodo_projects.demo_seeds WHERE organization_id = $1) AS seeds`,
      [ORG_A]
    );

    const again = await demo.load(admin);
    assert.equal(again.alreadyLoaded, true);
    assert.equal(again.created.length, 0, 'a second load created projects');

    const after = await db.row(
      `SELECT (SELECT count(*)::int FROM qodo_projects.projects WHERE organization_id = $1) AS projects,
              (SELECT count(*)::int FROM qodo_projects.customers WHERE organization_id = $1) AS customers,
              (SELECT count(*)::int FROM qodo_projects.demo_seeds WHERE organization_id = $1) AS seeds`,
      [ORG_A]
    );
    assert.deepEqual(after, before, 'a second load changed the row counts');

    // And the demo staff were not duplicated in the workspace store either.
    const people = (await store.all('users')).filter((person) => person.isDemo === true);
    assert.equal(people.length, 8);
  });
});

/* ------------------------------------------------------------------ */
/* Coverage — every screen has something on it                          */
/* ------------------------------------------------------------------ */

describe('the demo fills the screens it is meant to fill', { skip: SKIP }, () => {
  test('timesheets exist in more than one state', async () => {
    // A demo where every week is approved shows the approval queue switched
    // off: the "submitted" filter returns nothing and nobody can tell that a
    // rejection carries a reason.
    const states = await db.rows(
      `SELECT status, count(*)::int AS n FROM qodo_projects.timesheets
        WHERE organization_id = $1 GROUP BY status ORDER BY status`,
      [ORG_A]
    );
    const byStatus = new Map(states.map((row) => [row.status, row.n]));

    assert.ok((byStatus.get('approved') ?? 0) > 0, 'no approved timesheet');
    assert.ok((byStatus.get('submitted') ?? 0) > 0, 'nothing waiting for approval');
    assert.ok(byStatus.size >= 2, `only one timesheet state: ${JSON.stringify(states)}`);
  });

  test('the settings tabs are configured rather than empty', async () => {
    const counts = await db.row(
      `SELECT
         (SELECT count(*)::int FROM qodo_projects.workflow_rules  WHERE organization_id = $1) AS workflow,
         (SELECT count(*)::int FROM qodo_projects.business_rules  WHERE organization_id = $1) AS business,
         (SELECT count(*)::int FROM qodo_projects.automation_runs WHERE organization_id = $1) AS runs,
         (SELECT count(*)::int FROM qodo_projects.webhook_endpoints WHERE organization_id = $1) AS webhooks,
         (SELECT count(*)::int FROM qodo_projects.webhook_deliveries WHERE organization_id = $1) AS deliveries,
         (SELECT count(*)::int FROM qodo_projects.integration_connections WHERE organization_id = $1) AS integrations,
         (SELECT count(*)::int FROM qodo_projects.saved_reports  WHERE organization_id = $1) AS reports,
         (SELECT count(*)::int FROM qodo_projects.custom_views    WHERE organization_id = $1) AS views,
         (SELECT count(*)::int FROM qodo_projects.sla_policies    WHERE organization_id = $1) AS sla,
         (SELECT count(*)::int FROM qodo_projects.project_baselines WHERE organization_id = $1) AS baselines,
         (SELECT count(*)::int FROM qodo_projects.tags            WHERE organization_id = $1) AS tags,
         (SELECT count(*)::int FROM qodo_projects.work_calendars  WHERE organization_id = $1) AS calendars`,
      [ORG_A]
    );

    for (const [name, n] of Object.entries(counts)) {
      assert.ok(Number(n) > 0, `${name} is empty after a demo load — that tab would show nothing`);
    }
  });

  test('a run log that contains a failure as well as a success', async () => {
    // The error column is the one people come to this screen to read, and a
    // log where everything succeeded hides it.
    const statuses = await db.rows(
      `SELECT DISTINCT status FROM qodo_projects.automation_runs WHERE organization_id = $1`,
      [ORG_A]
    );
    const set = new Set(statuses.map((row) => row.status));
    assert.ok(set.has('applied'));
    assert.ok(set.has('failed') || set.has('skipped'), 'every automation run succeeded');
  });

  test('no integration claims to be connected, and none carries a credential', async () => {
    // §68: an adapter must never be presented as operational without a real
    // credential. A demo is exactly where that rule is most tempting to break.
    const rows = await db.rows(
      `SELECT provider, status, credentials FROM qodo_projects.integration_connections
        WHERE organization_id = $1`,
      [ORG_A]
    );
    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.equal(row.status, 'not_configured', `${row.provider} claims to be ${row.status}`);
      assert.equal(row.credentials, null, `${row.provider} carries a stored credential`);
    }
  });

  test('no webhook is active, and none points at a resolvable host', async () => {
    // Two independent reasons no request can leave the building. One would do;
    // two means a change to either alone cannot start sending traffic.
    const rows = await db.rows(
      'SELECT name, url, is_active FROM qodo_projects.webhook_endpoints WHERE organization_id = $1',
      [ORG_A]
    );
    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.equal(row.is_active, false, `${row.name} is active and would be delivered to`);
      assert.match(row.url, /\.invalid(\/|$)/, `${row.name} points at a host that could resolve`);
    }
  });

  test('the client contact is a client, not staff', async () => {
    // The client boundary is the module's hardest rule, and a demo without a
    // client cannot show that it exists.
    const client = await db.row(
      `SELECT m.user_id, m.is_client FROM qodo_projects.project_members m
        WHERE m.organization_id = $1 AND m.role = 'client' LIMIT 1`,
      [ORG_A]
    );
    assert.ok(client, 'the demo has no client member');
    assert.equal(client.is_client, true);

    // And they have no cost rate — a client is not somebody whose hours the
    // company pays for, and inventing one would put them in every cost report.
    const rate = await db.row(
      'SELECT 1 FROM qodo_projects.cost_rates WHERE organization_id = $1 AND user_id = $2',
      [ORG_A, client.user_id]
    );
    assert.equal(rate, null, 'the client contact was given a cost rate');
  });
});

/* ------------------------------------------------------------------ */
/* The accounts                                                         */
/* ------------------------------------------------------------------ */

describe('the demo accounts', { skip: SKIP }, () => {
  test('cannot be signed into', async () => {
    const people = (await store.all('users')).filter((person) => person.isDemo === true);
    assert.equal(people.length, 8);

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
    assert.equal(mine.batch.liveProjects, PROJECTS.length);
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
    assert.equal(result.removed.people, 8);
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

/* ------------------------------------------------------------------ */
/* Reset                                                                */
/* ------------------------------------------------------------------ */

describe('resetting the demo data', { skip: SKIP }, () => {
  test('reset rebuilds the demo without touching real work', async () => {
    // The point of the test: a real project and a real user created *alongside*
    // the demo must survive a reset untouched. Reset is unload-then-load, and
    // unload is the destructive half — if it ever widened from the manifest to
    // a pattern, this is the assertion that would catch it.
    const realProject = await projectService.create(admin, {
      name: 'مشروع حقيقي لا يجب أن يُمس',
      key: 'KEEP',
    });
    const realUser = await store.insert('users', {
      id: 'u-real-keep',
      name: 'موظّفة حقيقية',
      email: 'keep@engosoft.com',
      organizationId: ORG_A,
      status: 'active',
      role: 'member',
      department: 'general',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await demo.load(admin);
    const first = await demo.status(admin);

    const result = await demo.reset(admin);

    assert.ok(result.batchId, 'reset produced no new batch');
    assert.notEqual(result.batchId, first.batch.id, 'reset reused the old batch id');
    assert.equal(result.created.length, PROJECTS.length, 'reset did not rebuild every project');
    assert.ok(result.removed.projects >= PROJECTS.length, 'reset removed nothing');

    // The real work is still there, by id, not by count.
    const survivor = await db.row(
      'SELECT name FROM qodo_projects.projects WHERE id = $1 AND deleted_at IS NULL',
      [realProject.id]
    );
    assert.ok(survivor, 'reset deleted a real project');
    assert.equal(survivor.name, 'مشروع حقيقي لا يجب أن يُمس');

    assert.ok(await store.get('users', realUser.id), 'reset deleted a real user account');

    // And exactly one batch exists afterwards — a reset that left the old
    // manifest behind would make the next unload think there is more to remove.
    const batches = await db.rows(
      'SELECT DISTINCT batch_id FROM qodo_projects.demo_seeds WHERE organization_id = $1',
      [ORG_A]
    );
    assert.equal(batches.length, 1);
  });

  test('reset is safe to run when nothing is loaded', async () => {
    await demo.unload(admin);
    const result = await demo.reset(admin);
    assert.equal(result.created.length, PROJECTS.length);
    assert.equal(result.removed.projects, 0, 'reset reported removing projects that were not there');

    // Leave the database clean for anything that runs after this file.
    await demo.unload(admin);
  });
});
