/**
 * The Events analysis tab and eLearning — row shapes, fetchers and phrasing.
 * The training schedule's own types live in `eventsSchedule.ts`.
 *
 * The wording lives here rather than in the components so a card, a list row
 * and the detail panel can never describe the same course differently. It is
 * deliberately spoken Egyptian rather than the formal register the rest of the
 * workspace uses for legal-ish things: this screen is read at a glance between
 * two phone calls, and "فاضل ٣ محاضرات" lands where "عدد الجلسات المتبقية: ٣"
 * has to be parsed.
 */

import { api } from './api';

export interface InsightsSyncResult {
  ok: boolean;
  authority?: string | null;
  directAccepted?: boolean;
  directAttempted?: boolean;
  syncedAt?: string | null;
  warning?: string | null;
}

export const fetchStatus = () =>
  api.get<{ configured: boolean; missing: string[] }>('/events/status');


/* ── the analysis tab ────────────────────────────────────────────── */

export interface Bar {
  label: string;
  value: number;
  display?: string;
}

export interface AnalyticsRange {
  from: string;
  to: string;
}

export interface AnalyticsPeriod extends AnalyticsRange {
  previousFrom: string;
  previousTo: string;
  days: number;
  basis?: 'event_start';
}

export interface EventAnalyticsTotals {
  events: number;
  bookings: number;
  interested: number;
  attended: number;
  cancelled: number;
  seats: number;
  /** Confirmed bookings only for events whose capacity is filled in. */
  capacityBookings: number;
  noBookings: number;
  noDemand: number;
  withDemand: number;
  fillRate: number | null;
  demandRate: number | null;
  confirmationRate: number | null;
}

export interface EventDemandRow {
  id: number;
  name: string;
  startsAt: string | null;
  stage: string | null;
  kind: string | null;
  mode: string | null;
  instructor: string | null;
  seats: number;
  bookings: number;
  interested: number;
  attended: number;
  cancelled: number;
  demand: number;
  fillRate: number | null;
}

export interface EventsAnalytics {
  period: AnalyticsPeriod;
  /** True when Odoo failed and this is the last answer that worked. */
  stale?: boolean;
  fetchedAt?: string;
  current: EventAnalyticsTotals;
  previous: EventAnalyticsTotals;
  topDemand: EventDemandRow[];
  lowDemand: EventDemandRow[];
  comparison: TrainingComparisonRow[];
  byStage: Bar[];
  byMode: Bar[];
  byKind: Bar[];
  byInstructor: Bar[];
  trend: Array<{
    key: string;
    label: string;
    events: number;
    bookings: number;
    interested: number;
  }>;
  revenueAvailable: boolean;
  revenueError?: string | null;
  revenueStale: boolean;
  currency: 'USD' | null;
  collectedCurrent: EventsCollectedRevenue | null;
  collectedPrevious: EventsCollectedRevenue | null;
  revenueSource: ElearningRevenueSource | null;
}

export interface EventsCollectedRevenue {
  amount: number;
  invoices: number;
  invoiceCountExact: boolean;
  productLines: number;
  currency: 'USD';
  scope: 'explicit_offline_event_invoice_lines';
  unassignedInvoices: number;
  unassignedProductLines: number;
  excludedOnlineAmount: number;
  excludedOnlineInvoices: number;
  excludedUnknownAmount: number;
  excludedUnknownInvoices: number;
  stale?: boolean;
  fetchedAt?: string;
  syncedAt?: string | null;
  authority?: string | null;
  products: Array<{
    key: string;
    name: string;
    amount: number;
    invoices: number;
    events: string[];
    unassignedLines: number;
  }>;
}

const rangeQuery = (range: AnalyticsRange) =>
  new URLSearchParams({ from: range.from, to: range.to }).toString();

export const fetchAnalytics = (range: AnalyticsRange) =>
  api.get<EventsAnalytics>(`/events/analytics?${rangeQuery(range)}`);

/* ── eLearning ───────────────────────────────────────────────────── */

export interface ElearningCourse {
  id: number;
  name: string;
  summary: string | null;
  kind: string | null;
  lessons: number;
  hours: number;
  members: number;
  completed: number;
  engaged: number;
  views: number;
  completionRate: number | null;
  active: boolean;
  published: boolean;
  owner: string | null;
  access: string | null;
  productId: number | null;
  productName: string | null;
  productTemplateId: number | null;
  currency: string | null;
  free: boolean;
  sellable: boolean;
  commercial: boolean;
}

export interface ElearningOverview {
  stale?: boolean;
  courses: ElearningCourse[];
  /** Which fields this Odoo actually exposes — the page says so rather than lying. */
  available: string[];
  fetchedAt: string;
  insightsSync?: InsightsSyncResult;
}

export interface ElearningAnalytics {
  stale?: boolean;
  fetchedAt?: string;
  period: AnalyticsPeriod;
  periodAvailable: boolean;
  periodError?: string;
  totals: {
    courses: number;
    published: number;
    draft: number;
    members: number;
    completed: number;
    lessons: number;
    hours: number;
    engaged: number;
    completionRate: number | null;
  };
  byKind: Bar[];
  topByMembers: Bar[];
  topByCompletion: Bar[];
  biggest: Bar[];
  available: string[];
  salesAvailable: boolean;
  salesError?: string | null;
  revenueAvailable: boolean;
  revenueError?: string | null;
  currency: string | null;
  collectedCurrent: ElearningCollectedRevenue | null;
  collectedPrevious: ElearningCollectedRevenue | null;
  revenueSource: ElearningRevenueSource | null;
  revenueStale: boolean;
  commercialCurrent: ElearningCommercialTotals | null;
  commercialPrevious: ElearningCommercialTotals | null;
  topPaidCourses: ElearningCourseSalesRow[];
  noPaidSales: ElearningCourseSalesRow[];
  packageSales: ElearningPackageSalesRow[];
  current: ElearningPeriodTotals | null;
  previous: ElearningPeriodTotals | null;
  topDemand: ElearningDemandRow[];
  lowDemand: ElearningDemandRow[];
  comparison: TrainingComparisonRow[];
  trend: Array<{
    key: string;
    label: string;
    enrollments: number;
    invited: number;
    completed: number;
  }>;
  freeActivity: ElearningPeriodTotals | null;
}

export interface TrainingComparisonRow {
  key: string;
  name: string;
  kind: 'events' | 'elearning';
  paidAmount: number;
  /** Confirmed bookings for events; new enrollments for eLearning. */
  primary: number;
  /** Unconfirmed interest for events; invitations for eLearning. */
  secondary: number;
  operationalRecords: number;
  recordIds: number[];
  matchBasis: 'canonical_name' | 'financial_only' | 'operational_only';
  status:
    | 'paid_and_active'
    | 'paid_and_interest'
    | 'paid_only'
    | 'active_only'
    | 'interest_only'
    | 'no_demand';
}

export interface ElearningCommercialTotals {
  paidOrders: number;
  purchases: number;
  directSales: number;
  packagesSold: number;
  paidCourses: number;
  coursesWithSales: number;
  noSales: number;
  freeExcluded: number;
}

export interface ElearningCollectedRevenue {
  amount: number;
  invoices: number;
  invoiceCountExact: boolean;
  productLines: number;
  currency: 'USD';
  scope: 'odoo_elearning_catalog';
  catalogProducts: number;
  matchedAccountingProducts: number;
  stale?: boolean;
  fetchedAt?: string;
  syncedAt?: string | null;
  authority?: string | null;
  families: Array<{
    key: string;
    name: string;
    amount: number;
    invoices: number;
    productLines: number;
  }>;
  products: Array<{
    key: string;
    name: string;
    amount: number;
  }>;
}

export interface ElearningRevenueSource {
  app: 'Insights Hub';
  tab: string;
  dateBasis: string;
  valueBasis: string;
  grain: string;
  matchingBasis: string;
  repository: string;
  appUrl: string;
}

export interface ElearningCourseSalesRow {
  id: number;
  templateId: number;
  name: string;
  published: boolean;
  directSales: number;
  packageSales: number;
  totalSales: number;
  directOrders: number;
  packageOrders: number;
  packages: string[];
}

export interface ElearningPackageSalesRow {
  id: number;
  name: string;
  componentCount: number;
  components: string[];
  sales: number;
  orders: number;
  previousSales: number;
}

export interface ElearningPeriodTotals {
  courses: number;
  published: number;
  invited: number;
  enrollments: number;
  started: number;
  completed: number;
  activeCourses: number;
  noEnrollment: number;
  noDemand: number;
  conversionRate: number | null;
  startRate: number | null;
  completionRate: number | null;
}

export interface ElearningDemandRow {
  id: number;
  name: string;
  published: boolean;
  members: number;
  completionRate: number | null;
  invited: number;
  enrollments: number;
  started: number;
  completed: number;
  demand: number;
}

export const fetchElearning = () => api.get<ElearningOverview>('/events/elearning');
export const fetchElearningAnalytics = (range: AnalyticsRange) =>
  api.get<ElearningAnalytics>(`/events/elearning/analytics?${rangeQuery(range)}`);
export const refreshElearning = () => api.post<ElearningOverview>('/events/elearning/refresh');

/** Search helpers are shared with the schedule, so every tab matches the same way. */
export { matches, normaliseArabic } from '@shared/eventsSchedule';

/** "من ٣ دقايق" — how old a stale answer is, said the way somebody would. */
export function staleLabel(iso: string | undefined): string {
  if (!iso) return 'من شوية';
  const minutes = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 60) return `من ${minutes} دقيقة`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? 'من ساعة' : `من ${hours} ساعات`;
}

export function elearningKindLabel(kind: string | null): string {
  if (kind === 'training') return 'مسار تدريبي';
  if (kind === 'documentation') return 'مكتبة محتوى';
  return 'كورس';
}

/* ── analysis-tab wording ─────────────────────────────────────────── */

const shortFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
  timeZone: 'Africa/Cairo',
  day: 'numeric',
  month: 'short',
});

export const shortDate = (iso: string | null) => (iso ? shortFmt.format(new Date(iso)) : '');

/**
 * Odoo's stage names are English and set by whoever configured the pipeline.
 * The five that exist today are translated; anything added later falls through
 * to its own name rather than showing a blank, because a stage nobody
 * translated is still better information than none.
 */
const STAGE_AR: Record<string, string> = {
  planned: 'لسه مبدأش',
  'in progress': 'شغّال دلوقتي',
  finished: 'خلص',
  cancelled: 'اتلغى',
  delayed: 'مؤجّل',
};

export function stageLabel(stage: string | null): string {
  if (!stage) return '—';
  return STAGE_AR[stage.trim().toLowerCase()] ?? stage;
}

export function kindLabel(kind: string | null): string | null {
  if (kind === 'individual') return 'أفراد';
  if (kind === 'company') return 'شركة';
  if (kind === 'private') return 'خاص';
  return null;
}
