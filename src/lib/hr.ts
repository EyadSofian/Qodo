export type HRSource = 'master' | 'payroll' | 'insurance' | 'recruitment' | 'organization';

export interface HREmployeeSummary {
  employeeCode: string;
  nameEnglish: string;
  nameArabic: string;
  department: string;
  sector: string;
  title: string;
  hiringDate: string | null;
  birthDate: string | null;
  gender: string;
  status: string;
  companyEmail: string;
  linkedUserId: string | null;
  hasPayroll: boolean;
  hasInsurance: boolean;
  documentCompletionRate: number | null;
  totalSalary?: number | null;
}

export interface HRRecruitmentRequest {
  id: string;
  sequence: string;
  role: string;
  numberNeeded: number;
  accepted: number;
  feedback: string;
  department: string;
  vacancyReason: string;
  status: string;
  priority: string;
  seniority: string;
  location: string;
  assignedTo: string[];
  hiringPeriodDays: number | null;
  activeDate: string | null;
  dueDate: string | null;
  actualHiringDate: string | null;
  receivedRequirements: string;
  published: string;
  receivedCandidates: string;
  salaryRange: string;
  actualSalary: string;
  interviewer: string;
  validation: string;
}

export interface HROrganizationPosition {
  id: string;
  managerPositionId: string | null;
  title: string;
  employeeName: string;
  employeeCode: string | null;
  departmentCode: string;
  color: string | null;
  matchState: 'matched' | 'unmatched' | 'vacant';
  matchMethod?: 'exact' | 'prefix' | 'tokens' | null;
}

export interface HRDatasetMeta {
  source: HRSource;
  label: { ar: string; en: string };
  fileName?: string;
  sheetNames?: string[];
  importedAt: string | null;
  importedBy?: string | null;
  origin?: 'dashboard' | 'telegram';
  summary: Record<string, number> | null;
  warnings: Array<{ code: string; id?: string }>;
}

export interface HRReconciliation {
  activeWithoutPayroll: string[];
  payrollWithoutMaster: string[];
  insuranceWithoutMaster: string[];
  unlinkedAccounts: string[];
  unmatchedOrganizationPositions: string[];
}

export interface HRWorkforceAnalytics {
  period: string;
  active: number;
  inactive: number;
  newHires: number;
  gender: { male: number; female: number; unspecified: number };
  averageAge: number | null;
  ageBands: { under25: number; from25To34: number; from35To44: number; over45: number; unspecified: number };
  departments: Array<{ department: string; employees: number }>;
  largestDepartment: { department: string; employees: number } | null;
  socialInsured: number;
  healthInsured: number | null;
}

export interface HRPayrollAnalytics {
  rate: { buy: number; sell: number; asOf: string; source: string; sourceUrl: string; live: boolean };
  totalEgp: number;
  totalUsd: number;
  averageUsd: number;
  employees: number;
  departments: Array<{ department: string; employees: number; totalEgp: number; totalUsd: number; averageUsd: number }>;
  highestCostDepartment: { department: string; employees: number; totalEgp: number; totalUsd: number; averageUsd: number } | null;
  lowestCostDepartment: { department: string; employees: number; totalEgp: number; totalUsd: number; averageUsd: number } | null;
  ranking: Array<{ employeeCode: string; name: string; department: string; totalEgp: number; totalUsd: number }>;
}

export interface HRRecruitmentAnalytics {
  total: number;
  active: number;
  hold: number;
  done: number;
  totalNeeded: number;
  totalAccepted: number;
  openSeats: number;
  fillRate: number;
  overdue: number;
  dueSoon: number;
  averagePlannedDays: number | null;
  averageActualDays: number | null;
  funnel: { requirements: number; published: number; candidates: number; accepted: number; total: number };
}

export interface HROdooRecruitmentMatch {
  jobId: number;
  name: string;
  active: boolean;
  expectedEmployees: number;
  department: string;
  openedDate: string | null;
  publishedDate: string | null;
  applicantCount: number | null;
  stages: Array<{ stage: string; count: number }>;
  confidence: number;
  url: string;
}

export interface HROdooRecruitmentData {
  configured: boolean;
  connected: boolean;
  applicantsAvailable: boolean;
  summary: { matched: number; total: number; staleActive: number; candidateTotal: number | null };
  matches: Record<string, HROdooRecruitmentMatch>;
}

export interface HRDashboardData {
  permissions: {
    canViewPeople: boolean;
    canManage: boolean;
    canViewPayroll: boolean;
    selfOnly: boolean;
  };
  summary: {
    employees: number;
    active: number;
    payroll: number;
    insured: number;
    insuranceRecords: number;
    recruitmentRequests: number;
    openRecruitmentRequests: number;
    openPositions: number;
    organizationPositions: number;
    organizationVacancies: number;
  };
  analytics: null | {
    workforce: HRWorkforceAnalytics;
    payroll: HRPayrollAnalytics | null;
    recruitment: HRRecruitmentAnalytics;
    organization: { total: number; matched: number; vacant: number; unmatched: number; departments: number };
  };
  employees: HREmployeeSummary[];
  recruitment: HRRecruitmentRequest[];
  organization: HROrganizationPosition[];
  datasets: HRDatasetMeta[];
  accounts: Array<{ id: string; name: string; email: string }>;
  reconciliation: HRReconciliation | null;
  telegram: { enabled: boolean; restricted: boolean } | null;
}

export interface HREmployeeProfile extends HREmployeeSummary {
  directManager: string;
  resignationDate: string | null;
  workType: string;
  shiftStart: string;
  shiftEnd: string;
  weeklyHours: number | null;
  daysOff: string[];
  personalEmail: string;
  mobile: string;
  companyPhoneEgypt: string;
  companyPhoneKsa: string;
  bankName: string;
  bankStatus: string;
  bankAccount: string;
  nationalId: string;
  address: string;
  maritalStatus: string;
  children: number | null;
  nationality: string;
  education: string;
  graduationYear: number | null;
  religion: string;
  militaryStatus: string;
  socialInsuranceNumber: string;
  documents: Record<string, boolean | number | string | null>;
  payroll: null | {
    kpiContract: boolean;
    baseSalary: number | null;
    kpiAmount: number | null;
    totalSalary: number | null;
    title: string;
    department: string;
    status: string;
  };
  insurance: null | Record<string, string | number | null>;
  tax: null | { months: Record<string, number | null>; total: number | null };
  organizationPosition: HROrganizationPosition | null;
  sources: Record<string, boolean>;
}

export const HR_SOURCE_LABELS: Record<HRSource, { ar: string; en: string; hintAr: string; hintEn: string }> = {
  master: {
    ar: 'قاعدة الموظفين',
    en: 'Employee database',
    hintAr: 'البيانات الشخصية والوظيفية والمستندات',
    hintEn: 'Personal, employment, and document data',
  },
  payroll: {
    ar: 'الرواتب',
    en: 'Payroll',
    hintAr: 'المرتب الأساسي وKPI والإجمالي الشهري',
    hintEn: 'Base, KPI, and monthly total',
  },
  insurance: {
    ar: 'التأمينات والضرائب',
    en: 'Insurance & tax',
    hintAr: 'الاشتراكات والوعاء والضريبة',
    hintEn: 'Contributions, taxable base, and tax',
  },
  recruitment: {
    ar: 'طلبات التوظيف',
    en: 'Recruitment',
    hintAr: 'الاحتياجات والحالة والزمن المستهدف',
    hintEn: 'Demand, status, and hiring timeline',
  },
  organization: {
    ar: 'الهيكل التنظيمي',
    en: 'Organization',
    hintAr: 'المناصب والمدير المباشر والشواغر',
    hintEn: 'Positions, reporting lines, and vacancies',
  },
};
