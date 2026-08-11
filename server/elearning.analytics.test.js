import assert from 'node:assert/strict';
import test from 'node:test';
import { buildElearningPeriodSnapshot, buildElearningSalesSnapshot } from './elearning.js';

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

test('paid sales exclude free courses and count package revenue only once', () => {
  const courses = [
    {
      id: 1,
      name: 'AutoCAD',
      productTemplateId: 101,
      published: true,
      members: 10,
      free: false,
    },
    {
      id: 2,
      name: '3ds Max',
      productTemplateId: 102,
      published: true,
      members: 8,
      free: false,
    },
    {
      id: 3,
      name: 'The Freelance Masterclass',
      productTemplateId: 2056,
      published: true,
      members: 200,
      free: true,
    },
  ];
  const products = [
    { id: 11, templateId: 101, name: 'AutoCAD' },
    { id: 12, templateId: 102, name: '3ds Max' },
    { id: 13, templateId: 2056, name: 'The Freelance Masterclass' },
  ];
  const packages = [
    {
      id: 5,
      name: 'Interior Design Professional Track',
      createdAt: '2025-01-01 00:00:00',
      components: [
        { templateId: 101, name: 'AutoCAD', createdAt: '2025-01-01 00:00:00' },
        { templateId: 102, name: '3ds Max', createdAt: '2025-01-01 00:00:00' },
        {
          templateId: 2056,
          name: 'The Freelance Masterclass',
          createdAt: '2025-01-01 00:00:00',
        },
      ],
    },
  ];
  const saleLines = [
    {
      order_id: [100, 'S100'],
      product_id: [11, 'AutoCAD'],
      product_uom_qty: 1,
      price_subtotal: 80,
      create_date: '2026-08-01 10:00:00',
    },
    {
      order_id: [100, 'S100'],
      product_id: [12, '3ds Max'],
      product_uom_qty: 1,
      price_subtotal: 100,
      create_date: '2026-08-01 10:00:00',
    },
    {
      order_id: [100, 'S100'],
      product_id: [13, 'The Freelance Masterclass'],
      product_uom_qty: 1,
      price_subtotal: 0,
      create_date: '2026-08-01 10:00:00',
    },
    {
      order_id: [101, 'S101'],
      product_id: [11, 'AutoCAD'],
      product_uom_qty: 1,
      price_subtotal: 50,
      create_date: '2026-08-02 10:00:00',
    },
    {
      order_id: [102, 'S102'],
      product_id: [13, 'The Freelance Masterclass'],
      product_uom_qty: 1,
      price_subtotal: 25,
      create_date: '2026-08-03 10:00:00',
    },
  ];

  const result = buildElearningSalesSnapshot(courses, products, packages, saleLines);

  assert.equal(result.totals.packagesSold, 1);
  assert.equal(result.totals.directSales, 1);
  assert.equal(result.totals.purchases, 2);
  assert.equal(result.totals.packageRevenue, 180);
  assert.equal(result.totals.directRevenue, 50);
  assert.equal(result.totals.revenue, 230);
  assert.equal(result.totals.paidOrders, 2);
  assert.equal(result.totals.freeExcluded, 1);
  assert.equal(result.packages[0].sales, 1);
  assert.equal(result.topCourses.find((course) => course.name === 'AutoCAD').packageSales, 1);
  assert.equal(result.topCourses.some((course) => course.name.includes('Freelance')), false);
});
