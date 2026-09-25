export type HRSource =
  | 'master'
  | 'payroll'
  | 'insurance'
  | 'recruitment'
  | 'organization'
  | 'leave'
  | 'offices';

export interface HRLeaveRecord {
  id: string;
  employeeCode: string;
  employeeName: string;
  date: string;
  code: string;
  days: number;
  comment: string;
}

export interface HRLeaveBalance {
  employeeCode: string;
  employeeName: string;
  title: string;
  hiringDate: string | null;
  status: string;
  teamLeader: string;
  supervisor: string;
  carriedAnnual: number | null;
  annualEntitlement: number | null;
  annualAccrued: number | null;
  annualRemaining: number | null;
  sickEntitlement: number | null;
  sickUsed: number | null;
  sickRemaining: number | null;
  annualUsed: number | null;
  availableNow: number | null;
  records?: HRLeaveRecord[];
}

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
  hasLeave: boolean;
  leaveAvailable: number | null;
  documentCompletionRate: number | null;
  totalSalary?: number | null;
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
    leaveEmployees: number;
    leaveRecords: number;
  };
  analytics: null | {
    workforce: HRWorkforceAnalytics;
    payroll: HRPayrollAnalytics | null;
    organization: { total: number; matched: number; vacant: number; unmatched: number; departments: number };
    leave: {
      year: number;
      employees: number;
      activeEmployees: number;
      records: number;
      annualDays: number;
      sickDays: number;
      negativeBalances: number;
    };
  };
  employees: HREmployeeSummary[];
  organization: HROrganizationPosition[];
  leaveBalances: HRLeaveBalance[];
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
  leave: HRLeaveBalance | null;
  sources: Record<string, boolean>;
  /** Someone Odoo has and the HR file does not yet. */
  odooOnly?: boolean;
}
