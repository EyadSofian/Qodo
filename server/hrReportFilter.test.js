import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countReportRows, matchesReportFilter } from '../shared/hrReportFilter.js';

const rows = [
  { id: 'a', outcome: 'met', completed: 2, percent: 64.5, hiringDate: '2026-09-03', location: 'EG', workingDays: 12 },
  { id: 'b', outcome: 'missed', completed: 0, percent: 88, hiringDate: '2026-08-30', location: 'KSA', workingDays: null },
  { id: 'c', outcome: 'overdue', completed: 1, percent: null, hiringDate: null, location: 'EG', workingDays: 0 },
];

test('no filter keeps every row', () => {
  assert.equal(countReportRows(rows, null), 3);
});

test('eq and in compare exactly', () => {
  assert.equal(countReportRows(rows, { eq: { outcome: 'met' } }), 1);
  assert.equal(countReportRows(rows, { in: { outcome: ['met', 'missed'] } }), 2);
  assert.equal(countReportRows(rows, { eq: { outcome: 'met', location: 'KSA' } }), 0, 'every condition must hold');
});

test('gte and lt are numeric and never match an empty value', () => {
  assert.equal(countReportRows(rows, { gte: { completed: 1 } }), 2);
  assert.equal(countReportRows(rows, { lt: { percent: 70 } }), 1, 'a missing score is not "below 70"');
});

test('prefix and present', () => {
  assert.equal(countReportRows(rows, { prefix: { hiringDate: '2026-09' } }), 1);
  assert.equal(countReportRows(rows, { present: ['workingDays'] }), 2, 'zero is a value; null is not');
  assert.equal(matchesReportFilter(rows[2], { present: ['hiringDate'] }), false);
});
