/**
 * Time off, read live from Odoo.
 *
 * Odoo owns leave requests and allocations (its approval flow, its leave
 * types — Paid Time Off, Sick, permissions, public holidays, WFH, missions);
 * Qodo only reads them, beside the leave workbook HR still maintains. Nothing
 * here writes to Odoo. Descriptions a person typed on a request are never
 * read — the type, the dates and the state are what HR needs.
 *
 * Types whose Odoo `time_type` is "other" (working from home, a mission) are
 * away-from-desk, not absence, and are reported apart from leave.
 */

import { existingFields, odooConfigured, searchRead } from '../odoo.js';
import { localDay } from '../../shared/recruitment/sla.js';

const TTL_MS = 5 * 60 * 1000;

let cache = null;
let loading = null;

const many2one = (value) => (Array.isArray(value) ? { id: value[0], name: String(value[1] ?? '') } : null);

async function load() {
  const today = localDay();
  const year = Number(today.slice(0, 4));
  const from = `${year}-01-01`;
  const to = `${year + 1}-03-31`;
  const [typeFields, leaveFields, allocationFields] = await Promise.all([
    existingFields('hr.leave.type', ['name', 'color', 'time_type', 'request_unit', 'requires_allocation', 'active', 'unpaid', 'sequence']),
    existingFields('hr.leave', ['employee_id', 'holiday_status_id', 'request_date_from', 'request_date_to', 'number_of_days', 'duration_display', 'state', 'create_date', 'request_unit_hours', 'request_unit_half', 'department_id']),
    existingFields('hr.leave.allocation', ['employee_id', 'holiday_status_id', 'number_of_days', 'leaves_taken', 'state', 'date_from', 'date_to']),
  ]);
  const [types, leaves, allocations] = await Promise.all([
    searchRead('hr.leave.type', [], typeFields, { limit: 500, context: { active_test: false } }),
    searchRead('hr.leave', [['request_date_to', '>=', from], ['request_date_from', '<=', to]], leaveFields, { limit: 5000, order: 'request_date_from desc' }),
    searchRead('hr.leave.allocation', [['state', 'in', ['confirm', 'validate']], '|', ['date_to', '=', false], ['date_to', '>=', from]], allocationFields, { limit: 5000 }),
  ]);
  const typeById = new Map(types.map((type) => [type.id, type]));
  const typeOf = (value) => {
    const ref = many2one(value);
    const type = ref ? typeById.get(ref.id) : null;
    return { id: ref?.id ?? null, name: ref?.name ?? '', color: Number(type?.color) || 0, away: type?.time_type === 'other' };
  };
  return {
    at: Date.now(),
    year,
    types: types
      .map((type) => ({ id: type.id, name: String(type.name ?? ''), color: Number(type.color) || 0, away: type.time_type === 'other', unit: type.request_unit ?? 'day', requiresAllocation: type.requires_allocation === 'yes', active: type.active !== false, unpaid: Boolean(type.unpaid) }))
      .sort((left, right) => Number(right.active) - Number(left.active) || left.name.localeCompare(right.name)),
    leaves: leaves
      .filter((row) => Array.isArray(row.employee_id))
      .map((row) => ({
        id: row.id,
        odooEmployeeId: row.employee_id[0],
        employeeName: String(row.employee_id[1] ?? ''),
        type: typeOf(row.holiday_status_id),
        from: row.request_date_from || null,
        to: row.request_date_to || row.request_date_from || null,
        days: Number(row.number_of_days) || 0,
        duration: String(row.duration_display || ''),
        hours: Boolean(row.request_unit_hours),
        half: Boolean(row.request_unit_half),
        state: String(row.state || ''),
        createdAt: row.create_date || null,
      })),
    allocations: allocations
      .filter((row) => Array.isArray(row.employee_id))
      .map((row) => {
        const days = Number(row.number_of_days) || 0;
        const taken = Number(row.leaves_taken) || 0;
        return { id: row.id, odooEmployeeId: row.employee_id[0], employeeName: String(row.employee_id[1] ?? ''), type: typeOf(row.holiday_status_id), days, taken, remaining: Math.round((days - taken) * 100) / 100, state: String(row.state || ''), from: row.date_from || null, to: row.date_to || null };
      }),
  };
}

/** The cached time-off picture, refreshed in the background. Never throws; `null` when Odoo is off. */
export async function odooTimeOff({ wait = true, timeoutMs = null } = {}) {
  if (!odooConfigured()) return null;
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  if (!loading) {
    loading = load()
      .then((value) => {
        cache = value;
        return value;
      })
      .catch((error) => {
        console.warn('[hr] Odoo time off unavailable:', error?.message ?? error);
        return cache;
      })
      .finally(() => {
        loading = null;
      });
  }
  if (!wait) return cache;
  if (!timeoutMs) return loading;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(cache), timeoutMs);
  });
  try {
    return await Promise.race([loading ?? Promise.resolve(cache), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export const PENDING_STATES = new Set(['confirm', 'validate1']);

/** Approved leave covering `day`, split into absence and away-from-desk. */
export function awayOn(data, day = localDay()) {
  const covering = (data?.leaves ?? []).filter((leave) => leave.state === 'validate' && leave.from && leave.to && leave.from <= day && leave.to >= day);
  return { absent: covering.filter((leave) => !leave.type.away), away: covering.filter((leave) => leave.type.away) };
}

export function pendingRequests(data) {
  return (data?.leaves ?? []).filter((leave) => PENDING_STATES.has(leave.state));
}

export const __test = { load, reset: () => { cache = null; } };
