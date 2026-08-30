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

test('generic Odoo jobs never swallow a more specific workbook request', () => {
  assert.equal(__test.bestJob('Power BI', [{ id: 1, name: 'Power' }]), null);
  assert.equal(__test.bestJob('SCADA Instructor', [{ id: 2, name: 'Instructor' }]), null);
  assert.equal(__test.bestJob('Telesales (KSA)', [{ id: 3, name: 'Telesales' }]), null);
  assert.equal(__test.bestJob('Interior Instructor (Women)', [{ id: 4, name: 'Instructor' }]), null);
});

test('known Odoo role suffixes can make the job more specific without changing its meaning', () => {
  const match = __test.bestJob('OSHA', [
    { id: 1, name: 'OSHA Instructor' },
    { id: 2, name: 'Instructor' },
  ]);
  assert.equal(match?.job.id, 1);
  assert.equal(match?.score, 0.92);
});

test('normalisation still joins equivalent role names', () => {
  assert.equal(__test.bestJob('Senior/System Admin', [
    { id: 1, name: 'Senior System Administrator' },
  ])?.score, 1);
  assert.equal(__test.bestJob('CAMA2', [
    { id: 2, name: 'CAMA' },
  ])?.score, 1);
});

test('an HR-reviewed manual link overrides conservative automatic matching', () => {
  const request = { id: 'req-ksa', role: 'Telesales (KSA)' };
  const jobs = [
    { id: 20, name: 'Telesales' },
    { id: 21, name: 'Sales Team Leader' },
  ];
  assert.equal(__test.resolvedJob(request, jobs), null);
  assert.deepEqual(__test.resolvedJob(request, jobs, { 'req-ksa': 20 }), {
    job: jobs[0],
    score: 1,
    matchType: 'manual',
  });
});

test('a removed Odoo job leaves a visible stale manual link instead of guessing a replacement', () => {
  assert.deepEqual(__test.resolvedJob(
    { id: 'req-old', role: 'Instructor' },
    [{ id: 2, name: 'Instructor' }],
    { 'req-old': 999 }
  ), { invalidManual: true });
});

test('manual review suggestions rank similar titles but never create a link themselves', () => {
  const jobs = [
    { id: 1, name: 'Telesales', active: true, department_id: [7, 'Sales'] },
    { id: 2, name: 'HR Manager', active: true, department_id: [8, 'HR'] },
  ];
  const state = { applicantsAvailable: true, applicantByJob: new Map([[1, 12], [2, 3]]) };
  const suggestions = __test.suggestedJobs('Telesales (KSA)', jobs, state);
  assert.equal(suggestions[0].jobId, 1);
  assert.equal(suggestions[0].applicantCount, 12);
  assert.ok(suggestions[0].suggestionScore > 0.5);
});
