/**
 * The training schedule's client contract.
 *
 * The server does all of the Odoo parsing and business derivation; these are
 * the clean shapes it answers with, plus the formatting that belongs to the
 * page. Two clocks appear and they are kept apart on purpose:
 *
 * - **KSA** (`Asia/Riyadh`) for every column the operations sheet labels KSA —
 *   start/end time, session cells, work days. That is the clock the team
 *   schedules in.
 * - **Cairo** only where the page speaks about "today" or "last synced" to the
 *   person reading it, who is in Cairo.
 *
 * Datetimes arrive as real instants and are formatted here, never shifted.
 */

import { api } from './api';
import type { InsightsSyncResult } from './events';

export type DeliveryMode = 'online' | 'offline';
export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';
export type StatusCanonical = 'planned' | 'in_progress' | 'hold' | 'finished' | 'canceled' | 'refused';
export type DepartmentSource = 'odoo' | 'category' | 'course_name';

export interface TrainingSession {
  id: number;
  /** Chronological position: S1 is the first lecture that happens. */
  number: number;
  name: string | null;
  /** The number in the track's name, when it has one — a hint, not the order. */
  nameNumber: number | null;
  startsAt: string | null;
  endsAt: string | null;
  durationHours: number;
  /** Detail and Today only; validated http(s) on the server. */
  joinUrl?: string | null;
  /** Null when this Odoo has no Zoom status field. */
  meetingReady?: boolean | null;
}

export interface Registrations {
  /** `open` + `done` — the number shown as trainees. */
  confirmed: number;
  /** `draft`. */
  interested: number;
  /** `done`. */
  attended: number;
  /** `cancel`. */
  cancelled: number;
}

export interface TrainingScheduleRow {
  id: number;
  odooId: number;
  source: 'odoo';
  courseName: string;
  courseCode: string | null;
  department: string | null;
  /** Where the department came from — an Odoo field, a category label, or the course name. */
  departmentSource: DepartmentSource | null;
  section: string | null;
  package: string | null;
  instructor: string | null;
  /** "Group Online", "Company Offline"… — null when Odoo has neither half. */
  trainingType: string | null;
  typeCategory: 'group' | 'company' | 'private' | 'public' | null;
  deliveryMode: DeliveryMode | null;
  location: { offlineKind: string | null; branch: string | null; venue: string | null };
  /** Planned lectures (`total_lectures_number`); null when not entered. */
  lectureCount: number | null;
  sessionHours: number | null;
  traineeCount: number;
  registrations: Registrations;
  /** `seats_max`; null — never 0 — when not entered. */
  capacity: number | null;
  minimumCapacity: number | null;
  startsAt: string | null;
  endsAt: string | null;
  /** "19:00" on Riyadh's clock — the usual lecture start, from the lectures themselves. */
  startTimeKsa: string | null;
  endTimeKsa: string | null;
  dayPart: DayPart | null;
  /** Odoo's own stage name. */
  status: string | null;
  statusCanonical: StatusCanonical | null;
  stageId: number | null;
  /** SAT…FRI, derived from lecture dates on the KSA calendar. */
  workDays: string[];
  workDaysSource: 'sessions' | 'odoo' | null;
  configuredWorkDays: string[] | null;
  coordinator: string | null;
  comments: string | null;
  sessions: TrainingSession[];
  sessionsTotal: number;
  sessionsPast: number;
  sessionsRemaining: number;
  /** Past ÷ scheduled lectures; null when there are none to count. */
  progress: number | null;
  nextSession: { number: number; startsAt: string } | null;
  firstSessionAt: string | null;
  lastSessionAt: string | null;
  qualityFlags: string[];
}

export interface ScheduleMeta {
  from: string;
  to: string;
  days: number;
  maxDays: number;
  warnings: string[];
  availableDepartments: string[];
  availableSections: string[];
  availablePackages: string[];
  availableStatuses: string[];
  availableStages: string[];
  availableTypes: string[];
  availableInstructors: string[];
  availableCoordinators: string[];
  /** Concept → the live Odoo field it was read from, or null when this Odoo has none. */
  discoveredFields: Record<string, string | null>;
  missingFields: string[];
  capacityRuleSource: 'odoo' | null;
  // Archive only.
  year?: number | null;
  page?: number;
  pageSize?: number;
  hasMore?: boolean;
  search?: string | null;
}

export interface ScheduleResponse {
  rows: TrainingScheduleRow[];
  meta: ScheduleMeta;
  fetchedAt: string;
  /** True when Odoo failed and this is the last answer that worked. */
  stale?: boolean;
}

export interface TodaySession {
  id: number;
  number: number | null;
  totalSessions: number | null;
  lectureCount: number | null;
  name: string | null;
  startsAt: string;
  endsAt: string | null;
  durationHours: number;
  joinUrl: string | null;
  meetingReady: boolean | null;
  zoomExpected: boolean;
  event: {
    id: number | null;
    courseName: string | null;
    courseCode: string | null;
    instructor: string | null;
    trainingType: string | null;
    deliveryMode: DeliveryMode | null;
    location: TrainingScheduleRow['location'] | null;
    department: string | null;
    statusCanonical: StatusCanonical | null;
  };
}

export interface TodayResponse {
  date: string;
  sessions: TodaySession[];
  fetchedAt: string;
  stale?: boolean;
}

export interface DetailResponse {
  course: TrainingScheduleRow;
  odooUrl: string | null;
  fetchedAt: string;
  stale?: boolean;
}

export interface DateRange {
  from: string;
  to: string;
}

const query = (params: Record<string, string | number | null | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') search.set(key, String(value));
  }
  return search.toString();
};

export const fetchSchedule = (range: DateRange) =>
  api.get<ScheduleResponse>(`/events/schedule?${query({ from: range.from, to: range.to })}`);

export const fetchArchive = (params: { year?: number | null; from?: string; to?: string; page?: number; q?: string }) =>
  api.get<ScheduleResponse>(`/events/archive?${query(params)}`);

export const fetchToday = () => api.get<TodayResponse>('/events/today');

export const fetchEventDetail = (id: number) => api.get<DetailResponse>(`/events/${id}`);

export const syncSchedule = (range: DateRange) =>
  api.post<{ schedule: ScheduleResponse; insightsSync: InsightsSyncResult }>('/events/refresh', range);

/* ── date ranges ─────────────────────────────────────────────────── */

const DAY_MS = 86_400_000;
const KSA_OFFSET_MS = 3 * 3_600_000;

/** Today on Riyadh's calendar, as `YYYY-MM-DD`. */
export function ksaTodayIso(now = new Date()): string {
  return new Date(now.getTime() + KSA_OFFSET_MS).toISOString().slice(0, 10);
}

const addDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

export type RangePreset = 'month' | 'next30' | 'next90' | 'quarter' | 'custom';

export const SCHEDULE_MAX_DAYS = 186;

export function rangeFor(preset: Exclude<RangePreset, 'custom'>, now = new Date()): DateRange {
  const today = ksaTodayIso(now);
  const [year, month] = today.split('-').map(Number);
  if (preset === 'month') {
    const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    return { from: `${today.slice(0, 7)}-01`, to: last };
  }
  if (preset === 'quarter') {
    const startMonth = Math.floor((month - 1) / 3) * 3;
    const from = new Date(Date.UTC(year, startMonth, 1)).toISOString().slice(0, 10);
    const to = new Date(Date.UTC(year, startMonth + 3, 0)).toISOString().slice(0, 10);
    return { from, to };
  }
  return { from: today, to: addDays(today, preset === 'next30' ? 29 : 89) };
}

export function rangeDays(range: DateRange): number {
  return Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / DAY_MS) + 1;
}

/* ── formatting: KSA ─────────────────────────────────────────────── */

export const KSA = 'Asia/Riyadh';
const CAIRO = 'Africa/Cairo';

const ksaDateFmt = new Intl.DateTimeFormat('en-GB', { timeZone: KSA, day: 'numeric', month: 'short', year: 'numeric' });
const ksaShortFmt = new Intl.DateTimeFormat('en-GB', { timeZone: KSA, day: 'numeric', month: 'short' });
const ksaTimeFmt = new Intl.DateTimeFormat('en-US', { timeZone: KSA, hour: 'numeric', minute: '2-digit' });
const ksaMonthFmt = new Intl.DateTimeFormat('en-GB', { timeZone: KSA, month: 'long', year: 'numeric' });
const ksaFullFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: KSA,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const format = (fmt: Intl.DateTimeFormat) => (iso: string | null | undefined) =>
  iso && !Number.isNaN(Date.parse(iso)) ? fmt.format(new Date(iso)) : '';

/** "22 Sep 2026" — a KSA calendar date. */
export const ksaDate = format(ksaDateFmt);
/** "22 Sep". */
export const ksaShortDate = format(ksaShortFmt);
/** "7:00 PM" on Riyadh's clock. */
export const ksaTime = format(ksaTimeFmt);
export const ksaMonth = format(ksaMonthFmt);
export const ksaFull = format(ksaFullFmt);

/** "19:00" (the server's KSA wall clock) → "7:00 PM". */
export function hhmmLabel(hhmm: string | null): string {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/* ── formatting: Cairo (the reader's own clock) ──────────────────── */

const cairoTimeFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { timeZone: CAIRO, hour: 'numeric', minute: '2-digit' });
const cairoDayFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { timeZone: CAIRO, weekday: 'long', day: 'numeric', month: 'long' });

export const cairoTime = format(cairoTimeFmt);
export const cairoDay = format(cairoDayFmt);

/* ── words ───────────────────────────────────────────────────────── */

export const DAY_PART_AR: Record<DayPart, string> = {
  morning: 'صباحاً',
  afternoon: 'ظهراً',
  evening: 'مساءً',
  night: 'ليلاً',
};

export const QUALITY_LABELS: Record<string, string> = {
  missing_code: 'مفيش كود للكورس',
  missing_instructor: 'مفيش مدرّب متسجّل',
  missing_start: 'تاريخ البداية ناقص',
  missing_end: 'تاريخ النهاية ناقص',
  invalid_date: 'تاريخ مش مفهوم في أودو',
  end_before_start: 'تاريخ النهاية قبل البداية',
  no_sessions: 'مفيش محاضرات متولّدة في أودو',
  lecture_count_mismatch: 'عدد المحاضرات المتولّدة مختلف عن عدد المحاضرات المكتوب',
  session_outside_range: 'فيه محاضرة برّه تاريخ بداية ونهاية الكورس',
  capacity_missing: 'السعة (Maximum) مش مكتوبة',
  inconsistent_session_times: 'ميعاد المحاضرات مش ثابت بين المحاضرات',
  session_numbering_mismatch: 'ترقيم أسماء المحاضرات مختلف عن ترتيبها الفعلي',
  work_days_mismatch: 'أيام الدراسة المكتوبة مختلفة عن أيام المحاضرات الفعلية',
  missing_coordinator: 'مفيش كوردينيتور متسجّل',
  zoom_missing: 'لينك الزووم لسه مااتعملش لمحاضرة قريبة',
};

export const DEPARTMENT_SOURCE_AR: Record<DepartmentSource, string> = {
  odoo: 'من حقل القسم في أودو',
  category: 'مستنتج من الباقة / التصنيف في أودو',
  course_name: 'مستنتج من اسم الكورس',
};

/** Where an in-person course happens, as one phrase instead of three coded fields. */
export function placeLabel(row: Pick<TrainingScheduleRow, 'deliveryMode' | 'location'>): string | null {
  if (row.deliveryMode === 'online') return 'Online';
  const loc = row.location;
  if (!loc) return null;
  if (loc.offlineKind === 'in_house') return loc.venue ? `عند العميل — ${loc.venue}` : 'عند العميل';
  const branch = loc.branch === 'cairo' ? 'مقر القاهرة' : loc.branch === 'riyadh' ? 'مقر الرياض' : null;
  return branch ?? loc.venue ?? null;
}

/** "من ٣ دقايق" — how long ago, said the way somebody would. */
export function agoLabel(iso: string | undefined | null, now = Date.now()): string {
  if (!iso) return '';
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'دلوقتي';
  if (minutes < 60) return `من ${minutes} دقيقة`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? 'من ساعة' : `من ${hours} ساعات`;
}
