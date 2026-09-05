/**
 * Qodo Projects — the database-backed half.
 *
 * These are the tests that cannot be faked in memory: tenant isolation, the
 * client boundary, the append-only guarantee, the soft-delete round trip and
 * the work breakdown. What they check *is* PostgreSQL behaviour — a trigger
 * that refuses UPDATE proves nothing against an emulator that does not run
 * triggers — so they need a real server.
 *
 * `startTestDatabase` finds one: an external `PROJECTS_TEST_DATABASE_URL` if
 * somebody has set one up, otherwise an embedded PostgreSQL from the dev
 * dependencies, otherwise nothing — and then every suite skips with the reason
 * attached, naming the guarantees that went unverified. A green run that
 * silently skipped the client-boundary tests is worse than a red one.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { startTestDatabase } from './projects/testDatabase.js';
import { getStore } from './store.js';

/* ------------------------------------------------------------------ */
/* Bootstrap                                                            */
/* ------------------------------------------------------------------ */

/**
 * Task *documents* live in the workspace store, so a test that creates a
 * project task would write into ./data/workspace.json — the developer's own
 * dev data. Pointing DATA_DIR at a temporary directory before anything imports
 * `store.js` is what keeps a test run from editing somebody's workspace.
 */
const documentDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'qodo-projects-docs-'));
process.env.DATA_DIR = documentDirectory;

const database = await startTestDatabase();
const SKIP = database.url ? false : database.reason;

let db;
let projects;
let access;
let audit;
let phases;
let taskLists;
let tasks;
let scheduleService;
let issues;
let slaService;
let metadata;
let timeService;
let budgetService;
let collaboration;
let documents;
let automation;
let blueprint;
let reportService;
let dashboardService;
let aiService;

/** Two organizations, so every read can be tried from the wrong one. */
const ORG_A = 'test-org-a';
const ORG_B = 'test-org-b';

const alice = { id: 'u-alice', role: 'manager', organizationId: ORG_A, name: 'Alice', department: 'general' };
const bob = { id: 'u-bob', role: 'member', organizationId: ORG_A, name: 'Bob', department: 'general' };
const mallory = { id: 'u-mallory', role: 'admin', organizationId: ORG_B, name: 'Mallory', department: 'general' };
const customer = { id: 'u-customer', role: 'member', organizationId: ORG_A, name: 'Customer', department: 'general' };

before(async () => {
  if (SKIP) return;
  process.env.DATABASE_URL = database.url;

  db = await import('./projects/db.js');
  projects = await import('./projects/projectService.js');
  access = await import('./projects/projectAccess.js');
  audit = await import('./projects/auditService.js');
  phases = await import('./projects/phaseService.js');
  taskLists = await import('./projects/taskListService.js');
  tasks = await import('./projects/taskService.js');
  scheduleService = await import('./projects/scheduleService.js');
  issues = await import('./projects/issueService.js');
  slaService = await import('./projects/slaService.js');
  metadata = await import('./projects/metadataService.js');
  timeService = await import('./projects/timeService.js');
  budgetService = await import('./projects/budgetService.js');
  collaboration = await import('./projects/collaborationService.js');
  documents = await import('./projects/documentService.js');
  automation = await import('./projects/automationService.js');
  blueprint = await import('./projects/blueprintService.js');
  reportService = await import('./projects/reportService.js');
  dashboardService = await import('./projects/dashboardService.js');
  aiService = await import('./projects/aiService.js');

  // A clean schema per run, dropped rather than truncated so a migration added
  // since the last run is actually applied — the migration runner is itself one
  // of the things under test.
  await db.init();
  await db.query('DROP SCHEMA IF EXISTS qodo_projects CASCADE');
  await db.close();
  await db.init();

  // The modules and statuses a real organization gets on first boot. Without
  // them a created task has no status and half the assertions below would be
  // testing an unconfigured product rather than a working one.
  await metadata.ensureDefaults(ORG_A);
  await metadata.ensureDefaults(ORG_B);
});

after(async () => {
  // Every pool closes before the cluster does. A connection still attached
  // when PostgreSQL shuts down produces "terminating connection due to
  // administrator command" on a client nothing is listening to, which Node
  // reports as an uncaught exception and node:test blames on whichever test ran
  // last — a line that fails nothing and hides the next real one.
  if (db) {
    const stats = db.poolStats();
    if (stats && stats.total !== stats.idle) {
      console.error('[projects:test] connections still checked out at teardown:', stats);
    }
    await db.close();
  }
  // The workspace store has a pool of its own, and it is open because these
  // tests set DATABASE_URL — which switches `server/store.js` to PostgreSQL
  // too, so document blobs land in the same database. That is worth having:
  // the blob half is exercised for real. But the pool it opens is not ours to
  // forget, and leaving it attached is what made stopping the cluster produce
  // "terminating connection due to administrator command" on a client with no
  // handler of ours.
  const workspaceStore = await getStore();
  await workspaceStore.pool?.end().catch(() => {});

  await database.stop?.();
  await fs.rm(documentDirectory, { recursive: true, force: true }).catch(() => {});
});

/** A context for a project, as every route would resolve one. */
const contextFor = (user, projectId) => access.contextFor(user, projectId);

/* ------------------------------------------------------------------ */
/* Migrations                                                           */
/* ------------------------------------------------------------------ */

describe('migrations', { skip: SKIP }, () => {
  test('every migration applied and recorded its checksum', async () => {
    const applied = await db.rows(
      'SELECT filename, checksum FROM qodo_projects.schema_migrations ORDER BY filename'
    );
    assert.ok(applied.length >= 3, 'expected at least the three Phase 1–2 migrations');
    for (const row of applied) {
      assert.match(row.checksum, /^[0-9a-f]{64}$/, `${row.filename} has no usable checksum`);
    }
  });

  test('running migrations twice is a no-op', async () => {
    const before = await db.row('SELECT count(*)::int AS n FROM qodo_projects.schema_migrations');
    await db.close();
    await db.init();
    const after = await db.row('SELECT count(*)::int AS n FROM qodo_projects.schema_migrations');
    assert.equal(after.n, before.n);
  });

  test('every Projects table carries an organization boundary', async () => {
    // §70: a table without organization_id cannot be tenant-filtered, so it
    // must not exist. The two exceptions are join tables whose parent already
    // carries it and which are only ever reached through that parent.
    const exempt = new Set(['schema_migrations', 'calendar_holidays', 'task_baselines_exempt']);
    const missing = await db.rows(
      `SELECT c.relname AS table_name
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'qodo_projects' AND c.relkind = 'r'
          AND NOT EXISTS (
            SELECT 1 FROM pg_attribute a
             WHERE a.attrelid = c.oid AND a.attname = 'organization_id' AND a.attnum > 0
          )
        ORDER BY c.relname`
    );
    const unexplained = missing.map((r) => r.table_name).filter((name) => !exempt.has(name));
    assert.deepEqual(unexplained, [], `tables with no organization_id: ${unexplained.join(', ')}`);
  });
});

/* ------------------------------------------------------------------ */
/* Project lifecycle                                                    */
/* ------------------------------------------------------------------ */

describe('project lifecycle', { skip: SKIP }, () => {
  let project;

  test('creating a project makes its owner a member', async () => {
    project = await projects.create(alice, { name: 'Engosoft Tower', description: 'Tower fit-out' });
    assert.equal(project.name, 'Engosoft Tower');
    assert.equal(project.key, 'ET');

    const context = await contextFor(alice, project.id);
    assert.ok(context, 'the creator cannot open the project they just made');
    assert.equal(context.membership.role, 'owner');
  });

  test('the project key is unique within an organization', async () => {
    const second = await projects.create(alice, { name: 'Engosoft Tower' });
    assert.notEqual(second.key, project.key);
    assert.equal(second.key, 'ET1');
  });

  test('an end date before the start date is refused', async () => {
    await assert.rejects(
      () => projects.create(alice, { name: 'Backwards', startDate: '2026-06-01', endDate: '2026-01-01' }),
      (error) => error.body?.error === 'end_before_start'
    );
  });

  test('a project with no name is refused', async () => {
    await assert.rejects(
      () => projects.create(alice, { name: '   ' }),
      (error) => error.body?.error === 'name_required'
    );
  });

  test('archive and unarchive move the project between scopes', async () => {
    await projects.setArchived(await contextFor(alice, project.id), true);

    const active = await projects.list(alice, { scope: 'active' });
    assert.ok(!active.projects.some((p) => p.id === project.id));

    const archived = await projects.list(alice, { scope: 'archived' });
    assert.ok(archived.projects.some((p) => p.id === project.id));

    await projects.setArchived(await contextFor(alice, project.id), false);
    const back = await projects.list(alice, { scope: 'active' });
    assert.ok(back.projects.some((p) => p.id === project.id));
  });

  test('delete is reversible and purge is not', async () => {
    const doomed = await projects.create(alice, { name: 'Cancelled Bid' });
    await projects.softDelete(await contextFor(alice, doomed.id));

    assert.equal(await contextFor(alice, doomed.id), null, 'a deleted project is still resolvable');
    const trashed = await projects.list(alice, { scope: 'trashed' });
    assert.ok(trashed.projects.some((p) => p.id === doomed.id));

    await projects.restore(alice, doomed.id);
    assert.ok(await contextFor(alice, doomed.id));

    await projects.softDelete(await contextFor(alice, doomed.id));
    await projects.purge(alice, doomed.id);
    assert.equal(await projects.restore(alice, doomed.id), null);
  });
});

/* ------------------------------------------------------------------ */
/* Tenant isolation                                                     */
/* ------------------------------------------------------------------ */

describe('tenant isolation', { skip: SKIP }, () => {
  let projectA;

  before(async () => {
    if (SKIP) return;
    projectA = await projects.create(alice, { name: 'Confidential Bid' });
  });

  test('another organization cannot resolve the project at all', async () => {
    // Mallory is an administrator — of a different organization. The whole
    // point of the tenant filter is that this changes nothing.
    assert.equal(await contextFor(mallory, projectA.id), null);
  });

  test('another organization cannot see it in a listing', async () => {
    const listed = await projects.list(mallory, { scope: 'all' });
    assert.ok(!listed.projects.some((p) => p.id === projectA.id));
  });

  test('another organization cannot restore or purge it', async () => {
    assert.equal(await projects.restore(mallory, projectA.id), null);
    assert.equal(await projects.purge(mallory, projectA.id), null);
    assert.ok(await contextFor(alice, projectA.id), 'the project survived from its own side');
  });

  test('a non-member in the same organization cannot resolve a private project', async () => {
    assert.equal(await contextFor(bob, projectA.id), null);
  });

  test('adding the person as a member is what grants access', async () => {
    await projects.addMember(await contextFor(alice, projectA.id), { userId: bob.id, role: 'member' });
    const bobContext = await contextFor(bob, projectA.id);
    assert.ok(bobContext);
    assert.equal(bobContext.membership.role, 'member');
    assert.equal(bobContext.isClient, false);
  });

  test('the member list is shaped for the browser, not raw rows', async () => {
    // Returning the raw row was a real bug: the UI reads `userId`, the row says
    // `user_id`, and the members list rendered a row per person with no name.
    const [member] = await projects.members(await contextFor(alice, projectA.id));
    assert.ok(member.userId, 'a member came back without a userId');
    assert.ok(!('user_id' in member), 'a raw column escaped the service');
    assert.equal(typeof member.isClient, 'boolean');
  });

  test('removing the member takes the access away again', async () => {
    await projects.removeMember(await contextFor(alice, projectA.id), bob.id);
    assert.equal(await contextFor(bob, projectA.id), null);
  });

  test('the owner cannot be removed, because that would orphan the project', async () => {
    // Membership is what makes a project openable, so removing its owner would
    // leave a project with an owner who cannot see it.
    const context = await contextFor(alice, projectA.id);
    await assert.rejects(
      () => projects.removeMember(context, alice.id),
      (error) => error.body?.error === 'owner_cannot_be_removed'
    );
  });
});

/* ------------------------------------------------------------------ */
/* The client boundary                                                  */
/* ------------------------------------------------------------------ */

describe('the client boundary', { skip: SKIP }, () => {
  let project;

  before(async () => {
    if (SKIP) return;
    project = await projects.create(alice, { name: 'Client Facing Job' });
    await projects.addMember(await contextFor(alice, project.id), {
      userId: customer.id,
      role: 'client',
    });
  });

  test('a client member is marked as a client on the way in', async () => {
    const context = await contextFor(customer, project.id);
    assert.equal(context.isClient, true);
    assert.equal(context.membership.role, 'client');
  });

  test('a client cannot be smuggled in as staff by sending isClient false', async () => {
    // The API takes the role and derives the flag; it does not take the flag.
    await projects.addMember(await contextFor(alice, project.id), {
      userId: customer.id,
      role: 'client',
      isClient: false,
    });
    const reread = await contextFor(customer, project.id);
    assert.equal(reread.isClient, true);
  });

  test('a client is refused every write, whatever their permission set says', () => {
    const context = { permissionSet: { id: 'admin' }, membership: { role: 'client', isClient: true } };
    assert.equal(access.may(context, 'project.edit'), false);
    assert.equal(access.may(context, 'budget.view'), false);
    assert.equal(access.may(context, 'time.view'), false);
  });

  /**
   * The regression this suite exists for.
   *
   * `visibleProjectIds` originally read client-ness only from the permission
   * set, so a customer added to a project by role — with no client permission
   * set assigned — was listed every `portal` project in the company. The two
   * locks documented in QODO_PROJECTS_PERMISSIONS.md have to be checked in
   * both places, and this is the one that proves it.
   */
  test('a client sees only projects they were added to, never portal ones', async () => {
    await projects.create(alice, { name: 'Open To Staff', access: 'portal' });
    const visible = await access.visibleProjectIds(customer);
    assert.equal(visible.length, 1, 'the client was shown a project they were never added to');
    assert.equal(visible[0], project.id);
  });

  test('a client cannot see an internal phase or an internal task list', async () => {
    const managerContext = await contextFor(alice, project.id);
    await phases.create(managerContext, { name: 'Internal planning', isExternal: false });
    await phases.create(managerContext, { name: 'Client milestones', isExternal: true });
    await taskLists.create(managerContext, { name: 'Internal notes', isExternal: false });
    await taskLists.create(managerContext, { name: 'Shared deliverables', isExternal: true });

    const clientContext = await contextFor(customer, project.id);
    const visiblePhases = await phases.list(clientContext);
    const visibleLists = await taskLists.list(clientContext);

    assert.deepEqual(visiblePhases.map((p) => p.name), ['Client milestones']);
    assert.deepEqual(visibleLists.map((l) => l.name), ['Shared deliverables']);

    // And the staff side still sees both, so the filter narrowed rather than
    // deleted.
    assert.equal((await phases.list(managerContext)).length, 2);
    assert.equal((await taskLists.list(managerContext)).length, 2);
  });

  test('a client cannot see a task in an internal list', async () => {
    const managerContext = await contextFor(alice, project.id);
    const lists = await taskLists.list(managerContext);
    const internal = lists.find((l) => !l.isExternal);
    const external = lists.find((l) => l.isExternal);

    await tasks.create(managerContext, { title: 'Internal costing', taskListId: internal.id });
    const shared = await tasks.create(managerContext, { title: 'Shared drawing', taskListId: external.id });

    const clientContext = await contextFor(customer, project.id);
    const clientTasks = await tasks.list(clientContext);
    assert.deepEqual(clientTasks.tasks.map((t) => t.title), ['Shared drawing']);

    // A direct read by id must refuse too — a listing filter that a single
    // fetch routes around is not a boundary.
    const internalTask = (await tasks.list(managerContext)).tasks.find(
      (t) => t.title === 'Internal costing'
    );
    assert.equal(await tasks.get(clientContext, internalTask.id), null);
    assert.ok(await tasks.get(clientContext, shared.id), 'the shared task became unreadable');
  });
});

/* ------------------------------------------------------------------ */
/* Work breakdown                                                       */
/* ------------------------------------------------------------------ */

describe('work breakdown', { skip: SKIP }, () => {
  let context;
  let project;

  before(async () => {
    if (SKIP) return;
    project = await projects.create(alice, { name: 'Breakdown Test' });
    context = await contextFor(alice, project.id);
  });

  test('phases keep the order they were created in and can be reordered', async () => {
    const first = await phases.create(context, { name: 'Design' });
    const second = await phases.create(context, { name: 'Build' });
    assert.equal(first.sequence, 0);
    assert.equal(second.sequence, 1);

    const reordered = await phases.reorder(context, [second.id, first.id]);
    assert.deepEqual(reordered.map((p) => p.name), ['Build', 'Design']);
  });

  test('a task list inside an internal phase cannot be made client-visible', async () => {
    // Otherwise a client sees a list hanging off a phase they cannot see, which
    // renders as an orphan and reveals that the phase exists.
    const internalPhase = await phases.create(context, { name: 'Internal only', isExternal: false });
    const list = await taskLists.create(context, {
      name: 'Trying to escape',
      phaseId: internalPhase.id,
      isExternal: true,
    });
    assert.equal(list.isExternal, false);
  });

  test('a task exists in both halves and reads back as one record', async () => {
    const task = await tasks.create(context, {
      title: 'Pour the slab',
      durationDays: 5,
      estimatedHours: 40,
    });

    assert.ok(task.reference.startsWith('TSK-'), 'the task has no workspace reference');
    assert.equal(task.title, 'Pour the slab');
    assert.equal(task.durationDays, 5);
    assert.equal(task.projectId, project.id);

    const reread = await tasks.get(context, task.id);
    assert.equal(reread.title, 'Pour the slab');
    assert.equal(reread.estimatedHours, 40);
  });

  test('a task with no title is refused before anything is written', async () => {
    await assert.rejects(
      () => tasks.create(context, { title: '  ' }),
      (error) => error.body?.error === 'title_required'
    );
  });

  test('subtasks nest and carry their depth', async () => {
    const parent = await tasks.create(context, { title: 'Structure' });
    const child = await tasks.create(context, { title: 'Columns', parentTaskId: parent.id });
    const grandchild = await tasks.create(context, { title: 'Rebar', parentTaskId: child.id });

    assert.equal(parent.depth, 0);
    assert.equal(child.depth, 1);
    assert.equal(grandchild.depth, 2);

    const roots = await tasks.list(context, { topLevel: true });
    assert.ok(!roots.tasks.some((t) => t.id === child.id), 'a subtask appeared at the top level');

    const children = await tasks.list(context, { parentTaskId: parent.id });
    assert.deepEqual(children.tasks.map((t) => t.title), ['Columns']);
  });

  test('a task cannot be made its own ancestor', async () => {
    const parent = await tasks.create(context, { title: 'Loop parent' });
    const child = await tasks.create(context, { title: 'Loop child', parentTaskId: parent.id });

    await assert.rejects(
      () => tasks.reparent(context, parent.id, child.id),
      (error) => error.body?.error === 'would_create_cycle'
    );
    await assert.rejects(
      () => tasks.reparent(context, parent.id, parent.id),
      (error) => error.body?.error === 'cannot_be_own_parent'
    );
  });

  test('nesting stops at the maximum depth', async () => {
    let previous = await tasks.create(context, { title: 'Depth 0' });
    for (let level = 1; level <= 5; level += 1) {
      previous = await tasks.create(context, { title: `Depth ${level}`, parentTaskId: previous.id });
    }
    await assert.rejects(
      () => tasks.create(context, { title: 'Too deep', parentTaskId: previous.id }),
      (error) => error.body?.error === 'max_depth_exceeded'
    );
  });

  test('deleting a task takes its subtree with it', async () => {
    const parent = await tasks.create(context, { title: 'Doomed parent' });
    await tasks.create(context, { title: 'Doomed child', parentTaskId: parent.id });

    const removed = await tasks.remove(context, parent.id);
    assert.equal(removed.subtreeSize, 2, 'the subtask outlived its parent');
    assert.equal(await tasks.get(context, parent.id), null);
  });
});

/* ------------------------------------------------------------------ */
/* Scheduling                                                           */
/* ------------------------------------------------------------------ */

describe('scheduling', { skip: SKIP }, () => {
  let context;
  let a;
  let b;
  let c;

  before(async () => {
    if (SKIP) return;
    const project = await projects.create(alice, { name: 'Schedule Test', startDate: '2026-09-06' });
    context = await contextFor(alice, project.id);
    a = await tasks.create(context, { title: 'Excavate', durationDays: 5, startDate: '2026-09-06' });
    b = await tasks.create(context, { title: 'Foundations', durationDays: 3 });
    c = await tasks.create(context, { title: 'Frame', durationDays: 4 });
  });

  test('a dependency links two tasks in the same project', async () => {
    const edge = await scheduleService.addDependency(context, {
      predecessorId: a.id,
      successorId: b.id,
      type: 'FS',
    });
    assert.equal(edge.type, 'FS');
    assert.equal((await scheduleService.dependencies(context)).length, 1);
  });

  test('a dependency onto a task in another project is refused', async () => {
    const elsewhere = await projects.create(alice, { name: 'Somewhere Else' });
    const outsider = await tasks.create(await contextFor(alice, elsewhere.id), { title: 'Not ours' });

    await assert.rejects(
      () => scheduleService.addDependency(context, { predecessorId: a.id, successorId: outsider.id }),
      (error) => error.body?.error === 'task_not_found'
    );
  });

  test('a dependency that would close a loop is refused before it is stored', async () => {
    await scheduleService.addDependency(context, { predecessorId: b.id, successorId: c.id });

    await assert.rejects(
      () => scheduleService.addDependency(context, { predecessorId: c.id, successorId: a.id }),
      (error) => error.body?.error === 'would_create_cycle' && Array.isArray(error.body.cycle)
    );
    // And nothing was written on the way to refusing.
    assert.equal((await scheduleService.dependencies(context)).length, 2);
  });

  test('the schedule pushes successors onto working days', async () => {
    const result = await scheduleService.scheduleOf(context);
    assert.equal(result.ok, true);

    const byId = Object.fromEntries(result.tasks.map((task) => [task.id, task]));
    // Sun 6 → Thu 10 for a five-day task, then the next working day is Sun 13 —
    // not Friday.
    assert.equal(byId[a.id].earlyFinish, '2026-09-10');
    assert.equal(byId[b.id].earlyStart, '2026-09-13');
  });

  test('the longest chain is the critical path', async () => {
    const result = await scheduleService.scheduleOf(context);
    assert.deepEqual([...result.criticalPath].sort(), [a.id, b.id, c.id].sort());
  });

  test('a preview reports what would move without writing anything', async () => {
    const before = await tasks.get(context, b.id);
    const preview = await scheduleService.reschedule(context, a.id, '2026-09-13');

    assert.equal(preview.ok, true);
    assert.ok(preview.changes.length >= 2, 'the successor was not reported as moving');
    assert.ok(preview.projectSlipDays > 0);

    const after = await tasks.get(context, b.id);
    assert.equal(after.startDate, before.startDate, 'a preview wrote to the database');
  });

  test('committing a move writes the whole cascade', async () => {
    const committed = await scheduleService.reschedule(context, a.id, '2026-09-13', { commit: true });
    assert.equal(committed.committed, true);

    const moved = await tasks.get(context, a.id);
    // A plain `YYYY-MM-DD` string, not a Date. See the type parser in db.js:
    // a Date here would serialise to the previous day in any timezone east of
    // Greenwich, which is where this product runs.
    assert.equal(moved.startDate, '2026-09-13');
  });

  test('a date crosses the API as a calendar day, not an instant', async () => {
    const task = await tasks.get(context, a.id);
    assert.equal(typeof task.startDate, 'string');
    assert.match(task.startDate, /^\d{4}-\d{2}-\d{2}$/);
    // The round trip through JSON must not move it, which is the failure the
    // type parser exists to prevent.
    assert.equal(JSON.parse(JSON.stringify(task)).startDate, task.startDate);
  });

  test('a baseline is immutable once captured', async () => {
    const baseline = await scheduleService.captureBaseline(context, { name: 'Contract' });
    await assert.rejects(
      () =>
        db.query('UPDATE qodo_projects.task_baselines SET start_date = $1 WHERE baseline_id = $2', [
          '2020-01-01',
          baseline.id,
        ]),
      /cannot be/
    );
  });

  test('variance measures the current plan against the captured one', async () => {
    const baseline = await scheduleService.captureBaseline(context, { name: 'Before slip' });
    await scheduleService.reschedule(context, a.id, '2026-09-20', { commit: true });

    const variance = await scheduleService.compareToBaseline(context, baseline.id);
    const moved = variance.find((row) => row.id === a.id);
    assert.ok(moved.startVarianceDays > 0, 'moving a task later did not read as late');
  });

  test('a task added after the baseline reports no variance rather than a fabricated zero', async () => {
    const baseline = await scheduleService.captureBaseline(context, { name: 'Before the new task' });
    const late = await tasks.create(context, { title: 'Added later', startDate: '2026-10-01' });

    const variance = await scheduleService.compareToBaseline(context, baseline.id);
    const row = variance.find((entry) => entry.id === late.id);
    assert.equal(row.isNew, true);
    assert.equal(row.startVarianceDays, null);
  });
});

/* ------------------------------------------------------------------ */
/* Checklists                                                           */
/* ------------------------------------------------------------------ */

describe('checklists', { skip: SKIP }, () => {
  let context;
  let doneStatus;

  before(async () => {
    if (SKIP) return;
    const project = await projects.create(alice, { name: 'Checklist Test' });
    context = await contextFor(alice, project.id);

    // A module and a done status, which a real organization gets from seeding.
    const taskModule = await db.row(
      `INSERT INTO qodo_projects.modules
         (organization_id, key, label_ar, label_en, plural_ar, plural_en)
       VALUES ($1, 'task', 'مهمة', 'Task', 'مهام', 'Tasks')
       ON CONFLICT (organization_id, key) DO UPDATE SET label_en = EXCLUDED.label_en
       RETURNING id`,
      [ORG_A]
    );
    doneStatus = await db.row(
      `INSERT INTO qodo_projects.statuses
         (organization_id, module_id, key, label_ar, label_en, category)
       VALUES ($1, $2, 'done', 'مكتملة', 'Done', 'done')
       ON CONFLICT (module_id, key) DO UPDATE SET label_en = EXCLUDED.label_en
       RETURNING id`,
      [ORG_A, taskModule.id]
    );
  });

  test('a required checklist item blocks completing the task', async () => {
    const task = await tasks.create(context, { title: 'Handover' });
    await tasks.addChecklistItem(context, task.id, { text: 'Client signed off', isRequired: true });

    await assert.rejects(
      () => tasks.update(context, task.id, { statusId: doneStatus.id }),
      (error) => error.body?.error === 'checklist_incomplete'
    );
  });

  test('ticking the required item unblocks it', async () => {
    const task = await tasks.create(context, { title: 'Handover 2' });
    const item = await tasks.addChecklistItem(context, task.id, {
      text: 'Client signed off',
      isRequired: true,
    });

    await tasks.setChecklistItem(context, task.id, item.id, { isDone: true });
    const completed = await tasks.update(context, task.id, { statusId: doneStatus.id });
    assert.equal(completed.statusId, doneStatus.id);
  });

  test('an optional item never blocks anything', async () => {
    const task = await tasks.create(context, { title: 'Handover 3' });
    await tasks.addChecklistItem(context, task.id, { text: 'Nice to have', isRequired: false });
    const completed = await tasks.update(context, task.id, { statusId: doneStatus.id });
    assert.equal(completed.statusId, doneStatus.id);
  });
});

/* ------------------------------------------------------------------ */
/* Metadata                                                             */
/* ------------------------------------------------------------------ */

describe('metadata', { skip: SKIP }, () => {
  test('an organization gets its modules and statuses once', async () => {
    const modules = await metadata.modulesFor(ORG_A);
    assert.ok(modules.some((m) => m.key === 'task'));
    assert.ok(modules.some((m) => m.key === 'issue'));

    // Running it again must not duplicate anything — it runs on every boot.
    await metadata.ensureDefaults(ORG_A);
    assert.equal((await metadata.modulesFor(ORG_A)).length, modules.length);
  });

  test('statuses are scoped to their organization', async () => {
    const mine = await metadata.statusesFor(ORG_A, 'task');
    const theirs = await metadata.statusesFor(ORG_B, 'task');
    assert.ok(mine.length > 0 && theirs.length > 0);
    assert.equal(mine.filter((s) => theirs.some((t) => t.id === s.id)).length, 0);
  });

  test('a new task lands on the module’s default status', async () => {
    const project = await projects.create(alice, { name: 'Default Status' });
    const context = await contextFor(alice, project.id);
    const task = await tasks.create(context, { title: 'Has a status' });
    assert.ok(task.statusId, 'the task has no status, so no board can show it');
    assert.equal(task.status.category, 'open');
  });

  test('retiring a status does not break the records pointing at it', async () => {
    const [status] = await metadata.statusesFor(ORG_A, 'task');
    const project = await projects.create(alice, { name: 'Retired Status' });
    const context = await contextFor(alice, project.id);
    const task = await tasks.create(context, { title: 'Points at a retired status', statusId: status.id });

    await metadata.updateStatus(alice, ORG_A, status.id, { isActive: false });

    const reread = await tasks.get(context, task.id);
    assert.equal(reread.statusId, status.id, 'the record lost its status when it was retired');
    assert.equal(reread.status.key, status.key);
  });

  test('a field type outside the closed set is refused', async () => {
    await assert.rejects(
      () => metadata.createField(alice, ORG_A, { module: 'task', key: 'weird', type: 'quantum' }),
      (error) => error.body?.error === 'field_type_invalid'
    );
  });

  test('custom field values are validated on the server', async () => {
    await metadata.createField(alice, ORG_A, {
      module: 'task',
      key: 'contact_email',
      labelEn: 'Contact email',
      type: 'email',
    });

    await assert.rejects(
      () => metadata.setValues(alice, ORG_A, 'task', 'some-task', { contact_email: 'not an email' }),
      (error) => error.body?.problems?.[0]?.error === 'not_an_email'
    );

    const written = await metadata.setValues(alice, ORG_A, 'task', 'some-task', {
      contact_email: 'site@engosoft.com',
    });
    assert.equal(written, 1);

    const values = await metadata.valuesFor('task', ['some-task']);
    assert.equal(values.get('some-task').contact_email, 'site@engosoft.com');
  });

  test('a required field cannot be left empty', async () => {
    await metadata.createField(alice, ORG_A, {
      module: 'task',
      key: 'permit_number',
      labelEn: 'Permit number',
      type: 'text',
      isRequired: true,
    });

    await assert.rejects(
      () => metadata.setValues(alice, ORG_A, 'task', 'another-task', { permit_number: '' }),
      (error) => error.body?.problems?.[0]?.error === 'required'
    );
  });
});

/* ------------------------------------------------------------------ */
/* Issues                                                               */
/* ------------------------------------------------------------------ */

describe('issues', { skip: SKIP }, () => {
  let context;
  let project;

  before(async () => {
    if (SKIP) return;
    project = await projects.create(alice, { name: 'Defect Tracking' });
    context = await contextFor(alice, project.id);
  });

  test('an issue gets a readable reference from the project key', async () => {
    const issue = await issues.create(context, { title: 'Cracked beam', severity: 'critical' });
    assert.equal(issue.key, `${project.key}-1`);
    assert.equal(issue.severity, 'critical');
    assert.ok(issue.statusId, 'the issue has no status, so no triage board can show it');
  });

  test('references increment per project, not globally', async () => {
    const second = await issues.create(context, { title: 'Loose bolt' });
    assert.equal(second.number, 2);

    const otherProject = await projects.create(alice, { name: 'Other Site' });
    const otherContext = await contextFor(alice, otherProject.id);
    const elsewhere = await issues.create(otherContext, { title: 'Different defect' });
    assert.equal(elsewhere.number, 1, 'issue numbering leaked across projects');
  });

  test('an issue can be linked to a task in the same project', async () => {
    const task = await tasks.create(context, { title: 'Repair the beam' });
    const issue = await issues.create(context, { title: 'Beam needs repair' });

    const link = await issues.addLink(context, issue.id, {
      linkedType: 'task',
      linkedId: task.id,
      relation: 'blocks',
    });
    assert.equal(link.relation, 'blocks');

    const reread = await issues.get(context, issue.id);
    assert.equal(reread.links.length, 1);
  });

  test('an issue cannot be linked to a record in another project', async () => {
    const elsewhere = await projects.create(alice, { name: 'Not Ours' });
    const outsider = await tasks.create(await contextFor(alice, elsewhere.id), { title: 'Their task' });
    const issue = await issues.create(context, { title: 'Trying to link out' });

    await assert.rejects(
      () => issues.addLink(context, issue.id, { linkedType: 'task', linkedId: outsider.id }),
      (error) => error.body?.error === 'linked_not_found'
    );
  });

  test('closing derives from the status category, not from a typed field', async () => {
    const [closed] = (await metadata.statusesFor(ORG_A, 'issue')).filter((s) => s.category === 'done');
    const issue = await issues.create(context, { title: 'Will be closed' });
    assert.equal(issue.closedAt, null);

    const after = await issues.update(context, issue.id, { statusId: closed.id });
    assert.ok(after.closedAt, 'moving to a done status did not close the issue');

    const [open] = (await metadata.statusesFor(ORG_A, 'issue')).filter((s) => s.category === 'open');
    const reopened = await issues.update(context, issue.id, { statusId: open.id });
    assert.equal(reopened.closedAt, null, 'reopening left the closed stamp behind');
  });

  test('a client only sees issues shared with them', async () => {
    await projects.addMember(context, { userId: customer.id, role: 'client' });
    const clientContext = await contextFor(customer, project.id);

    await issues.create(context, { title: 'Internal defect', isExternal: false });
    const shared = await issues.create(context, { title: 'Shared defect', isExternal: true });

    const visible = await issues.list(clientContext);
    assert.ok(visible.issues.every((i) => i.isExternal));
    assert.ok(visible.issues.some((i) => i.id === shared.id));
  });

  test('an issue a client raises is visible to that client', async () => {
    // Otherwise a customer files a report and it disappears.
    const clientContext = await contextFor(customer, project.id);
    const raised = await issues.create(clientContext, { title: 'The lift is stuck' });
    assert.equal(raised.isExternal, true);
    assert.ok(await issues.get(clientContext, raised.id));
  });
});

/* ------------------------------------------------------------------ */
/* SLA                                                                  */
/* ------------------------------------------------------------------ */

describe('sla', { skip: SKIP }, () => {
  let context;
  let policy;

  before(async () => {
    if (SKIP) return;
    const project = await projects.create(alice, { name: 'SLA Test' });
    context = await contextFor(alice, project.id);

    policy = await slaService.createPolicy(alice, ORG_A, {
      name: 'Blockers in one hour',
      criteria: [{ field: 'severity', operator: 'eq', value: 'blocker' }],
      responseMinutes: 60,
      resolutionMinutes: 480,
      escalations: [{ afterMinutes: 0, notify: ['u-alice'] }],
    });
  });

  test('a target is required — a policy that promises nothing is not a policy', async () => {
    await assert.rejects(
      () => slaService.createPolicy(alice, ORG_A, { name: 'Empty promise' }),
      (error) => error.body?.error === 'sla_target_required'
    );
  });

  test('criteria match on a closed vocabulary and an unknown operator matches nothing', () => {
    const issue = { severity: 'blocker', priority: 'urgent' };
    assert.equal(slaService.matches(issue, [{ field: 'severity', operator: 'eq', value: 'blocker' }]), true);
    assert.equal(slaService.matches(issue, [{ field: 'severity', operator: 'eq', value: 'minor' }]), false);
    assert.equal(
      slaService.matches(issue, [{ field: 'severity', operator: 'sql_injection', value: 'x' }]),
      false,
      'an operator we do not understand matched everything'
    );
  });

  test('a clock starts only when a policy matches', async () => {
    const minor = await issues.create(context, { title: 'Paint scuff', severity: 'minor' });
    assert.equal(minor.sla, null, 'an issue with no matching policy was given a deadline anyway');

    const blocker = await issues.create(context, { title: 'Site shut down', severity: 'blocker' });
    assert.ok(blocker.sla, 'a blocker got no SLA clock');
    assert.ok(blocker.sla.responseDueAt);
  });

  test('working minutes skip the weekend', () => {
    // Thursday 2026-09-10 at 16:00 UTC, plus four working hours, must land on
    // Sunday — not Friday, which is not a working day here.
    const thursdayAfternoon = Date.UTC(2026, 8, 10, 16, 0);
    const result = slaService.addWorkingMinutes(
      thursdayAfternoon,
      240,
      { workdays: new Set([7, 1, 2, 3, 4]), holidays: new Set() },
      540,
      1020
    );
    assert.equal(new Date(result).toISOString().slice(0, 10), '2026-09-13');
  });

  test('assigning stops the response clock and closing stops the resolution clock', async () => {
    const blocker = await issues.create(context, { title: 'Crane down', severity: 'blocker' });
    await issues.update(context, blocker.id, { assigneeId: bob.id });

    let clock = await slaService.clockFor(blocker.id);
    assert.ok(clock.respondedAt, 'assigning did not count as a response');
    assert.equal(clock.resolvedAt, null);

    const [closed] = (await metadata.statusesFor(ORG_A, 'issue')).filter((s) => s.category === 'done');
    await issues.update(context, blocker.id, { statusId: closed.id });

    clock = await slaService.clockFor(blocker.id);
    assert.ok(clock.resolvedAt, 'closing did not stop the resolution clock');
  });

  test('a breach is recorded once, not on every sweep', async () => {
    const blocker = await issues.create(context, { title: 'Already late', severity: 'blocker' });
    // Reach in and put the deadline in the past — the alternative is a test
    // that waits an hour.
    await db.query(
      `UPDATE qodo_projects.sla_clocks
          SET response_due_at = now() - interval '1 hour',
              resolution_due_at = now() - interval '1 hour'
        WHERE issue_id = $1`,
      [blocker.id]
    );

    const first = await slaService.sweepBreaches(ORG_A);
    assert.ok(first.response.some((row) => row.issue_id === blocker.id));

    const second = await slaService.sweepBreaches(ORG_A);
    assert.ok(
      !second.response.some((row) => row.issue_id === blocker.id),
      'the same breach was reported twice'
    );
  });

  test('pausing the clock pushes the deadline out by however long it was paused', async () => {
    const blocker = await issues.create(context, { title: 'Waiting on the client', severity: 'blocker' });
    const before = await slaService.clockFor(blocker.id);

    await slaService.pauseClock(blocker.id);
    await db.query(
      `UPDATE qodo_projects.sla_clocks SET paused_at = now() - interval '30 minutes' WHERE issue_id = $1`,
      [blocker.id]
    );
    await slaService.resumeClock(blocker.id);

    const after = await slaService.clockFor(blocker.id);
    const moved =
      new Date(after.responseDueAt).getTime() - new Date(before.responseDueAt).getTime();
    assert.ok(moved > 25 * 60 * 1000, 'time spent waiting on the customer counted against us');
  });
});

/* ------------------------------------------------------------------ */
/* Time                                                                 */
/* ------------------------------------------------------------------ */

describe('time tracking', { skip: SKIP }, () => {
  let context;
  let task;

  before(async () => {
    if (SKIP) return;
    const project = await projects.create(alice, { name: 'Time Test' });
    context = await contextFor(alice, project.id);
    task = await tasks.create(context, { title: 'Billable work' });
  });

  test('a person may have only one timer running', async () => {
    await timeService.startTimer(context, { entityType: 'task', entityId: task.id });

    const running = await db.row(
      `SELECT count(*)::int AS n FROM qodo_projects.timers
        WHERE organization_id = $1 AND user_id = $2 AND stopped_at IS NULL`,
      [ORG_A, alice.id]
    );
    assert.equal(running.n, 1);

    // Starting a second one stops the first rather than refusing — which is
    // what people mean when they start a second timer.
    await timeService.startTimer(context, { entityType: 'task', entityId: task.id });
    const still = await db.row(
      `SELECT count(*)::int AS n FROM qodo_projects.timers
        WHERE organization_id = $1 AND user_id = $2 AND stopped_at IS NULL`,
      [ORG_A, alice.id]
    );
    assert.equal(still.n, 1, 'two timers were running for the same person');
  });

  test('the one-running-timer rule is enforced by the database, not only the service', async () => {
    // Bypass the service entirely — the constraint has to hold anyway, because
    // two browser tabs racing do not go through one code path.
    await assert.rejects(
      () =>
        db.query(
          `INSERT INTO qodo_projects.timers (organization_id, user_id, entity_type, entity_id)
           VALUES ($1, $2, 'task', $3)`,
          [ORG_A, alice.id, task.id]
        ),
      /duplicate key|unique/i
    );
  });

  test('a timer under a minute is discarded rather than logged', async () => {
    const result = await timeService.stopTimer(context);
    assert.equal(result.discarded, true, 'a mis-click became a time entry');
  });

  test('logging time by hand validates the hours', async () => {
    for (const hours of [0, -1, 25, 'abc']) {
      await assert.rejects(
        () => timeService.logTime(context, { taskId: task.id, hours }),
        (error) => error.body?.error === 'hours_invalid',
        `hours=${hours} was accepted`
      );
    }
  });

  test('time must be logged against something in this project', async () => {
    const elsewhere = await projects.create(alice, { name: 'Another Job' });
    const outsider = await tasks.create(await contextFor(alice, elsewhere.id), { title: 'Theirs' });

    await assert.rejects(
      () => timeService.logTime(context, { taskId: outsider.id, hours: 1 }),
      (error) => error.body?.error === 'task_not_found'
    );
  });

  test('logging somebody else’s time needs its own permission', async () => {
    const employeeContext = {
      ...context,
      user: bob,
      permissionSet: { id: 'employee' },
      membership: { role: 'member', isClient: false },
    };
    await assert.rejects(
      () => timeService.logTime(employeeContext, { taskId: task.id, hours: 2, userId: alice.id }),
      (error) => error.body?.missing === 'time.log_others'
    );
  });

  test('a task’s actual hours follow from its entries', async () => {
    await timeService.logTime(context, { taskId: task.id, hours: 3, logDate: '2026-09-07' });
    await timeService.logTime(context, { taskId: task.id, hours: 2.5, logDate: '2026-09-08' });

    const reread = await tasks.get(context, task.id);
    assert.equal(reread.actualHours, 5.5, 'the task and its time entries disagree');
  });
});

/* ------------------------------------------------------------------ */
/* Timesheets                                                           */
/* ------------------------------------------------------------------ */

describe('timesheets', { skip: SKIP }, () => {
  let context;
  let bobContext;
  let task;

  before(async () => {
    if (SKIP) return;
    const project = await projects.create(alice, { name: 'Timesheet Test' });
    context = await contextFor(alice, project.id);
    await projects.addMember(context, { userId: bob.id, role: 'member' });
    bobContext = await contextFor(bob, project.id);
    task = await tasks.create(context, { title: 'Weekly work' });
  });

  test('the week runs Sunday to Saturday', () => {
    // Engosoft's week starts on Sunday, so a Wednesday belongs to the Sunday
    // before it — not to the Monday.
    assert.equal(timeService.weekStart('2026-09-09'), '2026-09-06');
    assert.equal(timeService.weekStart('2026-09-06'), '2026-09-06');
    assert.equal(timeService.weekEnd('2026-09-06'), '2026-09-12');
  });

  test('an empty week cannot be submitted', async () => {
    await assert.rejects(
      () => timeService.submitTimesheet(bobContext, '2026-09-06'),
      (error) => error.body?.error === 'timesheet_empty'
    );
  });

  test('submitting attaches the week’s entries and moves them together', async () => {
    await timeService.logTime(bobContext, { taskId: task.id, hours: 8, logDate: '2026-09-07' });
    await timeService.logTime(bobContext, { taskId: task.id, hours: 6, logDate: '2026-09-08' });

    const sheet = await timeService.submitTimesheet(bobContext, '2026-09-06');
    assert.equal(sheet.status, 'submitted');

    const entries = await db.rows(
      'SELECT approval_status FROM qodo_projects.time_entries WHERE timesheet_id = $1',
      [sheet.id]
    );
    assert.equal(entries.length, 2);
    assert.ok(entries.every((entry) => entry.approval_status === 'submitted'));
  });

  test('nobody approves their own week', async () => {
    const sheet = await db.row(
      `SELECT id FROM qodo_projects.timesheets WHERE user_id = $1 AND status = 'submitted'`,
      [bob.id]
    );
    await assert.rejects(
      () => timeService.reviewTimesheet(bobContext, sheet.id, 'approved'),
      (error) => error.body?.error === 'cannot_approve_own_timesheet'
    );
  });

  test('a rejection must carry a reason', async () => {
    const sheet = await db.row(
      `SELECT id FROM qodo_projects.timesheets WHERE user_id = $1 AND status = 'submitted'`,
      [bob.id]
    );
    await assert.rejects(
      () => timeService.reviewTimesheet(context, sheet.id, 'rejected', '   '),
      (error) => error.body?.error === 'rejection_reason_required'
    );
  });

  test('approving freezes the rates in force on each entry’s own date', async () => {
    await budgetService.setRate(context, 'cost', {
      userId: bob.id,
      rate: 100,
      effectiveFrom: '2026-01-01',
    });

    const sheet = await db.row(
      `SELECT id FROM qodo_projects.timesheets WHERE user_id = $1 AND status = 'submitted'`,
      [bob.id]
    );
    await timeService.reviewTimesheet(context, sheet.id, 'approved');

    const entries = await db.rows(
      'SELECT cost_rate, approval_status FROM qodo_projects.time_entries WHERE timesheet_id = $1',
      [sheet.id]
    );
    assert.ok(entries.every((entry) => entry.approval_status === 'approved'));
    assert.ok(entries.every((entry) => Number(entry.cost_rate) === 100), 'the rate was not frozen');

    // A raise afterwards must not restate what was already approved.
    await budgetService.setRate(context, 'cost', {
      userId: bob.id,
      rate: 250,
      effectiveFrom: '2026-09-20',
    });
    const after = await db.rows(
      'SELECT cost_rate FROM qodo_projects.time_entries WHERE timesheet_id = $1',
      [sheet.id]
    );
    assert.ok(after.every((entry) => Number(entry.cost_rate) === 100), 'a raise rewrote history');
  });

  test('approved time cannot be edited by the person who logged it', async () => {
    const entry = await db.row(
      `SELECT id FROM qodo_projects.time_entries
        WHERE user_id = $1 AND approval_status = 'approved' LIMIT 1`,
      [bob.id]
    );
    await assert.rejects(
      () => timeService.updateEntry(bobContext, entry.id, { hours: 12 }),
      (error) => error.body?.error === 'time_entry_approved'
    );
  });

  test('a submitted week can be recalled before it is reviewed', async () => {
    await timeService.logTime(bobContext, { taskId: task.id, hours: 4, logDate: '2026-09-14' });
    const submitted = await timeService.submitTimesheet(bobContext, '2026-09-14');

    const recalled = await timeService.recallTimesheet(bobContext, submitted.id);
    assert.equal(recalled.status, 'draft');
  });
});

/* ------------------------------------------------------------------ */
/* Budget and earned value                                              */
/* ------------------------------------------------------------------ */

describe('budget', { skip: SKIP }, () => {
  let context;
  let project;

  before(async () => {
    if (SKIP) return;
    project = await projects.create(alice, {
      name: 'Budget Test',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });
    context = await contextFor(alice, project.id);
  });

  test('a budget needs a value', async () => {
    await assert.rejects(
      () => budgetService.setBudget(context, { type: 'project_amount' }),
      (error) => error.body?.error === 'budget_value_required'
    );
  });

  test('a budget type outside the closed set is refused', async () => {
    await assert.rejects(
      () => budgetService.setBudget(context, { type: 'vibes', amount: 100 }),
      (error) => error.body?.error === 'budget_type_invalid'
    );
  });

  test('budget state moves healthy → at risk → overrun at the stated thresholds', () => {
    const budget = { hours: 100, amount: null, thresholdPercent: 80 };
    assert.equal(budgetService.budgetState(budget, 10).state, 'healthy');
    assert.equal(budgetService.budgetState(budget, 79).state, 'healthy');
    assert.equal(budgetService.budgetState(budget, 80).state, 'at_risk');
    assert.equal(budgetService.budgetState(budget, 100).state, 'at_risk');
    assert.equal(budgetService.budgetState(budget, 101).state, 'overrun');
    // Finished with money left is a surplus; finished over is still an overrun.
    assert.equal(budgetService.budgetState(budget, 50, true).state, 'surplus');
    assert.equal(budgetService.budgetState(budget, 120, true).state, 'overrun');
  });

  test('a budget with nothing consumed is healthy, not a surplus', () => {
    const budget = { hours: 100, amount: null, thresholdPercent: 80 };
    assert.equal(budgetService.budgetState(budget, 0).state, 'healthy');
  });

  test('an unknown consumption is unset rather than zero', () => {
    const budget = { hours: 100, amount: null, thresholdPercent: 80 };
    assert.equal(budgetService.budgetState(budget, null).state, 'unset');
    assert.equal(budgetService.budgetState({ hours: null, amount: null, thresholdPercent: 80 }, 5).state, 'unset');
  });

  test('a project with no budget reports no consumption rather than zeroes', async () => {
    const empty = await projects.create(alice, { name: 'Nothing Logged' });
    const emptyContext = await contextFor(alice, empty.id);
    const consumed = await budgetService.consumption(emptyContext);

    // Null, not zero: nothing has been measured, and "0 hours planned" is a
    // claim nobody made.
    assert.equal(consumed.plannedHours, null);
    assert.equal(consumed.actualHours, null);
    assert.equal(consumed.actualCost, null);
  });

  test('earned value refuses to compute when its inputs are missing', async () => {
    const bare = await projects.create(alice, { name: 'No Budget At All' });
    const result = await budgetService.earnedValue(await contextFor(alice, bare.id));

    assert.equal(result.available, false);
    assert.ok(result.missing.includes('budget_amount'));
    assert.ok(result.missing.includes('project_dates'));
    // And it still says what it does know, rather than returning nothing.
    assert.equal(result.partial.budgetAtCompletion, null);
  });

  test('earned value computes the standard indices once it has its inputs', async () => {
    await budgetService.setBudget(context, { type: 'project_amount', amount: 100000, currency: 'EGP' });

    const task = await tasks.create(context, { title: 'Half done', estimatedHours: 100 });
    await tasks.update(context, task.id, { progress: 50 });
    await timeService.logTime(context, { taskId: task.id, hours: 10, logDate: '2026-06-01' });
    await db.query(
      `UPDATE qodo_projects.time_entries SET cost_rate = 500 WHERE project_id = $1`,
      [project.id]
    );

    const evm = await budgetService.earnedValue(context);
    assert.equal(evm.available, true);
    assert.equal(evm.budgetAtCompletion, 100000);
    // EV = BAC × progress = 100000 × 0.5
    assert.equal(evm.earnedValue, 50000);
    // AC = 10 hours × 500
    assert.equal(evm.actualCost, 5000);
    // CV = EV − AC, CPI = EV ÷ AC
    assert.equal(evm.costVariance, 45000);
    assert.equal(evm.costPerformanceIndex, 10);
    // The basis for planned value is stated so nobody reads more precision
    // into it than there is.
    assert.equal(evm.plannedProgressBasis, 'elapsed_calendar_time');
  });

  test('a ratio with a zero denominator is null, not infinity', async () => {
    const fresh = await projects.create(alice, {
      name: 'Nothing Spent',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });
    const freshContext = await contextFor(alice, fresh.id);
    await budgetService.setBudget(freshContext, { type: 'project_amount', amount: 5000 });
    const task = await tasks.create(freshContext, { title: 'Untouched' });
    await tasks.update(freshContext, task.id, { progress: 10 });

    const evm = await budgetService.earnedValue(freshContext);
    // No cost has been logged, so CPI has no denominator.
    assert.equal(evm.available, false);
    assert.ok(evm.missing.includes('actual_cost'));
  });

  test('a budget past its threshold is announced once', async () => {
    const watched = await projects.create(alice, { name: 'Watched Budget' });
    const watchedContext = await contextFor(alice, watched.id);
    const watchedTask = await tasks.create(watchedContext, { title: 'Burning hours' });

    await budgetService.setBudget(watchedContext, { type: 'project_hours', hours: 10, thresholdPercent: 80 });
    await timeService.logTime(watchedContext, { taskId: watchedTask.id, hours: 9 });

    const first = await budgetService.budgetsCrossingThreshold(ORG_A);
    assert.ok(first.some((row) => row.projectId === watched.id));

    const second = await budgetService.budgetsCrossingThreshold(ORG_A);
    assert.ok(
      !second.some((row) => row.projectId === watched.id),
      'the same budget warning went out twice'
    );
  });
});

/* ------------------------------------------------------------------ */
/* Collaboration                                                        */
/* ------------------------------------------------------------------ */

describe('comments', { skip: SKIP }, () => {
  let context;
  let clientContext;
  let task;

  before(async () => {
    if (SKIP) return;
    const project = await projects.create(alice, { name: 'Comment Test' });
    context = await contextFor(alice, project.id);
    await projects.addMember(context, { userId: customer.id, role: 'client' });
    clientContext = await contextFor(customer, project.id);
    task = await tasks.create(context, { title: 'Discussed work' });
  });

  test('a comment is internal unless somebody deliberately shares it', async () => {
    const internal = await collaboration.addComment(context, 'task', task.id, { body: 'Pad the estimate' });
    assert.equal(internal.isInternal, true, 'a comment defaulted to client-visible');
  });

  test('a client never sees an internal comment', async () => {
    await collaboration.addComment(context, 'task', task.id, {
      body: 'Shared with the client',
      isInternal: false,
    });

    const staffSees = await collaboration.comments(context, 'task', task.id);
    const clientSees = await collaboration.comments(clientContext, 'task', task.id);

    assert.ok(staffSees.length >= 2);
    assert.ok(clientSees.every((comment) => comment.isInternal === false));
    assert.ok(
      !clientSees.some((comment) => comment.body.includes('Pad the estimate')),
      'an internal comment reached the client'
    );
  });

  test('a client’s own comment is always client-visible', async () => {
    // Otherwise a customer writes something and it disappears.
    const posted = await collaboration.addComment(clientContext, 'task', task.id, {
      body: 'When is this due?',
      isInternal: true,
    });
    assert.equal(posted.isInternal, false);
  });

  test('somebody without comment.internal cannot write an internal comment', async () => {
    const contractorContext = {
      ...context,
      permissionSet: { id: 'contractor' },
      membership: { role: 'member', isClient: false },
    };
    const posted = await collaboration.addComment(contractorContext, 'task', task.id, {
      body: 'From a contractor',
      isInternal: true,
    });
    assert.equal(posted.isInternal, false);
  });

  test('a mention is read out of the body, not taken beside it', async () => {
    // The roster is empty in this test database, so nothing resolves — the
    // point is that the field is derived rather than accepted from the caller.
    const posted = await collaboration.addComment(context, 'task', task.id, {
      body: 'ping @Nobody Here',
      mentionIds: ['u-injected'],
    });
    assert.ok(!posted.mentionIds.includes('u-injected'), 'a caller-supplied mention was trusted');
  });

  test('only the author may edit, and visibility is not editable afterwards', async () => {
    const posted = await collaboration.addComment(context, 'task', task.id, { body: 'Mine' });

    const byOther = await collaboration.editComment(
      { ...context, user: bob },
      posted.id,
      'Not mine to change'
    );
    assert.equal(byOther, null);

    const edited = await collaboration.editComment(context, posted.id, 'Mine, corrected');
    assert.equal(edited.body, 'Mine, corrected');
    assert.ok(edited.editedAt);
    assert.equal(edited.isInternal, posted.isInternal, 'editing changed who can see it');
  });

  test('a reaction toggles rather than stacking', async () => {
    const posted = await collaboration.addComment(context, 'task', task.id, { body: 'Agreed?' });
    assert.deepEqual(await collaboration.react(context, posted.id, '👍'), { added: true });
    assert.deepEqual(await collaboration.react(context, posted.id, '👍'), { added: false });
  });
});

describe('pages', { skip: SKIP }, () => {
  let context;

  before(async () => {
    if (SKIP) return;
    const project = await projects.create(alice, { name: 'Wiki Test' });
    context = await contextFor(alice, project.id);
  });

  test('every save keeps what the page said before', async () => {
    const page = await collaboration.createPage(context, { title: 'Method statement', body: 'First draft' });
    assert.equal(page.revisionNo, 1);

    const second = await collaboration.updatePage(context, page.id, { body: 'Second draft' });
    assert.equal(second.revisionNo, 2);

    const revisions = await collaboration.pageRevisions(context, page.id);
    assert.equal(revisions.length, 2);
  });

  test('restoring writes a new revision rather than deleting the bad one', async () => {
    const page = await collaboration.createPage(context, { title: 'Spec', body: 'Good' });
    await collaboration.updatePage(context, page.id, { body: 'Accidentally wrong' });

    const restored = await collaboration.restorePageRevision(context, page.id, 1);
    assert.equal(restored.revisionNo, 3, 'restoring truncated the history');

    const current = await collaboration.page(context, page.id);
    assert.equal(current.body, 'Good');

    // And the mistake is still in the record, because it happened.
    const revisions = await collaboration.pageRevisions(context, page.id);
    assert.equal(revisions.length, 3);
  });
});

/* ------------------------------------------------------------------ */
/* Documents                                                            */
/* ------------------------------------------------------------------ */

describe('documents', { skip: SKIP }, () => {
  let context;
  let clientContext;

  before(async () => {
    if (SKIP) return;
    const project = await projects.create(alice, { name: 'Document Test' });
    context = await contextFor(alice, project.id);
    await projects.addMember(context, { userId: customer.id, role: 'client' });
    clientContext = await contextFor(customer, project.id);
  });

  test('a filename cannot escape the store', () => {
    assert.equal(documents.safeName('../../etc/passwd'), '_.._etc_passwd');
    assert.equal(documents.safeName(''), 'file');
    assert.ok(!documents.safeName('a/b/c').includes('/'));
  });

  test('the media allowlist refuses what a browser would execute', () => {
    assert.equal(documents.isAllowedMime('application/pdf'), true);
    assert.equal(documents.isAllowedMime('text/html'), false);
    // SVG is markup that can carry script; it is not on the list on purpose.
    assert.equal(documents.isAllowedMime('image/svg+xml'), false);
  });

  test('a download token is bound to the person it was minted for', () => {
    const token = documents.signDownload('u-alice', 'file-1', 1);
    assert.deepEqual(documents.verifyDownload(token, 'u-alice'), { fileId: 'file-1', versionNo: 1 });
    assert.equal(documents.verifyDownload(token, 'u-mallory'), null, 'a token worked in another hand');
    assert.equal(documents.verifyDownload(`${token.slice(0, -2)}xy`, 'u-alice'), null);
    assert.equal(documents.verifyDownload('nonsense', 'u-alice'), null);
  });

  test('an upload becomes version one and a second upload becomes version two', async () => {
    const first = await documents.upload(context, {
      name: 'plan.pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.from('%PDF-1.4 first'),
    });
    assert.equal(first.versionNo, 1);

    const second = await documents.upload(context, {
      fileId: first.id,
      name: 'plan.pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.from('%PDF-1.4 second'),
    });
    assert.equal(second.versionNo, 2);

    const file = await documents.get(context, first.id);
    assert.equal(file.currentVersion, 2);
    assert.equal(file.versions.length, 2);
  });

  test('an empty or disallowed upload is refused before anything is stored', async () => {
    await assert.rejects(
      () => documents.upload(context, { name: 'x', mimeType: 'application/pdf', bytes: Buffer.alloc(0) }),
      (error) => error.body?.error === 'document_empty'
    );
    await assert.rejects(
      () => documents.upload(context, { name: 'x.html', mimeType: 'text/html', bytes: Buffer.from('<b>') }),
      (error) => error.body?.error === 'file_type_not_allowed'
    );
  });

  test('restoring an old version puts its bytes back at the front', async () => {
    const file = await documents.upload(context, {
      name: 'spec.txt',
      mimeType: 'text/plain',
      bytes: Buffer.from('original'),
    });
    await documents.upload(context, {
      fileId: file.id,
      name: 'spec.txt',
      mimeType: 'text/plain',
      bytes: Buffer.from('mistake'),
    });

    const restored = await documents.restoreVersion(context, file.id, 1);
    assert.equal(restored.versionNo, 3, 'restoring truncated the history');

    const bytes = await documents.download(context, file.id, 3);
    assert.equal(bytes.bytes.toString(), 'original');
  });

  test('a client cannot see an internal document, by listing or by id', async () => {
    const internal = await documents.upload(context, {
      name: 'costs.csv',
      mimeType: 'text/csv',
      bytes: Buffer.from('rate,amount'),
      isExternal: false,
    });
    const shared = await documents.upload(context, {
      name: 'drawing.pdf',
      mimeType: 'application/pdf',
      bytes: Buffer.from('%PDF-1.4'),
      isExternal: true,
    });

    const visible = await documents.list(clientContext);
    assert.ok(visible.every((file) => file.isExternal));
    assert.ok(visible.some((file) => file.id === shared.id));

    assert.equal(await documents.get(clientContext, internal.id), null);
    assert.equal(await documents.download(clientContext, internal.id, 1), null);
  });
});

/* ------------------------------------------------------------------ */
/* Automation                                                           */
/* ------------------------------------------------------------------ */

describe('automation', { skip: SKIP }, () => {
  let context;
  let project;

  before(async () => {
    if (SKIP) return;
    project = await projects.create(alice, { name: 'Automation Test' });
    context = await contextFor(alice, project.id);
  });

  test('a rule with an unknown action is refused when it is saved', async () => {
    await assert.rejects(
      () =>
        automation.createRule(alice, ORG_A, {
          name: 'Run arbitrary code',
          moduleKey: 'task',
          trigger: 'create',
          actions: [{ type: 'eval', code: 'process.exit(1)' }],
        }),
      (error) => error.body?.error === 'action_unknown'
    );
  });

  test('a rule with a broken criterion is refused when it is saved', async () => {
    await assert.rejects(
      () =>
        automation.createRule(alice, ORG_A, {
          name: 'Typo',
          moduleKey: 'task',
          trigger: 'update',
          criteria: [{ field: 'priority', operator: 'equalz', value: 'high' }],
          actions: [{ type: 'notify', to: 'owner' }],
        }),
      (error) => error.body?.error === 'criteria_invalid'
    );
  });

  test('a rule with no actions is refused — it would fire and do nothing', async () => {
    await assert.rejects(
      () =>
        automation.createRule(alice, ORG_A, {
          name: 'Does nothing',
          moduleKey: 'task',
          trigger: 'create',
          actions: [],
        }),
      (error) => error.body?.error === 'actions_required'
    );
  });

  test('a matching rule fires once, and firing it again is a no-op', async () => {
    await automation.createRule(alice, ORG_A, {
      name: 'Tag urgent work',
      moduleKey: 'task',
      trigger: 'update',
      criteria: [{ field: 'priority', operator: 'eq', value: 'urgent' }],
      actions: [{ type: 'add_tag', tag: 'escalated' }],
    });

    const performed = [];
    const apply = async (action) => {
      performed.push(action.type);
      return { ok: true };
    };

    const record = { id: 'auto-task-1', priority: 'urgent' };
    const previous = { id: 'auto-task-1', priority: 'normal' };

    const first = await automation.runFor({
      organizationId: ORG_A,
      projectId: project.id,
      moduleKey: 'task',
      trigger: 'update',
      record,
      previous,
      user: alice,
      apply,
    });
    assert.equal(first.applied.length, 1);
    assert.deepEqual(performed, ['add_tag']);

    // The same change, delivered twice — a crash-and-retry, or two workers.
    const second = await automation.runFor({
      organizationId: ORG_A,
      projectId: project.id,
      moduleKey: 'task',
      trigger: 'update',
      record,
      previous,
      user: alice,
      apply,
    });
    assert.equal(second.applied.length, 0, 'the same event fired the rule twice');
    assert.deepEqual(performed, ['add_tag'], 'the action ran twice');
  });

  test('a different change to the same record does fire', async () => {
    const performed = [];
    const apply = async (action) => performed.push(action.type);

    await automation.runFor({
      organizationId: ORG_A,
      projectId: project.id,
      moduleKey: 'task',
      trigger: 'update',
      record: { id: 'auto-task-1', priority: 'urgent', progress: 50 },
      previous: { id: 'auto-task-1', priority: 'urgent', progress: 10 },
      user: alice,
      apply,
    });
    assert.deepEqual(performed, ['add_tag'], 'a genuinely new change was swallowed as a duplicate');
  });

  test('a rule scoped to one project does not fire on another', async () => {
    const elsewhere = await projects.create(alice, { name: 'Elsewhere' });
    await automation.createRule(alice, ORG_A, {
      name: 'Only here',
      moduleKey: 'task',
      trigger: 'create',
      projectId: elsewhere.id,
      actions: [{ type: 'notify', to: 'owner' }],
    });

    const performed = [];
    await automation.runFor({
      organizationId: ORG_A,
      projectId: project.id,
      moduleKey: 'task',
      trigger: 'create',
      record: { id: 'scoped-1' },
      user: alice,
      apply: async (action) => performed.push(action.type),
    });
    assert.deepEqual(performed, [], 'a project-scoped rule fired on another project');
  });

  test('a chain past the depth limit is stopped and recorded', async () => {
    const result = await automation.runFor({
      organizationId: ORG_A,
      projectId: project.id,
      moduleKey: 'task',
      trigger: 'update',
      record: { id: 'looping-task', priority: 'urgent' },
      previous: { id: 'looping-task', priority: 'normal' },
      user: alice,
      apply: async () => {},
      depth: automation.MAX_DEPTH + 1,
    });

    assert.equal(result.stopped, 'depth_limit');

    // Recorded, not silent: a loop that stops quietly looks like one that
    // finished, and the difference matters when somebody asks why a field
    // never updated.
    const runs = await automation.runHistory(ORG_A, { limit: 20 });
    assert.ok(runs.some((run) => run.status === 'failed' && /depth limit/.test(run.error ?? '')));
  });

  test('a dry run reports what would happen and does nothing', async () => {
    const performed = [];
    const preview = await automation.runFor({
      organizationId: ORG_A,
      projectId: project.id,
      moduleKey: 'task',
      trigger: 'update',
      record: { id: 'dry-1', priority: 'urgent' },
      previous: { id: 'dry-1', priority: 'low' },
      user: alice,
      apply: async (action) => performed.push(action.type),
      dryRun: true,
    });

    assert.ok(preview.applied.length >= 1);
    assert.ok(preview.applied.every((entry) => entry.dryRun));
    assert.deepEqual(performed, [], 'a dry run executed an action');
  });

  test('the quota counts and eventually says no', async () => {
    const first = await automation.consumeQuota(ORG_A, 1);
    assert.equal(first.exhausted, false);
    assert.ok(first.used >= 1);

    const blown = await automation.consumeQuota(ORG_A, first.allowed + 1);
    assert.equal(blown.exhausted, true, 'a runaway loop would have cost nothing');
  });
});

/* ------------------------------------------------------------------ */
/* Business rules                                                       */
/* ------------------------------------------------------------------ */

describe('business rules', { skip: SKIP }, () => {
  test('rules run in order and stop_processing stops the rest', async () => {
    const first = await automation.createBusinessRule(alice, ORG_B, {
      name: 'Blockers go to the lead',
      moduleKey: 'issue',
      criteria: [{ field: 'severity', operator: 'eq', value: 'blocker' }],
      actions: [{ type: 'assign', to: 'lead' }],
      stopProcessing: true,
      orderIndex: 0,
    });
    await automation.createBusinessRule(alice, ORG_B, {
      name: 'Everything else goes to the queue',
      moduleKey: 'issue',
      actions: [{ type: 'assign', to: 'queue' }],
      orderIndex: 1,
    });

    const performed = [];
    const applied = await automation.runBusinessRules({
      organizationId: ORG_B,
      moduleKey: 'issue',
      record: { id: 'i1', severity: 'blocker' },
      apply: async (action) => performed.push(action.to),
    });

    assert.equal(applied.length, 1, 'the second rule ran despite stop_processing');
    assert.deepEqual(performed, ['lead']);
    assert.equal(applied[0].ruleId, first.id);
  });

  test('without a stop, every matching rule runs', async () => {
    const performed = [];
    await automation.runBusinessRules({
      organizationId: ORG_B,
      moduleKey: 'issue',
      record: { id: 'i2', severity: 'minor' },
      apply: async (action) => performed.push(action.to),
    });
    assert.deepEqual(performed, ['queue']);
  });

  test('reordering changes which rule wins', async () => {
    const rules = await automation.businessRules(ORG_B, 'issue');
    await automation.reorderBusinessRules(ORG_B, [rules[1].id, rules[0].id]);

    const performed = [];
    await automation.runBusinessRules({
      organizationId: ORG_B,
      moduleKey: 'issue',
      record: { id: 'i3', severity: 'blocker' },
      apply: async (action) => performed.push(action.to),
    });
    // The catch-all is first now, and it does not stop, so both run.
    assert.deepEqual(performed, ['queue', 'lead']);
  });
});

/* ------------------------------------------------------------------ */
/* Blueprint                                                            */
/* ------------------------------------------------------------------ */

describe('blueprint', { skip: SKIP }, () => {
  let context;
  let created;

  before(async () => {
    if (SKIP) return;
    const project = await projects.create(alice, { name: 'Blueprint Test' });
    context = await contextFor(alice, project.id);

    created = await blueprint.createBlueprint(alice, ORG_A, {
      name: 'Task lifecycle',
      moduleKey: 'task',
    });

    const draft = await blueprint.saveDraft(alice, ORG_A, created.id, {
      transitions: [
        { name: 'Start', from: 'open', to: 'in_progress' },
        {
          name: 'Finish',
          from: 'in_progress',
          to: 'done',
          requiredFields: ['definitionOfDone'],
          requiresComment: true,
          allowedRoles: ['owner', 'manager'],
        },
      ],
    });
    await blueprint.publish(alice, ORG_A, draft.id);
  });

  test('a defined transition is allowed', async () => {
    const verdict = await blueprint.checkTransition({
      organizationId: ORG_A,
      moduleKey: 'task',
      entityType: 'task',
      entityId: 'bp-task-1',
      record: { id: 'bp-task-1' },
      fromStatusKey: 'open',
      toStatusKey: 'in_progress',
      context: { membership: { role: 'owner' }, permissions: [] },
    });
    assert.equal(verdict.allowed, true);
  });

  test('an undefined transition is refused, and the refusal says what is possible', async () => {
    const verdict = await blueprint.checkTransition({
      organizationId: ORG_A,
      moduleKey: 'task',
      entityType: 'task',
      entityId: 'bp-task-2',
      record: { id: 'bp-task-2' },
      fromStatusKey: 'open',
      toStatusKey: 'done',
      context: { membership: { role: 'owner' }, permissions: [] },
    });
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.reason, 'transition_not_defined');
    assert.deepEqual(verdict.available.map((t) => t.to), ['in_progress']);
  });

  test('a required field blocks the move and names what is missing', async () => {
    const verdict = await blueprint.checkTransition({
      organizationId: ORG_A,
      moduleKey: 'task',
      entityType: 'task',
      entityId: 'bp-task-3',
      record: { id: 'bp-task-3', definitionOfDone: '' },
      fromStatusKey: 'in_progress',
      toStatusKey: 'done',
      context: { membership: { role: 'owner' }, permissions: [] },
      comment: 'done',
    });
    assert.equal(verdict.allowed, false);
    assert.deepEqual(verdict.reason.detail, ['definitionOfDone']);
  });

  test('a required comment blocks the move', async () => {
    const verdict = await blueprint.checkTransition({
      organizationId: ORG_A,
      moduleKey: 'task',
      entityType: 'task',
      entityId: 'bp-task-4',
      record: { id: 'bp-task-4', definitionOfDone: 'Signed off' },
      fromStatusKey: 'in_progress',
      toStatusKey: 'done',
      context: { membership: { role: 'owner' }, permissions: [] },
      comment: '   ',
    });
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.reason, 'comment_required');
  });

  test('a role that is not permitted cannot make the move', async () => {
    const verdict = await blueprint.checkTransition({
      organizationId: ORG_A,
      moduleKey: 'task',
      entityType: 'task',
      entityId: 'bp-task-5',
      record: { id: 'bp-task-5', definitionOfDone: 'Signed off' },
      fromStatusKey: 'in_progress',
      toStatusKey: 'done',
      context: { membership: { role: 'member' }, permissions: [] },
      comment: 'finished',
    });
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.reason, 'role_not_permitted');
  });

  test('everything satisfied lets it through', async () => {
    const verdict = await blueprint.checkTransition({
      organizationId: ORG_A,
      moduleKey: 'task',
      entityType: 'task',
      entityId: 'bp-task-6',
      record: { id: 'bp-task-6', definitionOfDone: 'Signed off' },
      fromStatusKey: 'in_progress',
      toStatusKey: 'done',
      context: { membership: { role: 'manager' }, permissions: [] },
      comment: 'client accepted',
    });
    assert.equal(verdict.allowed, true);
  });

  test('enforceTransition refuses in the shape a route turns into HTTP', async () => {
    await assert.rejects(
      () =>
        blueprint.enforceTransition({
          organizationId: ORG_A,
          moduleKey: 'task',
          entityType: 'task',
          entityId: 'bp-task-7',
          record: { id: 'bp-task-7' },
          fromStatusKey: 'open',
          toStatusKey: 'done',
          context: { membership: { role: 'owner' }, permissions: [] },
        }),
      (error) => error.status === 409 && error.body.error === 'blueprint_transition_refused'
    );
  });

  test('a published version cannot be edited, only replaced', async () => {
    const version = await db.row(
      `SELECT id FROM qodo_projects.blueprint_versions
        WHERE blueprint_id = $1 AND state = 'published'`,
      [created.id]
    );
    await assert.rejects(
      () =>
        db.query('UPDATE qodo_projects.blueprint_versions SET definition = $2 WHERE id = $1', [
          version.id,
          JSON.stringify({ transitions: [] }),
        ]),
      /immutable/
    );
  });

  /**
   * The test the whole feature rests on.
   *
   * A record pinned to a version keeps obeying that version. Publishing a
   * stricter blueprint must not retroactively make a task somebody closed last
   * month illegal.
   */
  test('a record keeps the version it was attached to when a new one is published', async () => {
    // Pin the record to the current version by asking about it once.
    await blueprint.checkTransition({
      organizationId: ORG_A,
      moduleKey: 'task',
      entityType: 'task',
      entityId: 'bp-pinned',
      record: { id: 'bp-pinned' },
      fromStatusKey: 'open',
      toStatusKey: 'in_progress',
      context: { membership: { role: 'owner' }, permissions: [] },
    });

    // Publish a version that removes that transition entirely.
    const stricter = await blueprint.saveDraft(alice, ORG_A, created.id, {
      transitions: [{ name: 'Only cancel', from: 'open', to: 'cancelled' }],
    });
    await blueprint.publish(alice, ORG_A, stricter.id);

    const pinned = await blueprint.checkTransition({
      organizationId: ORG_A,
      moduleKey: 'task',
      entityType: 'task',
      entityId: 'bp-pinned',
      record: { id: 'bp-pinned' },
      fromStatusKey: 'open',
      toStatusKey: 'in_progress',
      context: { membership: { role: 'owner' }, permissions: [] },
    });
    assert.equal(pinned.allowed, true, 'publishing retroactively broke an existing record');

    // A record that has never been seen gets the new, stricter version.
    const fresh = await blueprint.checkTransition({
      organizationId: ORG_A,
      moduleKey: 'task',
      entityType: 'task',
      entityId: 'bp-fresh',
      record: { id: 'bp-fresh' },
      fromStatusKey: 'open',
      toStatusKey: 'in_progress',
      context: { membership: { role: 'owner' }, permissions: [] },
    });
    assert.equal(fresh.allowed, false, 'a new record was not governed by the published version');
  });

  test('migrating moves existing records onto the published version, deliberately', async () => {
    const result = await blueprint.migrateRecords(alice, ORG_A, created.id);
    assert.ok(result.migrated >= 1);

    const migrated = await blueprint.checkTransition({
      organizationId: ORG_A,
      moduleKey: 'task',
      entityType: 'task',
      entityId: 'bp-pinned',
      record: { id: 'bp-pinned' },
      fromStatusKey: 'open',
      toStatusKey: 'in_progress',
      context: { membership: { role: 'owner' }, permissions: [] },
    });
    assert.equal(migrated.allowed, false, 'migration did not move the record onto the new rules');
  });

  test('no blueprint at all means no restriction', async () => {
    const verdict = await blueprint.checkTransition({
      organizationId: ORG_B,
      moduleKey: 'task',
      entityType: 'task',
      entityId: 'unrestricted',
      record: { id: 'unrestricted' },
      fromStatusKey: 'anything',
      toStatusKey: 'anything_else',
      context: { membership: { role: 'viewer' }, permissions: [] },
    });
    assert.equal(verdict.allowed, true);
    assert.equal(verdict.reason, 'no_blueprint');
  });
});

/* ------------------------------------------------------------------ */
/* Reports                                                              */
/* ------------------------------------------------------------------ */

describe('reports', { skip: SKIP }, () => {
  let context;
  let project;

  before(async () => {
    if (SKIP) return;
    project = await projects.create(alice, { name: 'Report Test' });
    context = await contextFor(alice, project.id);

    const statuses = await metadata.statusesFor(ORG_A, 'task');
    const open = statuses.find((status) => status.category === 'open');
    const done = statuses.find((status) => status.category === 'done');

    await tasks.create(context, { title: 'One', statusId: open.id, estimatedHours: 8 });
    await tasks.create(context, { title: 'Two', statusId: open.id, estimatedHours: 4 });
    await tasks.create(context, { title: 'Three', statusId: done.id, estimatedHours: 2 });
  });

  test('a report groups and measures what it was asked for', async () => {
    const result = await reportService.run(alice, context, {
      module: 'task',
      groupBy: 'status',
      measure: 'count',
    });

    assert.equal(result.total, 3);
    const byBucket = Object.fromEntries(result.rows.map((row) => [row.bucket, row.value]));
    assert.equal(byBucket.Open, 2);
    assert.equal(byBucket.Done, 1);
  });

  test('a measure other than count aggregates the right column', async () => {
    const result = await reportService.run(alice, context, {
      module: 'task',
      groupBy: 'status',
      measure: 'estimated_hours',
    });
    assert.equal(result.total, 14);
  });

  test('a group-by outside the allowlist is refused rather than interpolated', async () => {
    for (const groupBy of ['id', 'title; DROP TABLE projects', 't.organization_id', '']) {
      await assert.rejects(
        () => reportService.run(alice, context, { module: 'task', groupBy, measure: 'count' }),
        (error) => error.body?.error === 'group_by_not_allowed',
        `groupBy=${groupBy} was accepted`
      );
    }
  });

  test('a measure outside the allowlist is refused', async () => {
    await assert.rejects(
      () => reportService.run(alice, context, { module: 'task', groupBy: 'status', measure: 'count(*) FROM users' }),
      (error) => error.body?.error === 'measure_not_allowed'
    );
  });

  test('a module that is not reportable is refused', async () => {
    await assert.rejects(
      () => reportService.run(alice, context, { module: 'users', groupBy: 'status', measure: 'count' }),
      (error) => error.body?.error === 'module_not_reportable'
    );
  });

  test('a money measure needs rate.view', async () => {
    const employeeContext = {
      ...context,
      permissionSet: { id: 'employee' },
      membership: { role: 'member', isClient: false },
    };
    await assert.rejects(
      () => reportService.run(alice, employeeContext, { module: 'time_log', groupBy: 'user', measure: 'cost' }),
      (error) => error.body?.missing === 'rate.view'
    );

    // And the builder does not offer what the engine would refuse.
    assert.ok(!reportService.availableMeasures(employeeContext, 'time_log').includes('cost'));

    // A *project manager* is refused too, and that is deliberate: knowing the
    // project is over budget is a project-management question, and knowing what
    // a colleague earns is not. Only a set carrying `rate.view` sees it.
    const managerContext = {
      ...context,
      permissionSet: { id: 'manager' },
      membership: { role: 'manager', isClient: false },
    };
    assert.ok(!reportService.availableMeasures(managerContext, 'time_log').includes('cost'));

    const withRates = {
      ...context,
      permissionSet: { id: 'admin' },
      membership: { role: 'owner', isClient: false },
    };
    assert.ok(reportService.availableMeasures(withRates, 'time_log').includes('cost'));
  });

  test('a report is scoped by membership, not by what was asked for', async () => {
    // Bob is not a member, so a portfolio report of his sees nothing of this
    // project — the same rule that governs opening it.
    const mine = await reportService.run(alice, null, {
      module: 'task',
      groupBy: 'project',
      measure: 'count',
    });
    const theirs = await reportService.run(bob, null, {
      module: 'task',
      groupBy: 'project',
      measure: 'count',
    });

    assert.ok(mine.rows.some((row) => row.bucket === 'Report Test'));
    assert.ok(!theirs.rows.some((row) => row.bucket === 'Report Test'));
  });

  test('a saved report stores its definition, not its rows', async () => {
    const saved = await reportService.save(alice, ORG_A, {
      name: 'Tasks by status',
      module: 'task',
      definition: { groupBy: 'status', measure: 'count' },
    });

    const reread = await reportService.getSaved(alice, ORG_A, saved.id);
    assert.equal(reread.definition.groupBy, 'status');
    assert.ok(!('rows' in reread.definition), 'a saved report froze its results');
  });

  test('a broken definition is refused when it is saved', async () => {
    await assert.rejects(
      () =>
        reportService.save(alice, ORG_A, {
          name: 'Broken',
          module: 'task',
          definition: { groupBy: 'nonsense', measure: 'count' },
        }),
      (error) => error.body?.error === 'group_by_not_allowed'
    );
  });

  test('a private report is not visible to anybody else', async () => {
    const saved = await reportService.save(alice, ORG_A, {
      name: 'Mine only',
      module: 'task',
      definition: { groupBy: 'status', measure: 'count' },
      visibility: 'private',
    });
    assert.equal(await reportService.getSaved(bob, ORG_A, saved.id), null);
    assert.ok(await reportService.getSaved(alice, ORG_A, saved.id));
  });
});

/* ------------------------------------------------------------------ */
/* Portfolio and workload                                               */
/* ------------------------------------------------------------------ */

describe('portfolio', { skip: SKIP }, () => {
  test('the portfolio only contains projects the reader may see', async () => {
    const mine = await reportService.portfolio(alice);
    const theirs = await reportService.portfolio(mallory);

    assert.ok(mine.projects.length > 0);
    assert.equal(theirs.projects.length, 0, 'another organization saw the portfolio');
  });

  test('at risk and delayed mean different things and both are stated', async () => {
    const late = await projects.create(alice, {
      name: 'Already Late',
      startDate: '2020-01-01',
      endDate: '2020-06-30',
    });
    const context = await contextFor(alice, late.id);
    await tasks.create(context, { title: 'Never finished', endDate: '2020-05-01' });

    const result = await reportService.portfolio(alice);
    const row = result.projects.find((project) => project.id === late.id);

    assert.equal(row.delayed, true, 'a project past its end date did not read as delayed');
    assert.equal(row.atRisk, true);
    assert.ok(row.overdueTasks >= 1);
    assert.ok(result.summary.delayed >= 1);
  });

  test('a project with nothing measured reports null rather than zero', async () => {
    const bare = await projects.create(alice, { name: 'Nothing Yet' });
    const result = await reportService.portfolio(alice);
    const row = result.projects.find((project) => project.id === bare.id);

    assert.equal(row.budgetHours, null);
    assert.equal(row.actualCost, null);
    assert.equal(row.taskCount, 0);
  });

  test('workload measures hours, not a count of tasks', async () => {
    const project = await projects.create(alice, { name: 'Workload Test' });
    const context = await contextFor(alice, project.id);
    const task = await tasks.create(context, { title: 'Heavy', estimatedHours: 40 });
    await tasks.setAssignees(context, task.id, [bob.id]);

    const result = await reportService.workload(alice, {});
    const row = result.people.find((person) => person.userId === bob.id);

    assert.ok(row, 'the assignee did not appear in the workload');
    // §53: a task count is not capacity. The hours are what is measured.
    assert.equal(row.assignedHours, 40);
    assert.equal(row.taskCount, 1);
  });
});

/* ------------------------------------------------------------------ */
/* Dashboards                                                           */
/* ------------------------------------------------------------------ */

describe('dashboards', { skip: SKIP }, () => {
  let dashboard;

  before(async () => {
    if (SKIP) return;
    dashboard = await dashboardService.create(alice, ORG_A, { name: 'Delivery board' });
  });

  test('a widget type outside the closed set is refused', async () => {
    await assert.rejects(
      () => dashboardService.addWidget(alice, ORG_A, dashboard.id, { type: 'iframe_anything' }),
      (error) => error.body?.error === 'widget_type_unknown'
    );
  });

  test('somebody else cannot add a widget to your dashboard', async () => {
    const result = await dashboardService.addWidget(bob, ORG_A, dashboard.id, {
      type: 'stat',
      title: 'Not yours',
    });
    assert.equal(result, null);
  });

  test('a dashboard renders its widgets through the report engine', async () => {
    const report = await reportService.save(alice, ORG_A, {
      name: 'Widget source',
      module: 'task',
      definition: { groupBy: 'status', measure: 'count' },
    });
    await dashboardService.addWidget(alice, ORG_A, dashboard.id, {
      type: 'report',
      reportId: report.id,
    });

    const rendered = await dashboardService.render(alice, null, ORG_A, dashboard.id);
    assert.equal(rendered.widgets.length, 1);
    assert.ok(rendered.widgets[0].data, 'the widget resolved no data');
    assert.equal(rendered.widgets[0].error, null);
  });

  test('one broken widget does not take the board down', async () => {
    await dashboardService.addWidget(alice, ORG_A, dashboard.id, {
      type: 'report',
      title: 'Broken',
      config: { definition: { module: 'task', groupBy: 'nonsense', measure: 'count' } },
    });

    const rendered = await dashboardService.render(alice, null, ORG_A, dashboard.id);
    assert.equal(rendered.widgets.length, 2);
    assert.ok(rendered.widgets.some((widget) => widget.error === 'group_by_not_allowed'));
    assert.ok(rendered.widgets.some((widget) => widget.data !== null), 'the good widget stopped rendering');
  });

  test('a private dashboard is not visible to anybody else', async () => {
    assert.equal(await dashboardService.render(bob, null, ORG_A, dashboard.id), null);
  });
});

/* ------------------------------------------------------------------ */
/* AI                                                                   */
/* ------------------------------------------------------------------ */

describe('ai', { skip: SKIP }, () => {
  let context;
  let clientContext;
  let internalTask;
  let sharedTask;

  before(async () => {
    if (SKIP) return;
    const project = await projects.create(alice, { name: 'AI Boundary Test' });
    context = await contextFor(alice, project.id);
    await projects.addMember(context, { userId: customer.id, role: 'client' });
    clientContext = await contextFor(customer, project.id);

    const internalList = await taskLists.create(context, { name: 'Internal', isExternal: false });
    const sharedList = await taskLists.create(context, { name: 'Shared', isExternal: true });

    internalTask = await tasks.create(context, { title: 'Internal costing', taskListId: internalList.id });
    sharedTask = await tasks.create(context, { title: 'Shared drawing', taskListId: sharedList.id });

    await collaboration.addComment(context, 'task', sharedTask.id, {
      body: 'Internally: pad the estimate by 20%',
      isInternal: true,
    });
    await collaboration.addComment(context, 'task', sharedTask.id, {
      body: 'Drawing issued for review',
      isInternal: false,
    });
  });

  /**
   * The most important AI test in the module.
   *
   * An AI layer that queries the database directly "because it needs context"
   * is a permission bypass with a friendly interface. This asserts the
   * retrieval path *is* the authorization path: a client cannot get a summary
   * of a task they cannot open, and the refusal happens before any model is
   * involved.
   */
  test('a client cannot get a summary of a task they cannot see', async () => {
    assert.equal(await aiService.summariseTask(clientContext, internalTask.id), null);
  });

  test('duplicate detection finds a reworded title and ignores an unrelated one', async () => {
    await tasks.create(context, { title: 'Pour the B2 slab' });

    const similar = await aiService.findSimilarTasks(context, 'Pour slab B2');
    assert.ok(
      similar.some((candidate) => candidate.title === 'Pour the B2 slab'),
      'a reworded duplicate was not spotted'
    );
    assert.ok(similar.every((candidate) => candidate.score >= 0.5));

    const unrelated = await aiService.findSimilarTasks(context, 'Install curtain wall glazing');
    assert.ok(!unrelated.some((candidate) => candidate.title === 'Pour the B2 slab'));
  });

  test('duplicate detection is scoped to the project', async () => {
    const elsewhere = await projects.create(alice, { name: 'Different Site' });
    const elsewhereContext = await contextFor(alice, elsewhere.id);
    await tasks.create(elsewhereContext, { title: 'Pour the B2 slab' });

    // Two projects now have that title. Searching one must not return the
    // other's — a similarity check that crosses projects is a disclosure.
    const similar = await aiService.findSimilarTasks(elsewhereContext, 'Pour slab B2');
    assert.equal(similar.length, 1);
  });

  test('a title too short to be meaningful returns nothing rather than everything', async () => {
    assert.deepEqual(await aiService.findSimilarTasks(context, 'fix'), []);
    assert.deepEqual(await aiService.findSimilarTasks(context, ''), []);
  });

  test('a capability refuses cleanly when no provider is configured', async () => {
    // The workspace's provider is unset in tests, and the honest answer is a
    // 503 that says so — not an empty summary the caller would render as one.
    if (aiService.available()) return;
    await assert.rejects(
      () => aiService.generate('description', 'Build a wall'),
      (error) => error.body?.error === 'ai_not_configured'
    );
  });

  test('an unknown generation kind is refused', async () => {
    await assert.rejects(
      () => aiService.generate('write_me_sql', 'anything'),
      (error) => error.body?.error === 'generation_kind_unknown'
    );
  });

  test('insights over an empty portfolio say so rather than inventing one', async () => {
    const result = await aiService.portfolioInsights(mallory);
    assert.deepEqual(result.insights, []);
    assert.equal(result.reason, 'no_projects_visible');
  });

  test('a question from somebody with no visible projects is answered honestly', async () => {
    const result = await aiService.askAboutProjects(mallory, 'What is late?');
    assert.equal(result.answer, null);
    assert.equal(result.reason, 'no_projects_visible');
    assert.deepEqual(result.sources, []);
  });
});

/* ------------------------------------------------------------------ */
/* Audit                                                                */
/* ------------------------------------------------------------------ */

describe('audit', { skip: SKIP }, () => {
  let project;

  before(async () => {
    if (SKIP) return;
    project = await projects.create(alice, { name: 'Audited Work' });
  });

  test('creating and updating a project both leave a record', async () => {
    await projects.update(await contextFor(alice, project.id), { name: 'Audited Work v2' });

    const history = await audit.historyOf({
      organizationId: ORG_A,
      entityType: 'project',
      entityId: project.id,
    });
    const actions = history.map((row) => row.action);
    assert.ok(actions.includes('project.create'));
    assert.ok(actions.includes('project.update'));
  });

  test('the audit log cannot be updated, even directly', async () => {
    await assert.rejects(
      () => db.query('UPDATE qodo_projects.audit_events SET action = $1 WHERE id > 0', ['tampered']),
      /append-only/
    );
  });

  test('the audit log cannot be deleted from, even directly', async () => {
    await assert.rejects(
      () => db.query('DELETE FROM qodo_projects.audit_events WHERE id > 0'),
      /append-only/
    );
  });

  test('a purge is recorded before the rows go', async () => {
    const doomed = await projects.create(alice, { name: 'To Be Erased' });
    await projects.softDelete(await contextFor(alice, doomed.id));
    await projects.purge(alice, doomed.id);

    const history = await audit.historyOf({
      organizationId: ORG_A,
      entityType: 'project',
      entityId: doomed.id,
    });
    assert.ok(
      history.some((row) => row.action === 'project.purge'),
      'purging left no evidence that the project ever existed'
    );
  });

  test('a rate is never written into the audit log', async () => {
    await audit.record({
      actor: alice,
      organizationId: ORG_A,
      entityType: 'test',
      entityId: 'rate-check',
      action: 'test.rate',
      before: { cost_rate: 100, name: 'A' },
      after: { cost_rate: 250, name: 'B' },
    });

    const [event] = await audit.historyOf({
      organizationId: ORG_A,
      entityType: 'test',
      entityId: 'rate-check',
    });
    assert.equal(event.before_state.cost_rate, '[redacted]');
    assert.equal(event.after_state.cost_rate, '[redacted]');
    assert.equal(event.after_state.name, 'B');
  });
});

/* ------------------------------------------------------------------ */
/* Pagination                                                           */
/* ------------------------------------------------------------------ */

describe('pagination', { skip: SKIP }, () => {
  test('a page is bounded however large a limit is asked for', async () => {
    const result = await projects.list(alice, { limit: 100000 });
    assert.ok(result.limit <= db.MAX_PAGE);
  });

  test('the total is the whole set, not the page', async () => {
    const page = await projects.list(alice, { limit: 1, scope: 'all' });
    assert.equal(page.projects.length, 1);
    assert.ok(page.total > 1);
  });
});
