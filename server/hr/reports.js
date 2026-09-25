/**
 * HR reports — one shape for all of them.
 *
 *   { headline: [{ key, value, label, filter }], columns: [...], rows: [...] }
 *
 * Every headline number carries the row filter that produces it, so the page
 * can drill from "7 missed" straight to the seven jobs. Filters are the same
 * five everywhere — date range, employee, department, job, recruiter — and a
 * report simply ignores the ones that mean nothing to it.
 */

import { find } from '../store.js';
import { can, PERMISSIONS } from '../../shared/permissions.js';
import { organizationOf } from '../../shared/organization.js';
import { recruiterKpi } from '../../shared/recruitment/kpi.js';
import { isIsoDate, localDay, slaSnapshot } from '../../shared/recruitment/sla.js';
import { usdEgpRate } from '../hrFx.js';
import { ageOn, genderKey, organizationState, payrollAnalytics } from '../hrModule.js';
import { HRError, forbidden } from './errors.js';
import { hrSettingsFor } from './settings.js';
import { requestsFor } from './recruitment/data.js';
import { recruitmentTeamFor } from './recruitment/team.js';
import { odooLinksFor } from './recruitment/data.js';
import { jobApplicants, funnelCounts } from './recruitment/odooPipeline.js';
import { countReportRows, matchesReportFilter } from '../../shared/hrReportFilter.js';

export const REPORTS = [
  { id: 'recruitment_sla', permission: 'recruitment' },
  { id: 'recruiter_productivity', permission: 'recruitment' },
  { id: 'recruitment_funnel', permission: 'recruitment' },
  { id: 'instructor_history', permission: 'recruitment' },
  { id: 'payroll', permission: 'payroll' },
  { id: 'workforce', permission: 'people' },
  { id: 'kpi', permission: 'recruitment' },
  { id: 'quarterly_reviews', permission: 'people' },
];

function allowed(user, permission) {
  if (permission === 'payroll') return can(user, PERMISSIONS.HR_PAYROLL);
  if (permission === 'people') return can(user, PERMISSIONS.HR_VIEW) || can(user, PERMISSIONS.HR_PERFORMANCE_REVIEW);
  return can(user, PERMISSIONS.HR_RECRUITMENT_VIEW) || can(user, PERMISSIONS.HR_RECRUITMENT_APPROVE);
}

export function reportsFor(user) {
  return REPORTS.filter((report) => allowed(user, report.permission)).map((report) => report.id);
}

function normal(value) {
  return String(value ?? '').toLowerCase().normalize('NFKD').replace(/[ً-ٰٟ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function contains(haystack, needle) {
  const wanted = normal(needle);
  return !wanted || normal(haystack).includes(wanted);
}

function inRange(day, { from, to }) {
  if (!day) return !from && !to;
  const value = String(day).slice(0, 10);
  return (!from || value >= from) && (!to || value <= to);
}

function cleanFilters(input = {}) {
  const from = isIsoDate(input.from) ? input.from : null;
  const to = isIsoDate(input.to) ? input.to : null;
  if (from && to && from > to) throw new HRError('report_range_invalid');
  return {
    from,
    to,
    employee: String(input.employee ?? '').slice(0, 80),
    department: String(input.department ?? '').slice(0, 80),
    job: String(input.job ?? '').slice(0, 80),
    recruiter: String(input.recruiter ?? '').slice(0, 20),
  };
}

function outcomeOf(snapshot, request) {
  if (request.status === 'completed' && !request.sla?.completedAt) return 'unknown';
  if (!snapshot.started) return 'not_started';
  if (snapshot.state === 'met') return 'met';
  if (snapshot.state === 'missed') return 'missed';
  if (snapshot.state === 'overdue') return 'overdue';
  if (request.status === 'on_hold') return 'on_hold';
  if (['cancelled', 'rejected'].includes(request.status)) return request.status;
  return 'open';
}

async function recruitmentBase(user, filters) {
  const organizationId = organizationOf(user);
  const [{ settings }, state, requests] = await Promise.all([hrSettingsFor(organizationId), organizationState(organizationId), requestsFor(organizationId)]);
  const team = await recruitmentTeamFor({ profiles: state.profiles, requests, settings });
  const nameOf = (code) => {
    const profile = state.profiles.get(code);
    return profile ? { ar: profile.nameArabic || profile.nameEnglish, en: profile.nameEnglish || profile.nameArabic } : null;
  };
  const today = localDay();
  const matches = (request) =>
    contains(`${request.title} ${request.reference}`, filters.job)
    && contains(request.department, filters.department)
    && (!filters.recruiter || request.recruiterCode === filters.recruiter)
    && (!filters.employee || contains(`${nameOf(request.recruiterCode)?.en ?? ''} ${nameOf(request.recruiterCode)?.ar ?? ''} ${request.recruiterCode ?? ''}`, filters.employee));
  return { organizationId, settings, state, requests, team, nameOf, today, matches };
}

const L = (ar, en) => ({ ar, en });

async function recruitmentSla(user, filters) {
  const base = await recruitmentBase(user, filters);
  const rows = base.requests
    .filter(base.matches)
    .filter((request) => request.sla?.startDate && inRange(request.sla.startDate, filters))
    .map((request) => {
      const snapshot = slaSnapshot(request.sla, { today: base.today, calendar: base.settings.recruitment.calendar, dueSoonWorkingDays: base.settings.recruitment.sla.dueSoonWorkingDays });
      return {
        id: request.id,
        reference: request.reference,
        title: request.title,
        department: request.department,
        classification: request.classification,
        priority: request.priority,
        recruiter: base.nameOf(request.recruiterCode),
        recruiterCode: request.recruiterCode,
        start: request.sla.startDate,
        due: snapshot.dueDate,
        completed: request.sla.completedAt ?? null,
        target: snapshot.targetWorkingDays,
        actual: snapshot.actualWorkingDays ?? snapshot.elapsedWorkingDays,
        outcome: outcomeOf(snapshot, request),
        source: request.source,
      };
    });
  const outcome = (value) => ({ eq: { outcome: value } });
  const met = countReportRows(rows, outcome('met'));
  const judged = countReportRows(rows, { in: { outcome: ['met', 'missed'] } });
  return {
    headline: [
      { key: 'total', label: L('وظائف لها SLA', 'Jobs with an SLA'), value: rows.length, filter: null },
      { key: 'met', label: L('داخل الـSLA', 'Met'), value: met, filter: outcome('met'), tone: 'success' },
      { key: 'missed', label: L('بعد الموعد', 'Missed'), value: countReportRows(rows, outcome('missed')), filter: outcome('missed'), tone: 'critical' },
      { key: 'overdue', label: L('متأخرة الآن', 'Overdue now'), value: countReportRows(rows, outcome('overdue')), filter: outcome('overdue'), tone: 'critical' },
      // The rate drills into the jobs it was computed from: every one with a known outcome.
      { key: 'rate', label: L('نسبة النجاح', 'SLA success'), value: judged ? Math.round((met / judged) * 1000) / 10 : null, unit: '%', filter: { in: { outcome: ['met', 'missed'] } } },
      { key: 'unknown', label: L('نتيجة غير معروفة (تاريخي)', 'Unknown outcome (legacy)'), value: countReportRows(rows, outcome('unknown')), filter: outcome('unknown') },
    ],
    columns: ['reference', 'title', 'department', 'priority', 'recruiter', 'start', 'due', 'completed', 'target', 'actual', 'outcome'],
    rows,
  };
}

async function recruiterProductivity(user, filters) {
  const base = await recruitmentBase(user, filters);
  const events = await find('recruitmentKpiEvents', (event) => organizationOf(event) === base.organizationId);
  const batches = await find('recruitmentRewardBatches', (batch) => organizationOf(batch) === base.organizationId);
  const codes = new Set([...base.team.map((member) => member.employeeCode), ...base.requests.map((request) => request.recruiterCode).filter(Boolean)]);
  const period = (filters.to ?? base.today).slice(0, 7);
  const rows = [...codes]
    .filter((code) => !filters.recruiter || code === filters.recruiter)
    .map((code) => {
      const owned = base.requests.filter((request) => request.recruiterCode === code).filter(base.matches);
      const inWindow = owned.filter((request) => inRange(request.sla?.startDate ?? request.assignedAt, filters));
      const completed = owned.filter((request) => request.sla?.completedAt && inRange(request.sla.completedAt, filters));
      const known = completed.filter((request) => request.sla.slaMet !== null && request.sla.slaMet !== undefined);
      const open = owned.filter((request) => ['hiring', 'on_hold'].includes(request.status));
      const overdue = open.filter((request) => slaSnapshot(request.sla, { today: base.today, calendar: base.settings.recruitment.calendar }).state === 'overdue');
      const days = known.map((request) => request.sla.actualWorkingDays).filter((value) => Number.isFinite(value));
      return {
        id: code,
        recruiterCode: code,
        recruiter: base.nameOf(code),
        onTeam: base.team.some((member) => member.employeeCode === code),
        started: inWindow.length,
        completed: completed.length,
        onTime: known.filter((request) => request.sla.slaMet).length,
        late: known.filter((request) => !request.sla.slaMet).length,
        open: open.length,
        overdue: overdue.length,
        averageWorkingDays: days.length ? Math.round((days.reduce((sum, value) => sum + value, 0) / days.length) * 10) / 10 : null,
        kpi: recruiterKpi({ employeeCode: code, period, requests: base.requests, events, settings: base.settings, today: base.today, calendar: base.settings.recruitment.calendar }).percent,
        rewardBatches: batches.filter((batch) => batch.employeeCode === code && batch.status !== 'cancelled').length,
      };
    })
    .filter((row) => row.started || row.completed || row.open || row.onTeam)
    .filter((row) => !filters.employee || contains(`${row.recruiter?.en ?? ''} ${row.recruiter?.ar ?? ''} ${row.recruiterCode}`, filters.employee));
  const sum = (key) => rows.reduce((total, row) => total + (row[key] || 0), 0);
  // These headlines are job counts; each drills into the recruiters who hold them.
  return {
    headline: [
      { key: 'recruiters', label: L('مسؤولو توظيف', 'Recruiters'), value: rows.length, filter: null },
      { key: 'completed', label: L('وظائف أُغلقت', 'Jobs closed'), value: sum('completed'), filter: { gte: { completed: 1 } } },
      { key: 'onTime', label: L('في الموعد', 'On time'), value: sum('onTime'), filter: { gte: { onTime: 1 } }, tone: 'success' },
      { key: 'overdue', label: L('متأخرة الآن', 'Overdue now'), value: sum('overdue'), filter: { gte: { overdue: 1 } }, tone: 'critical' },
    ],
    columns: ['recruiter', 'started', 'completed', 'onTime', 'late', 'open', 'overdue', 'averageWorkingDays', 'kpi', 'rewardBatches'],
    rows,
  };
}

async function recruitmentFunnel(user, filters) {
  const base = await recruitmentBase(user, filters);
  const links = await odooLinksFor(base.organizationId);
  const candidates = base.requests.filter(base.matches).filter((request) => links.get(request.id) && inRange(request.sla?.startDate ?? String(request.createdAt).slice(0, 10), filters));
  const rows = [];
  const queue = [...candidates];
  const worker = async () => {
    while (queue.length) {
      const request = queue.shift();
      try {
        const applicants = await jobApplicants(links.get(request.id).odooJobId, request.sla?.startDate ?? null);
        rows.push({ id: request.id, reference: request.reference, title: request.title, department: request.department, recruiter: base.nameOf(request.recruiterCode), ...funnelCounts(applicants, base.settings.recruitment.odoo.funnel) });
      } catch {
        rows.push({ id: request.id, reference: request.reference, title: request.title, department: request.department, recruiter: base.nameOf(request.recruiterCode), unavailable: true });
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const sum = (key) => rows.reduce((total, row) => total + (row[key] || 0), 0);
  return {
    headline: ['received', 'filtered', 'interviewed', 'accepted', 'offer', 'hired'].map((key) => ({
      key,
      label: {
        received: L('مرشحون مستلمون', 'Candidates received'),
        filtered: L('مناسبون بعد الفرز', 'Suitable after filtering'),
        interviewed: L('تمت مقابلتهم', 'Interviewed'),
        accepted: L('مقبولون', 'Accepted'),
        offer: L('عُرض عليهم', 'Offer sent'),
        hired: L('تم تعيينهم', 'Hired'),
      }[key],
      value: sum(key),
      filter: { gte: { [key]: 1 } },
    })),
    columns: ['reference', 'title', 'recruiter', 'received', 'filtered', 'interviewed', 'accepted', 'offer', 'hired'],
    rows,
    note: L('من Odoo للوظائف المرتبطة فقط، منذ بداية الـSLA لكل وظيفة.', 'From Odoo, linked jobs only, since each job\'s SLA start.'),
  };
}

async function instructorHistory(user, filters) {
  const base = await recruitmentBase(user, filters);
  const rows = base.requests
    .filter((request) => request.classification === 'instructor')
    .filter(base.matches)
    .filter((request) => inRange(request.sla?.startDate ?? request.legacy?.activeDate ?? String(request.createdAt).slice(0, 10), filters))
    .map((request) => {
      const snapshot = slaSnapshot(request.sla, { today: base.today, calendar: base.settings.recruitment.calendar });
      return {
        id: request.id,
        reference: request.reference,
        title: request.title,
        location: request.locationCode ?? request.location,
        status: request.status,
        start: request.sla?.startDate ?? null,
        completed: request.sla?.completedAt ?? null,
        workingDays: request.sla?.actualWorkingDays ?? (snapshot.started ? snapshot.elapsedWorkingDays : null),
        outcome: outcomeOf(snapshot, request),
        source: request.source,
        recruiter: base.nameOf(request.recruiterCode),
      };
    });
  const closedFilter = { present: ['completed', 'workingDays'] };
  const closed = rows.filter((row) => matchesReportFilter(row, closedFilter));
  return {
    headline: [
      { key: 'total', label: L('طلبات مدربين', 'Instructor requests'), value: rows.length, filter: null },
      { key: 'eg', label: L('مصر', 'Egypt'), value: countReportRows(rows, { eq: { location: 'EG' } }), filter: { eq: { location: 'EG' } } },
      { key: 'ksa', label: L('السعودية', 'Saudi Arabia'), value: countReportRows(rows, { eq: { location: 'KSA' } }), filter: { eq: { location: 'KSA' } } },
      { key: 'completed', label: L('مكتملة', 'Completed'), value: countReportRows(rows, { eq: { status: 'completed' } }), filter: { eq: { status: 'completed' } } },
      { key: 'avg', label: L('متوسط أيام العمل للإغلاق', 'Average working days to close'), value: closed.length ? Math.round((closed.reduce((sum, row) => sum + row.workingDays, 0) / closed.length) * 10) / 10 : null, filter: closedFilter },
    ],
    columns: ['reference', 'title', 'location', 'status', 'recruiter', 'start', 'completed', 'workingDays', 'outcome'],
    rows,
  };
}

async function payrollReport(user, filters) {
  const organizationId = organizationOf(user);
  const state = await organizationState(organizationId);
  const analytics = payrollAnalytics([...state.profiles.values()], await usdEgpRate());
  const rows = analytics.ranking
    .filter((row) => contains(row.department, filters.department) && contains(`${row.name} ${row.employeeCode}`, filters.employee))
    .map((row) => ({ id: row.employeeCode, ...row }));
  const total = rows.reduce((sum, row) => sum + row.totalUsd, 0);
  return {
    headline: [
      { key: 'total', label: L('إجمالي بالدولار', 'Total USD'), value: Math.round(total), unit: 'USD', filter: null },
      { key: 'employees', label: L('موظفون', 'Employees'), value: rows.length, filter: null },
      { key: 'average', label: L('المتوسط', 'Average'), value: rows.length ? Math.round(total / rows.length) : null, unit: 'USD', filter: null },
    ],
    columns: ['employeeCode', 'name', 'department', 'totalUsd', 'totalEgp'],
    rows,
    rate: analytics.rate,
  };
}

async function workforceReport(user, filters) {
  const organizationId = organizationOf(user);
  const state = await organizationState(organizationId);
  const today = localDay();
  const rows = [...state.profiles.values()]
    .filter((profile) => profile.sources.master)
    .filter((profile) => contains(profile.department || profile.sector, filters.department) && contains(`${profile.nameArabic} ${profile.nameEnglish} ${profile.employeeCode}`, filters.employee) && contains(profile.title, filters.job))
    .filter((profile) => inRange(profile.hiringDate, filters) || (!filters.from && !filters.to))
    .map((profile) => ({
      id: profile.employeeCode,
      employeeCode: profile.employeeCode,
      name: { ar: profile.nameArabic || profile.nameEnglish, en: profile.nameEnglish || profile.nameArabic },
      department: profile.department || profile.sector,
      title: profile.title,
      gender: genderKey(profile.gender),
      age: ageOn(profile.birthDate, today),
      hiringDate: profile.hiringDate,
      status: profile.status,
    }));
  const headline = [
    { key: 'active', label: L('نشط', 'Active'), filter: { eq: { status: 'active' } } },
    { key: 'inactive', label: L('غير نشط', 'Inactive'), filter: { eq: { status: 'inactive' } } },
    { key: 'male', label: L('رجال (نشط)', 'Men (active)'), filter: { eq: { status: 'active', gender: 'male' } } },
    { key: 'female', label: L('سيدات (نشط)', 'Women (active)'), filter: { eq: { status: 'active', gender: 'female' } } },
    { key: 'new', label: L('معينون هذا الشهر', 'Hired this month'), filter: { eq: { status: 'active' }, prefix: { hiringDate: today.slice(0, 7) } } },
  ];
  return {
    headline: headline.map((entry) => ({ ...entry, value: countReportRows(rows, entry.filter) })),
    columns: ['employeeCode', 'name', 'department', 'title', 'gender', 'age', 'hiringDate', 'status'],
    rows,
  };
}

async function kpiReport(user, filters) {
  const base = await recruitmentBase(user, filters);
  const events = await find('recruitmentKpiEvents', (event) => organizationOf(event) === base.organizationId);
  const from = (filters.from ?? `${base.today.slice(0, 4)}-01-01`).slice(0, 7);
  const to = (filters.to ?? base.today).slice(0, 7);
  const months = [];
  for (let cursor = from; cursor <= to && months.length < 24;) {
    months.push(cursor);
    const [year, month] = cursor.split('-').map(Number);
    cursor = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
  }
  const rows = [];
  for (const member of base.team.filter((item) => !filters.recruiter || item.employeeCode === filters.recruiter)) {
    for (const period of months) {
      const kpi = recruiterKpi({ employeeCode: member.employeeCode, period, requests: base.requests, events, settings: base.settings, today: base.today, calendar: base.settings.recruitment.calendar });
      const by = Object.fromEntries(kpi.categories.map((category) => [category.id, category.measured ? Math.round(category.score * 10) / 10 : null]));
      rows.push({ id: `${member.employeeCode}:${period}`, recruiter: member.shortName, recruiterCode: member.employeeCode, period, percent: kpi.percent === null ? null : Math.round(kpi.percent * 10) / 10, ...by });
    }
  }
  const measured = rows.filter((row) => row.percent !== null);
  return {
    headline: [
      { key: 'avg', label: L('متوسط النتيجة', 'Average score'), value: measured.length ? Math.round((measured.reduce((sum, row) => sum + row.percent, 0) / measured.length) * 10) / 10 : null, unit: '%', filter: { present: ['percent'] } },
      { key: 'below', label: L('أقل من 70%', 'Below 70%'), value: countReportRows(rows, { lt: { percent: 70 } }), filter: { lt: { percent: 70 } }, tone: 'critical' },
    ],
    columns: ['recruiter', 'period', 'percent', 'hr_review', 'hiring_target', 'commitment', 'system_quality'],
    rows,
  };
}

async function quarterlyReport(user, filters) {
  const organizationId = organizationOf(user);
  const [state, reviews] = await Promise.all([organizationState(organizationId), find('performanceReviews', (review) => organizationOf(review) === organizationId)]);
  const rows = reviews
    .map((review) => {
      const profile = state.profiles.get(review.employeeCode);
      const total = (review.criteria ?? []).reduce((sum, criterion) => sum + Number(criterion.max || 0), 0);
      const got = (review.criteria ?? []).reduce((sum, criterion) => sum + Number(review.scores?.[criterion.id] ?? 0), 0);
      return {
        id: review.id,
        employeeCode: review.employeeCode,
        name: profile ? { ar: profile.nameArabic || profile.nameEnglish, en: profile.nameEnglish || profile.nameArabic } : { ar: review.employeeCode, en: review.employeeCode },
        department: profile?.department ?? '',
        quarter: review.quarter,
        status: review.status,
        percent: total ? Math.round((got / total) * 1000) / 10 : null,
      };
    })
    .filter((row) => contains(row.department, filters.department) && contains(`${row.name.ar} ${row.name.en} ${row.employeeCode}`, filters.employee));
  return {
    headline: [
      { key: 'reviews', label: L('تقييمات', 'Reviews'), value: rows.length, filter: null },
      { key: 'final', label: L('معتمدة', 'Final'), value: countReportRows(rows, { eq: { status: 'final' } }), filter: { eq: { status: 'final' } } },
      { key: 'draft', label: L('مسودة', 'Draft'), value: countReportRows(rows, { eq: { status: 'draft' } }), filter: { eq: { status: 'draft' } } },
    ],
    columns: ['employeeCode', 'name', 'department', 'quarter', 'status', 'percent'],
    rows,
  };
}

const BUILDERS = {
  recruitment_sla: recruitmentSla,
  recruiter_productivity: recruiterProductivity,
  recruitment_funnel: recruitmentFunnel,
  instructor_history: instructorHistory,
  payroll: payrollReport,
  workforce: workforceReport,
  kpi: kpiReport,
  quarterly_reviews: quarterlyReport,
};

export async function buildReport(user, id, query = {}) {
  const report = REPORTS.find((item) => item.id === id);
  if (!report) throw new HRError('report_unknown', 404);
  if (!allowed(user, report.permission)) throw forbidden(report.permission === 'payroll' ? PERMISSIONS.HR_PAYROLL : report.permission === 'people' ? PERMISSIONS.HR_VIEW : PERMISSIONS.HR_RECRUITMENT_VIEW);
  const filters = cleanFilters(query);
  const result = await BUILDERS[id](user, filters);
  return { id, filters, ...result };
}
