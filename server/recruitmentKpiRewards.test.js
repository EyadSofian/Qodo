import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KPI_CATEGORIES, automaticEventKey, hiringTargetScore, kpiRules, recruiterKpi, validateWeights } from '../shared/recruitment/kpi.js';
import { DEFAULT_REWARD_RULES, jobEligibility, rewardCategoryFor, rewardProgress, validateRewardRules } from '../shared/recruitment/rewards.js';
import { resolveHRSettings } from '../shared/recruitment/settings.js';

const settings = resolveHRSettings({});

/* ── KPI ───────────────────────────────────────────────────────── */

test('the four categories are weighted 30 / 30 / 20 / 20 and total 100', () => {
  assert.deepEqual(KPI_CATEGORIES.map((category) => [category.id, category.weight]), [
    ['hr_review', 30],
    ['hiring_target', 30],
    ['commitment', 20],
    ['system_quality', 20],
  ]);
  assert.equal(KPI_CATEGORIES.reduce((sum, category) => sum + category.weight, 0), 100);
  assert.equal(validateWeights({ hr_review: 30, hiring_target: 30, commitment: 20, system_quality: 20 }), null);
  assert.equal(validateWeights({ hr_review: 30, hiring_target: 30, commitment: 20, system_quality: 25 }), 'kpi_weights_must_total_100');
});

test('a violation deducts its own points inside its category, never the whole weight', () => {
  const events = [
    { employeeCode: '257', period: '2026-09', category: 'hr_review', rule: 'candidate_mismatch', deduction: 5, createdAt: '2026-09-10T10:00:00Z' },
    { employeeCode: '257', period: '2026-09', category: 'system_quality', rule: 'cv_missing', deduction: 3, createdAt: '2026-09-11T10:00:00Z' },
  ];
  const kpi = recruiterKpi({ employeeCode: '257', period: '2026-09', requests: [], events, settings, today: '2026-09-30' });
  const byId = Object.fromEntries(kpi.categories.map((category) => [category.id, category]));
  assert.equal(byId.hr_review.score, 25);
  assert.equal(byId.system_quality.score, 17);
  assert.equal(byId.commitment.score, 20);
  assert.equal(byId.hiring_target.measured, false, 'no job decided this month');
  assert.equal(kpi.measuredWeight, 70);
  assert.equal(kpi.score, 62);
  assert.ok(Math.abs(kpi.percent - (62 / 70) * 100) < 1e-9);
});

test('a category never falls below zero however many deductions it collects', () => {
  const events = Array.from({ length: 12 }, (_, index) => ({
    employeeCode: '257', period: '2026-09', category: 'commitment', rule: 'punctuality', deduction: 4, createdAt: `2026-09-${String(index + 1).padStart(2, '0')}T08:00:00Z`,
  }));
  const kpi = recruiterKpi({ employeeCode: '257', period: '2026-09', requests: [], events, settings, today: '2026-09-30' });
  assert.equal(kpi.categories.find((category) => category.id === 'commitment').score, 0);
});

test('voided deductions stay visible in the breakdown but stop counting', () => {
  const events = [
    { id: 'e1', employeeCode: '257', period: '2026-09', category: 'system_quality', rule: 'cv_missing', deduction: 3, createdAt: '2026-09-10T10:00:00Z', voidedAt: '2026-09-12T10:00:00Z', voidReason: 'CV was attached offline' },
  ];
  const kpi = recruiterKpi({ employeeCode: '257', period: '2026-09', requests: [], events, settings, today: '2026-09-30' });
  const quality = kpi.categories.find((category) => category.id === 'system_quality');
  assert.equal(quality.score, 20);
  assert.equal(quality.events.length, 1);
  assert.equal(quality.events[0].rule.en, 'Accepted candidate without a CV in Odoo');
});

test('another recruiter\'s or another month\'s deductions never leak in', () => {
  const events = [
    { employeeCode: '420', period: '2026-09', category: 'hr_review', rule: 'offer_missing', deduction: 4 },
    { employeeCode: '257', period: '2026-08', category: 'hr_review', rule: 'offer_missing', deduction: 4 },
  ];
  const kpi = recruiterKpi({ employeeCode: '257', period: '2026-09', requests: [], events, settings, today: '2026-09-30' });
  assert.equal(kpi.categories.find((category) => category.id === 'hr_review').score, 30);
});

test('hiring target is 30 × on-time ÷ evaluated — 4 of 5 on time scores 24', () => {
  const sla = (startDate, completedAt) => ({ startDate, targetWorkingDays: 15, completedAt });
  const requests = [
    { id: 'a', recruiterCode: '257', status: 'completed', assignedAt: '2026-09-01T09:00:00Z', sla: { ...sla('2026-08-23', '2026-09-08'), slaMet: true } },
    { id: 'b', recruiterCode: '257', status: 'completed', assignedAt: '2026-09-01T09:00:00Z', sla: sla('2026-08-30', '2026-09-14') },
    { id: 'c', recruiterCode: '257', status: 'completed', assignedAt: '2026-09-02T09:00:00Z', sla: sla('2026-09-01', '2026-09-17') },
    { id: 'd', recruiterCode: '257', status: 'completed', assignedAt: '2026-09-03T09:00:00Z', sla: sla('2026-09-06', '2026-09-21') },
    // Due 2026-09-24, still open on the 30th: evaluated in September as not completed.
    { id: 'e', recruiterCode: '257', status: 'hiring', assignedAt: '2026-09-03T09:00:00Z', sla: { startDate: '2026-09-03', targetWorkingDays: 15 } },
    // Due next month: not judged yet.
    { id: 'f', recruiterCode: '257', status: 'hiring', assignedAt: '2026-09-20T09:00:00Z', sla: { startDate: '2026-09-20', targetWorkingDays: 60 } },
    // Somebody else's job.
    { id: 'g', recruiterCode: '420', status: 'completed', assignedAt: '2026-09-01T09:00:00Z', sla: sla('2026-09-01', '2026-09-10') },
  ];
  const target = hiringTargetScore({ employeeCode: '257', period: '2026-09', requests, weight: 30, today: '2026-09-30' });
  assert.equal(target.evaluated, 5);
  assert.equal(target.completedOnTime, 4);
  assert.equal(target.notCompleted, 1);
  assert.equal(target.assignedThisMonth, 6);
  assert.equal(target.score, 24);
  assert.deepEqual(target.jobs.map((job) => job.requestId).sort(), ['a', 'b', 'c', 'd', 'e']);
});

test('a late completion counts against the month it fell due in', () => {
  const requests = [{ id: 'late', recruiterCode: '257', status: 'completed', sla: { startDate: '2026-09-06', targetWorkingDays: 15, completedAt: '2026-10-05' } }];
  const september = hiringTargetScore({ employeeCode: '257', period: '2026-09', requests, weight: 30, today: '2026-10-10' });
  const october = hiringTargetScore({ employeeCode: '257', period: '2026-10', requests, weight: 30, today: '2026-10-10' });
  assert.equal(september.evaluated, 1);
  assert.equal(september.score, 0);
  assert.equal(october.evaluated, 0);
});

test('automatic findings have one stable identity so the clock raises them once', () => {
  assert.equal(automaticEventKey({ rule: 'cv_missing', requestId: 'r1', applicantId: 77 }), 'cv_missing|r1|77');
  assert.equal(automaticEventKey({ rule: 'odoo_job_not_linked', requestId: 'r1' }), 'odoo_job_not_linked|r1|-');
});

test('no rule judges appearance automatically; the presentation rule is manual, off by default and needs a written reason', () => {
  const rules = kpiRules(settings);
  const presentation = rules.find((rule) => rule.id === 'presentation_requirement');
  assert.equal(presentation.enabled, false);
  assert.equal(presentation.automatic, undefined);
  assert.equal(presentation.humanReviewOnly, true);
  assert.ok(presentation.minReasonLength >= 40);
  assert.equal(presentation.requiresJobField, 'presentationRequirement');
  for (const rule of rules.filter((item) => item.automatic)) {
    assert.doesNotMatch(`${rule.id} ${rule.en}`, /\b(appearance|looks?|presentation|gender|age|religion|nationality)\b/i);
  }
});

/* ── Rewards ───────────────────────────────────────────────────── */

const completed = (id, recruiterCode, classification, location, completedAt, slaMet = true) => ({
  id,
  recruiterCode,
  classification,
  location,
  locationCode: location,
  status: 'completed',
  sla: { startDate: '2026-08-01', targetWorkingDays: 30, completedAt, slaMet },
});

test('reward categories are priced by classification and location, location-specific first', () => {
  assert.equal(rewardCategoryFor({ classification: 'instructor', location: 'KSA' }).id, 'instructor_ksa');
  assert.equal(rewardCategoryFor({ classification: 'instructor', location: 'EG' }).id, 'instructor_eg');
  assert.equal(rewardCategoryFor({ classification: 'agent', location: 'EG' }).amountMin, 500);
  assert.equal(rewardCategoryFor({ classification: 'team_leader', location: 'KSA' }).amountMax, 650);
  assert.equal(rewardCategoryFor({ classification: 'senior', location: 'EG' }), null, 'no reward line exists for Senior yet');
  assert.equal(validateRewardRules(DEFAULT_REWARD_RULES), null);
});

test('exactly three qualifying jobs make a batch; two make progress', () => {
  const two = rewardProgress({
    employeeCode: '257',
    requests: [completed('a', '257', 'agent', 'EG', '2026-09-01'), completed('b', '257', 'agent', 'EG', '2026-09-05')],
  });
  assert.equal(two.proposals.length, 0);
  assert.deepEqual({ done: two.best.done, of: two.best.of }, { done: 2, of: 3 });

  const four = rewardProgress({
    employeeCode: '257',
    requests: ['a', 'b', 'c', 'd'].map((id, index) => completed(id, '257', 'agent', 'EG', `2026-09-0${index + 1}`)),
  });
  assert.equal(four.proposals.length, 1);
  assert.deepEqual(four.proposals[0].jobIds, ['a', 'b', 'c'], 'the three that waited longest');
  assert.equal(four.proposals[0].amountMin, 500);
  assert.equal(four.proposals[0].ruleVersion, 1);
  assert.equal(four.best.done, 1);
});

test('a job already in a batch is never counted again, and a cancelled batch hands its jobs back', () => {
  const requests = ['a', 'b', 'c'].map((id, index) => completed(id, '257', 'manager', 'EG', `2026-09-0${index + 1}`));
  const batched = rewardProgress({ employeeCode: '257', requests, batches: [{ id: 'x', status: 'approved', jobIds: ['a', 'b', 'c'] }] });
  assert.equal(batched.proposals.length, 0);
  assert.equal(batched.best.done, 0);
  const rejected = rewardProgress({ employeeCode: '257', requests, batches: [{ id: 'x', status: 'rejected', jobIds: ['a', 'b', 'c'] }] });
  assert.equal(rejected.proposals.length, 0, 'a rejected batch still consumed its jobs');
  const cancelled = rewardProgress({ employeeCode: '257', requests, batches: [{ id: 'x', status: 'cancelled', jobIds: ['a', 'b', 'c'] }] });
  assert.equal(cancelled.proposals.length, 1);
});

test('SLA and quality eligibility are enforced and explained', () => {
  const late = completed('late', '257', 'agent', 'EG', '2026-09-01', false);
  assert.deepEqual(jobEligibility(late).reasons, ['sla_not_met']);
  const flagged = completed('flagged', '257', 'agent', 'EG', '2026-09-01');
  assert.deepEqual(jobEligibility(flagged, { qualityFlags: new Set(['flagged']) }).reasons, ['quality_failed']);
  const legacyUnknown = { ...completed('legacy', '257', 'agent', 'EG', null), sla: { startDate: '2026-01-15', completedAt: null, slaMet: null } };
  assert.ok(jobEligibility(legacyUnknown).reasons.includes('not_completed'), 'a legacy job with no completion date never qualifies');
  const lenient = { ...DEFAULT_REWARD_RULES, eligibility: { requireCompleted: true, requireWithinSla: false, requireQualityPassed: true } };
  assert.equal(jobEligibility(late, { rules: lenient }).eligible, true);
});

test('categories fill separate pools unless the rules say mixed', () => {
  const requests = [
    completed('a', '257', 'agent', 'EG', '2026-09-01'),
    completed('b', '257', 'agent', 'EG', '2026-09-02'),
    completed('c', '257', 'manager', 'EG', '2026-09-03'),
  ];
  assert.equal(rewardProgress({ employeeCode: '257', requests }).proposals.length, 0);
  const mixed = rewardProgress({ employeeCode: '257', requests, rules: { ...DEFAULT_REWARD_RULES, grouping: 'mixed' } });
  assert.equal(mixed.proposals.length, 1);
  assert.equal(mixed.proposals[0].amountMin, (500 + 500 + 1200) / 3);
});

test('a batch keeps the rule version it was priced under', () => {
  const v2 = { ...DEFAULT_REWARD_RULES, version: 2, categories: DEFAULT_REWARD_RULES.categories.map((category) => (category.id === 'agent' ? { ...category, amountMin: 600, amountMax: 600 } : category)) };
  const requests = ['a', 'b', 'c'].map((id, index) => completed(id, '257', 'agent', 'EG', `2026-09-0${index + 1}`));
  const proposal = rewardProgress({ employeeCode: '257', requests, rules: v2 }).proposals[0];
  assert.equal(proposal.ruleVersion, 2);
  assert.equal(proposal.amountMin, 600);
  assert.equal(validateRewardRules({ ...v2, jobsPerBatch: 0 }), 'reward_jobs_per_batch_invalid');
  assert.equal(validateRewardRules({ ...v2, categories: [{ ...v2.categories[0], amountMin: 900, amountMax: 100 }] }), 'reward_category_amount_invalid');
});
