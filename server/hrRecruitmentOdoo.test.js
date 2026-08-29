import assert from 'node:assert/strict';
import { test } from 'node:test';
import { __test } from './hrRecruitmentOdoo.js';

test('Odoo recruitment matching tolerates the spelling errors in the HR workbook', () => {
  assert.equal(__test.clean('Vedio Editor Noraml'), 'video editor');
  const match = __test.bestJob('E-Commerce Team Leader Noraml', [
    { id: 7, name: 'Ecommerce Team Leader' },
    { id: 8, name: 'Sales Team Leader' },
  ]);
  assert.equal(match?.job.id, 7);
  assert.ok(match.score > 0.8);
});

test('ambiguous low-confidence Odoo jobs are deliberately left unmatched', () => {
  assert.equal(__test.bestJob('Specialist', [
    { id: 1, name: 'HR Specialist' },
    { id: 2, name: 'Payroll Specialist' },
  ]), null);
});
