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
