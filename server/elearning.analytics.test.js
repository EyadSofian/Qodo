import assert from 'node:assert/strict';
import test from 'node:test';
import { buildElearningPeriodSnapshot } from './elearning.js';

test('eLearning period snapshot ranks new enrollment and keeps invitations separate', () => {
  const courses = [
    { id: 1, name: 'AutoCAD', published: true, members: 20, completionRate: 25 },
    { id: 2, name: 'Revit', published: true, members: 4, completionRate: 0 },
  ];
  const memberships = [
    { channel_id: [1, 'AutoCAD'], member_status: 'joined', __count: 3 },
    { channel_id: [1, 'AutoCAD'], member_status: 'ongoing', __count: 2 },
    { channel_id: [1, 'AutoCAD'], member_status: 'completed', __count: 1 },
    { channel_id: [1, 'AutoCAD'], member_status: 'invited', __count: 2 },
  ];

  const result = buildElearningPeriodSnapshot(courses, memberships);
  assert.equal(result.totals.enrollments, 6);
  assert.equal(result.totals.invited, 2);
  assert.equal(result.totals.started, 3);
  assert.equal(result.totals.completed, 1);
  assert.equal(result.totals.noDemand, 1);
  assert.equal(result.topDemand[0].name, 'AutoCAD');
  assert.equal(result.lowDemand[0].name, 'Revit');
});
