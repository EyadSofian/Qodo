/**
 * Attendance, read from the ZKTeco fingerprint service (zkteco-attendance-receiver
 * on Railway, project "attendance-api").
 *
 * That service owns the punches and the rules that judge them: shifts per
 * department or person, grace, workdays, holiday detection, the "now" of the
 * last sync. Qodo only reads its JSON (`/dashboard/api/*`) and adds what the
 * fingerprint service cannot know:
 *
 *  * who the code is in HR — the fingerprint `employee_code` is Odoo's
 *    `registration_number`, which is the HR employee code (joined through
 *    `comparableCode`, so "0216" and "216" are one person), with the HR photo;
 *  * time off from Odoo — an absent day covered by approved leave is `leave`,
 *    one covered by an away type (WFH, mission, missed fingerprint, late or
 *    early permission) is `away`, and a late or one-punch day under an away
 *    type is `excused`. What is left is an unexcused absence.
 *
 * Configure with ATTENDANCE_API_URL (the service's base URL) and, once the
 * service requires it, ATTENDANCE_API_TOKEN (sent as a Bearer token). Without
 * the URL every reader answers `{ connected: false }` and HR works as before.
 * Nothing is ever written to the fingerprint service.
 */

import { can, PERMISSIONS } from '../../shared/permissions.js';
import { organizationOf } from '../../shared/organization.js';
import { localDay } from '../../shared/recruitment/sla.js';
import { organizationState } from '../hrModule.js';
import { HRError, forbidden } from './errors.js';
import { comparableCode, knownPhoto, odooEmployeeByKey, odooEmployeeIndex } from './odooPeople.js';
import { odooTimeOff, PENDING_STATES } from './odooTimeOff.js';
import { odooResolver } from './odooHR.js';
import { teamReach } from './teamReach.js';
import { photoUrlFor } from './recruitment/team.js';

const TTL_MS = 60 * 1000;
const TIMEOUT_MS = 20 * 1000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CODE = /^[\w.-]{1,128}$/;

/** Statuses that mean the person was at work that day. */
export const PRESENT_STATUSES = new Set(['ontime', 'late', 'incomplete', 'in', 'present', 'extra', 'excused']);

const base = () => String(process.env.ATTENDANCE_API_URL || '').trim().replace(/\/+$/, '');

/** The fingerprint service's own dashboard, where its shift rules and roster are edited. */
export function attendanceDashboardUrl() {
  return attendanceConfigured() ? `${base()}/dashboard` : null;
}

export function attendanceConfigured() {
  const url = base();
  if (/^https:\/\//.test(url)) return true;
  // Plain http only for a local service outside production (tests, previews).
  return process.env.NODE_ENV !== 'production' && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url);
}

/* ── the fingerprint service ─────────────────────────────────────── */

const cache = new Map(); // url -> { at, value }
const inflight = new Map(); // url -> Promise

function rangeQuery({ from, to, site } = {}) {
  const query = new URLSearchParams();
  if (from !== undefined && from !== null && from !== '') {
    if (!DAY.test(String(from))) throw new HRError('invalid_range', 400, { field: 'from' });
    query.set('from', String(from));
  }
  if (to !== undefined && to !== null && to !== '') {
    if (!DAY.test(String(to))) throw new HRError('invalid_range', 400, { field: 'to' });
    query.set('to', String(to));
  }
  if (from && to && String(from) > String(to)) throw new HRError('invalid_range', 400, { field: 'from' });
  if (site) query.set('site', String(site).slice(0, 128));
  const text = query.toString();
  return text ? `?${text}` : '';
}

/** One GET to the service, cached for a minute. `null` for a 404. */
async function upstream(path, range, { refresh = false } = {}) {
  const url = `${base()}${path}${rangeQuery(range)}`;
  const hit = cache.get(url);
  if (!refresh && hit && Date.now() - hit.at < TTL_MS) return hit.value;
  if (inflight.has(url)) return inflight.get(url);
  const token = String(process.env.ATTENDANCE_API_TOKEN || '').trim();
  const request = (async () => {
    let response;
    try {
      response = await fetch(url, {
        headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      console.warn('[hr] attendance service unreachable:', error?.message ?? error);
      throw new HRError('attendance_unavailable', 503);
    }
    if (response.status === 404) return null;
    if (response.status === 400) throw new HRError('invalid_range', 400);
    const type = response.headers.get('content-type') || '';
    if (!response.ok || !type.includes('json')) {
      // A redirect to the login page means the service wants a token we do not have.
      const code = response.status === 401 || (response.status >= 300 && response.status < 400) ? 'attendance_unauthorized' : 'attendance_unavailable';
      console.warn(`[hr] attendance service answered HTTP ${response.status} for ${path}`);
      throw new HRError(code, 503);
    }
    const value = await response.json();
    cache.set(url, { at: Date.now(), value });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return value;
  })();
  inflight.set(url, request);
  try {
    return await request;
  } finally {
    inflight.delete(url);
  }
}

/* ── time off against the attendance days ────────────────────────── */

/** Odoo leaves (validated, plus pending ones flagged) covering each day of one employee. */
export function leavesByDay(leaves, odooEmployeeId, from, to) {
  const days = new Map();
  if (odooEmployeeId === null || odooEmployeeId === undefined) return days;
  for (const leave of leaves ?? []) {
    if (leave.odooEmployeeId !== odooEmployeeId || !leave.from || !leave.to) continue;
    const approved = leave.state === 'validate';
    const pending = PENDING_STATES.has(leave.state);
    if (!approved && !pending) continue;
    const start = leave.from > from ? leave.from : from;
    const end = leave.to < to ? leave.to : to;
    for (let day = start; day <= end; day = nextDay(day)) {
      const current = days.get(day);
      // An approved leave wins over a pending one; a full leave over an away type.
      if (!current || (approved && !current.approved) || (approved === current.approved && current.away && !leave.type.away)) {
        days.set(day, { id: leave.id, type: leave.type.name, color: leave.type.color, away: Boolean(leave.type.away), approved, state: leave.state, from: leave.from, to: leave.to, days: leave.days, hours: Boolean(leave.hours) });
      }
    }
  }
  return days;
}

function nextDay(day) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/**
 * The status a day shows once Odoo time off is laid over it. Only approved
 * leave changes the status; a pending request is shown beside it.
 */
export function effectiveStatus(status, timeOff) {
  if (!timeOff?.approved) return status;
  if (status === 'absent' || status === 'pending') return timeOff.away ? 'away' : 'leave';
  if ((status === 'late' || status === 'incomplete') && timeOff.away) return 'excused';
  return status;
}

/** Counts that read the reconciled statuses of a list of days. */
export function reconciledCounts(days) {
  const counts = { leaveDays: 0, awayDays: 0, excusedDays: 0, unexcusedAbsences: 0, pendingLeaveDays: 0 };
  for (const day of days) {
    if (day.effective === 'leave') counts.leaveDays += 1;
    else if (day.effective === 'away') counts.awayDays += 1;
    else if (day.effective === 'excused') counts.excusedDays += 1;
    else if (day.effective === 'absent') counts.unexcusedAbsences += 1;
    if (day.timeOff && !day.timeOff.approved) counts.pendingLeaveDays += 1;
  }
  return counts;
}

/* ── who a fingerprint code is ───────────────────────────────────── */

/**
 * code → person, for one organization. `hrCode` is the address of the HR
 * profile page (the HR file's code, or the Odoo-only code), `odooId` the key
 * into Odoo time off.
 */
async function directory(user) {
  const organizationId = organizationOf(user);
  const [state, index, timeOff] = await Promise.all([
    organizationState(organizationId),
    odooEmployeeIndex({ timeoutMs: 4000 }),
    odooTimeOff({ timeoutMs: 4000 }),
  ]);
  const profiles = [...state.profiles.values()];
  const resolver = odooResolver(profiles, index);
  const byComparable = new Map();
  for (const profile of profiles) byComparable.set(comparableCode(profile.employeeCode), profile);
  const cacheByCode = new Map();
  const person = (code) => {
    const key = comparableCode(code);
    if (cacheByCode.has(key)) return cacheByCode.get(key);
    const profile = byComparable.get(key) ?? null;
    const odoo = profile ? resolver.odooFor(profile.employeeCode) : index ? odooEmployeeByKey(String(code), index) : null;
    const hrCode = profile?.employeeCode ?? (odoo ? resolver.codeFor(odoo.id) : null);
    const result = {
      hrCode,
      inHrFile: Boolean(profile),
      odooId: odoo?.id ?? null,
      nameArabic: profile?.nameArabic ?? '',
      nameEnglish: profile?.nameEnglish || odoo?.name || '',
      photoUrl: hrCode && odoo && knownPhoto(odoo.id) !== false ? photoUrlFor(hrCode) : null,
      linkedUserId: profile?.linkedUserId ?? null,
    };
    cacheByCode.set(key, result);
    return result;
  };
  return { profiles, resolver, index, timeOff, person };
}

function rights(user) {
  return {
    people: can(user, PERMISSIONS.HR_VIEW),
    personnel: can(user, PERMISSIONS.HR_PERSONNEL_VIEW),
  };
}

/** Company-wide attendance is for HR and Personnel viewers. */
function requireWide(user) {
  const r = rights(user);
  if (!r.people && !r.personnel) throw forbidden(PERMISSIONS.HR_VIEW);
}

/** Adds the HR person to anything carrying a fingerprint `code`. */
function withPerson(item, person) {
  if (!item || typeof item !== 'object' || item.code === undefined) return item;
  const who = person(item.code);
  return { ...item, hr: who };
}

/** Today's approved leave per Odoo id, for the "absent but on leave" split. */
function leaveToday(timeOff, today) {
  const map = new Map();
  for (const leave of timeOff?.leaves ?? []) {
    if (leave.state !== 'validate' || !leave.from || !leave.to || leave.from > today || leave.to < today) continue;
    const current = map.get(leave.odooEmployeeId);
    if (!current || (current.away && !leave.type.away)) map.set(leave.odooEmployeeId, { type: leave.type.name, color: leave.type.color, away: Boolean(leave.type.away), from: leave.from, to: leave.to });
  }
  return map;
}

function stripWithLeave(strip, odooId, timeOff) {
  if (!Array.isArray(strip) || !strip.length) return { strip: strip ?? [], counts: reconciledCounts([]) };
  const leaves = leavesByDay(timeOff?.leaves, odooId, strip[0][0], strip[strip.length - 1][0]);
  const days = strip.map(([day, status]) => {
    const off = leaves.get(day) ?? null;
    return { date: day, status, effective: effectiveStatus(status, off), timeOff: off };
  });
  return { strip: days.map((day) => [day.date, day.effective]), counts: reconciledCounts(days) };
}

/* ── readers ──────────────────────────────────────────────────────── */

const off = () => ({ connected: false });

/** Today, the range figures, the live feed, devices: the attendance home. */
export async function attendanceOverview(user, range = {}) {
  requireWide(user);
  if (!attendanceConfigured()) return off();
  const [data, people] = await Promise.all([upstream('/dashboard/api/overview', range, { refresh: range.refresh }), directory(user)]);
  const { person, timeOff } = people;
  const snapshotDay = data?.range?.snapshot ?? localDay();
  const onLeave = leaveToday(timeOff, snapshotDay);
  const groups = {};
  for (const [status, rows] of Object.entries(data?.snapshot?.people ?? {})) {
    groups[status] = (rows ?? []).map((row) => {
      const enriched = withPerson(row, person);
      const leave = enriched.hr?.odooId !== null ? onLeave.get(enriched.hr?.odooId) ?? null : null;
      return { ...enriched, timeOff: leave, effective: effectiveStatus(status, leave ? { ...leave, approved: true } : null) };
    });
  }
  // The service calls a one-punch day "in" whatever the time; someone who is in
  // but arrived after shift start + grace is late today, and stays marked in.
  const lateIn = (groups.in ?? []).filter((row) => Number(row.late) > 0).map((row) => ({ ...row, effective: 'late' }));
  if (lateIn.length) {
    groups.in = groups.in.filter((row) => !(Number(row.late) > 0));
    groups.late = [...(groups.late ?? []), ...lateIn];
  }
  // Absent (or not yet in) people who are on approved leave move to their own lists.
  const regrouped = { ...groups, leave: [], away: [] };
  for (const status of ['absent', 'pending']) {
    regrouped[status] = (groups[status] ?? []).filter((row) => row.effective === status);
    for (const row of groups[status] ?? []) if (row.effective === 'leave' || row.effective === 'away') regrouped[row.effective].push(row);
  }
  const leaders = Object.fromEntries(Object.entries(data?.leaders ?? {}).map(([key, rows]) => [key, (rows ?? []).map((row) => withPerson(row, person))]));
  return {
    connected: true,
    ...data,
    snapshot: { ...(data?.snapshot ?? {}), people: regrouped },
    leaders,
    feed: (data?.feed ?? []).map((row) => withPerson(row, person)),
    timeOff: { connected: Boolean(timeOff) },
  };
}

/** Every tracked employee in the range, with their strip reconciled against time off. */
export async function attendanceEmployees(user, range = {}) {
  requireWide(user);
  if (!attendanceConfigured()) return off();
  const [data, people] = await Promise.all([upstream('/dashboard/api/employees', range, { refresh: range.refresh }), directory(user)]);
  const { person, timeOff } = people;
  const employees = (data?.employees ?? []).map((row) => {
    const enriched = withPerson(row, person);
    const { strip, counts } = stripWithLeave(row.strip, enriched.hr?.odooId ?? null, timeOff);
    return { ...enriched, strip, ...counts };
  });
  return { connected: true, ...data, employees, excluded: (data?.excluded ?? []).map((row) => withPerson(row, person)), timeOff: { connected: Boolean(timeOff) } };
}

/** One entry per department with members and a daily series. */
export async function attendanceDepartments(user, range = {}) {
  requireWide(user);
  if (!attendanceConfigured()) return off();
  const [data, people] = await Promise.all([upstream('/dashboard/api/departments', range, { refresh: range.refresh }), directory(user)]);
  const { person, timeOff } = people;
  const departments = (data?.departments ?? []).map((department) => ({
    ...department,
    members: (department.members ?? []).map((row) => {
      const enriched = withPerson(row, person);
      const { strip, counts } = stripWithLeave(row.strip, enriched.hr?.odooId ?? null, timeOff);
      return { ...enriched, strip, ...counts };
    }),
  }));
  return { connected: true, ...data, departments };
}

/**
 * The fingerprint code for an HR address: the HR file's code itself, or the
 * registration number of someone only Odoo has. `o<id>` people have none.
 */
function fingerprintCode(code, people) {
  const text = String(code ?? '').trim();
  const profile = people.profiles.find((item) => item.employeeCode === text) ?? null;
  if (profile) return comparableCode(profile.employeeCode);
  const odoo = people.index ? odooEmployeeByKey(text, people.index) : null;
  const registration = String(odoo?.registration_number ?? '').trim();
  if (registration) return comparableCode(registration);
  return /^o\d+$/i.test(text) ? null : comparableCode(text);
}

/** Who may read one person's attendance: HR, Personnel, the person, their manager tree. */
function mayRead(user, code, people) {
  const r = rights(user);
  if (r.people || r.personnel) return true;
  const profile = people.profiles.find((item) => item.employeeCode === String(code)) ?? null;
  if (profile && profile.linkedUserId === user.id) return true;
  if (!people.index) return false;
  return Boolean(teamReach(user, people.profiles, people.resolver, people.index)?.codes.has(String(code)));
}

/**
 * One person's days in the range: every day with its punches, the time off
 * covering it and the status that leaves, plus the summary with leave days
 * taken out of absence.
 */
export async function employeeAttendance(user, code, range = {}) {
  const people = await directory(user);
  if (!mayRead(user, code, people)) throw forbidden(PERMISSIONS.HR_VIEW);
  if (!attendanceConfigured()) return off();
  const fingerprint = fingerprintCode(code, people);
  if (!fingerprint || !CODE.test(fingerprint)) return { connected: true, found: false, fingerprintCode: null };
  const data = await upstream(`/dashboard/api/employees/${encodeURIComponent(fingerprint)}`, range, { refresh: range.refresh });
  if (!data) return { connected: true, found: false, fingerprintCode: fingerprint };
  const who = people.person(fingerprint);
  const rangeFrom = data.range?.from ?? range.from ?? localDay();
  const rangeTo = data.range?.to ?? range.to ?? localDay();
  const leaves = leavesByDay(people.timeOff?.leaves, who.odooId, rangeFrom, rangeTo);
  const days = (data.days ?? []).map((day) => {
    const timeOff = leaves.get(day.date) ?? null;
    return { ...day, timeOff, effective: effectiveStatus(day.status, timeOff) };
  });
  const counts = reconciledCounts(days);
  // Attendance rate with approved leave and away days taken out of the expected days.
  const summary = data.employee ?? {};
  const expected = Math.max(0, Number(summary.expected_days ?? 0) - counts.leaveDays - counts.awayDays);
  const today = days.find((day) => day.date === data.range?.today) ?? null;
  return {
    connected: true,
    found: true,
    fingerprintCode: fingerprint,
    hr: who,
    range: data.range,
    settings: data.settings,
    shift: data.shift,
    employee: {
      ...summary,
      ...counts,
      adjusted_expected_days: expected,
      adjusted_attendance_rate: expected ? Math.min(1, Number(summary.present_days ?? 0) / expected) : null,
    },
    today: today ? { date: today.date, status: today.status, effective: today.effective, first: today.first, last: today.last, worked: today.worked, late: today.late, punches: today.punches, timeOff: today.timeOff, inOffice: Boolean(summary.in_office) } : null,
    days,
    devices: data.devices ?? [],
    weekdayArrival: data.weekday_arrival ?? [],
    timeOff: { connected: Boolean(people.timeOff) },
  };
}

/** Leave balances for one Odoo person, from Odoo allocations, by type. */
function balancesFor(timeOff, odooId) {
  if (!timeOff || odooId === null || odooId === undefined) return [];
  const byType = new Map();
  for (const allocation of timeOff.allocations ?? []) {
    if (allocation.odooEmployeeId !== odooId || allocation.state !== 'validate') continue;
    const key = allocation.type.name || String(allocation.type.id);
    const current = byType.get(key) ?? { type: allocation.type.name, allocated: 0, taken: 0, remaining: 0 };
    current.allocated += allocation.days;
    current.taken += allocation.taken;
    current.remaining = Math.round((current.allocated - current.taken) * 100) / 100;
    byType.set(key, current);
  }
  return [...byType.values()];
}

/**
 * Everything a chat assistant needs to answer "tell me about X": who they
 * are, today at the fingerprint device, the month's attendance with leave
 * laid over it, leave balances and requests. Pay, bank and identity numbers
 * are left out on purpose; they stay on the full profile endpoints.
 */
export async function employeeSnapshot(user, code, range = {}) {
  const people = await directory(user);
  if (!mayRead(user, code, people)) throw forbidden(PERMISSIONS.HR_VIEW);
  const profile = people.profiles.find((item) => item.employeeCode === String(code)) ?? null;
  const odooRow = profile ? people.resolver.odooFor(profile.employeeCode) : people.index ? odooEmployeeByKey(String(code), people.index) : null;
  if (!profile && !odooRow) throw new HRError('hr_employee_not_found', 404);
  const odooPublic = odooRow ? people.resolver.publicFor(odooRow) : null;
  let attendance = null;
  try {
    attendance = await employeeAttendance(user, code, range);
  } catch (error) {
    attendance = { connected: false, error: error?.code ?? 'attendance_unavailable' };
  }
  const odooId = odooRow?.id ?? null;
  const today = localDay();
  const requests = (people.timeOff?.leaves ?? [])
    .filter((leave) => leave.odooEmployeeId === odooId)
    .map((leave) => ({ type: leave.type.name, away: leave.type.away, from: leave.from, to: leave.to, days: leave.days, state: leave.state }));
  const absences = attendance?.found ? attendance.days.filter((day) => day.effective === 'absent').map((day) => day.date) : [];
  const lateDays = attendance?.found ? attendance.days.filter((day) => day.effective === 'late').map((day) => ({ date: day.date, first: day.first, lateMinutes: Math.round(day.late) })) : [];
  const summary = attendance?.found ? attendance.employee : null;
  return {
    employeeCode: profile?.employeeCode ?? (odooRow ? people.resolver.codeFor(odooRow.id) : String(code)),
    profileUrl: `/hr/people/${encodeURIComponent(profile?.employeeCode ?? String(code))}`,
    name: { arabic: profile?.nameArabic ?? '', english: profile?.nameEnglish || odooPublic?.name || '' },
    job: {
      title: profile?.title || odooPublic?.jobTitle || '',
      department: profile?.department || odooPublic?.department || '',
      sector: profile?.sector ?? '',
      manager: profile?.directManager || odooPublic?.manager?.name || '',
      hiringDate: profile?.hiringDate ?? odooPublic?.since ?? null,
      status: profile?.status ?? (odooRow?.active ? 'active' : 'unknown'),
      workEmail: profile?.companyEmail || odooPublic?.workEmail || '',
      workLocation: odooPublic?.workLocation ?? '',
      inHrFile: Boolean(profile),
      inOdoo: Boolean(odooRow),
    },
    attendance: attendance?.found
      ? {
          period: { from: attendance.range?.from, to: attendance.range?.to, dataUntil: attendance.range?.data_until },
          shift: summary.shift,
          schedule: summary.effective_schedule,
          today: attendance.today,
          lastPunch: summary.last_seen,
          inOfficeNow: Boolean(summary.in_office),
          expectedDays: summary.expected_days,
          presentDays: summary.present_days,
          absentDays: summary.absent_days,
          unexcusedAbsences: summary.unexcusedAbsences,
          leaveDays: summary.leaveDays,
          awayDays: summary.awayDays,
          lateDays: summary.late_days,
          excusedDays: summary.excusedDays,
          earlyLeaveDays: summary.early_days,
          missingPunchDays: summary.incomplete_days,
          attendanceRate: summary.attendance_rate,
          attendanceRateWithoutLeave: summary.adjusted_attendance_rate,
          punctuality: summary.punctuality,
          score: summary.score,
          averageArrivalMinute: summary.avg_arrival,
          averageDepartureMinute: summary.avg_departure,
          averageHours: summary.avg_hours,
          totalHours: summary.total_hours,
          overtimeHours: summary.overtime_hours,
          lateMinutes: summary.late_minutes,
          absences,
          lateDaysList: lateDays,
        }
      : { connected: attendance?.connected ?? false, found: false, note: attendance?.connected ? 'No fingerprint record for this code.' : 'Attendance service not connected.' },
    timeOff: {
      connected: Boolean(people.timeOff),
      workbook: profile?.leave ? { availableNow: profile.leave.availableNow ?? null, annualUsed: profile.leave.annualUsed ?? null, sickRemaining: profile.leave.sickRemaining ?? null } : null,
      balances: balancesFor(people.timeOff, odooId),
      onLeaveToday: requests.find((leave) => leave.state === 'validate' && leave.from <= today && leave.to >= today) ?? null,
      upcoming: requests.filter((leave) => leave.state === 'validate' && leave.from > today),
      pending: requests.filter((leave) => PENDING_STATES.has(leave.state)),
      takenThisYear: requests.filter((leave) => leave.state === 'validate' && leave.to <= today),
    },
    notes: [
      'Minutes are minutes after midnight, Cairo time.',
      'Attendance rate without leave takes approved Odoo leave and away days out of the expected days.',
      'Pay, bank and identity numbers are not part of this summary.',
    ],
  };
}

/** Find people by code, Arabic or English name, or e-mail — for chat lookups. */
export async function searchPeople(user, query, limit = 8) {
  const people = await directory(user);
  const r = rights(user);
  const text = String(query ?? '').trim().toLowerCase();
  if (!text) return { matches: [] };
  const team = r.people || r.personnel || !people.index ? null : teamReach(user, people.profiles, people.resolver, people.index);
  const allowed = (code, profile) => r.people || r.personnel || (profile && profile.linkedUserId === user.id) || Boolean(team?.codes.has(code));
  const normal = (value) => String(value ?? '').toLowerCase().normalize('NFKD').replace(/[ً-ٰٟ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();
  const needle = normal(text);
  const scored = [];
  const consider = (code, profile, names, extra) => {
    if (!code || !allowed(code, profile)) return;
    const values = names.map(normal).filter(Boolean);
    let score = 0;
    if (comparableCode(code) === comparableCode(text)) score = 100;
    else if (values.some((value) => value === needle)) score = 90;
    else if (values.some((value) => value.startsWith(needle))) score = 70;
    else if (values.some((value) => value.includes(needle))) score = 50;
    else if (needle.split(' ').length > 1 && needle.split(' ').every((part) => values.some((value) => value.includes(part)))) score = 40;
    if (score) scored.push({ score, employeeCode: code, ...extra });
  };
  for (const profile of people.profiles) {
    consider(profile.employeeCode, profile, [profile.nameArabic, profile.nameEnglish, profile.companyEmail], {
      nameArabic: profile.nameArabic, nameEnglish: profile.nameEnglish, title: profile.title, department: profile.department, status: profile.status, source: 'hr',
    });
  }
  for (const row of people.resolver.odooOnly ?? []) {
    const code = people.resolver.codeFor(row.id);
    const odoo = people.resolver.publicFor(row);
    consider(code, null, [odoo.name, odoo.workEmail], { nameArabic: '', nameEnglish: odoo.name, title: odoo.jobTitle, department: odoo.department, status: 'active', source: 'odoo' });
  }
  scored.sort((left, right) => right.score - left.score || String(left.nameEnglish).localeCompare(String(right.nameEnglish)));
  return { matches: scored.slice(0, Math.max(1, Math.min(25, Number(limit) || 8))) };
}

export const __test = { reset: () => { cache.clear(); inflight.clear(); }, fingerprintCode, rangeQuery };
