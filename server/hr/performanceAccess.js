import { performanceOnly } from '../../shared/permissions.js';
import { organizationOf } from '../../shared/organization.js';
import { find } from '../store.js';
import { organizationState } from '../hrModule.js';
import { comparableEmail, odooEmployeeIndex } from './odooPeople.js';
import { odooResolver } from './odooHR.js';
import { ownOdooEmployee, teamOdooIds } from './teamReach.js';

/** Resolve by employee link or exact work email, never names or department labels.
 * Missing/ambiguous Odoo identity fails closed to the manager's own records.
 */
export function resolvePerformanceTeam(user, profiles, index, accounts = []) {
  const resolver = odooResolver(profiles, index);
  const root = index ? ownOdooEmployee(user, profiles, resolver, index) : null;
  const odooIds = root ? teamOdooIds(index.rows, root.id) : new Set();
  if (root) odooIds.add(root.id);
  const codes = new Set([...odooIds].map((id) => resolver.codeFor(id)).filter(Boolean));
  const userIds = new Set([user.id]);
  for (const profile of profiles) {
    if (profile.linkedUserId === user.id) codes.add(profile.employeeCode);
    if (codes.has(profile.employeeCode) && profile.linkedUserId) userIds.add(profile.linkedUserId);
  }
  const emails = new Set((index?.rows ?? []).filter((row) => odooIds.has(row.id)).map((row) => comparableEmail(row.work_email)).filter(Boolean));
  for (const account of accounts) {
    if (organizationOf(account) === organizationOf(user) && emails.has(comparableEmail(account.email))) userIds.add(account.id);
  }
  return { codes, userIds };
}

export async function performanceTeamFor(user, state) {
  if (!performanceOnly(user)) return null;
  const [resolvedState, index, accounts] = await Promise.all([
    state ?? organizationState(organizationOf(user)),
    odooEmployeeIndex({ timeoutMs: 6000 }),
    find('users', (account) => organizationOf(account) === organizationOf(user)),
  ]);
  return resolvePerformanceTeam(user, [...resolvedState.profiles.values()], index, accounts);
}

export function performanceSubjectAllowed(scope, scorecard) {
  return scorecard.subjectType === 'employee' ? scope.codes.has(String(scorecard.subjectId))
    : scorecard.subjectType === 'user' && scope.userIds.has(String(scorecard.subjectId));
}
