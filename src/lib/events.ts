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
