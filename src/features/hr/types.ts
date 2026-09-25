/**
 * The shapes HR V2's API answers with. They mirror `server/hr/*` — when a
 * service adds a field, it lands here in the same change.
 */

export type Lang = 'ar' | 'en';
export type Localised = { ar: string; en: string };

export type Priority = 'critical' | 'required' | 'planned';
export type RequestStatus =
  | 'draft'
  | 'pending_review'
  | 'pending_approval'
  | 'hiring'
  | 'on_hold'
  | 'completed'
  | 'cancelled'
  | 'rejected';
export type SlaState = 'on_track' | 'due_soon' | 'due_today' | 'overdue' | 'paused' | 'met' | 'missed' | 'not_started';
export type Severity = 'critical' | 'warning' | 'info' | 'success';

export interface HRAccess {
  /** The caller's own employee code, when their account is linked to an HR record. */
  employeeCode: string | null;
  people: boolean;
  manage: boolean;
  payroll: boolean;
  recruitment: boolean;
  personnel: boolean;
  personnelManage: boolean;
  performance: boolean;
  settings: boolean;
  requests: boolean;
  kpiReview: boolean;
  rewards: boolean;
}

export interface TeamMember {
  employeeCode: string;
  nameArabic: string;
  nameEnglish: string;
  shortName: Localised;
  title: string;
  department: string;
  linkedUserId: string | null;
  odooEmployeeId: number | null;
  photoUrl: string | null;
  reasons: Array<'title' | 'odoo' | 'assignments' | 'manual'>;
  excluded?: boolean;
}

export interface Workload {
  critical: number;
  required: number;
  planned: number;
  unclassified: number;
  total: number;
}

export interface Limits {
  critical: number | null;
  required: number | null;
  planned: number | null;
}

export type LevelMap = Record<'critical' | 'required' | 'planned', 'ok' | 'full' | 'over'>;

export interface RecruiterCardData {
  member: TeamMember;
  workload: Workload;
  limits: Limits;
  level: LevelMap;
  pipeline: number;
  overdue: number;
  completedThisMonth: number;
  slaSuccess: { percent: number | null; judged: number };
  kpi: { percent: number | null; complete: boolean; period: string };
  reward: { done: number; of: number; category: RewardCategory | null; ready: number };
}

export interface SlaSnapshot {
  started: boolean;
  state: SlaState;
  startDate?: string;
  originalTargetWorkingDays?: number;
  extendedWorkingDays?: number;
  pausedWorkingDays?: number;
  targetWorkingDays?: number;
  originalDueDate?: string;
  dueDate?: string;
  elapsedWorkingDays?: number;
  remainingWorkingDays?: number;
  overdueWorkingDays?: number;
  progress?: number;
  completedAt?: string | null;
  actualWorkingDays?: number | null;
  slaMet?: boolean | null;
}

export interface StoredSla {
  startDate: string;
  targetWorkingDays: number;
  targetSource?: string;
  originalDueDate: string | null;
  currentDueDate: string | null;
  extendedWorkingDays: number;
  pausedWorkingDays: number;
  pausedSince: string | null;
  completedAt: string | null;
  actualWorkingDays: number | null;
  slaMet: boolean | null;
}

export interface RecruiterSummary {
  employeeCode: string;
  name: Localised;
  title: string;
  photoUrl: string | null;
  onTeam: boolean;
  active: boolean;
}

export interface Abilities {
  edit: boolean;
  submit: boolean;
  review: boolean;
  approve: boolean;
  assign: boolean;
  changePriority: boolean;
  extend: boolean;
  hold: boolean;
  resume: boolean;
  cancel: boolean;
  recordAccepted: boolean;
  linkOdoo: boolean;
  overrideCapacity: boolean;
  kpiReview: boolean;
}

export interface SalaryRange {
  min: number | null;
  max: number | null;
  currency: string | null;
  text: string;
}

export interface JobRequest {
  id: string;
  reference: string;
  source: 'qodo' | 'legacy_workbook';
  status: RequestStatus;
  statusChangedAt: string | null;
  title: string;
  department: string;
  departmentId: string;
  location: string;
  locationCode: 'EG' | 'KSA' | null;
  headcount: number;
  accepted: number;
  openSeats: number;
  classification: string | null;
  classificationSource: string | null;
  priority: Priority | null;
  prioritySource: string | null;
  reason: string;
  reasonNote: string;
  responsibilities: string;
  tasks: string;
  successIndicators: string;
  requirements: string;
  requirementChecks: { demo: boolean; technicalTest: boolean; offer: boolean };
  presentationRequirement: string;
  salaryRange: SalaryRange;
  actualSalary?: string;
  targetWorkingDays: number | null;
  recruiterCode: string | null;
  supportRecruiterCodes: string[];
  unresolvedAssignees: string[];
  assignedAt: string | null;
  interviewManager: { name: string; userId: string | null };
  requestedBy: string | null;
  requestedByName: string;
  notes: string;
  legacyValidation: string;
  sla: StoredSla | null;
  slaSnapshot: SlaSnapshot;
  recruiter: RecruiterSummary | null;
  supportRecruiters: Array<RecruiterSummary | null>;
  odooLink: { jobId: number; name: string; matchType: string; linkedAt: string } | null;
  abilities: Abilities;
  revision: number;
  createdAt: string;
  updatedAt: string;
  legacy?: {
    key: string;
    period: string | null;
    fileName: string | null;
    sequence: string;
    priority: string;
    seniority: string;
    hiringPeriodDays: number | null;
    activeDate: string | null;
    dueDate: string | null;
    status: string;
    stages: Record<string, string>;
    assignedTo: string[];
  };
}

export interface Classification {
  id: string;
  ar: string;
  en: string;
  active: boolean;
}

export interface Band {
  min: number;
  max: number;
  default: number;
}

export interface RecruitmentContext {
  today: string;
  policy: {
    bands: Record<Priority, Band>;
    capacity: Limits & { countOnHold: boolean };
    classifications: Classification[];
    dueSoonWorkingDays: number;
    weekend: number[];
  };
  perms: Record<string, boolean>;
  employeeCode: string | null;
  team: TeamMember[];
}

export interface Alert {
  id: string;
  type: string;
  severity: Severity;
  subject: { kind: 'job'; id: string } | { kind: 'recruiter'; code: string };
  link: string;
  fingerprint: string;
  params: Record<string, unknown>;
  title: Localised;
  body: Localised;
  actions: string[];
}

export interface RecruitmentSummary {
  activeJobs: number;
  onHold: number;
  critical: number;
  required: number;
  planned: number;
  unclassified: number;
  overdue: number;
  dueSoon: number;
  openSeats: number;
  pendingReview: number;
  pendingApproval: number;
  completedThisMonth: number;
  slaSuccess: { percent: number | null; judged: number; year: string };
}

export interface RecruitmentOverviewData {
  scope: 'all' | 'self' | null;
  team: RecruiterCardData[];
  summary: RecruitmentSummary;
  alerts: Alert[];
  context: RecruitmentContext;
}

export interface ApprovalRow {
  id: string;
  stage: string;
  action: string;
  decision: string;
  fromStatus: string;
  toStatus: string;
  actorId: string | null;
  actorName: string;
  comment: string;
  selfReviewed?: boolean;
  createdAt: string;
}

export interface TimelineStep {
  stage: 'request' | 'department_review' | 'final_approval' | 'hiring';
  state: 'done' | 'current' | 'upcoming' | 'rejected';
  event: ApprovalRow | null;
}

export interface AssignmentRow {
  id: string;
  recruiterCode: string | null;
  previousRecruiterCode: string | null;
  recruiter: RecruiterSummary | null;
  previous: RecruiterSummary | null;
  actorName: string;
  reason: string;
  override: boolean;
  overrideReason: string;
  capacity: { current: Workload; projected: Workload; limits: Limits; exceeded: string[] } | null;
  createdAt: string;
}

export interface ExtensionRow {
  id: string;
  previousDueDate: string;
  newDueDate: string;
  originalDueDate: string;
  addedWorkingDays: number;
  reason: string;
  note: string;
  actorName: string;
  createdAt: string;
}

export interface ActivityRow {
  id: string;
  type: string;
  actorId: string | null;
  actorName: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export interface RequestDetailData {
  request: JobRequest;
  timeline: TimelineStep[];
  approvals: ApprovalRow[];
  assignments: AssignmentRow[];
  extensions: ExtensionRow[];
  activity: ActivityRow[];
  performance: null | {
    kpiEvents: KpiEvent[];
    reward: {
      eligible: boolean;
      reasons: string[];
      category: RewardCategory | null;
      batch: null | { id: string; status: string; amountMin: number; amountMax: number; amountApproved: number | null; currency: string };
      rulesVersion: number;
    };
  };
  context: RecruitmentContext;
}

export interface CapacityCheck {
  ok: boolean;
  recruiterCode: string;
  recruiterName?: Localised;
  priority: string;
  current: Workload;
  projected: Workload;
  limits: Limits;
  exceeded: string[];
}

export interface OdooCandidate {
  id: number;
  name: string;
  stage: string;
  recruiter: string;
  appliedOn: string | null;
  lastStageUpdate: string | null;
  hiredOn: string | null;
  refused: boolean;
  refuseReason: string;
  expectedSalary: number | null;
  proposedSalary: number | null;
  hasEmail: boolean;
  hasPhone: boolean;
  meetings: number | null;
  url: string | null;
}

export interface Funnel {
  received: number;
  filtered: number;
  interviewed: number;
  accepted: number;
  offer: number;
  hired: number;
}

export interface OdooJobOption {
  jobId: number;
  name: string;
  active: boolean;
  department: string;
  applicantCount: number | null;
  suggestionScore?: number;
}

export interface RequestPipeline {
  configured: boolean;
  connected: boolean;
  since?: string | null;
  link: null | {
    jobId: number;
    name?: string;
    active?: boolean;
    confirmed?: boolean;
    matchType?: string;
    target?: number | null;
    recruiter?: string;
    url?: string | null;
    allTimeApplicants?: number | null;
    stale?: boolean;
  };
  suggestions?: OdooJobOption[];
  total?: number;
  stages?: Array<{ stage: string; sequence: number; count: number; active: number }>;
  funnel?: Funnel;
  acceptedFromOdoo?: number | null;
  candidates?: OdooCandidate[];
}

export interface OdooOverview {
  configured: boolean;
  connected: boolean;
  applicantsAvailable?: boolean;
  summary: null | {
    requests: number;
    confirmed: number;
    suggested: number;
    stale: number;
    odooJobs: number;
    activeOdooJobs: number;
    candidateTotal: number | null;
    activeCandidateTotal: number | null;
    stageTotals: Array<{ stage: string; count: number }>;
  };
  links: Record<string, { jobId: number; name?: string; active?: boolean; confirmed: boolean; matchType: string; confidence?: number; applicantCount?: number | null; recruiter?: string; url?: string | null; stale?: boolean }>;
  suggestions: Record<string, OdooJobOption[]>;
  jobOptions: OdooJobOption[];
}

export interface KpiRule {
  id: string;
  category: 'hr_review' | 'commitment' | 'system_quality';
  points: number;
  ar: string;
  en: string;
  enabled: boolean;
  automatic?: boolean;
  requiresJob?: boolean;
  requiresJobField?: string;
  humanReviewOnly?: boolean;
  minReasonLength?: number;
  custom?: boolean;
}

export interface KpiEvent {
  id: string;
  employeeCode: string;
  requestId: string | null;
  period: string;
  occurredOn: string;
  category: string;
  rule: { id: string; ar: string; en: string } | string;
  points: number;
  count: number;
  deduction: number;
  reason: string;
  evidence: string;
  note: string;
  reviewerId: string | null;
  reviewerName?: string;
  source: 'manual' | 'automatic';
  voidedAt: string | null;
  voidedBy: string | null;
  voidedByName?: string;
  voidReason: string;
  job?: { title: string; reference: string } | null;
  createdAt: string;
}

export interface KpiCategoryResult {
  id: 'hr_review' | 'hiring_target' | 'commitment' | 'system_quality';
  ar: string;
  en: string;
  weight: number;
  mode: 'deductions' | 'computed';
  measured: boolean;
  score: number | null;
  deducted: number;
  detail: null | {
    measured: boolean;
    score: number | null;
    weight: number;
    assignedThisMonth: number;
    evaluated: number;
    completed: number;
    completedOnTime: number;
    notCompleted: number;
    jobs: Array<{ requestId: string; title: string; reference: string; completedAt: string | null; dueDate: string; onTime: boolean; outcome: string; actualWorkingDays: number | null; targetWorkingDays: number }>;
  };
  events: KpiEvent[];
}

export interface KpiOverviewData {
  period: string;
  categories: Array<{ id: string; ar: string; en: string; weight: number; mode: string }>;
  recruiters: Array<{
    member: TeamMember;
    percent: number | null;
    score: number;
    measuredWeight: number;
    complete: boolean;
    categories: Array<{ id: string; weight: number; score: number | null; measured: boolean; deducted: number; deductions: number }>;
  }>;
  rules: KpiRule[];
  canReview: boolean;
}

export interface KpiDetailData {
  member: TeamMember | null;
  kpi: { employeeCode: string; period: string; categories: KpiCategoryResult[]; score: number; measuredWeight: number; percent: number | null; complete: boolean };
  canReview: boolean;
}

export interface RewardCategory {
  id: string;
  ar: string;
  en: string;
  classification: string;
  location: 'EG' | 'KSA' | null;
  amountMin: number;
  amountMax: number;
}

export interface RewardRules {
  id: string;
  version: number;
  jobsPerBatch: number;
  grouping: 'per_category' | 'mixed';
  currency: string;
  eligibility: { requireCompleted: boolean; requireWithinSla: boolean; requireQualityPassed: boolean };
  categories: RewardCategory[];
  createdAt: string;
  note?: string;
}

export interface RewardJob {
  id: string;
  title: string;
  reference: string;
  completedAt: string | null;
  classification: string | null;
  locationCode: string | null;
}

export interface RewardBatch {
  id: string;
  employeeCode: string;
  jobIds: string[];
  jobs: RewardJob[];
  categoryId: string;
  ruleVersion: number;
  amountMin: number;
  amountMax: number;
  amountApproved: number | null;
  currency: string;
  status: 'ready' | 'approved' | 'paid' | 'rejected' | 'cancelled';
  approverName: string;
  decidedAt: string | null;
  decisionNote: string;
  paidAt: string | null;
  createdAt: string;
  member: TeamMember | null;
}

export interface RewardsData {
  rules: RewardRules;
  versions: Array<{ id: string; version: number; createdAt: string; createdByName: string; note: string }>;
  recruiters: Array<{
    member: TeamMember;
    progress: Array<{ categoryId: string; category: RewardCategory | null; done: number; of: number; jobIds: string[]; jobs: RewardJob[] }>;
    best: { categoryId: string | null; category: RewardCategory | null; done: number; of: number; jobIds: string[] };
    ineligible: Array<{ requestId: string; reasons: string[]; job: RewardJob | null }>;
  }>;
  batches: RewardBatch[];
  canManage: boolean;
  canEditRules: boolean;
}

/** An Odoo employee as HR shows them (never the private e-mail, birthday or ID). */
export interface OdooEmployee {
  odooId: number;
  name: string;
  jobTitle: string;
  department: string;
  departmentId: number | null;
  manager: { id: number; name: string; code: string | null } | null;
  coach: { id: number; name: string; code: string | null } | null;
  leaveApprover: string;
  workEmail: string;
  workPhone: string;
  workLocation: string;
  employeeType: string;
  since: string | null;
  active: boolean;
  url: string | null;
}

/** A person in a row: their HR code (or Odoo key), names, photo. */
export interface PersonRef {
  code: string | null;
  nameArabic: string;
  nameEnglish: string;
  title: string;
  department: string;
  photoUrl: string | null;
  hasPhoto?: boolean;
  inHrFile: boolean;
}

export interface OdooLeaveType {
  id: number | null;
  name: string;
  color: number;
  away: boolean;
}

export interface OdooLeave {
  id: number;
  employee: PersonRef;
  type: OdooLeaveType;
  from: string | null;
  to: string | null;
  days: number;
  duration: string;
  hours: boolean;
  state: 'draft' | 'confirm' | 'validate1' | 'validate' | 'refuse' | string;
  createdAt: string | null;
}

export interface OdooAllocation {
  id: number;
  employee: PersonRef;
  type: OdooLeaveType;
  days: number;
  taken: number;
  remaining: number;
  state: string;
  from: string | null;
  to: string | null;
}

export interface TimeOffView {
  connected: boolean;
  year?: number;
  today?: string;
  types?: Array<OdooLeaveType & { unit: string; requiresAllocation: boolean; active: boolean; unpaid: boolean }>;
  requests?: OdooLeave[];
  allocations?: OdooAllocation[];
  onLeaveToday?: OdooLeave[];
  awayToday?: OdooLeave[];
  pending?: number;
  upcoming?: OdooLeave[];
}

export interface EmployeeOdooData {
  connected: boolean;
  employee?: OdooEmployee | null;
  manager?: PersonRef | null;
  reports?: PersonRef[];
  timeOff?: TimeOffView;
}

export interface EmployeeSummary {
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
  directManager?: string;
  photoUrl?: string | null;
  location?: string;
  age?: number | null;
  /** `odoo` for someone working in Odoo whom the HR file does not have yet. */
  source?: 'hr' | 'odoo';
  odoo?: OdooEmployee | null;
  onLeave?: { type: string; away: boolean; until: string } | null;
}

export interface WorkforceAnalytics {
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
}

export interface PeopleData {
  employees: EmployeeSummary[];
  analytics: WorkforceAnalytics | null;
  selfOnly: boolean;
  odoo?: { connected: boolean; odooOnly: number | null; onLeaveToday: number | null };
}

export interface HomeData {
  selfOnly: boolean;
  employeeCode?: string | null;
  metrics?: {
    activeEmployees: number;
    male: number;
    female: number;
    newEmployees: number;
    period: string;
    openJobs: number | null;
    openSeats: number | null;
    insuredEmployees: number;
    payrollUsd: number | null;
    payrollRate: { sell: number; source: string; asOf: string } | null;
  };
  recruitment?: null | {
    overdue: number;
    dueSoon: number;
    critical: number;
    pendingApproval: number;
    pendingReview: number;
    slaSuccess: { percent: number | null; judged: number; year: string };
    capacityAlerts: number;
    criticalAlerts: number;
    topAlerts: Alert[];
  };
  personnel?: {
    onboardingOpen: number;
    clearanceOpen: number;
    requestsOpen: number;
    leaveOpen: number;
    documentsIncomplete: number;
    negativeLeave: number;
    unlinkedAccounts: number | null;
    activeWithoutPayroll: number | null;
  };
  performance?: null | { lowGeneral: number; lowRecruitment: number; reviewsPending: number; quarter: string; period: string };
  timeOff?: { connected: false } | { connected: true; onLeaveToday: OdooLeave[]; awayToday: OdooLeave[]; pending: number; upcoming: OdooLeave[] };
  faces?: PersonRef[];
  odooOnly?: number | null;
  workforce?: {
    departments: Array<{ department: string; employees: number }>;
    gender: { male: number; female: number; unspecified: number };
    ageBands: WorkforceAnalytics['ageBands'];
    averageAge: number | null;
    largestDepartment: { department: string; employees: number } | null;
  };
}

export type PersonnelType = 'onboarding' | 'leave' | 'clearance' | 'salary_increase' | 'documents' | 'insurance' | 'general';
export type PersonnelStatus = 'open' | 'in_progress' | 'done' | 'cancelled';

export interface ChecklistItem {
  id: string;
  ar: string;
  en: string;
  owner: 'personnel' | 'manager' | 'it';
  done: boolean;
  doneBy: string | null;
  doneAt: string | null;
}

export interface PersonnelCase {
  id: string;
  type: PersonnelType;
  status: PersonnelStatus;
  title: string;
  employeeCode: string | null;
  candidate: { name: string } | null;
  hireIndex?: number;
  hireCount?: number;
  jobTitle: string;
  department: string;
  location: string;
  managerUserId: string | null;
  assignedTo: string | null;
  recruitmentRequestId?: string;
  recruitmentReference?: string;
  details: Record<string, unknown>;
  checklist: ChecklistItem[];
  notes: string;
  form?: { id: string; expiresAt: string; submittedAt: string | null; createdAt: string };
  formSubmission?: Record<string, string>;
  timeline: Array<{ type: string; actorId: string | null; at: string; note: string }>;
  canManage: boolean;
  canTick: Record<string, boolean>;
  createdAt: string;
  updatedAt: string;
}

/** See shared/hrReportFilter.js — the server counts with it, the page filters with it. */
export interface ReportFilter {
  eq?: Record<string, unknown>;
  in?: Record<string, unknown[]>;
  gte?: Record<string, number>;
  lt?: Record<string, number>;
  prefix?: Record<string, string>;
  present?: string[];
}

export interface ReportResult {
  id: string;
  filters: Record<string, string | null>;
  headline: Array<{ key: string; label: Localised; value: number | null; unit?: string; filter: ReportFilter | null; tone?: Severity }>;
  columns: string[];
  rows: Array<Record<string, unknown> & { id: string }>;
  note?: Localised;
  rate?: { sell: number; source: string; asOf: string };
}

export interface ReviewCriterion {
  id: string;
  ar: string;
  en: string;
  max: number;
}

export interface PerformanceRow {
  employeeCode: string;
  name: Localised;
  title: string;
  department: string;
  linkedUserId: string | null;
  general: { period: string; percent: number | null; status: string; templateId: string } | null;
  recruitment: { percent: number | null } | null;
  tasks: { count: number; average: number | null };
  review: { id: string; status: 'draft' | 'final'; percent: number | null; answered: number; total: number } | null;
}

export interface PerformanceData {
  period: string;
  quarter: string;
  criteria: ReviewCriterion[];
  rows: PerformanceRow[];
  canReview: boolean;
  attention: { lowGeneral: number; lowRecruitment: number; reviewsPending: number };
}

export interface QuarterlyReviewData {
  review: {
    id: string;
    employeeCode: string;
    quarter: string;
    criteria: ReviewCriterion[];
    scores: Record<string, number>;
    comments: Record<string, string>;
    summary: string;
    status: 'draft' | 'final';
    reviewerId: string | null;
    finalizedAt?: string | null;
    updatedAt?: string;
  };
  exists: boolean;
  canEdit: boolean;
  employee: { employeeCode: string; name: Localised; title: string; department: string };
}

export interface OrgPosition {
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

export interface OdooChartPerson extends PersonRef {
  odooId: number;
  parentId: number | null;
  jobTitle: string;
}

export interface OrganizationData {
  odoo: { connected: false } | {
    connected: true;
    people: OdooChartPerson[];
    departments: Array<{ id: number; name: string; parentId: number | null; manager: PersonRef | null; employees: number }>;
  };
  positions: OrgPosition[];
  analytics: { total: number; matched: number; vacant: number; unmatched: number; departments: number };
  departments: Array<{ name: string; sector: string; employees: number; managers: Array<{ name: string; count: number }>; openSeats: number; openJobs: number }>;
  vacancies: Array<{ source: 'structure' | 'recruitment'; id: string; title: string; department: string; status: string; priority?: Priority | null; openSeats?: number }>;
  genders: { male: number; female: number; unspecified: number };
}

export interface ChecklistDefinition {
  id: string;
  ar: string;
  en: string;
  owner: 'personnel' | 'manager' | 'it';
}

export interface CustomKpiRule {
  id: string;
  category: 'hr_review' | 'commitment' | 'system_quality';
  ar: string;
  en: string;
  points: number;
  enabled?: boolean;
}

export interface HRSettings {
  recruitment: {
    calendar: { weekend: number[]; holidays: string[] };
    sla: { bands: Record<Priority, Band>; dueSoonWorkingDays: number; holdPausesClock: boolean };
    capacity: Limits & { countOnHold: boolean };
    classifications: Classification[];
    team: { include: string[]; exclude: string[] };
    waits: { reviewWorkingDays: number; approvalWorkingDays: number; odooLinkWorkingDays: number };
    odoo: { funnel: Record<string, string[]> };
    approvals: { finalApproverUserId: string | null };
  };
  kpi: {
    weights: Record<string, number>;
    rules: Record<string, { points?: number; enabled?: boolean } | null>;
    customRules: CustomKpiRule[];
  };
  performance: { quarterlyCriteria: ReviewCriterion[] };
  personnel: { onboardingChecklist: ChecklistDefinition[]; clearanceChecklist: ChecklistDefinition[] };
}

export interface DatasetMeta {
  source: string;
  label: Localised;
  fileName?: string;
  importedAt: string | null;
  importedBy?: string | null;
  origin?: 'dashboard' | 'telegram';
  summary: Record<string, number> | null;
  warnings: Array<{ code: string; id?: string }>;
}

export interface SettingsView {
  settings: HRSettings;
  revision: number;
  updatedAt: string | null;
  canEdit: boolean;
  kpi: { categories: Array<{ id: string; ar: string; en: string; weight: number; mode: string }>; rules: KpiRule[] };
  rewardRules: RewardRules;
  rewardVersions: Array<{ id: string; version: number; createdAt: string; note?: string }>;
  team: Array<TeamMember & { excluded: boolean }>;
  teamCandidates: Array<{ employeeCode: string; name: string; nameArabic: string; title: string }>;
  migration: { imported: number; lastImportedAt: string | null; version: number };
  odoo: { configured: boolean; indexLoaded: boolean; employees: number };
  permissions: { keys: string[]; holders: Array<{ id: string; name: string; role: string; department: string; keys: string[] }> };
  approvers: Array<{ id: string; name: string }>;
  imports: null | {
    datasets: DatasetMeta[];
    history: Array<{ id: string; source: string; fileName?: string; createdAt: string; origin?: string; summary?: Record<string, number> | null; status?: string }>;
    telegram: { enabled: boolean; restricted: boolean };
  };
}

export interface ReconciliationPerson {
  employeeCode: string;
  nameArabic: string;
  nameEnglish: string;
  title: string;
  department: string;
}

export interface ReconciliationView {
  workbook: { fileName: string; importedAt: string; period: string | null; rows: number } | null;
  imported: number;
  differences: Array<{ requestId: string; reference: string; title: string; fields: Array<{ field: string; workbook: unknown; qodo: unknown }> }>;
  missing: Array<{ legacyKey: string; title: string; sequence: string; status: string }>;
  orphans: Array<{ requestId: string; reference: string; title: string; status: string }>;
  unresolved: Array<{ requestId: string; reference: string; title: string; names: string[] }>;
  people: {
    unlinkedAccounts: ReconciliationPerson[];
    activeWithoutPayroll: ReconciliationPerson[] | null;
    payrollWithoutMaster: ReconciliationPerson[] | null;
    insuranceWithoutMaster: ReconciliationPerson[] | null;
    unmatchedPositions: Array<{ id: string; title: string; employeeName: string; department: string }>;
    odooOnly?: Array<{ odooId: number; code: string; photoUrl: string | null; name: string; jobTitle: string; department: string; workEmail: string }> | null;
  };
}

export interface AuditRow {
  kind: string;
  at: string;
  actor: string;
  subject: string;
  requestId: string | null;
  detail: Record<string, unknown> | null;
}
