/**
 * Qodo Projects — the criteria language, without a database.
 *
 * Every rule engine in this module — custom views, layout rules, SLA policies,
 * workflow rules, business rules and Blueprint conditions — evaluates through
 * one function. That makes it the highest-leverage thing to test and the worst
 * thing to get wrong: an operator that quietly matches everything turns a
 * targeted rule into one that fires on every record in the company.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { OPERATORS, matches, resolveRange, test as evaluate, validate } from './projects/criteria.js';
import { ACTION_TYPES, MAX_DEPTH, idempotencyKey } from './projects/automationService.js';
import { SECRET_MASK, checkUrl, sign } from './projects/webhookService.js';

const task = {
  id: 't1',
  title: 'Pour the slab',
  priority: 'high',
  progress: 40,
  labels: ['concrete'],
  assigneeIds: [],
  status: { key: 'in_progress', category: 'active' },
};

/* ── operators ────────────────────────────────────────────────────── */

test('an unknown operator matches nothing', () => {
  // The failure this prevents: a typo in a rule turning it into "applies to
  // everything" rather than "applies to nothing".
  assert.equal(evaluate({ field: 'priority', operator: 'equals', value: 'high' }, task), false);
  assert.equal(evaluate({ field: 'priority', operator: '', value: 'high' }, task), false);
  assert.equal(evaluate({}, task), false);
});

test('equality and membership', () => {
  assert.equal(evaluate({ field: 'priority', operator: 'eq', value: 'high' }, task), true);
  assert.equal(evaluate({ field: 'priority', operator: 'ne', value: 'high' }, task), false);
  assert.equal(evaluate({ field: 'priority', operator: 'in', value: ['high', 'urgent'] }, task), true);
  assert.equal(evaluate({ field: 'priority', operator: 'not_in', value: ['high'] }, task), false);
  // A non-list value for a list operator matches nothing rather than throwing.
  assert.equal(evaluate({ field: 'priority', operator: 'in', value: 'high' }, task), false);
});

test('comparisons treat absent values as absent, not as zero', () => {
  assert.equal(evaluate({ field: 'progress', operator: 'gt', value: 30 }, task), true);
  assert.equal(evaluate({ field: 'progress', operator: 'lt', value: 30 }, task), false);
  // `estimatedHours` is not on this record. A missing number must not read as 0
  // and satisfy `lt: 10`.
  assert.equal(evaluate({ field: 'estimatedHours', operator: 'lt', value: 10 }, task), false);
  assert.equal(evaluate({ field: 'estimatedHours', operator: 'gt', value: 0 }, task), false);
});

test('emptiness understands strings, nulls and empty lists', () => {
  assert.equal(evaluate({ field: 'assigneeIds', operator: 'is_empty' }, task), true);
  assert.equal(evaluate({ field: 'labels', operator: 'is_not_empty' }, task), true);
  assert.equal(evaluate({ field: 'nothing', operator: 'is_empty' }, task), true);
});

test('text comparison is case-insensitive', () => {
  assert.equal(evaluate({ field: 'title', operator: 'contains', value: 'SLAB' }, task), true);
  assert.equal(evaluate({ field: 'title', operator: 'starts_with', value: 'pour' }, task), true);
  assert.equal(evaluate({ field: 'title', operator: 'not_contains', value: 'steel' }, task), true);
});

test('a dotted field reads one level down', () => {
  assert.equal(evaluate({ field: 'status.category', operator: 'eq', value: 'active' }, task), true);
  assert.equal(evaluate({ field: 'status.category', operator: 'eq', value: 'done' }, task), false);
});

/* ── change operators ─────────────────────────────────────────────── */

test('a change operator needs a previous state, and a creation has none', () => {
  // "Became urgent" is not the same rule as "is urgent", and firing the first
  // on every save is the difference between an alert and a nightly flood.
  assert.equal(evaluate({ field: 'priority', operator: 'changed' }, task, null), false);
  assert.equal(
    evaluate({ field: 'priority', operator: 'changed' }, task, { ...task, priority: 'normal' }),
    true
  );
  assert.equal(evaluate({ field: 'priority', operator: 'changed' }, task, task), false);
});

test('changed_to and changed_from name both ends', () => {
  const before = { ...task, priority: 'normal' };
  assert.equal(evaluate({ field: 'priority', operator: 'changed_to', value: 'high' }, task, before), true);
  assert.equal(evaluate({ field: 'priority', operator: 'changed_to', value: 'urgent' }, task, before), false);
  assert.equal(evaluate({ field: 'priority', operator: 'changed_from', value: 'normal' }, task, before), true);
});

/* ── criteria sets ────────────────────────────────────────────────── */

test('no conditions means the rule applies to the module', () => {
  assert.equal(matches(task, []), true);
  assert.equal(matches(task, null), true);
});

test('all and any behave, and an unrecognised match reads as all', () => {
  const conditions = [
    { field: 'priority', operator: 'eq', value: 'high' },
    { field: 'progress', operator: 'gt', value: 90 },
  ];
  assert.equal(matches(task, conditions, 'all'), false);
  assert.equal(matches(task, conditions, 'any'), true);
  // The narrower reading, because a typo must not widen a rule.
  assert.equal(matches(task, conditions, 'sometimes'), false);
});

/* ── validation ───────────────────────────────────────────────────── */

test('a rule with a typo is refused when it is saved, not when it silently fails', () => {
  assert.deepEqual(validate([{ field: 'priority', operator: 'eq', value: 'high' }]), []);

  const problems = validate([
    { operator: 'eq', value: 'x' },
    { field: 'priority', operator: 'equalz', value: 'x' },
    { field: 'priority', operator: 'in', value: 'not-a-list' },
  ]);
  assert.deepEqual(problems.map((problem) => problem.error), [
    'field_required',
    'operator_unknown',
    'value_must_be_a_list',
  ]);
});

test('every operator the validator accepts is one the evaluator handles', () => {
  // The two lists drifting is how an operator becomes savable and inert.
  for (const operator of OPERATORS) {
    const verdict = evaluate({ field: 'priority', operator, value: 'high' }, task, { ...task, priority: 'low' });
    assert.equal(typeof verdict, 'boolean', `${operator} did not return a boolean`);
  }
});

/* ── relative ranges ──────────────────────────────────────────────── */

test('a relative range resolves at read time, so a saved view keeps meaning what it said', () => {
  const [from, to] = resolveRange('last_7_days');
  assert.match(from, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(to, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(from < to);

  const [, overdueTo] = resolveRange('overdue');
  assert.ok(overdueTo < new Date().toISOString().slice(0, 10));

  assert.equal(resolveRange('whenever'), null);
});

/* ── automation ───────────────────────────────────────────────────── */

test('the action vocabulary is closed and contains nothing that executes', () => {
  assert.ok(ACTION_TYPES.length > 0);
  for (const forbidden of ['eval', 'run_script', 'exec', 'custom_function']) {
    assert.ok(!ACTION_TYPES.includes(forbidden), `${forbidden} is in the action list`);
  }
});

test('the idempotency key is stable for the same event and different for another', () => {
  const base = { ruleId: 'r1', entityType: 'task', entityId: 't1', trigger: 'update', fingerprint: 'priority' };
  assert.equal(idempotencyKey(base), idempotencyKey(base), 'a retry would not be recognised');
  assert.notEqual(idempotencyKey(base), idempotencyKey({ ...base, fingerprint: 'progress' }));
  assert.notEqual(idempotencyKey(base), idempotencyKey({ ...base, entityId: 't2' }));
  assert.notEqual(idempotencyKey(base), idempotencyKey({ ...base, ruleId: 'r2' }));
});

test('the depth limit is small enough to catch a loop quickly', () => {
  assert.ok(MAX_DEPTH >= 2 && MAX_DEPTH <= 10);
});

/* ── webhooks ─────────────────────────────────────────────────────── */

test('a webhook cannot be pointed at the network behind our server', async () => {
  // This is the whole of SSRF: without it, "add a webhook" means "make my
  // server fetch any internal URL and tell me what it said". 169.254.169.254 is
  // the cloud metadata service, which is where credentials live.
  for (const url of [
    'http://127.0.0.1/admin',
    'http://localhost:5432',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/',
    'http://192.168.1.1/',
  ]) {
    const verdict = await checkUrl(url);
    assert.equal(verdict.ok, false, `${url} was allowed`);
    assert.equal(verdict.reason, 'address_not_allowed');
  }
});

test('a webhook must be a real http URL', async () => {
  assert.equal((await checkUrl('file:///etc/passwd')).reason, 'protocol_not_allowed');
  assert.equal((await checkUrl('not a url')).reason, 'url_invalid');
  assert.equal((await checkUrl('ftp://example.com')).reason, 'protocol_not_allowed');
});

test('the signature covers the timestamp, so a delivery cannot be replayed', () => {
  const body = JSON.stringify({ event: 'task.created' });
  const first = sign('secret', 1000, body);
  const second = sign('secret', 2000, body);
  assert.notEqual(first, second, 'the same body signs identically at any time');
  assert.equal(first, sign('secret', 1000, body));
  assert.notEqual(first, sign('other-secret', 1000, body));
});

test('the secret mask is not a secret', () => {
  assert.ok(SECRET_MASK.length > 0);
  assert.ok(!/[a-zA-Z0-9]/.test(SECRET_MASK), 'the mask looks like it could be a value');
});
