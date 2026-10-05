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

test('published Odoo jobs put their owners on the desk and count per employee code', async () => {
  const { deriveRecruitmentTeam } = await import('./hr/recruitment/team.js');
  const { odooJobsByEmployee, odooJobTotals } = await import('./hr/recruitment/odooJobs.js');
  const job = (id, recruiter, toRecruit, newApplications) => ({ id, name: `Job ${id}`, recruiter, toRecruit, applications: newApplications + 5, newApplications, hired: 0 });
  const snapshot = {
    connected: true,
    jobs: [job(1, { id: 11, name: 'Yasmin' }, 2, 3), job(2, { id: 11, name: 'Yasmin' }, 1, 0), job(3, { id: 99, name: 'Left the company' }, 4, 1), job(4, null, 1, 0)],
    team: [
      { id: 11, name: 'Yasmin', employeeCode: '420' },
      { id: 12, name: 'Salah', employeeCode: '389' },
      { id: 99, name: 'Left the company', employeeCode: null },
    ],
  };
  const byCode = odooJobsByEmployee(snapshot);
  assert.deepEqual([...byCode.keys()], ['420', '389'], 'an owner Odoo cannot tie to an employee code owns nothing here');
  assert.deepEqual(odooJobTotals(byCode.get('420')), { jobs: 2, toRecruit: 3, newApplications: 3, applications: 13 });
  assert.deepEqual(odooJobTotals(byCode.get('389')), { jobs: 0, toRecruit: 0, newApplications: 0, applications: 0 }, 'the team manager has a card with no job');
  assert.equal(odooJobsByEmployee(null).size, 0);
  assert.equal(odooJobsByEmployee({ connected: false, jobs: [], team: [] }).size, 0);

  const profile = (employeeCode, title, status = 'active') => ({ employeeCode, nameArabic: '', nameEnglish: `Person ${employeeCode}`, title, department: 'HR', status, sources: { master: true } });
  const profiles = new Map([['420', profile('420', 'HR Generalist')], ['389', profile('389', 'HR Manager')], ['500', profile('500', 'Accountant')], ['522', profile('522', 'HR Admin', 'inactive')]]);
  const team = deriveRecruitmentTeam({ profiles, requests: [], odooJobOwners: ['420', '389', '522', '999'] });
  assert.deepEqual(team.map((member) => member.employeeCode).sort(), ['389', '420'], 'active HR-file people only; a leaver or an unknown code is not on the desk');
  assert.deepEqual(team.find((member) => member.employeeCode === '389').reasons, ['odoo_jobs']);
  const excluded = deriveRecruitmentTeam({ profiles, requests: [], odooJobOwners: ['420', '389'], team: { include: [], exclude: ['389'] } });
  assert.deepEqual(excluded.map((member) => member.employeeCode), ['420'], 'Settings can still take someone off the desk');
});

test('the desk follows Odoo: one request per published job, the workbook archived, Qodo requests kept', async () => {
  const { planOdooSync, odooRequestId, ARCHIVE_NOT_FROM_ODOO, ARCHIVE_UNPUBLISHED, ARCHIVE_REPLACED } = await import('./hr/recruitment/odooSync.js');
  const org = 'org-1';
  const job = (id, name, recruiter, toRecruit = 1) => ({ id, name, department: 'Training', recruiter, toRecruit, applications: 0, newApplications: 0, hired: 0 });
  const yasmin = { id: 11, name: 'Yasmin' };
  const ghost = { id: 99, name: 'Left the company' };
  const snapshot = {
    connected: true,
    jobs: [{ ...job(1, 'CFM Instructor', yasmin, 2), activeDate: '2026-10-01', hiringPeriodDays: 30, salaryFrom: 1500, salaryTo: 2500 }, job(2, 'Video Editor', ghost), job(3, 'IT Manager', null), job(4, 'Accountant', yasmin)],
    team: [{ id: 11, name: 'Yasmin', employeeCode: '420' }, { id: 99, name: 'Left the company', employeeCode: '522' }],
  };
  const profiles = new Map([['420', { employeeCode: '420', status: 'active' }], ['522', { employeeCode: '522', status: 'inactive' }]]);
  const request = (id, source, status, extra = {}) => ({ id, source, status, title: id, recruiterCode: null, revision: 1, ...extra });
  const requests = [
    request('leg-1', 'legacy_workbook', 'hiring', { recruiterCode: '420', priority: 'critical' }),
    request('leg-2', 'legacy_workbook', 'completed'),
    request('leg-linked', 'legacy_workbook', 'hiring'),
    request('qodo-draft', 'qodo', 'draft'),
    request('qodo-swept', 'qodo', 'pending_approval', { archivedAt: '2026-10-05T11:00:00Z', archiveReason: ARCHIVE_NOT_FROM_ODOO }),
    request('qodo-approved', 'qodo', 'hiring', { title: 'Accountant (as approved)', headcount: 1, recruiterCode: '257', priority: 'critical' }),
    request(odooRequestId(org, 4), 'odoo', 'hiring', { title: 'Accountant' }),
    request(odooRequestId(org, 7), 'odoo', 'hiring', { title: 'Unpublished since' }),
    request(odooRequestId(org, 8), 'odoo', 'completed', { title: 'Filled and closed' }),
    request(odooRequestId(org, 3), 'odoo', 'hiring', { title: 'IT Manager', department: 'Training', departmentId: 'training', headcount: 1, unresolvedAssignees: [], archivedAt: '2026-10-01T00:00:00Z', archiveReason: ARCHIVE_UNPUBLISHED }),
  ];
  const links = new Map([['leg-linked', { odooJobId: 1 }], ['qodo-approved', { odooJobId: 4 }]]);
  const calendar = { weekend: [5, 6], holidays: [] };
  const plan = planOdooSync({ organizationId: org, snapshot, requests, links, profiles, today: '2026-10-05', calendar, stamp: '2026-10-05T10:00:00.000Z' });

  assert.equal(plan.skipped, null);
  assert.deepEqual(plan.create.map((item) => item.document.reference), ['ODOO-1', 'ODOO-2'], 'a workbook row linked to the job is not that job\'s request; an approved Qodo request is');
  const cfm = plan.create[0].document;
  assert.deepEqual([cfm.source, cfm.status, cfm.title, cfm.headcount, cfm.recruiterCode], ['odoo', 'hiring', 'CFM Instructor', 2, '420'], 'Odoo gives the job, seats and owner');
  assert.deepEqual([cfm.priority, cfm.hiringPeriodDays, cfm.sla.startDate, cfm.sla.currentDueDate, cfm.targetWorkingDays], ['required', 30, '2026-10-01', '2026-11-12', 30], 'the Active Date starts the clock; the Hiring Period is working days (no Friday, no Saturday) and names the priority');
  assert.deepEqual(cfm.salaryRange, { min: 1500, max: 2500, currency: null, text: '' });
  assert.equal(cfm.odoo.firstSeen, '2026-10-05');
  const video = plan.create[1].document;
  assert.deepEqual([video.recruiterCode, video.unresolvedAssignees], [null, ['Left the company']], 'an owner who left owns nothing here, and is named');
  assert.deepEqual([video.priority, video.sla], [null, null], 'no period in Odoo: no priority and no clock until one is set');

  assert.deepEqual(plan.restore.map((item) => item.id), [odooRequestId(org, 3), 'qodo-swept'], 'a job published again gets its own request back, and a Qodo request swept away by the first Odoo-only deploy returns');
  assert.deepEqual(plan.update.map((item) => [item.id, Object.keys(item.patch).sort()]), [[odooRequestId(org, 3), ['odoo']]], 'the approved Qodo request is left exactly as approved: its recruiter, priority and clock are not Odoo\'s to change');

  const archived = Object.fromEntries(plan.archive.map((item) => [item.id, item.reason]));
  assert.deepEqual(archived, {
    'leg-1': ARCHIVE_NOT_FROM_ODOO,
    'leg-2': ARCHIVE_NOT_FROM_ODOO,
    'leg-linked': ARCHIVE_NOT_FROM_ODOO,
    [odooRequestId(org, 4)]: ARCHIVE_REPLACED,
    [odooRequestId(org, 7)]: ARCHIVE_UNPUBLISHED,
  }, 'the workbook leaves the desk; a draft made in Qodo stays; the request kept for a job steps aside for the approved one');

  // A second run over the result changes nothing.
  const after = [
    ...requests.map((item) => ({ ...item, ...(archived[item.id] ? { archivedAt: '2026-10-05T10:00:00.000Z', archiveReason: archived[item.id] } : {}), ...(plan.restore.some((restore) => restore.id === item.id) ? { archivedAt: null, archiveReason: null } : {}), ...(plan.update.find((update) => update.id === item.id)?.patch ?? {}) })),
    // A jsonb column hands keys back in its own order; that must not read as a change.
    ...plan.create.map((item) => ({ ...item.document, odoo: Object.fromEntries(Object.entries(item.document.odoo).reverse()), salaryRange: Object.fromEntries(Object.entries(item.document.salaryRange).reverse()) })),
  ];
  const again = planOdooSync({ organizationId: org, snapshot, requests: after, links, profiles, today: '2026-10-06', calendar });
  assert.deepEqual([again.create.length, again.restore.length, again.update.length, again.archive.length], [0, 0, 0, 0]);

  // The link is removed (or the approved request is cancelled): the job's own request comes back.
  const unclaimed = planOdooSync({ organizationId: org, snapshot, requests: after, links: new Map([['leg-linked', { odooJobId: 1 }]]), profiles, today: '2026-10-06', calendar });
  assert.deepEqual([unclaimed.restore.map((item) => item.id), unclaimed.create.length, unclaimed.archive.length], [[odooRequestId(org, 4)], 0, 0]);

  // A priority changed in Qodo stands while Odoo's own values stay put…
  const cfmId = odooRequestId(org, 1);
  const edited = after.map((item) => (item.id === cfmId ? { ...item, priority: 'critical', prioritySource: 'manual', sla: { ...item.sla, extendedWorkingDays: 5 } } : item));
  assert.equal(planOdooSync({ organizationId: org, snapshot, requests: edited, links, profiles, today: '2026-10-06', calendar }).update.length, 0);
  // …and Odoo wins again the moment HR moves the date or the period there. The extension is kept.
  const moved = { ...snapshot, jobs: snapshot.jobs.map((item) => (item.id === 1 ? { ...item, activeDate: '2026-10-04', hiringPeriodDays: 15 } : item)) };
  const follow = planOdooSync({ organizationId: org, snapshot: moved, requests: edited, links, profiles, today: '2026-10-06', calendar }).update;
  assert.deepEqual(follow.map((item) => item.id), [cfmId]);
  const { patch } = follow[0];
  assert.deepEqual([patch.priority, patch.prioritySource, patch.hiringPeriodDays, patch.sla.startDate, patch.sla.originalDueDate, patch.sla.extendedWorkingDays], ['critical', 'odoo_hiring_period', 15, '2026-10-04', '2026-10-25', 5]);
  assert.ok(patch.sla.currentDueDate > patch.sla.originalDueDate, 'the extension still pushes the due date out');

  // A job dated under the earlier calendar-day reading is re-dated once — unless somebody set its priority by hand.
  const old = (item, extra = {}) => ({ ...item, sla: { ...item.sla, targetWorkingDays: 21, originalDueDate: '2026-11-01', currentDueDate: '2026-11-01' }, targetWorkingDays: 21, odoo: { jobId: 1, firstSeen: '2026-10-05', activeDate: '2026-10-01', hiringPeriod: 30, seniority: null, status: null, publishedDate: null }, ...extra });
  const redate = (extra) => planOdooSync({ organizationId: org, snapshot, requests: after.map((item) => (item.id === cfmId ? old(item, extra) : item)), links, profiles, today: '2026-10-06', calendar }).update.find((item) => item.id === cfmId).patch;
  assert.deepEqual([redate({}).sla.currentDueDate, redate({}).targetWorkingDays], ['2026-11-12', 30]);
  assert.deepEqual(Object.keys(redate({ prioritySource: 'manual' })), ['odoo'], 'a hand-set priority keeps its clock; only the tracker moves');

  // An outage or an empty answer never archives the desk.
  assert.equal(planOdooSync({ organizationId: org, snapshot: null, requests, links, profiles, today: '2026-10-05', calendar }).skipped, 'odoo_unavailable');
  const empty = planOdooSync({ organizationId: org, snapshot: { connected: true, jobs: [], team: [] }, requests, links, profiles, today: '2026-10-05' });
  assert.deepEqual([empty.skipped, empty.archive.length], ['no_published_jobs', 0]);
});
