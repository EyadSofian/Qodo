/**
 * Odoo HR data, addressed the way HR pages address people: by HR employee
 * code when the HR file has the person, by `o<id>` (or the Odoo-only code)
 * when only Odoo does. One resolver is shared by People, Personnel, Home and
 * Organization so a name, a photo and a link always agree.
 */

import { localDay } from '../../shared/recruitment/sla.js';
import { knownPhoto, matchOdooEmployees, odooOnlyCode, publicOdooEmployee } from './odooPeople.js';
import { PENDING_STATES, awayOn } from './odooTimeOff.js';
import { photoUrlFor } from './recruitment/team.js';

/** code ⇄ Odoo id, both directions, for one organization's profiles. */
export function odooResolver(profiles, index) {
  const { byCode, odooOnly } = matchOdooEmployees(profiles, index);
  const codeByOdooId = new Map();
  for (const [code, row] of byCode) codeByOdooId.set(row.id, code);
  const profileByCode = new Map(profiles.map((profile) => [profile.employeeCode, profile]));
  const codeFor = (odooId) => {
    if (codeByOdooId.has(odooId)) return codeByOdooId.get(odooId);
    const row = index?.byId.get(odooId);
    return row ? odooOnlyCode(row) : null;
  };
  /** A person as a row shows them: code, both names, department, photo. */
  const person = (odooId, fallbackName = '') => {
    const code = codeFor(odooId);
    const profile = code ? profileByCode.get(code) : null;
    const row = index?.byId.get(odooId) ?? null;
    return {
      code,
      nameArabic: profile?.nameArabic ?? '',
      nameEnglish: profile?.nameEnglish || row?.name || fallbackName,
      title: profile?.title || row?.job_title || '',
      department: profile?.department || (Array.isArray(row?.department_id) ? String(row.department_id[1] ?? '') : ''),
      photoUrl: code && knownPhoto(odooId) !== false ? photoUrlFor(code) : null,
      hasPhoto: knownPhoto(odooId) === true,
      inHrFile: Boolean(profile),
    };
  };
  return { byCode, odooOnly, codeFor, person, odooFor: (code) => byCode.get(code) ?? null, publicFor: (row) => publicOdooEmployee(row, { codeFor }) };
}

/** One Odoo leave, as HR shows it. */
export function leaveView(leave, resolver) {
  return {
    id: leave.id,
    employee: resolver.person(leave.odooEmployeeId, leave.employeeName),
    type: leave.type,
    from: leave.from,
    to: leave.to,
    days: leave.days,
    duration: leave.duration,
    hours: leave.hours,
    state: leave.state,
    createdAt: leave.createdAt,
  };
}

/**
 * The time-off picture for a reader: everything for HR and Personnel, only
 * their own requests for anyone else (`ownOdooId`).
 */
export function timeOffView(data, resolver, { everyone, ownOdooId = null, today = localDay() }) {
  if (!data) return { connected: false };
  const visible = (row) => everyone || (ownOdooId !== null && row.odooEmployeeId === ownOdooId);
  const leaves = data.leaves.filter(visible);
  const allocations = data.allocations.filter(visible);
  const away = awayOn({ leaves }, today);
  const inDays = (days) => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  const weekAhead = inDays(7);
  return {
    connected: true,
    year: data.year,
    today,
    types: data.types.filter((type) => type.active),
    requests: leaves.map((leave) => leaveView(leave, resolver)),
    allocations: allocations.map((allocation) => ({ ...allocation, employee: resolver.person(allocation.odooEmployeeId, allocation.employeeName) })),
    onLeaveToday: away.absent.map((leave) => leaveView(leave, resolver)),
    awayToday: away.away.map((leave) => leaveView(leave, resolver)),
    pending: leaves.filter((leave) => PENDING_STATES.has(leave.state)).length,
    upcoming: leaves.filter((leave) => leave.state === 'validate' && !leave.type.away && leave.from > today && leave.from <= weekAhead).map((leave) => leaveView(leave, resolver)),
  };
}
