import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildElearningCourseComparison,
  buildEventCourseComparison,
  canonicalTrainingName,
} from './trainingComparison.js';

test('event comparison joins only an exact cleaned course name and aggregates its Odoo events', () => {
  const rows = buildEventCourseComparison(
    [
      {
        name: '[42] Interior Design - Photoshop - Event (Offline Attendance (Riyadh))',
        amount: 284.68,
      },
    ],
    [
      { id: 1, name: 'Interior Design Photoshop - 5621', bookings: 11, interested: 2 },
      { id: 2, name: 'Photoshop for Interior Design - 5628', bookings: 7, interested: 0 },
    ]
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].paidAmount, 284.68);
  assert.equal(rows[0].primary, 18);
  assert.equal(rows[0].secondary, 2);
  assert.equal(rows[0].operationalRecords, 2);
  assert.equal(rows[0].status, 'paid_and_active');
  assert.equal(rows[0].matchBasis, 'canonical_name');
});

test('similar course names stay separate instead of producing a guessed match', () => {
  const rows = buildEventCourseComparison(
    [{ name: 'Advanced AI Tools - Event (Offline Attendance (Riyadh))', amount: 150 }],
    [{ id: 3, name: 'AI Tools - 7001', bookings: 4, interested: 0 }]
  );

  assert.equal(rows.length, 2);
  assert.deepEqual(new Set(rows.map((row) => row.matchBasis)), new Set(['financial_only', 'operational_only']));
});

test('eLearning comparison separates paid demand from new course enrollment', () => {
  const rows = buildElearningCourseComparison(
    [{ name: '[847] PMP Exam Simulator (AR)', amount: 500 }],
    [
      { id: 8, name: 'PMP Exam Simulator (AR)', enrollments: 3, invited: 1 },
      { id: 9, name: 'CFM', enrollments: 0, invited: 0 },
    ]
  );

  assert.equal(canonicalTrainingName('[847] PMP Exam Simulator (AR)'), 'exam|pmp|simulator');
  assert.equal(rows.find((row) => row.name.includes('PMP'))?.status, 'paid_and_active');
  assert.equal(rows.find((row) => row.name === 'CFM')?.status, 'no_demand');
});
