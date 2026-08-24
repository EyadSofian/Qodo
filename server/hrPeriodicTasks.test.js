import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HR_PERIODIC_TASKS,
  HR_TASK_CATEGORIES,
  HR_TASK_FREQUENCIES,
} from '../shared/hrPeriodicTasks.js';
import { getStage } from '../shared/departments.js';

test('the supplied HR plan is represented without dropped or duplicate templates', () => {
  assert.equal(HR_PERIODIC_TASKS.length, 51);
  assert.equal(new Set(HR_PERIODIC_TASKS.map((item) => item.id)).size, 51);
  assert.deepEqual(
    Object.fromEntries(
      HR_TASK_CATEGORIES.map((category) => [
        category.id,
        HR_PERIODIC_TASKS.filter((item) => item.category === category.id).length,
      ])
    ),
    {
      recruitment: 10,
      personnel: 15,
      department_management: 7,
      learning: 8,
      performance: 8,
      executive_reports: 3,
    }
  );
  assert.deepEqual(
    Object.fromEntries(
      HR_TASK_FREQUENCIES.map((frequency) => [
        frequency.id,
        HR_PERIODIC_TASKS.filter((item) => item.frequency === frequency.id).length,
      ])
    ),
    { daily: 16, weekly: 12, semi_monthly: 3, monthly: 13, quarterly: 7 }
  );
});

test('every HR template can create a measurable task brief', () => {
  const categoryIds = new Set(HR_TASK_CATEGORIES.map((item) => item.id));
  const frequencyIds = new Set(HR_TASK_FREQUENCIES.map((item) => item.id));
  for (const item of HR_PERIODIC_TASKS) {
    assert.ok(categoryIds.has(item.category), `${item.id} has an unknown category`);
    assert.ok(frequencyIds.has(item.frequency), `${item.id} has an unknown cadence`);
    assert.ok(item.title.trim(), `${item.id} has no title`);
    assert.ok(item.dueRule.trim(), `${item.id} has no deadline rule`);
    assert.ok(item.doneDefinition.trim(), `${item.id} has no evidence rule`);
    assert.ok(item.owner.trim(), `${item.id} has no owner role`);
  }
});

test('legacy HR funnel stages retain their lifecycle meaning after the redesign', () => {
  assert.equal(getStage('hr', 'request').id, 'planned');
  assert.equal(getStage('hr', 'screening').id, 'in_progress');
  assert.equal(getStage('hr', 'interview').id, 'in_progress');
  assert.equal(getStage('hr', 'offer').id, 'review');
  assert.equal(getStage('hr', 'hired').id, 'done');
});
