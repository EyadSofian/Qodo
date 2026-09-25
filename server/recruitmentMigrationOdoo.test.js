import assert from 'node:assert/strict';
import { test } from 'node:test';
import { departmentIdFor, legacyKey, legacyRequestFromRow, legacyRequestId, resolveAssignee } from './hr/recruitment/migration.js';
import { __test as pipeline } from './hr/recruitment/odooPipeline.js';
import { __test as people, comparableEmail, odooEmployeeFor } from './hr/odooPeople.js';
import { recruitmentPolicy, resolveHRSettings } from '../shared/recruitment/settings.js';

const policy = recruitmentPolicy(resolveHRSettings({}));
const employees = [
  { employeeCode: '257', nameEnglish: 'Shahinda Samir Shaaban Muhammad', nameArabic: 'شهندا سمير شعبان محمد', department: 'Human Resources', status: 'active' },
  { employeeCode: '389', nameEnglish: 'Salah Alddin Muhammad Ragab', nameArabic: 'صلاح الدين محمد رجب', department: 'Human Resources', status: 'active' },
  { employeeCode: '135', nameEnglish: 'Salah al-Din Majid Salah al-Din Ismail', nameArabic: 'صلاح الدين ماجد', department: 'Instructor Department', status: 'active' },
  { employeeCode: '246', nameEnglish: 'Fatma Morsi Ahmed Mohamed', nameArabic: 'فاطمة مرسي احمد محمد', department: 'Human Resources', status: 'inactive' },
  { employeeCode: '247', nameEnglish: 'Karim Wael Ismail Salem', nameArabic: 'كريم وائل اسماعيل سالم', department: 'Human Resources', status: 'active' },
  { employeeCode: '60', nameEnglish: 'Karim Mamdouh Mohamed Khalil', nameArabic: 'كريم ممدوح', department: 'Pre-Sales', status: 'inactive' },
];

const row = (overrides = {}) => ({
  id: 'Recruitment Report 8\\9-2026:6:8',
  sequence: '6',
  role: 'CFM Instructor',
  numberNeeded: 1,
  accepted: 0,
  feedback: '',
  department: 'Instructor',
  vacancyReason: 'New',
  status: 'active',
  priority: 'top',
  seniority: 'High',
  location: 'KSA',
  assignedTo: ['Shahinda'],
  hiringPeriodDays: 30,
  activeDate: '2026-09-23',
  dueDate: '2026-10-25',
  actualHiringDate: null,
  receivedRequirements: 'done',
  published: 'wait',
  receivedCandidates: 'wait',
  salaryRange: '1000 SAR',
  actualSalary: '',
  interviewer: 'Eng.Taha',
  validation: 'Eng.Taha',
  ...overrides,
});

test('a legacy row keeps its identity across monthly workbooks', () => {
  const september = row();
  const october = row({ id: 'Recruitment Report 10-2026:9:14', sequence: '9', status: 'done', accepted: 1 });
  assert.equal(legacyKey(september), legacyKey(october), 'the report period and row number are not part of the key');
  assert.equal(legacyRequestId('engosoft', september), legacyRequestId('engosoft', october));
  assert.notEqual(legacyRequestId('engosoft', september), legacyRequestId('other', september));
  const undated = row({ activeDate: null, sequence: '12' });
  assert.match(legacyKey(undated), /#12$/, 'a row with no active date falls back to its report number');
});

test('assignees resolve only inside HR and only uniquely', () => {
  assert.equal(resolveAssignee('Shahinda', employees), '257');
  assert.equal(resolveAssignee('Salah', employees), '389', 'the instructor named Salah is not in HR');
  assert.equal(resolveAssignee('Karim', employees), '247', 'the Pre-Sales Karim is not in HR');
  assert.equal(resolveAssignee('Fatima', employees), null, 'Fatima is not Fatma');
  assert.equal(resolveAssignee('', employees), null);
});

test('a workbook row maps onto the Qodo request without inventing approvals or dates', () => {
  const request = legacyRequestFromRow(row({ assignedTo: ['Shahinda', 'Salah'] }), { organizationId: 'engosoft', employees, policy, dataset: { fileName: 'x.xlsx', payload: { period: 'P' } }, today: '2026-09-24' });
  assert.equal(request.status, 'hiring');
  assert.equal(request.priority, 'required');
  assert.equal(request.prioritySource, 'legacy_hiring_period');
  assert.equal(request.classification, 'instructor');
  assert.equal(request.locationCode, 'KSA');
  assert.equal(request.recruiterCode, '257');
  assert.deepEqual(request.supportRecruiterCodes, ['389']);
  assert.equal(request.requestedBy, null, 'nobody is invented as the requester');
  assert.equal(request.legacyValidation, 'Eng.Taha');
  assert.equal(request.sla.startDate, '2026-09-23');
  assert.equal(request.sla.originalDueDate, '2026-10-25');
  assert.equal(request.sla.targetSource, 'legacy_due_date');
  assert.equal(request.departmentId, 'training');

  const done = legacyRequestFromRow(row({ status: 'done', accepted: 1 }), { organizationId: 'engosoft', employees, policy, today: '2026-09-24' });
  assert.equal(done.status, 'completed');
  assert.equal(done.sla.completedAt, null);
  assert.equal(done.sla.slaMet, null, 'an unknown outcome stays unknown');

  const held = legacyRequestFromRow(row({ status: 'hold' }), { organizationId: 'engosoft', employees, policy, today: '2026-09-24' });
  assert.equal(held.sla.pausedSince, '2026-09-24', 'the hold is paused from the day it reached Qodo, charging nothing retroactively');

  const blank = legacyRequestFromRow(row({ hiringPeriodDays: 0, activeDate: null, dueDate: null }), { organizationId: 'engosoft', employees, policy, today: '2026-09-24' });
  assert.equal(blank.priority, null);
  assert.equal(blank.sla, null);
});

test('workbook departments route to the right reviewing department', () => {
  assert.equal(departmentIdFor('Sales'), 'sales');
  assert.equal(departmentIdFor('Instructor'), 'training');
  assert.equal(departmentIdFor('LMS'), 'training');
  assert.equal(departmentIdFor('OPS'), 'operations');
  assert.equal(departmentIdFor('IT'), 'it');
  assert.equal(departmentIdFor('Developer'), 'it');
  assert.equal(departmentIdFor('HR'), 'hr');
  assert.equal(departmentIdFor(''), 'general');
});

/* ── Odoo ──────────────────────────────────────────────────────── */

const jobs = [
  { id: 1, name: 'CFM Instructor', active: true },
  { id: 2, name: 'Instructor', active: true },
  { id: 3, name: 'Telesales', active: true },
];

test('a confirmed link wins, an automatic match is only a suggestion, and generic jobs are never guessed', () => {
  const links = new Map([['confirmed', { requestId: 'confirmed', odooJobId: 3, matchType: 'manual' }]]);
  assert.deepEqual(pipeline.resolveLink({ id: 'confirmed', title: 'Telesales (KSA)' }, links, jobs), { job: jobs[2], confirmed: true, matchType: 'manual' });
  const automatic = pipeline.resolveLink({ id: 'auto', title: 'CFM Instructor' }, new Map(), jobs);
  assert.equal(automatic.job.id, 1);
  assert.equal(automatic.confirmed, false);
  assert.equal(pipeline.resolveLink({ id: 'generic', title: 'SCADA Instructor' }, new Map(), jobs), null);
  assert.equal(pipeline.resolveLink({ id: 'ksa', title: 'Telesales (KSA)' }, new Map(), jobs), null);
});

test('a link to a job Odoo no longer has is reported stale, never re-guessed', () => {
  const links = new Map([['old', { requestId: 'old', odooJobId: 999, matchType: 'manual' }]]);
  assert.deepEqual(pipeline.resolveLink({ id: 'old', title: 'CFM Instructor' }, links, jobs), { job: null, confirmed: true, stale: true, jobId: 999 });
});

test('the funnel counts each candidate at their stage and every earlier step', () => {
  const applicant = (stage, refused = false) => ({ stage, refused });
  const counts = pipeline.funnelCounts([
    applicant('New'),
    applicant('Initial Screening'),
    applicant('HR Evaluation'),
    applicant('Technical Evaluation'),
    applicant('Technical Evaluation', true),
    applicant('Contract negotiation'),
    applicant('Contract Signed'),
    applicant('Rejected', true),
  ], policy.funnel);
  assert.deepEqual(counts, { received: 8, filtered: 5, interviewed: 4, accepted: 2, offer: 2, hired: 1 });
});

test('an Odoo applicant is shaped without leaking what the caller may not see', () => {
  const shaped = pipeline.shapeApplicant({ id: 7, partner_name: 'Candidate', stage_id: [4, 'Technical Evaluation'], active: false, refuse_reason_id: [2, 'Salary'], salary_expected: 25000, email_from: 'x@y.z', meeting_ids: [1] });
  assert.equal(shaped.refused, true);
  assert.equal(shaped.refuseReason, 'Salary');
  assert.equal(shaped.hasEmail, true);
  assert.equal(Object.hasOwn(shaped, 'email_from'), false, 'the address itself is never passed through');
  assert.equal(shaped.meetings, 1);
});

/* ── Photos ────────────────────────────────────────────────────── */

test('Odoo employees join by work e-mail first, then by a unique full name', () => {
  const index = {
    byEmail: new Map([['shahinda@test.local', { id: 3111, name: 'Shahinda Samir Shaaban Muhammad' }], ['dup@test.local', null]]),
    byName: new Map([[people.comparableName('Salah Alddin Muhammad Ragab'), { id: 3170 }], [people.comparableName('Taha Aref'), { id: 3076 }]]),
  };
  assert.equal(odooEmployeeFor({ companyEmail: 'Shahinda@Test.local ', nameEnglish: 'x' }, index).id, 3111);
  assert.equal(odooEmployeeFor({ companyEmail: '', nameEnglish: 'Salah Alddin Muhammad Ragab' }, index).id, 3170);
  assert.equal(odooEmployeeFor({ companyEmail: 'dup@test.local', nameEnglish: 'Nobody Here' }, index), null, 'an ambiguous e-mail joins nobody');
  assert.equal(people.comparableName('ENG.Taha Aref'), 'taha aref');
  assert.equal(comparableEmail(' A@B.C '), 'a@b.c');
});

test('only real raster photos are served — never an SVG placeholder', () => {
  assert.equal(people.sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), 'image/jpeg');
  assert.equal(people.sniff(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), 'image/png');
  assert.equal(people.sniff(Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(people.sniff(Buffer.from('<svg onload="alert(1)"></svg>')), null);
});
