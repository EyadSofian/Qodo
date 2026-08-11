import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEventsSnapshot } from './events.js';

test('event demand separates confirmed bookings, interest and no-demand events', () => {
  const events = [
    {
      id: 1,
      name: 'Revit',
      date_begin: '2026-08-01 10:00:00',
      stage_id: [3, 'Planned'],
      event_type: 'individual',
      attendance_method: 'online',
      instructor_id: [9, 'Ahmed'],
      seats_max: 10,
    },
    {
      id: 2,
      name: 'BIM',
      date_begin: '2026-08-12 10:00:00',
      stage_id: [3, 'Planned'],
      event_type: 'company',
      attendance_method: 'offline',
      instructor_id: false,
      seats_max: 20,
    },
  ];
  const registrations = [
    { event_id: [1, 'Revit'], state: 'open', __count: 4 },
    { event_id: [1, 'Revit'], state: 'done', __count: 2 },
    { event_id: [1, 'Revit'], state: 'draft', __count: 3 },
    { event_id: [1, 'Revit'], state: 'cancel', __count: 1 },
    { event_id: [2, 'BIM'], state: 'open', __count: 4 },
    { event_id: [2, 'BIM'], state: 'draft', __count: 1 },
  ];

  const result = buildEventsSnapshot(events, registrations);
  assert.equal(result.totals.events, 1);
  assert.equal(result.totals.bookings, 4);
  assert.equal(result.totals.interested, 1);
  assert.equal(result.totals.attended, 0);
  assert.equal(result.totals.noDemand, 0);
  assert.equal(result.totals.fillRate, 20);
  assert.equal(result.topDemand[0].name, 'BIM');
  assert.equal(result.lowDemand[0].name, 'BIM');
});
