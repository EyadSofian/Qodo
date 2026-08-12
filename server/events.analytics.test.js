import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEventsSnapshot } from './events.js';
import { buildOfflineEventsRevenueSnapshot } from './insightsRevenue.js';

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
  assert.equal(result.totals.capacityBookings, 4);
  assert.equal(result.topDemand[0].name, 'BIM');
  assert.equal(result.lowDemand[0].name, 'BIM');
});

test('occupancy ignores bookings where no event capacity is entered', () => {
  const events = [
    { id: 1, name: 'Known capacity', date_begin: '2026-08-01 10:00:00', attendance_method: 'offline', seats_max: 10 },
    { id: 2, name: 'No capacity', date_begin: '2026-08-02 10:00:00', attendance_method: 'offline', seats_max: 0 },
  ];
  const registrations = [
    { event_id: [1, 'Known capacity'], state: 'open', __count: 5 },
    { event_id: [2, 'No capacity'], state: 'open', __count: 7 },
  ];

  const result = buildEventsSnapshot(events, registrations);
  assert.equal(result.totals.bookings, 12);
  assert.equal(result.totals.capacityBookings, 5);
  assert.equal(result.totals.seats, 10);
  assert.equal(result.totals.fillRate, 50);
});

test('most requested event is ranked by confirmed bookings before unconfirmed interest', () => {
  const events = [
    { id: 1, name: 'Interest only', date_begin: '2026-08-01 10:00:00', attendance_method: 'offline', seats_max: 30 },
    { id: 2, name: 'Confirmed', date_begin: '2026-08-02 10:00:00', attendance_method: 'offline', seats_max: 30 },
  ];
  const registrations = [
    { event_id: [1, 'Interest only'], state: 'draft', __count: 20 },
    { event_id: [2, 'Confirmed'], state: 'open', __count: 3 },
  ];

  const result = buildEventsSnapshot(events, registrations);
  assert.equal(result.topDemand[0].name, 'Confirmed');
});

test('event revenue keeps explicit classroom invoices and reports ambiguous mapping separately', () => {
  const result = buildOfflineEventsRevenueSnapshot({
    source: { tab: 'Paid Invoices', dateBasis: 'Payment Date', valueBasis: 'USD Paid' },
    detail: {
      truncated: false,
      rows: [
        {
          product: '[5] AutoCAD - Event (Offline Attendance (Riyadh))',
          movement: 'INV-1',
          usdPaid: 150,
        },
        {
          product: '[7] Photoshop - Event (Offline Attendance (Riyadh))',
          movement: 'INV-1',
          usdPaid: 150,
        },
        {
          product: '[4] AutoCAD - Event (Online Attendance)',
          movement: 'INV-2',
          event: 'AutoCAD Online',
          usdPaid: 100,
        },
        {
          product: '[65] CFM - Event',
          movement: 'INV-3',
          usdPaid: 500,
        },
        { product: '[110] Management - PRIMAVERA', movement: 'INV-4', usdPaid: 200 },
      ],
    },
  });

  assert.equal(result.amount, 300);
  assert.equal(result.invoices, 1);
  assert.equal(result.products.length, 2);
  assert.equal(result.unassignedInvoices, 1);
  assert.equal(result.excludedOnlineAmount, 100);
  assert.equal(result.excludedUnknownAmount, 500);
  assert.equal(result.invoiceCountExact, true);
});
