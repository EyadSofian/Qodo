/**
 * The courses page's client half — row shapes and the plain-Arabic phrasing.
 *
 * The wording lives here rather than in the components so a card, a list row
 * and the detail panel can never describe the same course differently. It is
 * deliberately spoken Egyptian rather than the formal register the rest of the
 * workspace uses for legal-ish things: this screen is read at a glance between
 * two phone calls, and "فاضل ٣ محاضرات" lands where "عدد الجلسات المتبقية: ٣"
 * has to be parsed.
 */

import { api } from './api';

export interface CourseSession {
  id: number;
  name: string | null;
  /** A real instant — the server already stamped Odoo's naive UTC. */
  at: string | null;
  hours: number;
  eventId: number | null;
  eventName: string | null;
  /** Already validated as http(s) on the server — safe for an href. */
  joinUrl: string | null;
  /** False means the Zoom meeting has not been created in Odoo yet. */
  meetingReady: boolean;
}

export interface Course {
  id: number;
  code: string | null;
  name: string;
  startsAt: string | null;
  endsAt: string | null;
  stage: string | null;
  kind: string | null;
  mode: string | null;
  offlineKind: string | null;
  branch: string | null;
  venue: string | null;
  instructor: string | null;
  plannedSessions: number;
  sessionHours: number;
  attendees: number;
  seats: number;
  sessionsTotal: number;
  sessionsLeft: number;
  nextSession: CourseSession | null;
}

export interface CourseDetail extends Course {
  sessions: CourseSession[];
}

export interface CoursesOverview {
  stale?: boolean;
  running: Course[];
  upcoming: Course[];
  today: CourseSession[];
  stages: { id: number; name: string; running: boolean; finished: boolean }[];
  fetchedAt: string;
}

export const fetchStatus = () =>
  api.get<{ configured: boolean; missing: string[] }>('/events/status');

export const fetchCourses = () => api.get<CoursesOverview>('/events');

export const fetchCourse = (id: number) =>
  api.get<{ course: CourseDetail }>(`/events/${id}`).then((r) => r.course);

export const refreshCourses = () => api.post<CoursesOverview>('/events/refresh');

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
  trend: Array<{
    key: string;
    label: string;
    enrollments: number;
    invited: number;
    completed: number;
  }>;
  freeActivity: ElearningPeriodTotals | null;
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

/**
 * One search box over data that is already loaded.
 *
 * Client-side because it is: fifty-five courses on the events page and a couple
 * of hundred on eLearning are all in memory the moment the tab opens, and a
 * round trip to Odoo per keystroke would make typing feel like waiting.
 *
 * Arabic is normalised on both sides — أ إ آ all become ا, ة becomes ه, and the
 * tatweel and diacritics are dropped — because somebody hunting for "التصميم"
 * should not miss "التصميــم", and nobody types hamzas consistently.
 */
export function normaliseArabic(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matches(query: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = normaliseArabic(query);
  if (!needle) return true;
  const haystack = normaliseArabic(fields.filter(Boolean).join(' '));
  // Every word has to appear, in any order: "revit احمد" finds the Revit course
  // Ahmed teaches without caring which was typed first.
  return needle.split(' ').every((word) => haystack.includes(word));
}

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

/* ── saying it in Arabic ─────────────────────────────────────────── */

const CAIRO = 'Africa/Cairo';

const dayFmt = new Intl.DateTimeFormat('ar-EG', {
  timeZone: CAIRO,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const timeFmt = new Intl.DateTimeFormat('ar-EG', {
  timeZone: CAIRO,
  hour: 'numeric',
  minute: '2-digit',
});
const shortFmt = new Intl.DateTimeFormat('ar-EG', {
  timeZone: CAIRO,
  day: 'numeric',
  month: 'short',
});

export const timeOf = (iso: string | null) => (iso ? timeFmt.format(new Date(iso)) : '');
export const dayOf = (iso: string | null) => (iso ? dayFmt.format(new Date(iso)) : '');
export const shortDate = (iso: string | null) => (iso ? shortFmt.format(new Date(iso)) : '');

/** Whole days between now and then, counted on Cairo's calendar, not by 24s. */
function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const midnight = (date: Date) =>
    new Date(date.toLocaleDateString('en-US', { timeZone: CAIRO })).getTime();
  return Math.round((midnight(new Date(iso)) - midnight(new Date())) / 86_400_000);
}

/** "النهاردة" / "بكرة" / "بعد ٣ أيام" — the way somebody would actually say it. */
export function whenLabel(iso: string | null): string {
  const days = daysUntil(iso);
  if (days === null) return 'مفيش ميعاد';
  if (days === 0) return 'النهاردة';
  if (days === 1) return 'بكرة';
  if (days === 2) return 'بعد بكرة';
  if (days < 0) return `فاتت من ${Math.abs(days)} يوم`;
  if (days <= 7) return `بعد ${days} أيام`;
  return shortDate(iso);
}

/** Arabic counts one, two and many differently, so the sessions line does too. */
export function sessionsLeftLabel(left: number): string {
  if (left <= 0) return 'خلصت محاضراتها';
  if (left === 1) return 'فاضل محاضرة واحدة';
  if (left === 2) return 'فاضل محاضرتين';
  if (left <= 10) return `فاضل ${left} محاضرات`;
  return `فاضل ${left} محاضرة`;
}

export function attendeesLabel(count: number): string {
  if (count === 0) return 'لسه محدش سجّل';
  if (count === 1) return 'طالب واحد';
  if (count === 2) return 'طالبين';
  if (count <= 10) return `${count} طلاب`;
  return `${count} طالب`;
}

/** Where it happens, as one phrase instead of three coded fields. */
export function placeLabel(course: Pick<Course, 'mode' | 'offlineKind' | 'branch' | 'venue'>): string {
  if (course.mode === 'online') return 'أونلاين';
  const branch = course.branch === 'cairo' ? 'القاهرة' : course.branch === 'riyadh' ? 'الرياض' : '';
  if (course.offlineKind === 'in_house') return course.venue ? `عند العميل — ${course.venue}` : 'عند العميل';
  if (branch) return `في مقر ${branch}`;
  return course.venue ?? 'مكان مش محدد';
}

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

/** How far through it is, for the bar on the card. */
export function progressOf(course: Pick<Course, 'sessionsTotal' | 'sessionsLeft'>): number {
  if (!course.sessionsTotal) return 0;
  const done = course.sessionsTotal - course.sessionsLeft;
  return Math.max(0, Math.min(100, Math.round((done / course.sessionsTotal) * 100)));
}

/** Sessions grouped under the day they fall on, for the schedule list. */
export function groupByDay(sessions: CourseSession[]): { day: string; sessions: CourseSession[] }[] {
  const groups = new Map<string, CourseSession[]>();
  for (const session of sessions) {
    const key = dayOf(session.at) || 'بدون ميعاد';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(session);
  }
  return [...groups].map(([day, rows]) => ({ day, sessions: rows }));
}
