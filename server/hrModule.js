import { create, find, findOne, getStore, now } from './store.js';
import { can, PERMISSIONS } from '../shared/permissions.js';
import { organizationOf } from '../shared/organization.js';
import { HR_IMPORT_SOURCES, HRWorkbookError, parseHRWorkbook } from './hrWorkbook.js';
import { usdEgpRate } from './hrFx.js';
import { odooRecruitmentMatches } from './hrRecruitmentOdoo.js';

const datasetId = (organizationId, source) => `hr-dataset:${organizationId}:${source}`;
const linkDocumentId = (organizationId) => `hr-links:${organizationId}`;

const SOURCE_LABELS = {
  master: { ar: 'قاعدة الموظفين', en: 'Employee database' },
  payroll: { ar: 'الرواتب الشهرية', en: 'Monthly payroll' },
  insurance: { ar: 'التأمينات والضرائب', en: 'Insurance & tax' },
  recruitment: { ar: 'طلبات التوظيف', en: 'Recruitment requests' },
  organization: { ar: 'الهيكل التنظيمي', en: 'Organization structure' },
};

function publicDataset(dataset) {
  if (!dataset) return null;
  const { payload: _payload, ...meta } = dataset;
  return meta;
}

function emptyProfile(employeeCode) {
  return {
    employeeCode,
    nameEnglish: '',
    nameArabic: '',
    sector: '',
    department: '',
    title: '',
    directManager: '',
    hiringDate: null,
    status: 'unknown',
    resignationDate: null,
    workType: '',
    shiftStart: '',
    shiftEnd: '',
    weeklyHours: null,
    daysOff: [],
    companyEmail: '',
    personalEmail: '',
    mobile: '',
    companyPhoneEgypt: '',
    companyPhoneKsa: '',
    bankName: '',
    bankStatus: '',
    bankAccount: '',
    nationalId: '',
    gender: '',
    birthDate: null,
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
    linkedUserId: null,
    sources: { master: false, payroll: false, insurance: false, organization: false },
  };
}

function comparablePersonName(value) {
  return String(value || '')
    .split(' ')
    .filter((token) => token.length > 1)
    .join(' ')
    .replaceAll('عبد الرحمن', 'عبدالرحمن')
    .replaceAll('عبد الله', 'عبدالله')
    .replaceAll('عبد العزيز', 'عبدالعزيز')
    .replaceAll('منه الله', 'منهالله')
    .trim();
}

function uniqueCandidate(candidates) {
  const unique = [...new Map(candidates.map((profile) => [profile.employeeCode, profile])).values()];
  const active = unique.filter((profile) => profile.status === 'active');
  if (active.length === 1) return active[0];
  return unique.length === 1 ? unique[0] : null;
}

/**
 * Organization sheets use display names such as "Ahmed Saeed", while the
 * employee database stores the full four-part Arabic name. An exact-only join
 * therefore loses most of the chart. These rules stay conservative: they
 * accept a unique full/prefix/token match, prefer a unique active employee,
 * and deliberately leave every ambiguous result for human review.
 */
function matchOrganizationEmployee(position, profiles) {
  const positionKey = comparablePersonName(position.employeeNameKey);
  if (!positionKey || positionKey === 'جديد') return { employee: null, method: null };
  const candidates = [...profiles.values()].filter((profile) => profile.sources.master);
  const keysFor = (profile) => [profile.nameKeyArabic, profile.nameKeyEnglish]
    .map(comparablePersonName)
    .filter(Boolean);

  const exact = uniqueCandidate(candidates.filter((profile) => keysFor(profile).includes(positionKey)));
  if (exact) return { employee: exact, method: 'exact' };

  const prefix = uniqueCandidate(candidates.filter((profile) =>
    keysFor(profile).some((key) => key === positionKey || key.startsWith(`${positionKey} `))
  ));
  if (prefix) return { employee: prefix, method: 'prefix' };

  const positionTokens = positionKey.split(' ').filter(Boolean);
  const tokenMatch = uniqueCandidate(candidates.filter((profile) =>
    keysFor(profile).some((key) => {
      const tokens = key.split(' ');
      let cursor = -1;
      return positionTokens.every((token) => {
        cursor = tokens.indexOf(token, cursor + 1);
        return cursor >= 0;
      });
    })
  ));
  return { employee: tokenMatch, method: tokenMatch ? 'tokens' : null };
}

function employeeMapFromDatasets(datasets) {
  const bySource = Object.fromEntries(datasets.map((dataset) => [dataset.source, dataset]));
  const profiles = new Map();
  const ensure = (employeeCode) => {
    const code = String(employeeCode || '').trim();
    if (!profiles.has(code)) profiles.set(code, emptyProfile(code));
    return profiles.get(code);
  };

  for (const employee of bySource.master?.payload?.employees ?? []) {
    const profile = ensure(employee.employeeCode);
    Object.assign(profile, employee);
    profile.sources.master = true;
  }
  for (const payroll of bySource.payroll?.payload?.employees ?? []) {
    const profile = ensure(payroll.employeeCode);
    if (!profile.nameEnglish) profile.nameEnglish = payroll.nameEnglish;
    if (!profile.title) profile.title = payroll.title;
    if (!profile.department) profile.department = payroll.department;
    if (profile.status === 'unknown') profile.status = payroll.status;
    profile.payroll = payroll;
    profile.sources.payroll = true;
  }

  const taxByNationalId = new Map(
    (bySource.insurance?.payload?.tax ?? [])
      .filter((row) => row.nationalId)
      .map((row) => [row.nationalId, row])
  );
  for (const insurance of bySource.insurance?.payload?.insurance ?? []) {
    const profile = ensure(insurance.employeeCode);
    if (!profile.nameArabic) profile.nameArabic = insurance.nameArabic;
    if (!profile.title) profile.title = insurance.title;
    if (!profile.department) profile.department = insurance.department;
    if (!profile.nationalId) profile.nationalId = insurance.nationalId;
    if (!profile.socialInsuranceNumber) profile.socialInsuranceNumber = insurance.insuranceNumber;
    profile.insurance = insurance;
    profile.tax = taxByNationalId.get(insurance.nationalId) ?? null;
    profile.sources.insurance = true;
  }

  const positions = (bySource.organization?.payload?.positions ?? []).map((position) => {
    const placeholder = comparablePersonName(position.employeeNameKey) === 'جديد';
    const match = placeholder ? { employee: null, method: null } : matchOrganizationEmployee(position, profiles);
    const employeeCode = match.employee?.employeeCode ?? null;
    if (employeeCode) {
      const profile = ensure(employeeCode);
      profile.organizationPosition = { ...position, employeeCode, matchMethod: match.method };
      profile.sources.organization = true;
    }
    return {
      ...position,
      employeeName: placeholder ? '' : position.employeeName,
      employeeCode,
      matchMethod: match.method,
      matchState: employeeCode ? 'matched' : (!position.employeeName || placeholder) ? 'vacant' : 'unmatched',
    };
  });

  return { bySource, profiles, positions };
}

function applyUserLinks(profiles, users, linkDocument) {
  const links = linkDocument?.links ?? {};
  const userByEmail = new Map(
    users.filter((user) => user.email).map((user) => [String(user.email).trim().toLowerCase(), user])
  );
  for (const profile of profiles.values()) {
    const explicit = links[profile.employeeCode];
    const linked = users.find((user) => user.id === explicit)
      ?? userByEmail.get(String(profile.companyEmail || '').trim().toLowerCase())
      ?? null;
    profile.linkedUserId = linked?.id ?? null;
  }
}

function employeeSummary(profile, includePayroll) {
  return {
    employeeCode: profile.employeeCode,
    nameEnglish: profile.nameEnglish,
    nameArabic: profile.nameArabic,
    department: profile.department,
    sector: profile.sector,
    title: profile.title,
    hiringDate: profile.hiringDate,
    birthDate: profile.birthDate,
    gender: profile.gender,
    status: profile.status,
    companyEmail: profile.companyEmail,
    linkedUserId: profile.linkedUserId,
    hasPayroll: Boolean(profile.payroll),
    hasInsurance: Boolean(profile.insurance),
    documentCompletionRate: profile.documents?.completionRate ?? null,
    totalSalary: includePayroll ? profile.payroll?.totalSalary ?? null : undefined,
  };
}

function cairoDay() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function genderKey(value) {
  const key = String(value || '').trim().toLowerCase();
  if (['male', 'm', 'ذكر', 'رجل'].includes(key)) return 'male';
  if (['female', 'f', 'أنثى', 'انثى', 'سيدة'].includes(key)) return 'female';
  return 'unspecified';
}

function ageOn(birthDate, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(birthDate || ''))) return null;
  const [year, month, day] = birthDate.split('-').map(Number);
  const [currentYear, currentMonth, currentDay] = today.split('-').map(Number);
  const age = currentYear - year - (currentMonth < month || (currentMonth === month && currentDay < day) ? 1 : 0);
  return age >= 15 && age <= 100 ? age : null;
}

function departmentBreakdown(profiles) {
  const groups = new Map();
  for (const profile of profiles) {
    const department = String(profile.department || profile.sector || 'غير محدد').trim();
    groups.set(department, (groups.get(department) ?? 0) + 1);
  }
  return [...groups.entries()]
    .map(([department, employees]) => ({ department, employees }))
    .sort((left, right) => right.employees - left.employees || left.department.localeCompare(right.department, 'ar'));
}

function workforceAnalytics(profiles, insured) {
  const today = cairoDay();
  const period = today.slice(0, 7);
  const active = profiles.filter((profile) => profile.status === 'active' && profile.sources.master);
  const gender = { male: 0, female: 0, unspecified: 0 };
  const ageBands = { under25: 0, from25To34: 0, from35To44: 0, over45: 0, unspecified: 0 };
  const ages = [];
  for (const profile of active) {
    gender[genderKey(profile.gender)] += 1;
    const age = ageOn(profile.birthDate, today);
    if (age === null) ageBands.unspecified += 1;
    else {
      ages.push(age);
      if (age < 25) ageBands.under25 += 1;
      else if (age < 35) ageBands.from25To34 += 1;
      else if (age < 45) ageBands.from35To44 += 1;
      else ageBands.over45 += 1;
    }
  }
  const departments = departmentBreakdown(active);
  return {
    period,
    active: active.length,
    inactive: profiles.filter((profile) => profile.status === 'inactive' && profile.sources.master).length,
    newHires: active.filter((profile) => String(profile.hiringDate || '').startsWith(period)).length,
    gender,
    averageAge: ages.length ? Math.round((ages.reduce((sum, value) => sum + value, 0) / ages.length) * 10) / 10 : null,
    ageBands,
    departments,
    largestDepartment: departments[0] ?? null,
    socialInsured: insured.length,
    healthInsured: null,
  };
}

function payrollAnalytics(profiles, fx) {
  const paid = profiles.filter((profile) => profile.sources.payroll && Number.isFinite(Number(profile.payroll?.totalSalary)));
  const byDepartment = new Map();
  let totalEgp = 0;
  const ranking = [];
  for (const profile of paid) {
    const total = Number(profile.payroll?.totalSalary || 0);
    totalEgp += total;
    const department = String(profile.department || profile.payroll?.department || 'غير محدد').trim();
    const current = byDepartment.get(department) ?? { department, employees: 0, totalEgp: 0 };
    current.employees += 1;
    current.totalEgp += total;
    byDepartment.set(department, current);
    ranking.push({
      employeeCode: profile.employeeCode,
      name: profile.nameArabic || profile.nameEnglish || `#${profile.employeeCode}`,
      department,
      totalEgp: total,
      totalUsd: total / fx.sell,
    });
  }
  const departments = [...byDepartment.values()]
    .map((item) => ({ ...item, totalUsd: item.totalEgp / fx.sell, averageUsd: item.totalEgp / fx.sell / item.employees }))
    .sort((left, right) => right.totalEgp - left.totalEgp || left.department.localeCompare(right.department, 'ar'));
  ranking.sort((left, right) => right.totalEgp - left.totalEgp || left.name.localeCompare(right.name, 'ar'));
  return {
    rate: fx,
    totalEgp,
    totalUsd: totalEgp / fx.sell,
    averageUsd: paid.length ? totalEgp / fx.sell / paid.length : 0,
    employees: paid.length,
    departments,
    highestCostDepartment: departments[0] ?? null,
    lowestCostDepartment: departments.at(-1) ?? null,
    ranking,
  };
}

function daysBetween(from, to) {
  const start = Date.parse(`${from}T12:00:00Z`);
  const end = Date.parse(`${to}T12:00:00Z`);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.round((end - start) / 86_400_000) : null;
}

function recruitmentAnalytics(requests) {
  const today = cairoDay();
  const active = requests.filter((request) => request.status === 'active');
  const plannedDays = requests
    .map((request) => request.activeDate && request.dueDate ? daysBetween(request.activeDate, request.dueDate) : null)
    .filter((value) => value !== null && value >= 0);
  const actualDays = requests
    .map((request) => request.activeDate && request.actualHiringDate ? daysBetween(request.activeDate, request.actualHiringDate) : null)
    .filter((value) => value !== null && value >= 0);
  const totalNeeded = requests.reduce((sum, request) => sum + Math.max(0, request.numberNeeded), 0);
  const totalAccepted = requests.reduce((sum, request) => sum + Math.max(0, request.accepted), 0);
  const openSeats = active.reduce((sum, request) => sum + Math.max(0, request.numberNeeded - request.accepted), 0);
  return {
    total: requests.length,
    active: active.length,
    hold: requests.filter((request) => request.status === 'hold').length,
    done: requests.filter((request) => request.status === 'done').length,
    totalNeeded,
    totalAccepted,
    openSeats,
    fillRate: totalNeeded ? Math.round((totalAccepted / totalNeeded) * 100) : 0,
    overdue: active.filter((request) => request.dueDate && request.dueDate < today && request.accepted < request.numberNeeded).length,
    dueSoon: active.filter((request) => {
      if (!request.dueDate || request.dueDate < today) return false;
      const days = daysBetween(today, request.dueDate);
      return days !== null && days <= 14;
    }).length,
    averagePlannedDays: plannedDays.length ? Math.round(plannedDays.reduce((sum, value) => sum + value, 0) / plannedDays.length) : null,
    averageActualDays: actualDays.length ? Math.round(actualDays.reduce((sum, value) => sum + value, 0) / actualDays.length) : null,
    funnel: {
      requirements: active.filter((request) => request.receivedRequirements === 'done').length,
      published: active.filter((request) => request.published === 'done').length,
      candidates: active.filter((request) => request.receivedCandidates === 'done').length,
      accepted: active.filter((request) => request.accepted > 0).length,
      total: active.length,
    },
  };
}

function organizationAnalytics(positions) {
  const matched = positions.filter((position) => position.matchState === 'matched').length;
  const vacant = positions.filter((position) => position.matchState === 'vacant').length;
  const unmatched = positions.filter((position) => position.matchState === 'unmatched').length;
  const departments = new Set(positions.map((position) => position.departmentCode).filter(Boolean));
  return { total: positions.length, matched, vacant, unmatched, departments: departments.size };
}

function reconciliation(profiles, positions) {
  const list = [...profiles.values()];
  const active = list.filter((profile) => profile.status === 'active');
  const masterCodes = new Set(list.filter((profile) => profile.sources.master).map((profile) => profile.employeeCode));
  return {
    activeWithoutPayroll: active.filter((profile) => !profile.sources.payroll).map((profile) => profile.employeeCode),
    payrollWithoutMaster: list.filter((profile) => profile.sources.payroll && !masterCodes.has(profile.employeeCode)).map((profile) => profile.employeeCode),
    insuranceWithoutMaster: list.filter((profile) => profile.sources.insurance && !masterCodes.has(profile.employeeCode)).map((profile) => profile.employeeCode),
    unlinkedAccounts: active.filter((profile) => !profile.linkedUserId).map((profile) => profile.employeeCode),
    unmatchedOrganizationPositions: positions.filter((position) => position.matchState === 'unmatched').map((position) => position.id),
  };
}

async function organizationState(organizationId) {
  const [datasets, users, linkDocument] = await Promise.all([
    find('hrDatasets', (dataset) => dataset.organizationId === organizationId),
    find('users', (user) => organizationOf(user) === organizationId),
    findOne('hrEmployeeLinks', (document) => document.id === linkDocumentId(organizationId)),
  ]);
  const state = employeeMapFromDatasets(datasets);
  applyUserLinks(state.profiles, users, linkDocument);
  return { ...state, datasets, users, linkDocument };
}

export async function hrDashboardFor(user) {
  const organizationId = organizationOf(user);
  const state = await organizationState(organizationId);
  const canViewPeople = can(user, PERMISSIONS.HR_VIEW);
  const canManage = can(user, PERMISSIONS.HR_MANAGE);
  const canViewPayroll = can(user, PERMISSIONS.HR_PAYROLL);
  const fxPromise = canViewPayroll ? usdEgpRate() : Promise.resolve(null);
  const allProfiles = [...state.profiles.values()];
  const visibleProfiles = canViewPeople
    ? allProfiles
    : allProfiles.filter((profile) => profile.linkedUserId === user.id);
  const recruitment = state.bySource.recruitment?.payload?.requests ?? [];
  const active = allProfiles.filter((profile) => profile.status === 'active');
  const payroll = allProfiles.filter((profile) => profile.sources.payroll);
  const insuranceRecords = allProfiles.filter((profile) => profile.sources.insurance);
  const insured = insuranceRecords.filter((profile) => profile.insurance?.insuranceNumber);
  const activeRecruitment = recruitment.filter((request) => request.status === 'active');
  const fx = await fxPromise;

  const summary = canViewPeople
    ? {
        employees: allProfiles.filter((profile) => profile.sources.master).length,
        active: active.length,
        payroll: payroll.length,
        insured: insured.length,
        insuranceRecords: insuranceRecords.length,
        recruitmentRequests: recruitment.length,
        openRecruitmentRequests: activeRecruitment.length,
        openPositions: activeRecruitment.reduce(
          (sum, request) => sum + Math.max(0, request.numberNeeded - request.accepted),
          0
        ),
        organizationPositions: state.positions.length,
        organizationVacancies: state.positions.filter((position) => position.matchState === 'vacant').length,
      }
    : {
        employees: visibleProfiles.length,
        active: visibleProfiles.filter((profile) => profile.status === 'active').length,
        payroll: visibleProfiles.filter((profile) => profile.sources.payroll).length,
        insured: visibleProfiles.filter((profile) => profile.insurance?.insuranceNumber).length,
        insuranceRecords: visibleProfiles.filter((profile) => profile.sources.insurance).length,
        recruitmentRequests: 0,
        openRecruitmentRequests: 0,
        openPositions: 0,
        organizationPositions: 0,
        organizationVacancies: 0,
      };

  return {
    permissions: {
      canViewPeople,
      canManage,
      canViewPayroll,
      selfOnly: !canViewPeople,
    },
    summary,
    analytics: canViewPeople
      ? {
          workforce: workforceAnalytics(allProfiles, insured),
          payroll: canViewPayroll ? payrollAnalytics(allProfiles, fx) : null,
          recruitment: recruitmentAnalytics(recruitment),
          organization: organizationAnalytics(state.positions),
        }
      : null,
    employees: visibleProfiles
      .map((profile) => employeeSummary(profile, canViewPayroll))
      .sort((left, right) =>
        (left.status === 'active' ? 0 : 1) - (right.status === 'active' ? 0 : 1)
        || (left.nameArabic || left.nameEnglish).localeCompare(right.nameArabic || right.nameEnglish, 'ar')
      ),
    recruitment: canViewPeople ? recruitment : [],
    organization: canViewPeople ? state.positions : [],
    accounts: canManage
      ? state.users
          .filter((account) => account.status === 'active')
          .map((account) => ({ id: account.id, name: account.name, email: account.email }))
          .sort((left, right) => left.name.localeCompare(right.name, 'ar'))
      : [],
    datasets: canManage
      ? HR_IMPORT_SOURCES.map((source) => {
          const dataset = state.bySource[source];
          return dataset
            ? publicDataset(dataset)
            : { source, label: SOURCE_LABELS[source], importedAt: null, summary: null, warnings: [] };
        })
      : [],
    reconciliation: canManage ? reconciliation(state.profiles, state.positions) : null,
    telegram: canManage
      ? {
          enabled: Boolean(
            (process.env.HR_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN)
            && process.env.HR_TELEGRAM_WEBHOOK_SECRET
            && String(process.env.HR_TELEGRAM_CHAT_IDS || '').trim()
          ),
          restricted: Boolean(String(process.env.HR_TELEGRAM_CHAT_IDS || '').trim()),
        }
      : null,
  };
}

export async function hrRecruitmentOdooFor(user) {
  if (!can(user, PERMISSIONS.HR_VIEW)) throw new HRWorkbookError('forbidden', 403);
  const state = await organizationState(organizationOf(user));
  return odooRecruitmentMatches(state.bySource.recruitment?.payload?.requests ?? []);
}

function stripSensitive(profile, includeSensitive, includePayroll) {
  const result = structuredClone(profile);
  result.hasPayroll = Boolean(result.payroll);
  result.hasInsurance = Boolean(result.insurance);
  result.documentCompletionRate = result.documents?.completionRate ?? null;
  result.totalSalary = includePayroll ? result.payroll?.totalSalary ?? null : undefined;
  delete result.nameKeyArabic;
  delete result.nameKeyEnglish;
  if (!includeSensitive) {
    result.personalEmail = '';
    result.mobile = '';
    result.companyPhoneEgypt = '';
    result.companyPhoneKsa = '';
    result.nationalId = result.nationalId ? `••••${result.nationalId.slice(-4)}` : '';
    result.address = '';
    result.bankName = '';
    result.bankStatus = '';
    result.bankAccount = '';
  }
  if (!includePayroll) {
    result.payroll = null;
    result.insurance = result.insurance
      ? {
          status: result.insurance.status,
          insuranceNumber: result.insurance.insuranceNumber
            ? `••••${String(result.insurance.insuranceNumber).slice(-4)}`
            : '',
          insuranceStartDate: result.insurance.insuranceStartDate,
          insuranceEndDate: result.insurance.insuranceEndDate,
        }
      : null;
    result.tax = null;
  }
  return result;
}

export async function hrEmployeeFor(user, employeeCode) {
  const state = await organizationState(organizationOf(user));
  const profile = state.profiles.get(String(employeeCode));
  if (!profile) throw new HRWorkbookError('hr_employee_not_found', 404);
  const self = profile.linkedUserId === user.id;
  if (!self && !can(user, PERMISSIONS.HR_VIEW)) throw new HRWorkbookError('forbidden', 403);
  return stripSensitive(
    profile,
    self || can(user, PERMISSIONS.HR_MANAGE),
    self || can(user, PERMISSIONS.HR_PAYROLL)
  );
}

export async function importHRDataset({
  bytes,
  fileName,
  requestedSource = 'auto',
  organizationId,
  actorId = null,
  origin = 'dashboard',
}) {
  const parsed = await parseHRWorkbook(bytes, requestedSource);
  const id = datasetId(organizationId, parsed.source);
  const existing = await findOne('hrDatasets', (dataset) => dataset.id === id);
  const document = {
    organizationId,
    source: parsed.source,
    label: SOURCE_LABELS[parsed.source],
    fileName: String(fileName || 'workbook.xlsx').slice(0, 180),
    sheetNames: parsed.sheetNames,
    importedAt: now(),
    importedBy: actorId,
    origin,
    summary: parsed.summary,
    warnings: parsed.warnings,
    payload: parsed.payload,
  };
  const store = await getStore();
  const dataset = existing ? await store.update('hrDatasets', id, document) : await create('hrDatasets', { id, ...document });
  const state = await organizationState(organizationId);
  const quality = reconciliation(state.profiles, state.positions);
  const run = await create('hrImportRuns', {
    organizationId,
    source: parsed.source,
    fileName: document.fileName,
    importedBy: actorId,
    origin,
    summary: parsed.summary,
    warnings: parsed.warnings,
    quality: Object.fromEntries(Object.entries(quality).map(([key, value]) => [key, value.length])),
    status: 'completed',
  });
  return { dataset: publicDataset(dataset), run, reconciliation: quality };
}

const MASTER_FIELDS = new Set([
  'nameEnglish', 'nameArabic', 'sector', 'department', 'title', 'directManager', 'hiringDate',
  'status', 'resignationDate', 'workType', 'shiftStart', 'shiftEnd', 'weeklyHours', 'daysOff',
  'companyEmail', 'personalEmail', 'mobile', 'companyPhoneEgypt', 'companyPhoneKsa', 'gender',
  'birthDate', 'address', 'maritalStatus', 'children', 'nationality', 'education', 'graduationYear',
  'religion', 'militaryStatus', 'socialInsuranceNumber', 'nationalId', 'documents',
]);
const PAYROLL_FIELDS = new Set(['title', 'department', 'status', 'kpiContract', 'baseSalary', 'kpiAmount', 'totalSalary']);
const INSURANCE_FIELDS = new Set([
  'insuredTitle', 'title', 'department', 'insuredCompany', 'insuranceNumber', 'insuranceStartDate',
  'insuranceEndDate', 'paymentMethod', 'payrollCompany', 'insuranceOffice', 'actualSalary',
  'salaryWithAllowances', 'insuredSalary', 'subscriptionSalary', 'status', 'employeeShare',
  'employerShare', 'taxBracket', 'annualTax', 'monthlyTax',
]);
const BANK_FIELDS = new Set(['bankName', 'bankStatus', 'bankAccount']);

function cleanPatch(patch, allowed) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new HRWorkbookError('hr_patch_invalid');
  }
  const result = {};
  for (const [key, value] of Object.entries(patch)) {
    if (allowed.has(key)) result[key] = value;
  }
  if (!Object.keys(result).length) throw new HRWorkbookError('hr_patch_empty');
  return result;
}

function datasetRows(dataset, section) {
  if (section === 'master' || section === 'bank') return dataset.payload?.employees;
  if (section === 'payroll') return dataset.payload?.employees;
  if (section === 'insurance') return dataset.payload?.insurance;
  return null;
}

export async function updateHREmployee({ organizationId, employeeCode, section, patch, actorId }) {
  const source = section === 'bank' ? 'master' : section;
  const allowed = section === 'master' ? MASTER_FIELDS
    : section === 'bank' ? BANK_FIELDS
      : section === 'payroll' ? PAYROLL_FIELDS
        : section === 'insurance' ? INSURANCE_FIELDS
          : null;
  if (!allowed) throw new HRWorkbookError('hr_section_invalid');
  const updates = cleanPatch(patch, allowed);
  const id = datasetId(organizationId, source);
  const dataset = await findOne('hrDatasets', (document) => document.id === id);
  if (!dataset) throw new HRWorkbookError('hr_dataset_missing', 409, { source });
  const rows = datasetRows(dataset, section);
  const index = rows?.findIndex((row) => row.employeeCode === String(employeeCode)) ?? -1;
  if (index < 0) throw new HRWorkbookError('hr_employee_not_found', 404);
  const payload = structuredClone(dataset.payload);
  const targetRows = section === 'insurance' ? payload.insurance : payload.employees;
  targetRows[index] = { ...targetRows[index], ...updates, employeeCode: String(employeeCode) };
  const store = await getStore();
  await store.update('hrDatasets', id, {
    payload,
    lastEditedAt: now(),
    lastEditedBy: actorId,
  });
  return hrEmployeeFor({ id: actorId, organizationId, role: 'admin', status: 'active', permissions: null }, employeeCode);
}

const RECRUITMENT_FIELDS = new Set([
  'role', 'numberNeeded', 'accepted', 'feedback', 'department', 'vacancyReason', 'status',
  'priority', 'seniority', 'location', 'assignedTo', 'hiringPeriodDays', 'activeDate', 'dueDate',
  'actualHiringDate', 'receivedRequirements', 'published', 'receivedCandidates', 'salaryRange',
  'actualSalary', 'interviewer', 'validation',
]);

export async function updateRecruitmentRequest({ organizationId, requestId, patch, actorId }) {
  const updates = cleanPatch(patch, RECRUITMENT_FIELDS);
  const id = datasetId(organizationId, 'recruitment');
  const dataset = await findOne('hrDatasets', (document) => document.id === id);
  if (!dataset) throw new HRWorkbookError('hr_dataset_missing', 409, { source: 'recruitment' });
  const payload = structuredClone(dataset.payload);
  const index = payload.requests.findIndex((request) => request.id === requestId);
  if (index < 0) throw new HRWorkbookError('hr_recruitment_not_found', 404);
  payload.requests[index] = { ...payload.requests[index], ...updates, id: requestId };
  if (
    Number(payload.requests[index].numberNeeded) > 0
    && Number(payload.requests[index].accepted) >= Number(payload.requests[index].numberNeeded)
  ) {
    payload.requests[index].status = 'done';
  }
  await (await getStore()).update('hrDatasets', id, { payload, lastEditedAt: now(), lastEditedBy: actorId });
  return payload.requests[index];
}

export async function linkHREmployee({ organizationId, employeeCode, userId, actorId }) {
  const state = await organizationState(organizationId);
  if (!state.profiles.has(String(employeeCode))) throw new HRWorkbookError('hr_employee_not_found', 404);
  if (userId && !state.users.some((user) => user.id === userId)) throw new HRWorkbookError('hr_user_not_found', 404);
  const id = linkDocumentId(organizationId);
  const links = { ...(state.linkDocument?.links ?? {}) };
  for (const [code, linkedUserId] of Object.entries(links)) {
    if (linkedUserId === userId && code !== String(employeeCode)) delete links[code];
  }
  if (userId) links[String(employeeCode)] = userId;
  else delete links[String(employeeCode)];
  const patch = { organizationId, links, updatedBy: actorId };
  if (state.linkDocument) await (await getStore()).update('hrEmployeeLinks', id, patch);
  else await create('hrEmployeeLinks', { id, ...patch });
  return { employeeCode: String(employeeCode), userId: userId || null };
}

export async function hrImportHistory(organizationId, limit = 25) {
  return (await find('hrImportRuns', (run) => run.organizationId === organizationId))
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .slice(0, Math.max(1, Math.min(100, Number(limit) || 25)));
}
