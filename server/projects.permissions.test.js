/**
 * Qodo Projects — authorization, without a database.
 *
 * Everything here is pure: the permission catalogue, the client boundary, the
 * role narrowing, the audit redaction and the key derivation. They are the
 * rules that decide who sees what, so they are tested where they can run on
 * every machine and in every CI job rather than only where PostgreSQL happens
 * to be installed.
 *
 * The database-backed half lives in `projects.integration.test.js` and skips
 * loudly when there is no test database, so a green run never quietly means
 * "the isolation tests did not execute".
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ALL_PROJECT_PERMISSIONS,
  CLIENT_SAFE_PERMISSIONS,
  PERMISSION_SETS,
  PROJECT_PERMISSIONS as P,
  PROJECT_ROLES,
  canInProject,
  isClientSet,
  permissionsOfSet,
  visibleToClient,
} from '../shared/projects/permissions.js';
import { diff, REDACTED_FIELDS } from './projects/auditService.js';
import { mayManageDemoData } from './projects/demoDataService.js';
import { deriveKey } from './projects/projectService.js';
import { RESTRICTED_RATE_FIELDS } from './projects/projectAccess.js';

const context = (setId, role, overrides = {}) => ({
  permissionSet: PERMISSION_SETS[setId],
  membership: { role, isClient: role === 'client', ...overrides },
});

/* ── the catalogue ────────────────────────────────────────────────── */

test('every permission key is unique and namespaced', () => {
  const keys = ALL_PROJECT_PERMISSIONS;
  assert.equal(new Set(keys).size, keys.length, 'duplicate permission key');
  for (const key of keys) {
    assert.match(key, /^[a-z_]+\.[a-z_]+$/, `${key} is not module.action`);
  }
});

test('every permission in every set exists in the catalogue', () => {
  const known = new Set(ALL_PROJECT_PERMISSIONS);
  for (const [id, set] of Object.entries(PERMISSION_SETS)) {
    for (const key of set.permissions) {
      assert.ok(known.has(key), `set ${id} grants unknown permission ${key}`);
    }
  }
});

test('the administrator set tracks the catalogue automatically', () => {
  // The point of deriving admin from the catalogue is that adding a permission
  // never strands the person whose job is to grant it. If this ever fails,
  // somebody has typed the admin list out by hand.
  assert.deepEqual(
    [...PERMISSION_SETS.admin.permissions].sort(),
    [...ALL_PROJECT_PERMISSIONS].sort()
  );
});

test('three keys belong to no set except administrator', () => {
  // developer.manage runs customer-authored scripts on our server;
  // permissions.manage can grant every other key including itself;
  // project.purge destroys what the recycle bin exists to protect.
  for (const key of [P.DEVELOPER_MANAGE, P.PERMISSIONS_MANAGE, P.PROJECT_PURGE]) {
    for (const [id, set] of Object.entries(PERMISSION_SETS)) {
      if (id === 'admin') continue;
      assert.ok(!set.permissions.includes(key), `${id} must not carry ${key}`);
    }
  }
});

/* ── the demo-data gate ───────────────────────────────────────────── */

/**
 * The demo endpoint is the only one in the module that creates workspace user
 * accounts, so it asks for two separate grants rather than one. These check
 * that neither half is sufficient alone — which is the whole of the rule.
 */
test('loading demo data needs the Projects administrator set', () => {
  for (const id of ['manager', 'employee', 'client']) {
    assert.equal(
      mayManageDemoData({ role: 'admin' }, PERMISSION_SETS[id]),
      false,
      `${id} could load demo data with only a workspace admin role`
    );
  }
});

test('loading demo data needs the workspace administrator role as well', () => {
  // Holding every Projects permission is authority over projects. Creating
  // logins for the company is a different decision, and this is where the two
  // are kept apart.
  for (const role of ['manager', 'member', 'viewer', undefined]) {
    assert.equal(
      mayManageDemoData({ role }, PERMISSION_SETS.admin),
      false,
      `a ${role ?? 'role-less'} user could load demo data with the admin permission set`
    );
  }
});

test('both keys together are what opens it', () => {
  assert.equal(mayManageDemoData({ role: 'admin' }, PERMISSION_SETS.admin), true);
});

test('an absent user is refused rather than crashing the guard', () => {
  assert.equal(mayManageDemoData(null, PERMISSION_SETS.admin), false);
  assert.equal(mayManageDemoData(undefined, undefined), false);
});

/* ── deny by default ──────────────────────────────────────────────── */

test('a non-member is refused everything, including reading', () => {
  const outsider = { permissionSet: PERMISSION_SETS.admin, membership: null };
  for (const key of ALL_PROJECT_PERMISSIONS) {
    assert.equal(canInProject(outsider, key), false, `non-member allowed ${key}`);
  }
});

test('an unknown permission is denied rather than ignored', () => {
  assert.equal(canInProject(context('admin', 'owner'), 'project.take_over_the_company'), false);
});

test('an empty context is a refusal, not a crash', () => {
  assert.equal(canInProject(undefined, P.PROJECT_VIEW), false);
  assert.equal(canInProject({}, P.PROJECT_VIEW), false);
});

/* ── the client boundary ──────────────────────────────────────────── */

test('a client is refused every permission outside the client-safe list', () => {
  const client = context('client', 'client');
  const safe = new Set(CLIENT_SAFE_PERMISSIONS);
  for (const key of ALL_PROJECT_PERMISSIONS) {
    if (safe.has(key)) continue;
    assert.equal(canInProject(client, key), false, `client allowed ${key}`);
  }
});

test('the client-safe list contains nothing that reveals internal work', () => {
  // The specific keys a customer must never hold, whatever anybody ticks.
  const forbidden = [
    P.COMMENT_INTERNAL,
    P.TIME_VIEW,
    P.TIME_LOG,
    P.BUDGET_VIEW,
    P.RATE_VIEW,
    P.REPORTS_VIEW,
    P.REPORTS_FINANCE,
    P.AUDIT_VIEW,
    P.CUSTOMIZATION_MANAGE,
    P.AUTOMATION_MANAGE,
    P.PROJECT_MANAGE_MEMBERS,
    P.TASK_CREATE,
    P.TASK_EDIT,
  ];
  for (const key of forbidden) {
    assert.ok(
      !CLIENT_SAFE_PERMISSIONS.includes(key),
      `${key} has been added to the client-safe list — that is a data leak, not a feature`
    );
  }
});

test('a client permission set cannot be escaped by giving the person a staff role', () => {
  // The failure this guards: an administrator sets a customer's project role to
  // "manager" by mistake. The permission set still says client, and that is the
  // reading that must win.
  const confused = { permissionSet: PERMISSION_SETS.client, membership: { role: 'manager', isClient: false } };
  assert.equal(canInProject(confused, P.PROJECT_EDIT), false);
  assert.equal(canInProject(confused, P.BUDGET_VIEW), false);
  assert.equal(canInProject(confused, P.PROJECT_VIEW), true);
});

test('a client membership cannot be escaped by giving the person a staff permission set', () => {
  // The mirror of the previous test, and the more dangerous direction: the
  // membership row says client, the set says manager. Client still wins.
  const confused = { permissionSet: PERMISSION_SETS.manager, membership: { role: 'client', isClient: true } };
  assert.equal(canInProject(confused, P.BUDGET_VIEW), false);
  assert.equal(canInProject(confused, P.TIME_VIEW), false);
  assert.equal(canInProject(confused, P.COMMENT_INTERNAL), false);
});

test('visibleToClient hides internal records whichever way the flag is spelled', () => {
  assert.equal(visibleToClient({ isInternal: true }), false);
  assert.equal(visibleToClient({ isExternal: false }), false);
  assert.equal(visibleToClient({ isExternal: true }), true);
  assert.equal(visibleToClient({}), true);
  assert.equal(visibleToClient(null), false);
});

/* ── roles narrow, never widen ────────────────────────────────────── */

test('a viewer cannot write even with the administrator permission set', () => {
  const viewer = context('admin', 'viewer');
  assert.equal(canInProject(viewer, P.PROJECT_VIEW), true);
  assert.equal(canInProject(viewer, P.TASK_VIEW), true);
  assert.equal(canInProject(viewer, P.TASK_CREATE), false);
  assert.equal(canInProject(viewer, P.TASK_EDIT), false);
  assert.equal(canInProject(viewer, P.PROJECT_DELETE), false);
  assert.equal(canInProject(viewer, P.TIMESHEET_APPROVE), false);
});

test('a member is not a manager, however senior their permission set', () => {
  const member = context('manager', 'member');
  assert.equal(canInProject(member, P.TASK_EDIT), true);
  // Withheld by the role regardless of the set.
  assert.equal(canInProject(member, P.PROJECT_EDIT), false);
  assert.equal(canInProject(member, P.PROJECT_MANAGE_MEMBERS), false);
  assert.equal(canInProject(member, P.TIMESHEET_APPROVE), false);
  assert.equal(canInProject(member, P.RATE_VIEW), false);
  assert.equal(canInProject(member, P.BUDGET_MANAGE), false);
});

test('a manager role plus a manager set can run the project', () => {
  const manager = context('manager', 'manager');
  for (const key of [
    P.PROJECT_EDIT,
    P.PROJECT_MANAGE_MEMBERS,
    P.TASK_ASSIGN,
    P.TASK_EDIT_SCHEDULE,
    P.TIMESHEET_APPROVE,
    P.BUDGET_MANAGE,
  ]) {
    assert.equal(canInProject(manager, key), true, `manager refused ${key}`);
  }
});

test('an employee cannot assign, approve, budget or see a rate', () => {
  const employee = context('employee', 'member');
  assert.equal(canInProject(employee, P.TASK_EDIT), true);
  assert.equal(canInProject(employee, P.TIME_LOG), true);
  assert.equal(canInProject(employee, P.TASK_ASSIGN), false);
  assert.equal(canInProject(employee, P.TIMESHEET_APPROVE), false);
  assert.equal(canInProject(employee, P.BUDGET_VIEW), false);
  assert.equal(canInProject(employee, P.RATE_VIEW), false);
});

test('a contractor is an employee without the internal conversation', () => {
  const contractor = context('contractor', 'member');
  assert.equal(canInProject(contractor, P.TASK_EDIT), true);
  assert.equal(canInProject(contractor, P.TIME_LOG), true);
  assert.equal(canInProject(contractor, P.COMMENT_INTERNAL), false);
  assert.equal(canInProject(contractor, P.FORUM_VIEW), false);
  assert.equal(canInProject(contractor, P.REPORTS_VIEW), false);
});

test('an explicit permission array on a set replaces the built-in template', () => {
  const custom = {
    permissionSet: { id: 'employee', isClient: false, permissions: [P.PROJECT_VIEW] },
    membership: { role: 'member' },
  };
  assert.equal(canInProject(custom, P.PROJECT_VIEW), true);
  // The employee template grants this; the explicit array does not, and the
  // explicit array is what an administrator actually ticked.
  assert.equal(canInProject(custom, P.TASK_EDIT), false);
});

test('permissionsOfSet and isClientSet read a stored row the same as a built-in', () => {
  assert.deepEqual(permissionsOfSet({ id: 'client' }), PERMISSION_SETS.client.permissions);
  assert.deepEqual(permissionsOfSet({ id: 'client', permissions: ['a'] }), ['a']);
  assert.equal(isClientSet({ id: 'client' }), true);
  assert.equal(isClientSet({ id: 'manager' }), false);
  assert.equal(isClientSet({ id: 'anything', isClient: true }), true);
  assert.equal(isClientSet(null), false);
});

test('an unrecognised role is treated as a viewer, not as an owner', () => {
  const nonsense = context('admin', 'chief-wizard');
  assert.equal(canInProject(nonsense, P.PROJECT_VIEW), true);
  assert.equal(canInProject(nonsense, P.PROJECT_DELETE), false);
});

test('the project role table has no client role that ranks above a member', () => {
  assert.equal(PROJECT_ROLES.client.isClient, true);
  assert.equal(PROJECT_ROLES.client.rank, 0);
});

/* ── audit ────────────────────────────────────────────────────────── */

test('diff reports only what changed', () => {
  const changes = diff({ name: 'A', color: 'red' }, { name: 'B', color: 'red' });
  assert.deepEqual(changes, { name: ['A', 'B'] });
});

test('diff does not report a change when only the representation differs', () => {
  assert.deepEqual(diff({ due: null }, { due: undefined }), {});
  assert.deepEqual(diff({ n: 1 }, { n: 1 }), {});
});

test('diff treats an added field as a change from null', () => {
  assert.deepEqual(diff({}, { owner: 'u1' }), { owner: [null, 'u1'] });
  assert.deepEqual(diff({ owner: 'u1' }, {}), { owner: ['u1', null] });
});

test('diff never writes a rate or a secret into the audit log', () => {
  const changes = diff(
    { cost_rate: 100, secret: 'old', name: 'A' },
    { cost_rate: 250, secret: 'new', name: 'B' }
  );
  assert.deepEqual(changes.cost_rate, ['[redacted]', '[redacted]']);
  assert.deepEqual(changes.secret, ['[redacted]', '[redacted]']);
  assert.deepEqual(changes.name, ['A', 'B']);
});

test('the redaction list still covers every rate field the projection strips', () => {
  // These two lists protect the same secret in two places — the record on the
  // way out, and its history. If one grows, the other has to.
  for (const field of RESTRICTED_RATE_FIELDS) {
    if (!field.toLowerCase().includes('rate')) continue;
    assert.ok(
      REDACTED_FIELDS.includes(field),
      `${field} is stripped from records but would be written into the audit log`
    );
  }
});

/* ── project keys ─────────────────────────────────────────────────── */

test('a project key is derived as a readable abbreviation', () => {
  assert.equal(deriveKey('Engosoft Tower'), 'ET');
  assert.equal(deriveKey('Bridge'), 'BRID');
  assert.equal(deriveKey('New Cairo Business District'), 'NCBD');
});

test('key derivation survives punctuation, Arabic and emptiness', () => {
  assert.equal(deriveKey('Al-Rehab / Phase 2'), 'ARP2');
  // Arabic has no Latin letters to abbreviate, so it falls back rather than
  // producing an empty key that would then collide with every other one.
  assert.equal(deriveKey('برج إنجوسوفت'), 'PRJ');
  assert.equal(deriveKey(''), 'PRJ');
  assert.equal(deriveKey(null), 'PRJ');
  assert.equal(deriveKey('!!!'), 'PRJ');
});
