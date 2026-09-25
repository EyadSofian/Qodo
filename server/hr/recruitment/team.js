/**
 * Who the recruitment team is — derived from HR's own records, never typed in.
 *
 * Production has no reliable single field for "recruiter": the recruiters have
 * no Qodo accounts, Odoo's recruiter field is stale (it still names people who
 * have left), and the HR manager and an HR admin carry real requests without a
 * recruitment title. So membership is the union of three facts about an
 * *active* employee, plus an explicit Settings list for anything they miss:
 *
 *   title        the HR database calls them a recruitment/talent specialist
 *   odoo         Odoo places them in the Recruiting department
 *   assignments  they own a Qodo recruitment request (live, or within a year)
 *   manual       HR added them in Settings → Recruitment team
 *
 * and minus anybody HR excluded there. Every member carries the reasons, so the
 * Settings screen can show why somebody is on the desk.
 */

import { knownPhoto, odooDepartmentName, odooEmployeeFor, odooEmployeeIndex } from '../odooPeople.js';

const RECRUITMENT_TITLE = /recruit|talent\s*acqu|توظيف|استقطاب/i;
const RECRUITING_DEPARTMENT = /recruit|talent/i;
const RECENT_MS = 365 * 24 * 60 * 60 * 1000;

function firstTwo(value) {
  return String(value ?? '').trim().split(/\s+/).slice(0, 2).join(' ');
}

export function shortNames(profile) {
  const en = firstTwo(profile?.nameEnglish) || firstTwo(profile?.nameArabic) || `#${profile?.employeeCode ?? ''}`;
  const ar = firstTwo(profile?.nameArabic) || en;
  return { ar, en };
}

export function photoUrlFor(employeeCode) {
  return `/api/hr/people/${encodeURIComponent(employeeCode)}/photo`;
}

function recentlyOwned(request, now) {
  if (['draft', 'pending_review', 'pending_approval', 'hiring', 'on_hold'].includes(request.status)) return true;
  const stamp = Date.parse(request.assignedAt ?? request.sla?.startDate ?? request.legacy?.activeDate ?? request.updatedAt ?? '');
  return Number.isFinite(stamp) && now - stamp <= RECENT_MS;
}

/**
 * @param {object} input
 * @param {Map<string, object>} input.profiles  HR profiles keyed by employee code
 * @param {object[]} input.requests  recruitment requests
 * @param {{include: string[], exclude: string[]}} input.team  Settings overrides
 * @param {object|null} [input.odooIndex]  from `odooEmployeeIndex`
 */
export function deriveRecruitmentTeam({ profiles, requests, team = { include: [], exclude: [] }, odooIndex = null, now = Date.now() }) {
  const reasons = new Map();
  const add = (code, reason) => {
    if (!code) return;
    const list = reasons.get(code) ?? [];
    if (!list.includes(reason)) list.push(reason);
    reasons.set(code, list);
  };

  for (const profile of profiles.values()) {
    if (profile.status !== 'active' || !profile.sources?.master) continue;
    if (RECRUITMENT_TITLE.test(String(profile.title ?? ''))) add(profile.employeeCode, 'title');
    const odoo = odooEmployeeFor(profile, odooIndex);
    if (odoo && RECRUITING_DEPARTMENT.test(odooDepartmentName(odoo))) add(profile.employeeCode, 'odoo');
  }
  for (const request of requests) {
    if (!recentlyOwned(request, now)) continue;
    for (const code of [request.recruiterCode, ...(request.supportRecruiterCodes ?? [])]) add(code, 'assignments');
  }
  for (const code of team.include ?? []) add(String(code), 'manual');

  const excluded = new Set((team.exclude ?? []).map(String));
  const members = [];
  for (const [code, why] of reasons) {
    if (excluded.has(code)) continue;
    const profile = profiles.get(code);
    // A person who has left stays on their old jobs' history, not on the desk.
    if (!profile || profile.status !== 'active') continue;
    const odoo = odooEmployeeFor(profile, odooIndex);
    members.push({
      employeeCode: code,
      nameArabic: profile.nameArabic,
      nameEnglish: profile.nameEnglish,
      shortName: shortNames(profile),
      title: profile.title,
      department: profile.department,
      linkedUserId: profile.linkedUserId ?? null,
      odooEmployeeId: odoo?.id ?? null,
      // Only 1 in 5 Odoo employees has a photo; skip the ones known to be missing.
      photoUrl: odoo && knownPhoto(odoo.id) !== false ? photoUrlFor(code) : null,
      reasons: why,
    });
  }
  // Specialists first, then by name — the people whose whole job this is lead the row.
  const rank = (member) => (member.reasons.includes('title') ? 0 : member.reasons.includes('odoo') ? 1 : 2);
  return members.sort((left, right) => rank(left) - rank(right) || left.shortName.en.localeCompare(right.shortName.en));
}

/** Team members plus the non-blocking Odoo index (photos, departments) when it is warm. */
export async function recruitmentTeamFor({ profiles, requests, settings }) {
  const odooIndex = await odooEmployeeIndex({ timeoutMs: 2500 });
  return deriveRecruitmentTeam({ profiles, requests, team: settings.recruitment.team, odooIndex });
}
