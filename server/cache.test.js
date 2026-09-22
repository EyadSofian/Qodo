import assert from 'node:assert/strict';
import test from 'node:test';
import { makeCache } from './cache.js';

test('cache shares one in-flight load for simultaneous readers', async () => {
  const cache = makeCache(60_000);
  let loads = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const load = async () => {
    loads += 1;
    await gate;
    return { value: 7 };
  };

  const first = cache.get('catalogue', load);
  const second = cache.get('catalogue', load);
  assert.equal(loads, 1);
  release();

  assert.deepEqual(await first, { value: 7 });
  assert.deepEqual(await second, { value: 7 });
  assert.equal(loads, 1);
});

test('expire forces a fresh load but keeps the last good answer for a failure', async () => {
  const cache = makeCache(60_000);
  const first = await cache.get('schedule', async () => ({ rows: [1], fetchedAt: 'first' }));
  assert.deepEqual(first.rows, [1]);

  cache.expire();
  let loads = 0;
  const refreshed = await cache.get('schedule', async () => {
    loads += 1;
    return { rows: [2], fetchedAt: 'second' };
  });
  assert.equal(loads, 1);
  assert.deepEqual(refreshed.rows, [2]);

  cache.expire();
  const fallback = await cache.get('schedule', async () => {
    throw new Error('odoo_timeout');
  });
  assert.equal(fallback.stale, true);
  assert.deepEqual(fallback.rows, [2]);
  assert.ok(!Number.isNaN(Date.parse(fallback.fetchedAt)), 'stale answers carry the real sync time, not the epoch');
});
