import assert from 'node:assert/strict';
import test from 'node:test';
import { buildElearningPeriodSnapshot, buildElearningSalesSnapshot } from './elearning.js';
import { buildRecordedRevenueSnapshot } from './insightsRevenue.js';

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

test('paid sales exclude free courses and count a paid package only once', () => {
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
  assert.equal(result.totals.paidOrders, 2);
  assert.equal(result.totals.freeExcluded, 1);
  assert.equal(result.packages[0].sales, 1);
  assert.equal(result.topCourses.find((course) => course.name === 'AutoCAD').packageSales, 1);
  assert.equal(result.topCourses.some((course) => course.name.includes('Freelance')), false);
});

test('zero-value package lines do not become paid demand', () => {
  const courses = [
    { id: 1, name: 'A', productTemplateId: 101, published: true, members: 1, free: false },
    { id: 2, name: 'B', productTemplateId: 102, published: true, members: 1, free: false },
  ];
  const products = [
    { id: 11, templateId: 101, name: 'A' },
    { id: 12, templateId: 102, name: 'B' },
  ];
  const packages = [
    {
      id: 5,
      name: 'Free inclusion',
      createdAt: '2025-01-01 00:00:00',
      components: [
        { templateId: 101, name: 'A', createdAt: '2025-01-01 00:00:00' },
        { templateId: 102, name: 'B', createdAt: '2025-01-01 00:00:00' },
      ],
    },
  ];
  const saleLines = products.map((product) => ({
    order_id: [100, 'S100'],
    product_id: [product.id, product.name],
    product_uom_qty: 1,
    price_subtotal: 0,
    create_date: '2026-08-01 10:00:00',
  }));

  const result = buildElearningSalesSnapshot(courses, products, packages, saleLines);
  assert.equal(result.totals.packagesSold, 0);
  assert.equal(result.totals.paidOrders, 0);
  assert.equal(result.totals.purchases, 0);
});

test('Insights accounting revenue keeps only the recorded course modality in USD', () => {
  const result = buildRecordedRevenueSnapshot({
    source: {
      tab: 'Paid Invoices',
      dateBasis: 'Payment Date',
      valueBasis: 'USD Paid',
      grain: 'invoice_product_line',
    },
    courses: {
      variants: [
        { key: 'event', invoices: 20, revenueUsd: 9000 },
        { key: 'recorded', invoices: 3, revenueUsd: 3035.532995 },
        { key: 'free', invoices: 4, revenueUsd: 0 },
      ],
      families: [
        {
          familyKey: 'cfm',
          family: 'CFM',
          variants: [
            { key: 'event', invoices: 8, revenueUsd: 5000 },
            { key: 'recorded', invoices: 2, revenueUsd: 2135.426 },
          ],
          products: [
            { variantKey: 'recorded', lines: 2 },
            { variantKey: 'event', lines: 10 },
          ],
        },
        {
          familyKey: 'pmp',
          family: 'PMP',
          variants: [{ key: 'event', invoices: 12, revenueUsd: 4000 }],
          products: [{ variantKey: 'event', lines: 12 }],
        },
      ],
    },
  });

  assert.equal(result.amount, 3035.53);
  assert.equal(result.currency, 'USD');
  assert.equal(result.invoices, 3);
  assert.equal(result.productLines, 2);
  assert.deepEqual(result.families, [
    { key: 'cfm', name: 'CFM', amount: 2135.43, invoices: 2, productLines: 2 },
  ]);
  assert.equal(result.source.valueBasis, 'USD Paid');
});
