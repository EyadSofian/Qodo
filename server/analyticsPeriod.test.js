import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalyticsPeriodError, analyticsPeriod, publicPeriod } from './analyticsPeriod.js';

test('analytics period is inclusive and compares with the same number of days', () => {
  const period = analyticsPeriod({ from: '2026-05-01', to: '2026-05-31' });
  assert.deepEqual(publicPeriod(period), {
    from: '2026-05-01',
    to: '2026-05-31',
    previousFrom: '2026-03-31',
    previousTo: '2026-04-30',
    days: 31,
  });
  assert.equal(period.toOdooExclusive, '2026-06-01 00:00:00');
});

test('analytics period refuses invalid and reversed dates', () => {
  assert.throws(
    () => analyticsPeriod({ from: '2026-02-30', to: '2026-03-01' }),
    AnalyticsPeriodError
  );
  assert.throws(
    () => analyticsPeriod({ from: '2026-08-02', to: '2026-08-01' }),
    AnalyticsPeriodError
  );
});
