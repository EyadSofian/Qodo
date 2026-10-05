/**
 * "His team" in People, for somebody who holds `hr.people.team` and not
 * `hr.view`: everyone below them in Odoo's manager tree (`parent_id`), at every
 * level, and nobody else. Odoo owns that tree, so moving someone under another
 * manager in Odoo moves them between teams here without touching Qodo.
 *
 * Only active employees count. A resigned person's record still points at their
 * old manager, and that is history, not a team.
 */

import { organizationOf } from '../../shared/organization.js';
import { can, PERMISSIONS } from '../../shared/permissions.js';
import { organizationState } from '../hrModule.js';
import { odooResolver } from './odooHR.js';
import { comparableEmail, odooEmployeeIndex } from './odooPeople.js';

/** Odoo ids below `rootId`, every level down. Safe against a loop in the tree. */
export function teamOdooIds(rows, rootId) {
  const children = new Map();
  for (const row of rows) {
    if (!row.active || !Array.isArray(row.parent_id)) continue;
    const parent = row.parent_id[0];
    children.set(parent, [...(children.get(parent) ?? []), row.id]);
  }
  const team = new Set();
  const queue = [rootId];
  while (queue.length) {
    for (const id of children.get(queue.shift()) ?? []) {
      if (id === rootId || team.has(id)) continue;
      team.add(id);
      queue.push(id);
    }
  }
  return team;
}

/**
 * The caller's own Odoo employee: through the HR record their account is linked
 * to, else the one active Odoo employee whose work e-mail is their login. A
 * name is never enough — it could hand one manager another manager's team.
 */
export function ownOdooEmployee(user, profiles, resolver, index) {
  const own = profiles.find((profile) => profile.linkedUserId === user.id);
  const linked = own ? resolver.odooFor(own.employeeCode) : null;
  if (linked) return linked;
  const email = comparableEmail(user.email);
  if (!email) return null;
  const matches = index.rows.filter((row) => row.active && comparableEmail(row.work_email) === email);
  return matches.length === 1 ? matches[0] : null;
}

/**
 * The team this caller reads People through, or null when the team scope does
 * not apply (they read everyone through `hr.view`, or hold neither key).
 * `odooIds` is empty when Odoo is unreachable or their account joins no Odoo
 * employee — they then see only themselves, never everyone.
 */
export function teamReach(user, profiles, resolver, index) {
  if (can(user, PERMISSIONS.HR_VIEW) || !can(user, PERMISSIONS.HR_PEOPLE_TEAM)) return null;
  const root = index ? ownOdooEmployee(user, profiles, resolver, index) : null;
  const odooIds = root ? teamOdooIds(index.rows, root.id) : new Set();
  const codes = new Set([...odooIds].map((id) => resolver.codeFor(id)).filter(Boolean));
  return { rootId: root?.id ?? null, odooIds, codes };
}

/** Whether `code` (HR code, Odoo code or `o<id>`) is in the caller's team. */
export async function inTeam(user, code) {
  if (can(user, PERMISSIONS.HR_VIEW) || !can(user, PERMISSIONS.HR_PEOPLE_TEAM)) return false;
  const [state, index] = await Promise.all([organizationState(organizationOf(user)), odooEmployeeIndex({ timeoutMs: 6000 })]);
  if (!index) return false;
  const profiles = [...state.profiles.values()];
  return Boolean(teamReach(user, profiles, odooResolver(profiles, index), index)?.codes.has(String(code)));
}
