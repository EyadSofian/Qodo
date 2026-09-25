/**
 * Everything a recruitment decision needs to know about the person asking and
 * the organization they are in — loaded once per request, passed down.
 */

import { find } from '../../store.js';
import { can, isActiveUser, PERMISSIONS } from '../../../shared/permissions.js';
import { organizationOf } from '../../../shared/organization.js';
import { localDay } from '../../../shared/recruitment/sla.js';
import { recruitmentPolicy } from '../../../shared/recruitment/settings.js';
import { organizationState } from '../../hrModule.js';
import { hrSettingsFor } from '../settings.js';
import { odooLinksFor, requestsFor } from './data.js';
import { odooEmployeeIndex } from '../odooPeople.js';
import { recruitmentTeamFor } from './team.js';

export async function recruitmentContext(user, { withTeam = true } = {}) {
  const organizationId = organizationOf(user);
  const [{ settings, revision }, state, requests, links] = await Promise.all([
    hrSettingsFor(organizationId),
    organizationState(organizationId),
    requestsFor(organizationId),
    odooLinksFor(organizationId),
  ]);
  const policy = recruitmentPolicy(settings);
  const team = withTeam ? await recruitmentTeamFor({ profiles: state.profiles, requests, settings }) : [];
  const ownProfile = [...state.profiles.values()].find((profile) => profile.linkedUserId === user.id) ?? null;
  return {
    user,
    organizationId,
    settings,
    settingsRevision: revision,
    policy,
    state,
    profiles: state.profiles,
    requests,
    links,
    team,
    teamCodes: new Set(team.map((member) => member.employeeCode)),
    // Whatever the team lookup already warmed; never waits on Odoo.
    odooIndex: await odooEmployeeIndex({ wait: false }),
    employeeCode: ownProfile?.employeeCode ?? null,
    today: localDay(new Date(), 'Africa/Cairo'),
    perms: {
      view: can(user, PERMISSIONS.HR_RECRUITMENT_VIEW),
      request: can(user, PERMISSIONS.HR_RECRUITMENT_REQUEST),
      review: can(user, PERMISSIONS.HR_RECRUITMENT_REVIEW),
      approve: can(user, PERMISSIONS.HR_RECRUITMENT_APPROVE),
      assign: can(user, PERMISSIONS.HR_RECRUITMENT_ASSIGN),
      extend: can(user, PERMISSIONS.HR_RECRUITMENT_EXTEND),
      override: can(user, PERMISSIONS.HR_RECRUITMENT_OVERRIDE_CAPACITY),
      kpiReview: can(user, PERMISSIONS.HR_RECRUITMENT_KPI_REVIEW),
      rewards: can(user, PERMISSIONS.HR_RECRUITMENT_REWARDS_MANAGE),
      settings: can(user, PERMISSIONS.HR_SETTINGS_MANAGE),
      payroll: can(user, PERMISSIONS.HR_PAYROLL),
    },
  };
}

/** Anyone who can open the recruitment area at all. */
export function hasRecruitmentAccess(ctx) {
  const { perms } = ctx;
  return perms.view || perms.request || perms.review || perms.approve || perms.assign || perms.extend || perms.kpiReview || perms.rewards || Boolean(ctx.employeeCode && ctx.teamCodes.has(ctx.employeeCode));
}

/** Active accounts in the organization holding a permission, optionally narrowed. */
export async function usersWith(organizationId, permission, filter = () => true) {
  const users = await find('users', (user) => organizationOf(user) === organizationId && isActiveUser(user));
  return users.filter((user) => can(user, permission) && filter(user));
}

/** Every account's display name in the organization, for timelines. */
export async function userNames(organizationId) {
  const users = await find('users', (user) => organizationOf(user) === organizationId);
  return new Map(users.map((user) => [user.id, user.name]));
}

/** The display name of an employee code, for notifications and timelines. */
export function employeeName(ctx, code, lang = 'en') {
  if (!code) return '';
  const member = ctx.team.find((item) => item.employeeCode === code);
  if (member) return lang === 'ar' ? member.shortName.ar : member.shortName.en;
  const profile = ctx.profiles.get(code);
  if (!profile) return `#${code}`;
  const name = lang === 'ar' ? profile.nameArabic || profile.nameEnglish : profile.nameEnglish || profile.nameArabic;
  return String(name || `#${code}`).split(/\s+/).slice(0, 2).join(' ');
}
