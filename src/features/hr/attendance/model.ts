/**
 * Attendance from the ZKTeco fingerprint service, as HR shows it.
 *
 * The service judges each day (on time, late, absent, one punch…) by its own
 * shift rules; Qodo lays Odoo time off over it, so an absent day with
 * approved leave reads "leave", one with an away type (WFH, mission,
 * permission) "away", and a late day under a permission "excused".
 */

import type { Lang, Localised } from '../types';

export type DayStatus =
  | 'ontime' | 'present' | 'late' | 'excused' | 'in' | 'incomplete' | 'absent' | 'pending'
  | 'leave' | 'away' | 'off' | 'holiday' | 'extra' | 'exempt' | 'none' | 'future' | 'nodata';

export interface PersonRef {
  hrCode: string | null;
  inHrFile: boolean;
  odooId: number | null;
  nameArabic: string;
  nameEnglish: string;
  photoUrl: string | null;
}

export interface LeaveOnDay {
  id: number;
  type: string;
  color: number;
  away: boolean;
  approved: boolean;
  state: string;
  from: string;
  to: string;
  days: number;
  hours: boolean;
}

export interface AttendanceRange {
  from: string;
  to: string;
  today: string;
  real_today: string;
  data_until: string | null;
  unsynced_days: number;
  snapshot?: string;
  now?: string;
}

export interface EmployeeSummary {
  code: string;
  name: string;
  department: string;
  title: string;
  team: string;
  shift: string;
  effective_schedule: 'fixed' | 'flexible' | 'exempt';
  first_seen: string | null;
  last_seen: string | null;
  active: boolean;
  expected_days: number;
  present_days: number;
  judged_days: number;
  absent_days: number;
  late_days: number;
  early_days: number;
  incomplete_days: number;
  extra_days: number;
  attendance_rate: number | null;
  punctuality: number | null;
  score: number | null;
  avg_arrival: number | null;
  avg_departure: number | null;
  avg_hours: number | null;
  total_hours: number;
  overtime_hours: number;
  late_minutes: number;
  avg_late: number | null;
  today: DayStatus | null;
  today_first: string | null;
  today_last: string | null;
  in_office: boolean;
  hr?: PersonRef;
  strip?: Array<[string, DayStatus]>;
  leaveDays?: number;
  awayDays?: number;
  excusedDays?: number;
  unexcusedAbsences?: number;
  pendingLeaveDays?: number;
  adjusted_expected_days?: number;
  adjusted_attendance_rate?: number | null;
}

export interface SnapshotRow {
  code: string;
  name: string;
  department: string;
  first: string | null;
  last: string | null;
  late: number;
  worked: number | null;
  in_office: boolean;
  hr?: PersonRef;
  timeOff?: { type: string; away: boolean; to: string } | null;
}

export interface DailyPoint {
  date: string;
  type: 'work' | 'off' | 'holiday' | 'nodata' | 'future';
  expected: number;
  present: number;
  ontime: number;
  late: number;
  incomplete: number;
  in: number;
  absent: number;
  pending: number;
  extra: number;
  punches: number;
  rate: number | null;
  avg_arrival: number | null;
  avg_hours: number | null;
}

export interface Kpis {
  active_employees: number;
  tracked_employees: number;
  work_days: number;
  holidays: number;
  attendance_rate: number | null;
  punctuality: number | null;
  present_days: number;
  absent_days: number;
  late_days: number;
  incomplete_days: number;
  late_hours: number;
  overtime_hours: number;
  total_hours: number;
  avg_hours: number | null;
  avg_arrival: number | null;
  punches: number;
  duplicates: number;
}

export interface LeaderRow {
  code: string;
  name: string;
  department: string;
  value: number;
  hr?: PersonRef;
}

export interface DeviceRow {
  site: string;
  id: string;
  range_total: number;
  today: number;
  people: number;
  daily: number[];
  last_punch: string | null;
  last_received: string | null;
  lifetime_total: number;
}

export interface FeedRow {
  code: string;
  name: string;
  at: string;
  device: string;
  state: string | null;
  hr?: PersonRef;
}

export interface AttendanceOverview {
  connected: boolean;
  range: AttendanceRange;
  settings: AttendanceSettings;
  sites: string[];
  kpis: Kpis;
  previous: Kpis;
  snapshot: {
    day: DailyPoint | null;
    type: string | null;
    people: Partial<Record<DayStatus, SnapshotRow[]>>;
    in_office: number | null;
    arrivals: number[];
    hourly: number[];
  };
  daily: DailyPoint[];
  heatmap: number[][];
  leaders: { punctual: LeaderRow[]; late: LeaderRow[]; hours: LeaderRow[]; absent: LeaderRow[] };
  departments: Array<{ name: string; employees: number; attendance_rate: number | null; punctuality: number | null; avg_hours: number | null }>;
  devices: { days: string[]; devices: DeviceRow[] };
  feed: FeedRow[];
  last_received: string | null;
  timeOff: { connected: boolean };
}

export interface AttendanceSettings {
  shift_start: string;
  shift_end: string;
  grace_minutes: number;
  required_hours: number;
  workdays: number[];
  active_days: number;
  holiday_threshold: number;
  departments: Record<string, { schedule?: 'fixed' | 'flexible'; shift_start?: string; shift_end?: string }>;
}

export interface AttendanceEmployees {
  connected: boolean;
  range: AttendanceRange;
  settings: AttendanceSettings;
  employees: EmployeeSummary[];
  departments: string[];
  timeOff: { connected: boolean };
}

export interface DepartmentReport {
  name: string;
  employees: number;
  schedule: 'fixed' | 'flexible';
  late_after: number | null;
  attendance_rate: number | null;
  punctuality: number | null;
  present_days: number;
  expected_days: number;
  late_days: number;
  absent_days: number;
  late_minutes: number;
  avg_arrival: number | null;
  avg_hours: number | null;
  overtime_hours: number;
  today: { here: number; late: number; missing: number; in_office: number };
  teams: Array<[string, number]>;
  daily: Array<{ date: string; rate: number | null; present: number; expected: number; late: number; absent: number }>;
  members: EmployeeSummary[];
}

export interface AttendanceDepartments {
  connected: boolean;
  range: AttendanceRange;
  departments: DepartmentReport[];
  last_received: string | null;
}

export interface AttendanceDay {
  date: string;
  status: DayStatus;
  effective: DayStatus;
  type: string;
  weekday: number;
  count: number;
  first: string | null;
  last: string | null;
  worked: number | null;
  late: number;
  early: number;
  overtime: number;
  break: number | null;
  punches: Array<{ at: string; device: string; state: string | null }>;
  timeOff: LeaveOnDay | null;
}

export interface EmployeeAttendanceData {
  connected: boolean;
  found?: boolean;
  fingerprintCode?: string | null;
  hr?: PersonRef;
  range?: AttendanceRange;
  settings?: AttendanceSettings;
  shift?: { start: number; end: number };
  employee?: EmployeeSummary;
  today?: { date: string; status: DayStatus; effective: DayStatus; first: string | null; last: string | null; worked: number | null; late: number; punches: AttendanceDay['punches']; timeOff: LeaveOnDay | null; inOffice: boolean } | null;
  days?: AttendanceDay[];
  devices?: Array<[string, number]>;
  weekdayArrival?: Array<number | null>;
  timeOff?: { connected: boolean };
}

/* ── statuses ──────────────────────────────────────────────────────── */

export interface StatusMeta {
  label: Localised;
  /** "r g b" */
  color: string;
  /** Counts as a day at work. */
  present?: boolean;
}

export const STATUS: Record<DayStatus, StatusMeta> = {
  ontime: { label: { ar: 'في الموعد', en: 'On time' }, color: '21 128 61', present: true },
  present: { label: { ar: 'حاضر (مرن)', en: 'Present (flexible)' }, color: '21 128 61', present: true },
  in: { label: { ar: 'داخل الآن', en: 'In now' }, color: '22 163 74', present: true },
  late: { label: { ar: 'متأخر', en: 'Late' }, color: '202 108 6', present: true },
  excused: { label: { ar: 'متأخر بإذن', en: 'Excused' }, color: '59 110 180', present: true },
  incomplete: { label: { ar: 'بصمة ناقصة', en: 'Missing punch' }, color: '71 85 105', present: true },
  absent: { label: { ar: 'غائب', en: 'Absent' }, color: '190 18 60' },
  pending: { label: { ar: 'لم يحضر بعد', en: 'Not in yet' }, color: '100 116 139' },
  leave: { label: { ar: 'إجازة', en: 'On leave' }, color: '110 86 170' },
  away: { label: { ar: 'مأمورية / من المنزل', en: 'Away (WFH, mission)' }, color: '52 96 150' },
  extra: { label: { ar: 'يوم إضافي', en: 'Extra day' }, color: '62 66 160', present: true },
  off: { label: { ar: 'إجازة أسبوعية', en: 'Day off' }, color: '203 213 225' },
  holiday: { label: { ar: 'عطلة', en: 'Holiday' }, color: '186 198 214' },
  exempt: { label: { ar: 'غير ملزم ببصمة', en: 'Exempt' }, color: '148 163 184' },
  none: { label: { ar: '—', en: '—' }, color: '241 245 249' },
  future: { label: { ar: 'لم يأتِ بعد', en: 'Future' }, color: '241 245 249' },
  nodata: { label: { ar: 'لم تُزامن بعد', en: 'Not synced yet' }, color: '226 232 240' },
};

/** The order status groups are listed in on "today". */
export const TODAY_ORDER: DayStatus[] = ['late', 'absent', 'pending', 'leave', 'away', 'incomplete', 'in', 'ontime', 'present', 'excused', 'extra', 'exempt'];

export const statusColor = (status: DayStatus | null | undefined) => `rgb(${STATUS[status ?? 'none']?.color ?? STATUS.none.color})`;

/* ── time ──────────────────────────────────────────────────────────── */

/** Minutes after midnight → "11:07 ص" / "11:07 AM". */
export function clock(minutes: number | null | undefined, lang: Lang) {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '—';
  const total = Math.round(minutes) % (24 * 60);
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  const suffix = lang === 'en' ? (hour < 12 ? 'AM' : 'PM') : hour < 12 ? 'ص' : 'م';
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

/** "HH:MM[:SS]" → "11:07 ص". */
export function clockText(value: string | null | undefined, lang: Lang) {
  if (!value) return '—';
  const [hour, minute] = value.split(':').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value;
  return clock(hour * 60 + minute, lang);
}

/** An ISO date-time's clock part, for feeds. */
export function clockOf(value: string | null | undefined, lang: Lang) {
  if (!value) return '—';
  const match = /T(\d{2}:\d{2})/.exec(value);
  return match ? clockText(match[1], lang) : '—';
}

export function hoursText(hours: number | null | undefined, lang: Lang) {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) return '—';
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  if (lang === 'en') return minutes ? `${whole}h ${minutes}m` : `${whole}h`;
  return minutes ? `${whole} س ${minutes} د` : `${whole} س`;
}

export function minutesText(minutes: number | null | undefined, lang: Lang) {
  if (!minutes) return lang === 'en' ? '0 min' : '0 د';
  return minutes >= 60 ? hoursText(minutes / 60, lang) : lang === 'en' ? `${Math.round(minutes)} min` : `${Math.round(minutes)} د`;
}

/* ── ranges ────────────────────────────────────────────────────────── */

export type RangePreset = 'today' | 'week' | 'month' | 'last30' | 'lastMonth' | 'custom';

export interface DateRange {
  preset: RangePreset;
  from: string;
  to: string;
}

const iso = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;

/** Today in Cairo, as the fingerprint service counts days. */
export function cairoToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return parts;
}

export function presetRange(preset: RangePreset, today = cairoToday()): DateRange {
  const day = new Date(`${today}T12:00:00`);
  if (preset === 'today') return { preset, from: today, to: today };
  if (preset === 'week') {
    // The Egyptian week starts on Saturday.
    const back = (day.getDay() + 1) % 7;
    const start = new Date(day);
    start.setDate(day.getDate() - back);
    return { preset, from: iso(start), to: today };
  }
  if (preset === 'month') return { preset, from: `${today.slice(0, 8)}01`, to: today };
  if (preset === 'lastMonth') {
    const start = new Date(day.getFullYear(), day.getMonth() - 1, 1, 12);
    const end = new Date(day.getFullYear(), day.getMonth(), 0, 12);
    return { preset, from: iso(start), to: iso(end) };
  }
  const start = new Date(day);
  start.setDate(day.getDate() - 29);
  return { preset: 'last30', from: iso(start), to: today };
}

export const PRESET_LABEL: Record<Exclude<RangePreset, 'custom'>, Localised> = {
  today: { ar: 'اليوم', en: 'Today' },
  week: { ar: 'هذا الأسبوع', en: 'This week' },
  month: { ar: 'هذا الشهر', en: 'This month' },
  last30: { ar: 'آخر 30 يوم', en: 'Last 30 days' },
  lastMonth: { ar: 'الشهر الماضي', en: 'Last month' },
};

export function rangeQuery(range: DateRange) {
  return `from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
}

export const WEEKDAY: Localised[] = [
  { ar: 'الإثنين', en: 'Mon' },
  { ar: 'الثلاثاء', en: 'Tue' },
  { ar: 'الأربعاء', en: 'Wed' },
  { ar: 'الخميس', en: 'Thu' },
  { ar: 'الجمعة', en: 'Fri' },
  { ar: 'السبت', en: 'Sat' },
  { ar: 'الأحد', en: 'Sun' },
];

/** The name to show for someone on an attendance row: HR's Arabic, the device's, then Odoo's. */
export function displayName(row: { name?: string; hr?: PersonRef }, lang: Lang) {
  if (lang === 'en') return row.hr?.nameEnglish || row.name || row.hr?.nameArabic || '';
  return row.hr?.nameArabic || row.name || row.hr?.nameEnglish || '';
}

/** Where a row links: the HR profile's attendance tab when HR can address the person. */
export function profileLink(row: { code: string; hr?: PersonRef }) {
  const code = row.hr?.hrCode ?? row.code;
  return `/hr/people/${encodeURIComponent(code)}?tab=attendance`;
}
