/**
 * The recruitment desk — what the Overview, Capacity and alert drawer read.
 *
 * One pass over the organization's requests produces the team cards (workload,
 * month, SLA success, KPI, reward progress), the headline figures and the
 * alerts, so the three can never disagree about what "overdue" means.
 */

import { find } from '../../store.js';
import { PERMISSIONS } from '../../../shared/permissions.js';
import { organizationOf } from '../../../shared/organization.js';
import { capacityLevel, loadByRecruiter } from '../../../shared/recruitment/capacity.js';
import { deriveRecruitmentAlerts } from '../../../shared/recruitment/alerts.js';
import { recruiterKpi } from '../../../shared/recruitment/kpi.js';
import { rewardProgress } from '../../../shared/recruitment/rewards.js';
import { slaSnapshot } from '../../../shared/recruitment/sla.js';
import { COMMITTED_STATUSES, PENDING_STATUSES } from '../../../shared/recruitment/workflow.js';
import { forbidden } from '../errors.js';
import { employeeName, hasRecruitmentAccess, recruitmentContext } from './context.js';
import { canSee, publicContext, publicRequest } from './requests.js';
import { activeRewardRules, qualityFlags } from './rewards.js';
import { odooJobTotals, odooJobsByEmployee, publishedJobs, publishedJobsSnapshot } from './odooJobs.js';
import { syncOdooJobs } from './odooSync.js';

/** The desk is for people who run or oversee recruitment, and for a recruiter's own card. */
function deskScope(ctx) {
  const all = ctx.perms.view || ctx.perms.assign || ctx.perms.approve || ctx.perms.kpiReview || ctx.perms.rewards;
  if (all) return 'all';
  if (ctx.employeeCode && ctx.teamCodes.has(ctx.employeeCode)) return 'self';
  return null;
}

function snapshotOf(ctx, request) {
  return slaSnapshot(request.sla, { today: ctx.today, calendar: ctx.policy.calendar, dueSoonWorkingDays: ctx.policy.dueSoonWorkingDays });
}

function percent(part, whole) {
  return whole ? Math.round((part / whole) * 1000) / 10 : null;
}

export async function deskData(user) {
  const ctx = await recruitmentContext(user);
  if (!hasRecruitmentAccess(ctx)) throw forbidden(PERMISSIONS.HR_RECRUITMENT_VIEW);
  const scope = deskScope(ctx);
  const [events, batches, rules, flags, odoo] = await Promise.all([
    find('recruitmentKpiEvents', (event) => organizationOf(event) === ctx.organizationId),
    find('recruitmentRewardBatches', (batch) => organizationOf(batch) === ctx.organizationId),
    activeRewardRules(ctx.organizationId),
    qualityFlags(ctx.organizationId),
    publishedJobsSnapshot(),
  ]);
  return { ctx, scope, events, batches, rules, flags, odoo };
}

const approvedInQodo = (request) => request.source === 'qodo' && ['hiring', 'on_hold', 'completed'].includes(request.status);

/**
 * An Odoo job as the desk shows it: Odoo's own counts, plus the Qodo request
 * confirmed against it — the thing that carries its deadline and can be edited.
 */
function deskJobs(ctx, snapshot, jobs) {
  // Odoo names an owner by user; only one who is on Qodo's desk counts as owning it here.
  const codeByOdooUser = new Map((snapshot?.team ?? []).filter((member) => member.employeeCode && ctx.teamCodes.has(member.employeeCode)).map((member) => [member.id, member.employeeCode]));
  const requestByJob = new Map();
  for (const [requestId, link] of ctx.links) {
    const request = ctx.requests.find((item) => item.id === requestId);
    if (!request || !canSee(ctx, request)) continue;
    // An approved request speaks for the job ahead of the one the sync keeps.
    const jobId = Number(link.odooJobId);
    if (!requestByJob.has(jobId) || approvedInQodo(request)) requestByJob.set(jobId, request);
  }
  return jobs.map((job) => {
    const request = requestByJob.get(job.id) ?? null;
    return {
      ...job,
      ownerCode: (job.recruiter && codeByOdooUser.get(job.recruiter.id)) || null,
      // `approved`: the request went through review and final approval in Qodo,
      // as opposed to one the sync keeps for a job published without a request.
      request: request ? { id: request.id, reference: request.reference, status: request.status, priority: request.priority ?? null, dueDate: request.sla?.currentDueDate ?? null, approved: approvedInQodo(request) } : null,
    };
  });
}

function teamCards({ ctx, scope, events, batches, rules, flags, odoo }) {
  const odooJobs = odooJobsByEmployee(odoo);
  const period = ctx.today.slice(0, 7);
  const year = ctx.today.slice(0, 4);
  const loads = loadByRecruiter(ctx.requests, { countOnHold: ctx.policy.capacity.countOnHold !== false });
  const members = scope === 'all' ? ctx.team : ctx.team.filter((member) => member.employeeCode === ctx.employeeCode);
  return members.map((member) => {
    const code = member.employeeCode;
    const owned = ctx.requests.filter((request) => request.recruiterCode === code);
    const load = loads.get(code) ?? { critical: 0, required: 0, planned: 0, unclassified: 0, total: 0 };
    const completed = owned.filter((request) => request.status === 'completed' && request.sla?.completedAt);
    const completedThisMonth = completed.filter((request) => request.sla.completedAt.slice(0, 7) === period);
    const judgedThisYear = completed.filter((request) => request.sla.completedAt.slice(0, 4) === year && request.sla.slaMet !== null);
    const kpi = recruiterKpi({ employeeCode: code, period, requests: ctx.requests, events, settings: ctx.settings, today: ctx.today, calendar: ctx.policy.calendar });
    const reward = rewardProgress({ employeeCode: code, requests: ctx.requests, batches, qualityFlags: flags, rules });
    const overdue = owned.filter((request) => request.status === 'hiring' && snapshotOf(ctx, request).state === 'overdue').length;
    return {
      member,
      workload: load,
      limits: { critical: ctx.policy.capacity.critical, required: ctx.policy.capacity.required, planned: ctx.policy.capacity.planned },
      level: capacityLevel(load, ctx.policy.capacity),
      pipeline: owned.filter((request) => PENDING_STATUSES.includes(request.status)).length,
      overdue,
      completedThisMonth: completedThisMonth.length,
      slaSuccess: { percent: percent(judgedThisYear.filter((request) => request.sla.slaMet).length, judgedThisYear.length), judged: judgedThisYear.length },
      kpi: { percent: kpi.percent, complete: kpi.complete, period },
      reward: { done: reward.best.done, of: reward.best.of, category: reward.best.category, ready: batches.filter((batch) => batch.employeeCode === code && batch.status === 'ready').length },
      // What Odoo publishes under their name today; null while Odoo is unreachable.
      odoo: odoo?.connected ? odooJobTotals(odooJobs.get(code) ?? []) : null,
    };
  });
}

function summaryFigures(ctx, requests) {
  const live = requests.filter((request) => request.status === 'hiring');
  const committed = requests.filter((request) => COMMITTED_STATUSES.includes(request.status));
  const snapshots = live.map((request) => snapshotOf(ctx, request));
  const year = ctx.today.slice(0, 4);
  const judged = requests.filter((request) => request.status === 'completed' && request.sla?.completedAt?.slice(0, 4) === year && request.sla.slaMet !== null && request.sla.slaMet !== undefined);
  return {
    activeJobs: live.length,
    onHold: requests.filter((request) => request.status === 'on_hold').length,
    critical: live.filter((request) => request.priority === 'critical').length,
    required: live.filter((request) => request.priority === 'required').length,
    planned: live.filter((request) => request.priority === 'planned').length,
    unclassified: live.filter((request) => !request.priority).length,
    overdue: snapshots.filter((snapshot) => snapshot.state === 'overdue').length,
    dueSoon: snapshots.filter((snapshot) => ['due_soon', 'due_today'].includes(snapshot.state)).length,
    openSeats: committed.reduce((sum, request) => sum + Math.max(0, (Number(request.headcount) || 0) - (Number(request.accepted) || 0)), 0),
    pendingReview: requests.filter((request) => request.status === 'pending_review').length,
    pendingApproval: requests.filter((request) => request.status === 'pending_approval').length,
    completedThisMonth: requests.filter((request) => request.status === 'completed' && request.sla?.completedAt?.slice(0, 7) === ctx.today.slice(0, 7)).length,
    slaSuccess: { percent: percent(judged.filter((request) => request.sla.slaMet).length, judged.length), judged: judged.length, year },
  };
}

export function alertsForContext(ctx, { batches = [], scope = 'all' } = {}) {
  const requests = ctx.requests.filter((request) => canSee(ctx, request) && (scope === 'all' || request.recruiterCode === ctx.employeeCode));
  const codes = new Set(requests.map((request) => request.recruiterCode).filter(Boolean));
  const names = new Map([...codes].map((code) => [code, { ar: employeeName(ctx, code, 'ar'), en: employeeName(ctx, code, 'en') }]));
  const readyBatches = batches.filter((batch) => batch.status === 'ready' && (scope === 'all' || batch.employeeCode === ctx.employeeCode));
  return deriveRecruitmentAlerts({ requests, names, policy: ctx.policy, linkedRequestIds: new Set(ctx.links.keys()), readyBatches, today: ctx.today });
}

/** Odoo's published board in four figures, for whoever sees the whole desk. */
function odooFigures({ ctx, scope, odoo }) {
  if (scope !== 'all' || !odoo?.connected) return null;
  return { ...odooJobTotals(odoo.jobs), unowned: deskJobs(ctx, odoo, odoo.jobs).filter((job) => !job.ownerCode).length, fetchedAt: odoo.fetchedAt };
}

/** The Overview page in one round trip: team first, then figures, then alerts. */
export async function recruitmentOverview(user) {
  const data = await deskData(user);
  const { ctx, scope } = data;
  const visible = ctx.requests.filter((request) => canSee(ctx, request));
  return {
    scope,
    team: scope ? teamCards(data) : [],
    odoo: odooFigures(data),
    summary: summaryFigures(ctx, scope === 'all' ? visible : visible.filter((request) => request.recruiterCode === ctx.employeeCode)),
    alerts: alertsForContext(ctx, { batches: data.batches, scope: scope ?? 'self' }),
    context: publicContext(ctx),
  };
}

export async function recruitmentTeam(user) {
  const data = await deskData(user);
  if (!data.scope) throw forbidden(PERMISSIONS.HR_RECRUITMENT_VIEW);
  return { team: teamCards(data), context: publicContext(data.ctx) };
}

export async function recruitmentSummary(user) {
  const data = await deskData(user);
  if (!data.scope) throw forbidden(PERMISSIONS.HR_RECRUITMENT_VIEW);
  const visible = data.ctx.requests.filter((request) => canSee(data.ctx, request));
  return { summary: summaryFigures(data.ctx, visible), today: data.ctx.today };
}

export async function recruitmentAlerts(user) {
  const data = await deskData(user);
  return { alerts: alertsForContext(data.ctx, { batches: data.batches, scope: data.scope ?? 'self' }), today: data.ctx.today };
}

/** The capacity board: every member's committed jobs, pipeline and limits. */
export async function capacityBoard(user) {
  const data = await deskData(user);
  if (!data.scope) throw forbidden(PERMISSIONS.HR_RECRUITMENT_VIEW);
  const { ctx } = data;
  const cards = teamCards(data);
  const odooJobs = odooJobsByEmployee(data.odoo);
  // Each job with its Odoo posting, whoever owns the posting in Odoo: an
  // approved request keeps the recruiter Qodo assigned.
  const postings = new Map(deskJobs(ctx, data.odoo, data.odoo?.connected ? data.odoo.jobs : []).map((job) => [job.id, job]));
  const withPosting = (request) => ({ ...publicRequest(ctx, request), posting: postings.get(Number(ctx.links.get(request.id)?.odooJobId)) ?? null });
  return {
    odooConnected: Boolean(data.odoo?.connected),
    recruiters: cards.map((card) => ({
      ...card,
      odooJobs: deskJobs(ctx, data.odoo, odooJobs.get(card.member.employeeCode) ?? []),
      jobs: ctx.requests
        .filter((request) => request.recruiterCode === card.member.employeeCode && (COMMITTED_STATUSES.includes(request.status) || PENDING_STATUSES.includes(request.status)))
        .map(withPosting),
    })),
    unassigned: ctx.requests
      .filter((request) => !request.recruiterCode && ['pending_review', 'pending_approval', 'hiring', 'on_hold'].includes(request.status) && canSee(ctx, request))
      .map(withPosting),
    context: publicContext(ctx),
  };
}

/**
 * Every job published in Odoo for Egypt, with its owner and the Qodo request
 * confirmed against it. `refresh` re-reads Odoo now and reports a failure
 * instead of serving the last copy.
 */
export async function odooPublishedJobs(user, { refresh = false } = {}) {
  let ctx = await recruitmentContext(user);
  if (!hasRecruitmentAccess(ctx)) throw forbidden(PERMISSIONS.HR_RECRUITMENT_VIEW);
  const data = await publishedJobs({ refresh });
  if (refresh) {
    // "Refresh from Odoo" brings the desk in line now instead of at the next tick.
    const synced = await syncOdooJobs(ctx.organizationId, { snapshot: data });
    if (synced && !synced.skipped) ctx = await recruitmentContext(user);
  }
  return {
    ...data,
    jobs: deskJobs(ctx, data, data.jobs),
    team: (data.team ?? []).map((member) => {
      const profile = member.employeeCode ? ctx.profiles.get(member.employeeCode) : null;
      return { ...member, nameArabic: profile?.nameArabic || '', title: profile?.title || member.title };
    }),
  };
}
