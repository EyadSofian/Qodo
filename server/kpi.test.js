import assert from 'node:assert/strict';
import test from 'node:test';
import {
  KPI_AUDIENCES,
  KPI_CHECK_STATES,
  KPI_RATINGS,
  KPI_TEMPLATES,
  kpiChecklistRatio,
  kpiRatingFor,
  kpiRawRatio,
  kpiTemplateById,
  scoreScorecard,
} from '../shared/kpi.js';
import { KPI_SEED_RECORDS } from '../shared/kpiRecords.js';

const close = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: expected ${expected}, got ${actual}`);

test('every approved workbook is represented and each one totals 100 points', () => {
  assert.equal(KPI_TEMPLATES.length, 5);
  assert.equal(new Set(KPI_TEMPLATES.map((template) => template.id)).size, 5);
  const audiences = new Set(KPI_AUDIENCES.map((item) => item.id));
  for (const template of KPI_TEMPLATES) {
    assert.ok(audiences.has(template.audience), `${template.id} has an unknown audience`);
    close(
      template.groups.reduce((sum, group) => sum + group.weight, 0),
      100,
      `${template.id} weights`
    );
    assert.ok(template.groups.length, `${template.id} has no axes`);
    const ids = new Set();
    for (const group of template.groups) {
      assert.ok(group.kpis.length, `${group.id} of ${template.id} has no KPIs`);
      for (const kpi of [...group.kpis, ...group.checklist]) {
        assert.ok(kpi.ar.trim(), `${template.id}/${group.id} has an unnamed row`);
        assert.ok(!ids.has(kpi.id), `${template.id} repeats row id ${kpi.id}`);
        ids.add(kpi.id);
      }
      for (const kpi of group.kpis) {
        assert.ok(kpi.weight > 0, `${kpi.id} has no weight`);
        assert.ok(['higher', 'lower'].includes(kpi.direction), `${kpi.id} has no direction`);
      }
    }
  }
});

test('a group score is its KPI weights whichever family the template belongs to', () => {
  // The HR workbooks weight in absolute points that already sum to the axis…
  for (const group of kpiTemplateById('recruitment_specialist').groups) {
    close(group.kpis.reduce((sum, kpi) => sum + kpi.weight, 0), group.weight, `${group.id} points`);
  }
  // …while the marketing card weights each sub-KPI as a share of its category.
  for (const group of kpiTemplateById('marketing_manager').groups) {
    close(group.kpis.reduce((sum, kpi) => sum + kpi.weight, 0), 1, `${group.id} shares`);
  }
});

test('the recruitment card reproduces the approved July figures for ياسمين اشرف', () => {
  const template = kpiTemplateById('recruitment_specialist');
  const actuals = {
    'kpi-1-1': 1, 'kpi-1-2': 1, 'kpi-1-3': 48,
    'kpi-2-1': 5, 'kpi-2-2': 0.2, 'kpi-2-3': 0.9,
    'kpi-3-1': 48, 'kpi-3-2': 1, 'kpi-3-3': 0.7,
    'kpi-4-1': 50, 'kpi-4-2': 0.85, 'kpi-4-3': 0.05,
    'kpi-5-1': 0.8, 'kpi-5-2': 1, 'kpi-5-3': 1,
  };
  const result = scoreScorecard(template, {
    values: Object.fromEntries(Object.entries(actuals).map(([id, actual]) => [id, { actual }])),
  });

  const byId = Object.fromEntries(result.groups.map((group) => [group.id, group]));
  close(byId['axis-1'].score, 20, 'requests axis');
  close(byId['axis-2'].score, 16.571428571428573, 'sourcing axis');
  close(byId['axis-3'].score, 20, 'screening axis');
  close(byId['axis-4'].score, 16.4, 'cycle speed axis');
  close(byId['axis-5'].score, 20, 'offers axis');
  close(result.approved.score, 92.97142857142856, 'approved total');
  assert.equal(result.approved.rating.id, 'excellent');
  // Nobody has reviewed the checklist yet, so verification must not scale the
  // score down — an unopened checklist is not a failed one.
  assert.equal(result.verification.ratio, null);
  assert.equal(result.completeness.complete, false);
});

test('the HR manager card reproduces the approved planning axis, including its lower-is-better rows', () => {
  const template = kpiTemplateById('hr_manager');
  const result = scoreScorecard(template, {
    values: {
      'kpi-1-1': { actual: 5 },
      'kpi-1-2': { actual: 3 },
      'kpi-1-3': { actual: 4 },
      'kpi-1-4': { actual: 5 },
    },
  });
  const planning = result.groups.find((group) => group.id === 'axis-1');
  close(planning.score, 19, 'planning axis');
  close(planning.ratio, 0.95, 'planning ratio');
  // Beating a lower-is-better target is capped, never rewarded past 100%.
  close(planning.kpis.find((kpi) => kpi.id === 'kpi-1-2').ratio, 1, 'time to fill');
  close(planning.kpis.find((kpi) => kpi.id === 'kpi-1-4').ratio, 0.8, 'cost per hire');
  // The four unanswered axes are absent from the denominator, not scored zero.
  close(result.approved.max, 20, 'measured weight');
  close(result.approved.percent, 95, 'measured percent');
});

test('a checklist multiplies the recruitment score and skips its not-applicable rows', () => {
  const template = kpiTemplateById('recruitment_specialist');
  const [axis] = template.groups;
  const values = Object.fromEntries(axis.kpis.map((kpi) => [kpi.id, { actual: kpi.target }]));

  const perfect = scoreScorecard(template, {
    values,
    checks: Object.fromEntries(axis.checklist.map((item) => [item.id, 'done'])),
  });
  close(perfect.groups[0].score, 20, 'fully verified axis');

  const partial = scoreScorecard(template, {
    values,
    checks: Object.fromEntries(
      axis.checklist.map((item, index) => [item.id, index === 0 ? 'missed' : index === 1 ? 'na' : 'done'])
    ),
  });
  // Six items, one missed, one not applicable: 4 of the 5 counted rows pass.
  close(partial.groups[0].checklist.ratio, 0.8, 'verification rate');
  close(partial.groups[0].score, 16, 'verified axis');
});

test('the sales card pays a tiered entitlement rather than the raw achievement', () => {
  const template = kpiTemplateById('sales_operations_manager');
  const at = (achievement) =>
    scoreScorecard(template, { values: { 'kpi-1-1': { actual: achievement, target: 1 } } })
      .groups.find((group) => group.id === 'axis-1').score;
  close(at(1.2), 50, 'above target');
  close(at(1), 50, 'on target');
  close(at(0.95), 35, '90-100 band');
  close(at(0.85), 20, '80-90 band');
  close(at(0.75), 10, '70-80 band');
  close(at(0.5), 0, 'below 70');
});

test('a marketing category below its floor scores zero, and the sales ladder deducts cash', () => {
  const template = kpiTemplateById('marketing_manager');

  const belowFloor = scoreScorecard(template, {
    values: { 'kpi-3-1': { actual: 0.4, target: 0.8 } },
  }).groups.find((group) => group.id === 'cat-3');
  close(belowFloor.ratio, 0.5, 'satisfaction ratio');
  assert.equal(belowFloor.gated, true);
  close(belowFloor.score, 0, 'gated category');

  const aboveFloor = scoreScorecard(template, {
    values: { 'kpi-3-1': { actual: 0.72, target: 0.8 } },
  }).groups.find((group) => group.id === 'cat-3');
  assert.equal(aboveFloor.gated, false);
  close(aboveFloor.score, 4.5, 'category above its floor');

  // 80% of target with a 40,000 incentive loses 4,000, so 90% of the weight survives.
  const sales = scoreScorecard(template, {
    values: { 'kpi-1-1': { actual: 110_400, target: 138_000 } },
    incentives: { 'cat-1': 40_000 },
  }).groups.find((group) => group.id === 'cat-1');
  close(sales.incentive.achievement, 0.8, 'achievement');
  close(sales.incentive.deduction, 4000, 'deduction');
  close(sales.incentive.net, 36_000, 'net incentive');
  close(sales.score, 45, 'weighted sales category');

  const collapsed = scoreScorecard(template, {
    values: { 'kpi-1-1': { actual: 60_000, target: 138_000 } },
    incentives: { 'cat-1': 40_000 },
  }).groups.find((group) => group.id === 'cat-1');
  close(collapsed.incentive.net, 0, 'forfeited incentive');
  close(collapsed.score, 0, 'forfeited category');
});

test('achievement handles the zero cases each direction reads differently', () => {
  close(kpiRawRatio({ direction: 'lower', target: 3, actual: 0 }), 1, 'no violations is a perfect month');
  close(kpiRawRatio({ direction: 'higher', target: 3, actual: 0 }), 0, 'no output is an empty month');
  close(kpiRawRatio({ direction: 'lower', target: 0, actual: 4 }), 0, 'missed a zero target');
  assert.equal(kpiRawRatio({ direction: 'higher', target: 3, actual: null }), null, 'unmeasured stays unmeasured');
});

test('an untouched scorecard scores nothing at all rather than zero', () => {
  const result = scoreScorecard(kpiTemplateById('personnel_specialist'), {});
  assert.equal(result.approved.percent, null);
  assert.equal(result.approved.rating, null);
  close(result.approved.score, 0, 'no score');
  close(result.approved.max, 0, 'no measured weight');
  assert.equal(result.completeness.measured, 0);
  assert.equal(result.completeness.complete, false);
});

test('a fully answered scorecard reports itself complete', () => {
  const template = kpiTemplateById('personnel_specialist');
  const result = scoreScorecard(template, {
    values: Object.fromEntries(
      template.groups.flatMap((group) => group.kpis.map((kpi) => [kpi.id, { actual: 1 }]))
    ),
    checks: Object.fromEntries(
      template.groups.flatMap((group) => group.checklist.map((item) => [item.id, 'done']))
    ),
  });
  assert.equal(result.completeness.complete, true);
  close(result.approved.percent, 100, 'complete percent');
  assert.equal(result.approved.rating.id, 'excellent');
});

test('the rating ladder matches the scale printed in every workbook', () => {
  assert.deepEqual(
    [100, 90, 89, 80, 79, 70, 69, 60, 59].map((percent) => kpiRatingFor(percent).id),
    ['excellent', 'excellent', 'very_good', 'very_good', 'good', 'good', 'fair', 'fair', 'weak']
  );
  assert.equal(kpiRatingFor(null), null);
  assert.equal(KPI_RATINGS.length, 5);
});

test('a checklist nobody has opened is unrated, not failed', () => {
  const checklist = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(kpiChecklistRatio(checklist, {}).ratio, null);
  assert.equal(kpiChecklistRatio(checklist, { a: 'na', b: 'na' }).ratio, null);
  close(kpiChecklistRatio(checklist, { a: 'done', b: 'partial', c: 'missed' }).ratio, 0.5, 'mixed');
  assert.equal(KPI_CHECK_STATES.find((state) => state.id === 'na').value, null);
});

test('the seeded workbook months reproduce the totals printed in the workbooks', () => {
  const score = (subjectName) => {
    const record = KPI_SEED_RECORDS.find((item) => item.subjectName === subjectName);
    assert.ok(record, `${subjectName} was not transcribed`);
    return scoreScorecard(kpiTemplateById(record.templateId), record);
  };

  // The recruitment workbook's own dashboard prints 100 and 92.97. Getting
  // these the wrong way round is the failure mode worth guarding: each
  // specialist owns a fixed pair of columns, and the settings sheet has a
  // blank row above the names that makes positional reading swap them.
  close(score('شاهندة سمير').approved.score, 100, 'شاهندة سمير');
  close(score('ياسمين اشرف').approved.score, 92.97142857142856, 'ياسمين اشرف');
  close(score('مدير الموارد البشرية').approved.score, 98, 'HR manager');

  // The personnel workbook prints 99 because one criterion was entered as 4
  // out of a maximum of 3. Capping each criterion at its own maximum — the
  // rule the other four workbooks state outright — makes that axis 24, not 25.
  close(score('قسم شئون العاملين').approved.score, 98, 'people operations');

  // Marketing recorded exactly one figure; the other fifteen rows stay out of
  // the denominator instead of dragging the month to a grade nobody earned.
  const marketing = score('مدير التسويق');
  close(marketing.approved.max, 50, 'marketing measured weight');
  close(marketing.approved.percent, 80, 'marketing percent');

  // The sales workbook is an unfilled template, so it seeds ungraded.
  assert.equal(score('مدير المبيعات والعمليات').approved.percent, null);
});

test('every seeded row points at a KPI its template actually declares', () => {
  for (const record of KPI_SEED_RECORDS) {
    const template = kpiTemplateById(record.templateId);
    assert.ok(template, `${record.templateId} is not in the catalogue`);
    assert.match(record.period, /^\d{4}-\d{2}$/, `${record.subjectName} has no month`);
    const kpis = new Set(template.groups.flatMap((group) => group.kpis.map((kpi) => kpi.id)));
    const checks = new Set(template.groups.flatMap((group) => group.checklist.map((item) => item.id)));
    for (const id of Object.keys(record.values)) {
      assert.ok(kpis.has(id), `${record.subjectName} records unknown KPI ${id}`);
    }
    for (const [id, state] of Object.entries(record.checks)) {
      assert.ok(checks.has(id), `${record.subjectName} records unknown check ${id}`);
      assert.ok(KPI_CHECK_STATES.some((item) => item.id === state), `${id} has state ${state}`);
    }
  }
});
