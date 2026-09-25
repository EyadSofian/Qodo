/**
 * Performance — one view over the four ways Qodo already measures people.
 *
 *   general KPI      the approved workbook scorecards (`kpiScorecards`)
 *   recruitment KPI  the 30/30/20/20 desk score, for recruiters
 *   tasks            the scores managers give finished tasks
 *   quarterly review the configurable review below
 *
 * They are joined on the employee code (and the Qodo account linked to it),
 * not copied into a fifth store — so a scorecard corrected in the KPI desk is
 * corrected here too. Quarterly criteria are a setting; a review stores the
 * criteria it was scored against, so changing them never rescores a past
 * quarter.
 */

import { find, findOne, getStore, create, now } from '../store.js';
import { can, PERMISSIONS } from '../../shared/permissions.js';
import { organizationOf } from '../../shared/organization.js';
import { kpiTemplateById, scoreScorecard } from '../../shared/kpi.js';
import { recruiterKpi } from '../../shared/recruitment/kpi.js';
import { localDay } from '../../shared/recruitment/sla.js';
import { HRError, forbidden, notFound } from './errors.js';
import { hrSettingsFor } from './settings.js';
import { organizationState } from '../hrModule.js';
import { requestsFor, stableId } from './recruitment/data.js';
import { recruitmentTeamFor } from './recruitment/team.js';

const QUARTER = /^\d{4}-Q[1-4]$/;

export function quarterOf(day) {
  const month = Number(String(day).slice(5, 7));
  return `${String(day).slice(0, 4)}-Q${Math.floor((month - 1) / 3) + 1}`;
}

function access(user) {
  return {
    view: can(user, PERMISSIONS.HR_VIEW),
    review: can(user, PERMISSIONS.HR_PERFORMANCE_REVIEW),
    recruitment: can(user, PERMISSIONS.HR_RECRUITMENT_VIEW),
  };
}

function reviewPercent(review) {
  const total = (review.criteria ?? []).reduce((sum, criterion) => sum + Number(criterion.max || 0), 0);
  const got = (review.criteria ?? []).reduce((sum, criterion) => sum + Math.min(Number(criterion.max || 0), Math.max(0, Number(review.scores?.[criterion.id] ?? 0))), 0);
  const answered = (review.criteria ?? []).filter((criterion) => review.scores?.[criterion.id] !== undefined && review.scores?.[criterion.id] !== null).length;
  return { percent: total && answered ? (got / total) * 100 : null, answered, total: (review.criteria ?? []).length };
}

export async function performanceOverview(user, { period, quarter } = {}) {
  const rights = access(user);
  const organizationId = organizationOf(user);
  const today = localDay();
  const month = /^\d{4}-\d{2}$/.test(String(period ?? '')) ? period : today.slice(0, 7);
  const q = QUARTER.test(String(quarter ?? '')) ? quarter : quarterOf(today);
  const [state, { settings }, scorecards, tasks, reviews, requests, events] = await Promise.all([
    organizationState(organizationId),
    hrSettingsFor(organizationId),
    find('kpiScorecards', (card) => organizationOf(card) === organizationId),
    find('tasks', (task) => organizationOf(task) === organizationId && task.score !== null && task.score !== undefined),
    find('performanceReviews', (review) => organizationOf(review) === organizationId),
    requestsFor(organizationId),
    find('recruitmentKpiEvents', (event) => organizationOf(event) === organizationId),
  ]);
  const team = await recruitmentTeamFor({ profiles: state.profiles, requests, settings });
  const teamCodes = new Set(team.map((member) => member.employeeCode));
  const own = [...state.profiles.values()].find((profile) => profile.linkedUserId === user.id) ?? null;
  const everyone = rights.view || rights.review;
  if (!everyone && !rights.recruitment && !own) throw forbidden(PERMISSIONS.HR_VIEW);

  const profiles = [...state.profiles.values()].filter((profile) => profile.status === 'active' && profile.sources.master);
  const visible = everyone
    ? profiles
    : profiles.filter((profile) => (rights.recruitment && teamCodes.has(profile.employeeCode)) || profile.employeeCode === own?.employeeCode);

  const rows = visible.map((profile) => {
    const cards = scorecards
      .filter((card) => (card.subjectType === 'employee' && card.subjectId === profile.employeeCode) || (card.subjectType === 'user' && profile.linkedUserId && card.subjectId === profile.linkedUserId))
      .filter((card) => card.period <= month)
      .sort((left, right) => right.period.localeCompare(left.period));
    const latest = cards[0] ?? null;
    const template = latest ? kpiTemplateById(latest.templateId) : null;
    const general = latest && template ? { period: latest.period, percent: scoreScorecard(template, latest).approved.percent, status: latest.status, templateId: latest.templateId } : null;
    const scored = profile.linkedUserId
      ? tasks.filter((task) => (task.assigneeIds ?? []).includes(profile.linkedUserId) && String(task.completedAt ?? task.scoredAt ?? '').slice(0, 7) === month)
      : [];
    const review = reviews.find((item) => item.employeeCode === profile.employeeCode && item.quarter === q) ?? null;
    return {
      employeeCode: profile.employeeCode,
      name: { ar: profile.nameArabic || profile.nameEnglish, en: profile.nameEnglish || profile.nameArabic },
      title: profile.title,
      department: profile.department || profile.sector,
      linkedUserId: profile.linkedUserId ?? null,
      general,
      recruitment: teamCodes.has(profile.employeeCode)
        ? { percent: recruiterKpi({ employeeCode: profile.employeeCode, period: month, requests, events, settings, today, calendar: settings.recruitment.calendar }).percent }
        : null,
      tasks: { count: scored.length, average: scored.length ? scored.reduce((sum, task) => sum + Number(task.score || 0), 0) / scored.length : null },
      review: review ? { id: review.id, status: review.status, ...reviewPercent(review) } : null,
    };
  });

  return {
    period: month,
    quarter: q,
    criteria: settings.performance.quarterlyCriteria,
    rows,
    canReview: rights.review,
    attention: {
      lowGeneral: rows.filter((row) => row.general?.percent !== null && row.general?.percent !== undefined && row.general.percent < 70).length,
      lowRecruitment: rows.filter((row) => row.recruitment?.percent !== null && row.recruitment?.percent !== undefined && row.recruitment.percent < 70).length,
      reviewsPending: rows.filter((row) => !row.review || row.review.status !== 'final').length,
    },
  };
}

export async function reviewFor(user, employeeCode, quarter) {
  const rights = access(user);
  const organizationId = organizationOf(user);
  if (!QUARTER.test(String(quarter))) throw new HRError('performance_quarter_invalid');
  const state = await organizationState(organizationId);
  const profile = state.profiles.get(String(employeeCode));
  if (!profile) throw notFound('hr_employee_not_found');
  const self = profile.linkedUserId === user.id;
  if (!rights.view && !rights.review && !self) throw forbidden(PERMISSIONS.HR_PERFORMANCE_REVIEW);
  const id = stableId('prv', organizationId, profile.employeeCode, quarter);
  const review = await findOne('performanceReviews', (row) => row.id === id);
  const { settings } = await hrSettingsFor(organizationId);
  return {
    review: review ?? { id, employeeCode: profile.employeeCode, quarter, criteria: settings.performance.quarterlyCriteria, scores: {}, comments: {}, summary: '', status: 'draft', reviewerId: null },
    exists: Boolean(review),
    canEdit: rights.review && !self && (!review || review.status !== 'final'),
    employee: { employeeCode: profile.employeeCode, name: { ar: profile.nameArabic || profile.nameEnglish, en: profile.nameEnglish || profile.nameArabic }, title: profile.title, department: profile.department },
  };
}

export async function saveReview(user, employeeCode, quarter, input = {}) {
  const rights = access(user);
  if (!rights.review) throw forbidden(PERMISSIONS.HR_PERFORMANCE_REVIEW);
  const current = await reviewFor(user, employeeCode, quarter);
  if (!current.canEdit) throw new HRError(current.review.status === 'final' ? 'performance_review_final' : 'performance_self_review_forbidden', current.review.status === 'final' ? 409 : 403);
  // A saved review keeps the criteria it was started with; a new one takes today's.
  const criteria = current.review.criteria;
  const scores = {};
  for (const criterion of criteria) {
    const value = input.scores?.[criterion.id];
    if (value === undefined || value === null || value === '') continue;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > Number(criterion.max)) throw new HRError('performance_score_invalid', 400, { criterion: criterion.id, max: criterion.max });
    scores[criterion.id] = number;
  }
  const comments = {};
  for (const criterion of criteria) {
    const note = String(input.comments?.[criterion.id] ?? '').trim().slice(0, 1000);
    if (note) comments[criterion.id] = note;
  }
  const finalize = input.finalize === true;
  if (finalize && Object.keys(scores).length !== criteria.length) throw new HRError('performance_review_incomplete', 400, { answered: Object.keys(scores).length, total: criteria.length });
  const document = {
    organizationId: organizationOf(user),
    employeeCode: current.review.employeeCode,
    quarter,
    criteria,
    scores,
    comments,
    summary: String(input.summary ?? '').trim().slice(0, 2000),
    status: finalize ? 'final' : 'draft',
    reviewerId: user.id,
    finalizedAt: finalize ? now() : null,
  };
  if (current.exists) await (await getStore()).update('performanceReviews', current.review.id, document);
  else await create('performanceReviews', { id: current.review.id, ...document });
  return reviewFor(user, employeeCode, quarter);
}
