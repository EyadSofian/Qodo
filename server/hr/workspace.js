/**
 * HR Home, People, Organization and Payroll reads for HR V2.
 *
 * These sit on the same employee state the workbook imports build
 * (`organizationState`), so People, Payroll and the org chart keep reading the
 * files HR already maintains — and they add what those files cannot: photos
 * and work locations from Odoo, and open seats from Qodo's own requests.
 * Payroll figures are only ever computed for a caller holding `hr.payroll`.
 */

import { find } from '../store.js';
import { can, PERMISSIONS } from '../../shared/permissions.js';
import { organizationOf } from '../../shared/organization.js';
import { localDay } from '../../shared/recruitment/sla.js';
import { usdEgpRate } from '../hrFx.js';
import {
  ageOn,
  employeeSummary,
  genderKey,
  leaveAnalytics,
  organizationAnalytics,
  organizationState,
  payrollAnalytics,
  reconciliation,
  workforceAnalytics,
} from '../hrModule.js';
import { forbidden } from './errors.js';
import { knownPhoto, odooEmployeeByKey, odooEmployeeIndex, odooWorkLocation } from './odooPeople.js';
import { odooTimeOff } from './odooTimeOff.js';
import { odooResolver, timeOffView } from './odooHR.js';
import { photoUrlFor } from './recruitment/team.js';
import { recruitmentOverview } from './recruitment/desk.js';
import { performanceOverview } from './performance.js';
import { PAYROLL_TYPES } from './personnel.js';

function rights(user) {
  return {
    people: can(user, PERMISSIONS.HR_VIEW),
    manage: can(user, PERMISSIONS.HR_MANAGE),
    payroll: can(user, PERMISSIONS.HR_PAYROLL),
    recruitment: can(user, PERMISSIONS.HR_RECRUITMENT_VIEW) || can(user, PERMISSIONS.HR_RECRUITMENT_APPROVE) || can(user, PERMISSIONS.HR_RECRUITMENT_ASSIGN),
    personnel: can(user, PERMISSIONS.HR_PERSONNEL_VIEW),
    performance: can(user, PERMISSIONS.HR_PERFORMANCE_REVIEW),
    settings: can(user, PERMISSIONS.HR_SETTINGS_MANAGE),
  };
}

/**
 * Which HR areas this person may open — the sidebar asks this, the routes
 * re-check. `employeeCode` is the caller's own HR record, which is what lets
 * somebody without HR rights still open their profile, KPI and seat.
 */
export async function hrAccess(user) {
  const r = rights(user);
  const state = await organizationState(organizationOf(user));
  const own = [...state.profiles.values()].find((profile) => profile.linkedUserId === user.id) ?? null;
  return {
    ...r,
    employeeCode: own?.employeeCode ?? null,
    personnelManage: can(user, PERMISSIONS.HR_PERSONNEL_MANAGE),
    requests: can(user, PERMISSIONS.HR_RECRUITMENT_REQUEST) || can(user, PERMISSIONS.HR_RECRUITMENT_REVIEW),
    kpiReview: can(user, PERMISSIONS.HR_RECRUITMENT_KPI_REVIEW),
    rewards: can(user, PERMISSIONS.HR_RECRUITMENT_REWARDS_MANAGE),
  };
}

/**
 * Employees for the People directory. The HR file is the record; Odoo adds the
 * live job, department, manager, work location, photo and today's leave. Active
 * Odoo employees the HR file does not have yet are listed too (for HR viewers
 * only), marked `source: 'odoo'`, so nobody working here is missing from People.
 */
export async function peopleDirectory(user) {
  const r = rights(user);
  const organizationId = organizationOf(user);
  const [state, index, timeOff] = await Promise.all([
    organizationState(organizationId),
    odooEmployeeIndex({ timeoutMs: 2500 }),
    odooTimeOff({ timeoutMs: 2500 }),
  ]);
  const profiles = [...state.profiles.values()];
  const resolver = odooResolver(profiles, index);
  const today = localDay();
  const leaveToday = new Map();
  for (const leave of timeOff?.leaves ?? []) {
    if (leave.state === 'validate' && leave.from <= today && leave.to >= today) leaveToday.set(leave.odooEmployeeId, { type: leave.type.name, away: leave.type.away, until: leave.to });
  }
  const visible = r.people ? profiles : profiles.filter((profile) => profile.linkedUserId === user.id);
  // A seat stores the Qodo account sitting in it, so it reaches an employee only
  // through that employee's linked account.
  const seats = await find('officeSeats', (seat) => organizationOf(seat) === organizationId && seat.userId);
  const offices = new Map((await find('offices', (office) => organizationOf(office) === organizationId)).map((office) => [office.id, office]));
  const employees = visible
    .filter((profile) => profile.sources.master || profile.sources.payroll)
    .map((profile) => {
      const odoo = resolver.odooFor(profile.employeeCode);
      const seat = profile.linkedUserId ? seats.find((row) => row.userId === profile.linkedUserId) : null;
      return {
        ...employeeSummary(profile, r.payroll),
        directManager: profile.directManager,
        photoUrl: odoo && knownPhoto(odoo.id) !== false ? photoUrlFor(profile.employeeCode) : null,
        location: odooWorkLocation(odoo) || (seat ? offices.get(seat.officeId)?.zone ?? '' : ''),
        age: ageOn(profile.birthDate, today),
        source: 'hr',
        odoo: odoo ? resolver.publicFor(odoo) : null,
        onLeave: odoo ? leaveToday.get(odoo.id) ?? null : null,
      };
    });
  if (r.people) {
    for (const row of resolver.odooOnly) {
      const odoo = resolver.publicFor(row);
      const code = resolver.codeFor(row.id);
      employees.push({
        employeeCode: code,
        nameEnglish: odoo.name,
        nameArabic: '',
        department: odoo.department,
        sector: '',
        title: odoo.jobTitle,
        hiringDate: odoo.since,
        birthDate: null,
        gender: '',
        status: 'active',
        companyEmail: odoo.workEmail,
        linkedUserId: null,
        hasPayroll: false,
        hasInsurance: false,
        hasLeave: false,
        leaveAvailable: null,
        documentCompletionRate: null,
        directManager: odoo.manager?.name ?? '',
        photoUrl: knownPhoto(row.id) !== false ? photoUrlFor(code) : null,
        location: odoo.workLocation,
        age: null,
        source: 'odoo',
        odoo,
        onLeave: leaveToday.get(row.id) ?? null,
      });
    }
  }
  employees.sort((left, right) => (left.status === 'active' ? 0 : 1) - (right.status === 'active' ? 0 : 1) || (left.nameArabic || left.nameEnglish).localeCompare(right.nameArabic || right.nameEnglish, 'ar'));
  const insured = profiles.filter((profile) => profile.insurance?.insuranceNumber);
  return {
    employees,
    analytics: r.people ? workforceAnalytics(profiles, insured) : null,
    selfOnly: !r.people,
    odoo: { connected: Boolean(index), odooOnly: r.people ? resolver.odooOnly.length : null, onLeaveToday: r.people ? [...leaveToday.values()].filter((entry) => !entry.away).length : null },
  };
}

/**
 * One person's Odoo side: job, department, manager, direct reports and time
 * off. The HR record reader (HR viewers, Personnel, or the person) may read it.
 */
export async function employeeOdoo(user, code) {
  const r = rights(user);
  const organizationId = organizationOf(user);
  const [state, index, timeOff] = await Promise.all([organizationState(organizationId), odooEmployeeIndex({ timeoutMs: 6000 }), odooTimeOff({ timeoutMs: 6000 })]);
  const profiles = [...state.profiles.values()];
  const profile = state.profiles.get(String(code)) ?? null;
  const self = Boolean(profile && profile.linkedUserId === user.id);
  if (!r.people && !r.personnel && !self) throw forbidden(PERMISSIONS.HR_VIEW);
  if (!index) return { connected: false };
  const resolver = odooResolver(profiles, index);
  const row = profile ? resolver.odooFor(profile.employeeCode) : (r.people ? odooEmployeeByKey(code, index) : null);
  if (!row) return { connected: true, employee: null };
  const reports = index.rows
    .filter((item) => item.active && Array.isArray(item.parent_id) && item.parent_id[0] === row.id)
    .map((item) => resolver.person(item.id))
    .sort((left, right) => left.nameEnglish.localeCompare(right.nameEnglish));
  return {
    connected: true,
    employee: resolver.publicFor(row),
    manager: Array.isArray(row.parent_id) ? resolver.person(row.parent_id[0], row.parent_id[1]) : null,
    reports,
    timeOff: timeOffView(timeOff, resolver, { everyone: false, ownOdooId: row.id }),
  };
}

/**
 * A profile for someone Odoo has and the HR file does not, so People can open
 * them. HR viewers only; every HR-file field is simply empty.
 */
export async function odooOnlyProfile(user, code) {
  if (!can(user, PERMISSIONS.HR_VIEW)) throw forbidden(PERMISSIONS.HR_VIEW);
  const index = await odooEmployeeIndex({ timeoutMs: 6000 });
  const row = odooEmployeeByKey(code, index);
  if (!row) return null;
  const state = await organizationState(organizationOf(user));
  const resolver = odooResolver([...state.profiles.values()], index);
  if (resolver.odooOnly.every((item) => item.id !== row.id)) return null;
  const odoo = resolver.publicFor(row);
  return {
    employeeCode: resolver.codeFor(row.id),
    nameEnglish: odoo.name,
    nameArabic: '',
    department: odoo.department,
    sector: '',
    title: odoo.jobTitle,
    hiringDate: odoo.since,
    birthDate: null,
    gender: '',
    status: row.active ? 'active' : 'inactive',
    companyEmail: odoo.workEmail,
    linkedUserId: null,
    hasPayroll: false,
    hasInsurance: false,
    hasLeave: false,
    leaveAvailable: null,
    documentCompletionRate: null,
    directManager: odoo.manager?.name ?? '',
    resignationDate: null,
    workType: '',
    shiftStart: '',
    shiftEnd: '',
    weeklyHours: null,
    daysOff: [],
    personalEmail: '',
    mobile: '',
    companyPhoneEgypt: odoo.workPhone,
    companyPhoneKsa: '',
    bankName: '',
    bankStatus: '',
    bankAccount: '',
    nationalId: '',
    address: '',
    maritalStatus: '',
    children: null,
    nationality: '',
    education: '',
    graduationYear: null,
    religion: '',
    militaryStatus: '',
    socialInsuranceNumber: '',
    documents: {},
    payroll: null,
    insurance: null,
    tax: null,
    organizationPosition: null,
    leave: null,
    sources: { master: false, payroll: false, insurance: false, organization: false, leave: false, odoo: true },
    odooOnly: true,
  };
}

export async function hrHome(user) {
  const r = rights(user);
  const organizationId = organizationOf(user);
  const state = await organizationState(organizationId);
  const profiles = [...state.profiles.values()];
  if (!r.people && !r.recruitment && !r.personnel) {
    const own = profiles.find((profile) => profile.linkedUserId === user.id) ?? null;
    return { selfOnly: true, employeeCode: own?.employeeCode ?? null };
  }
  const insured = profiles.filter((profile) => profile.insurance?.insuranceNumber);
  const workforce = workforceAnalytics(profiles, insured);
  const fx = r.payroll ? await usdEgpRate() : null;
  const payroll = r.payroll ? payrollAnalytics(profiles, fx) : null;
  const readsPeople = r.people || r.personnel;
  const [recruitment, personnelCases, performance, index, timeOff] = await Promise.all([
    r.recruitment ? recruitmentOverview(user).catch(() => null) : null,
    // Salary increases and insurance operations are payroll data, even as a count.
    r.personnel || r.manage ? find('personnelRequests', (item) => organizationOf(item) === organizationId && (r.payroll || !PAYROLL_TYPES.has(item.type))) : [],
    r.people || r.performance ? performanceOverview(user).catch(() => null) : null,
    readsPeople ? odooEmployeeIndex({ timeoutMs: 2500 }) : null,
    readsPeople ? odooTimeOff({ timeoutMs: 2500 }) : null,
  ]);
  const resolver = index ? odooResolver(profiles, index) : null;
  const timeOffToday = resolver && timeOff ? timeOffView(timeOff, resolver, { everyone: true }) : null;
  const active = profiles.filter((profile) => profile.status === 'active' && profile.sources.master);
  const leave = leaveAnalytics(state.bySource.leave);
  const gaps = r.manage ? reconciliation(state.profiles, state.positions) : null;
  const alerts = recruitment?.alerts ?? [];
  return {
    selfOnly: false,
    metrics: {
      activeEmployees: workforce.active,
      male: workforce.gender.male,
      female: workforce.gender.female,
      newEmployees: workforce.newHires,
      period: workforce.period,
      openJobs: recruitment?.summary.activeJobs ?? null,
      openSeats: recruitment?.summary.openSeats ?? null,
      insuredEmployees: workforce.socialInsured,
      payrollUsd: payroll ? payroll.totalUsd : null,
      payrollRate: payroll ? payroll.rate : null,
    },
    recruitment: recruitment
      ? {
          overdue: recruitment.summary.overdue,
          dueSoon: recruitment.summary.dueSoon,
          critical: recruitment.summary.critical,
          pendingApproval: recruitment.summary.pendingApproval,
          pendingReview: recruitment.summary.pendingReview,
          slaSuccess: recruitment.summary.slaSuccess,
          capacityAlerts: alerts.filter((alert) => alert.type.startsWith('capacity_')).length,
          criticalAlerts: alerts.filter((alert) => alert.severity === 'critical').length,
          topAlerts: alerts.slice(0, 4),
        }
      : null,
    personnel: {
      onboardingOpen: personnelCases.filter((item) => item.type === 'onboarding' && ['open', 'in_progress'].includes(item.status)).length,
      clearanceOpen: personnelCases.filter((item) => item.type === 'clearance' && ['open', 'in_progress'].includes(item.status)).length,
      requestsOpen: personnelCases.filter((item) => !['onboarding', 'clearance', 'leave'].includes(item.type) && ['open', 'in_progress'].includes(item.status)).length,
      leaveOpen: personnelCases.filter((item) => item.type === 'leave' && ['open', 'in_progress'].includes(item.status)).length,
      documentsIncomplete: active.filter((profile) => typeof profile.documents?.completionRate === 'number' && profile.documents.completionRate < 1).length,
      negativeLeave: leave.negativeBalances,
      unlinkedAccounts: gaps ? gaps.unlinkedAccounts.length : null,
      activeWithoutPayroll: gaps && r.payroll ? gaps.activeWithoutPayroll.length : null,
    },
    performance: performance
      ? { ...performance.attention, quarter: performance.quarter, period: performance.period }
      : null,
    timeOff: timeOffToday
      ? { connected: true, onLeaveToday: timeOffToday.onLeaveToday.slice(0, 12), awayToday: timeOffToday.awayToday.slice(0, 12), pending: timeOffToday.pending, upcoming: timeOffToday.upcoming.slice(0, 8) }
      : { connected: false },
    // Faces for the page header: people with a real Odoo photo first.
    faces: resolver
      ? [...resolver.byCode.values()]
          .filter((row) => row.active)
          .map((row) => resolver.person(row.id))
          .sort((left, right) => Number(right.hasPhoto) - Number(left.hasPhoto))
          .slice(0, 8)
      : [],
    odooOnly: resolver && r.people ? resolver.odooOnly.length : null,
    workforce: {
      departments: workforce.departments.slice(0, 8),
      gender: workforce.gender,
      ageBands: workforce.ageBands,
      averageAge: workforce.averageAge,
      largestDepartment: workforce.largestDepartment,
    },
  };
}

export async function payrollOverview(user) {
  if (!can(user, PERMISSIONS.HR_PAYROLL)) throw forbidden(PERMISSIONS.HR_PAYROLL);
  const organizationId = organizationOf(user);
  const state = await organizationState(organizationId);
  const profiles = [...state.profiles.values()];
  const fx = await usdEgpRate();
  const analytics = payrollAnalytics(profiles, fx);
  const insurance = profiles.filter((profile) => profile.insurance);
  const sum = (key) => insurance.reduce((total, profile) => total + (Number(profile.insurance?.[key]) || 0), 0);
  const dataset = state.bySource.payroll;
  const gaps = reconciliation(state.profiles, state.positions);
  const person = (code) => {
    const profile = state.profiles.get(code);
    return { employeeCode: code, nameArabic: profile?.nameArabic ?? '', nameEnglish: profile?.nameEnglish ?? '', title: profile?.title ?? '', department: profile?.department || profile?.payroll?.department || '', hiringDate: profile?.hiringDate ?? null };
  };
  return {
    analytics,
    insurance: {
      records: insurance.length,
      insured: insurance.filter((profile) => profile.insurance?.insuranceNumber).length,
      employeeShare: sum('employeeShare'),
      employerShare: sum('employerShare'),
      monthlyTax: sum('monthlyTax'),
      uninsuredOnPayroll: profiles.filter((profile) => profile.sources.payroll && profile.status !== 'inactive' && !profile.insurance?.insuranceNumber).map((profile) => person(profile.employeeCode)),
    },
    gaps: {
      activeWithoutPayroll: gaps.activeWithoutPayroll.map(person),
      payrollWithoutMaster: gaps.payrollWithoutMaster.map(person),
    },
    source: dataset ? { fileName: dataset.fileName, importedAt: dataset.importedAt, summary: dataset.summary } : null,
    employees: profiles
      .filter((profile) => profile.sources.payroll)
      .map((profile) => ({ employeeCode: profile.employeeCode, name: profile.nameArabic || profile.nameEnglish, department: profile.department || profile.payroll?.department || '', hasInsurance: Boolean(profile.insurance) })),
  };
}

/** Org chart, department strength, direct managers and every vacancy in one place. */
export async function organizationOverview(user) {
  if (!can(user, PERMISSIONS.HR_VIEW)) throw forbidden(PERMISSIONS.HR_VIEW);
  const organizationId = organizationOf(user);
  const state = await organizationState(organizationId);
  const profiles = [...state.profiles.values()].filter((profile) => profile.status === 'active' && profile.sources.master);
  const requests = await find('recruitmentRequests', (request) => organizationOf(request) === organizationId);
  const departments = new Map();
  for (const profile of profiles) {
    const name = String(profile.department || profile.sector || '—').trim();
    const entry = departments.get(name) ?? { name, sector: profile.sector || '', employees: 0, managers: new Map(), openSeats: 0, openJobs: 0 };
    entry.employees += 1;
    if (profile.directManager) entry.managers.set(profile.directManager, (entry.managers.get(profile.directManager) ?? 0) + 1);
    departments.set(name, entry);
  }
  const open = requests.filter((request) => ['pending_review', 'pending_approval', 'hiring', 'on_hold'].includes(request.status));
  const normal = (value) => String(value ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  for (const request of open) {
    const key = [...departments.keys()].find((name) => normal(name) === normal(request.department) || (normal(request.department).length > 2 && normal(name).includes(normal(request.department))));
    const entry = key ? departments.get(key) : null;
    if (!entry) continue;
    entry.openJobs += 1;
    entry.openSeats += Math.max(0, (Number(request.headcount) || 0) - (Number(request.accepted) || 0));
  }
  const index = await odooEmployeeIndex({ timeoutMs: 4000 });
  let odoo = { connected: false };
  if (index) {
    const resolver = odooResolver([...state.profiles.values()], index);
    const active = index.rows.filter((row) => row.active);
    const perDepartment = new Map();
    for (const row of active) if (Array.isArray(row.department_id)) perDepartment.set(row.department_id[0], (perDepartment.get(row.department_id[0]) ?? 0) + 1);
    odoo = {
      connected: true,
      people: active.map((row) => ({
        odooId: row.id,
        parentId: Array.isArray(row.parent_id) ? row.parent_id[0] : null,
        jobTitle: String(row.job_title || (Array.isArray(row.job_id) ? row.job_id[1] : '') || ''),
        ...resolver.person(row.id),
      })),
      departments: [...index.departments.values()]
        .filter((row) => row.active !== false)
        .map((row) => ({
          id: row.id,
          name: String(row.name ?? ''),
          parentId: Array.isArray(row.parent_id) ? row.parent_id[0] : null,
          manager: Array.isArray(row.manager_id) ? resolver.person(row.manager_id[0], row.manager_id[1]) : null,
          employees: perDepartment.get(row.id) ?? 0,
        }))
        .sort((left, right) => right.employees - left.employees || left.name.localeCompare(right.name)),
    };
  }
  return {
    odoo,
    positions: state.positions,
    analytics: organizationAnalytics(state.positions),
    departments: [...departments.values()]
      .map((entry) => ({ ...entry, managers: [...entry.managers.entries()].map(([name, count]) => ({ name, count })).sort((left, right) => right.count - left.count).slice(0, 3) }))
      .sort((left, right) => right.employees - left.employees),
    vacancies: [
      ...state.positions.filter((position) => position.matchState === 'vacant').map((position) => ({ source: 'structure', id: position.id, title: position.title, department: position.departmentCode, status: 'vacant' })),
      ...open.map((request) => ({ source: 'recruitment', id: request.id, title: request.title, department: request.department, status: request.status, priority: request.priority, openSeats: Math.max(0, (Number(request.headcount) || 0) - (Number(request.accepted) || 0)) })),
    ],
    genders: Object.fromEntries(['male', 'female', 'unspecified'].map((key) => [key, profiles.filter((profile) => genderKey(profile.gender) === key).length])),
  };
}
