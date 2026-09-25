/**
 * Odoo, seen from one Qodo job.
 *
 * Qodo owns the request, the approval, the owner and the clock; Odoo owns the
 * candidates, the Odoo job and its stages. This module is where the two meet,
 * read-only, and it keeps the conservative matching rule that already protects
 * HR from the wrong numbers: an automatic match is a *suggestion* until HR
 * confirms it, and only a confirmed link feeds a job's pipeline, its accepted
 * count or an automatic KPI check.
 *
 * Counts are scoped to applicants created on or after the job's SLA start —
 * Odoo jobs are reused round after round, and last spring's applicants are not
 * this request's pipeline.
 */

import { existingFields, odooConfigured, readGroup, searchRead } from '../../odoo.js';
import { bestJob, jobOption, readOdooState, suggestedJobs } from '../../hrRecruitmentOdoo.js';
import { DEFAULT_FUNNEL } from '../../../shared/recruitment/settings.js';
import { forbidden, notFound } from '../errors.js';
import { canSee } from './requests.js';
import { recruitmentContext } from './context.js';

const PIPELINE_TTL_MS = 10 * 60 * 1000;
const STAGE_TTL_MS = 60 * 60 * 1000;
const pipelineCache = new Map();
let stageCache = null;

export const FUNNEL_STEPS = ['received', 'filtered', 'interviewed', 'accepted', 'offer', 'hired'];

function baseUrl() {
  return String(process.env.ODOO_URL || '').replace(/\/+$/, '');
}

function odooUrl(model, id) {
  const base = baseUrl();
  return base ? `${base}/web#id=${id}&model=${model}&view_type=form` : null;
}

async function stages() {
  if (stageCache && Date.now() - stageCache.at < STAGE_TTL_MS) return stageCache.value;
  const rows = await searchRead('hr.recruitment.stage', [], ['name', 'sequence', 'hired_stage', 'fold'], { order: 'sequence, id' });
  stageCache = { at: Date.now(), value: rows };
  return rows;
}

function sinceFor(request) {
  const day = request.sla?.startDate ?? String(request.createdAt ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/** Map each funnel step to the stage names it counts, from Settings. */
export function funnelCounts(applicants, funnel = DEFAULT_FUNNEL) {
  const excluded = new Set(funnel.excluded ?? []);
  const inStages = (list, applicant) => (list ?? []).includes(applicant.stage);
  const counts = { received: applicants.length, filtered: 0, interviewed: 0, accepted: 0, offer: 0, hired: 0 };
  for (const applicant of applicants) {
    if (excluded.has(applicant.stage)) continue;
    // Being interviewed happened even if the candidate was refused afterwards;
    // being accepted, offered or hired did not survive a refusal.
    if (inStages(funnel.filtered, applicant)) counts.filtered += 1;
    if (inStages(funnel.interviewed, applicant)) counts.interviewed += 1;
    if (applicant.refused) continue;
    if (inStages(funnel.accepted, applicant)) counts.accepted += 1;
    if (inStages(funnel.offer, applicant)) counts.offer += 1;
    if (inStages(funnel.hired, applicant)) counts.hired += 1;
  }
  return counts;
}

async function readApplicants(jobId, since) {
  const wanted = ['partner_name', 'name', 'stage_id', 'user_id', 'create_date', 'date_closed', 'salary_expected', 'salary_proposed', 'active', 'refuse_reason_id', 'date_last_stage_update', 'email_from', 'partner_phone', 'meeting_ids'];
  const fields = await existingFields('hr.applicant', wanted);
  const domain = [['job_id', '=', jobId]];
  if (since) domain.push(['create_date', '>=', `${since} 00:00:00`]);
  return searchRead('hr.applicant', domain, fields, { limit: 400, order: 'create_date desc', context: { active_test: false } });
}

function shapeApplicant(row) {
  const refused = row.active === false || Boolean(row.refuse_reason_id);
  return {
    id: row.id,
    name: String(row.partner_name || row.name || `#${row.id}`),
    stage: Array.isArray(row.stage_id) ? String(row.stage_id[1]) : 'Unstaged',
    stageId: Array.isArray(row.stage_id) ? row.stage_id[0] : null,
    recruiter: Array.isArray(row.user_id) ? String(row.user_id[1]) : '',
    appliedOn: row.create_date ? String(row.create_date).slice(0, 10) : null,
    lastStageUpdate: row.date_last_stage_update ? String(row.date_last_stage_update).slice(0, 10) : null,
    hiredOn: row.date_closed ? String(row.date_closed).slice(0, 10) : null,
    refused,
    refuseReason: Array.isArray(row.refuse_reason_id) ? String(row.refuse_reason_id[1]) : '',
    expectedSalary: Number(row.salary_expected) || null,
    proposedSalary: Number(row.salary_proposed) || null,
    hasEmail: Boolean(row.email_from),
    hasPhone: Boolean(row.partner_phone),
    meetings: Array.isArray(row.meeting_ids) ? row.meeting_ids.length : null,
    url: odooUrl('hr.applicant', row.id),
  };
}

/** The applicants on one Odoo job since a date, cached for ten minutes. */
export async function jobApplicants(jobId, since, { forceRefresh = false } = {}) {
  const key = `${jobId}|${since ?? '-'}`;
  const hit = pipelineCache.get(key);
  if (!forceRefresh && hit && Date.now() - hit.at < PIPELINE_TTL_MS) return hit.value;
  const rows = await readApplicants(jobId, since);
  const value = rows.map(shapeApplicant);
  pipelineCache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * The link each request resolves to: the confirmed link HR saved, else a
 * confident automatic match offered as a suggestion.
 */
export function resolveLink(request, links, jobs) {
  const stored = links.get(request.id);
  if (stored) {
    const job = jobs.find((item) => item.id === stored.odooJobId) ?? null;
    return job ? { job, confirmed: true, matchType: stored.matchType ?? 'manual' } : { job: null, confirmed: true, stale: true, jobId: stored.odooJobId };
  }
  const automatic = bestJob(request.title, jobs);
  return automatic ? { job: automatic.job, confirmed: false, matchType: 'automatic', confidence: automatic.score } : null;
}

/** Every request's Odoo link and the organization-wide Odoo picture. */
export async function recruitmentOdooOverview(user, { forceRefresh = false } = {}) {
  const ctx = await recruitmentContext(user, { withTeam: false });
  if (!ctx.perms.view && !ctx.perms.assign) throw forbidden();
  if (!odooConfigured()) return { configured: false, connected: false, links: {}, suggestions: {}, jobOptions: [], summary: null };
  try {
    const state = await readOdooState(forceRefresh && ctx.perms.assign);
    const includeJobs = ctx.perms.assign;
    const links = {};
    const suggestions = {};
    let confirmed = 0;
    let suggested = 0;
    let stale = 0;
    for (const request of ctx.requests) {
      const resolved = resolveLink(request, ctx.links, state.jobs);
      if (resolved?.stale) stale += 1;
      if (resolved?.job) {
        if (resolved.confirmed) confirmed += 1;
        else suggested += 1;
        links[request.id] = {
          jobId: resolved.job.id,
          name: String(resolved.job.name ?? ''),
          active: Boolean(resolved.job.active),
          confirmed: resolved.confirmed,
          matchType: resolved.matchType,
          confidence: resolved.confidence ?? 1,
          applicantCount: state.applicantsAvailable ? state.applicantByJob.get(resolved.job.id) ?? 0 : null,
          recruiter: Array.isArray(resolved.job.user_id) ? String(resolved.job.user_id[1]) : '',
          url: odooUrl('hr.job', resolved.job.id),
        };
      } else if (resolved?.stale) {
        links[request.id] = { jobId: resolved.jobId, stale: true, confirmed: true, matchType: 'manual' };
      }
      if (includeJobs && ['draft', 'pending_review', 'pending_approval', 'hiring', 'on_hold'].includes(request.status)) {
        suggestions[request.id] = suggestedJobs(request.title, state.jobs, state);
      }
    }
    return {
      configured: true,
      connected: true,
      applicantsAvailable: state.applicantsAvailable,
      summary: {
        requests: ctx.requests.length,
        confirmed,
        suggested,
        stale,
        odooJobs: state.jobs.length,
        activeOdooJobs: state.jobs.filter((job) => job.active).length,
        candidateTotal: state.candidateTotal,
        activeCandidateTotal: state.activeCandidateTotal,
        stageTotals: state.stageTotals,
      },
      links,
      suggestions,
      jobOptions: includeJobs
        ? state.jobs.map((job) => jobOption(job, state)).sort((left, right) => Number(right.active) - Number(left.active) || left.name.localeCompare(right.name, 'en'))
        : [],
    };
  } catch (error) {
    console.warn('[hr] Odoo recruitment unavailable:', error?.message ?? error);
    return { configured: true, connected: false, links: {}, suggestions: {}, jobOptions: [], summary: null };
  }
}

/** One job's Odoo pipeline, funnel and candidates, for the detail page. */
export async function requestPipeline(user, requestId, { forceRefresh = false } = {}) {
  const ctx = await recruitmentContext(user, { withTeam: false });
  const request = ctx.requests.find((item) => item.id === String(requestId));
  if (!request) throw notFound('recruitment_request_not_found');
  if (!canSee(ctx, request)) throw forbidden();
  if (!odooConfigured()) return { configured: false, connected: false, link: null };
  try {
    const state = await readOdooState();
    const resolved = resolveLink(request, ctx.links, state.jobs);
    if (!resolved?.job) {
      return {
        configured: true,
        connected: true,
        link: resolved?.stale ? { jobId: resolved.jobId, stale: true } : null,
        suggestions: ctx.perms.assign ? suggestedJobs(request.title, state.jobs, state) : [],
      };
    }
    const since = sinceFor(request);
    const [applicants, stageRows] = await Promise.all([jobApplicants(resolved.job.id, since, { forceRefresh }), stages()]);
    const order = new Map(stageRows.map((stage, index) => [stage.name, stage.sequence ?? index]));
    const byStage = new Map();
    for (const applicant of applicants) {
      const current = byStage.get(applicant.stage) ?? { stage: applicant.stage, sequence: order.get(applicant.stage) ?? 999, count: 0, active: 0 };
      current.count += 1;
      if (!applicant.refused) current.active += 1;
      byStage.set(applicant.stage, current);
    }
    const funnel = funnelCounts(applicants, ctx.policy.funnel);
    const canSeeSalary = ctx.perms.view || ctx.perms.assign;
    return {
      configured: true,
      connected: true,
      since,
      link: {
        jobId: resolved.job.id,
        name: String(resolved.job.name ?? ''),
        active: Boolean(resolved.job.active),
        confirmed: resolved.confirmed,
        matchType: resolved.matchType,
        target: Number(resolved.job.no_of_recruitment ?? resolved.job.expected_employees ?? 0) || null,
        recruiter: Array.isArray(resolved.job.user_id) ? String(resolved.job.user_id[1]) : '',
        url: odooUrl('hr.job', resolved.job.id),
        allTimeApplicants: state.applicantsAvailable ? state.applicantByJob.get(resolved.job.id) ?? 0 : null,
      },
      total: applicants.length,
      stages: [...byStage.values()].sort((left, right) => left.sequence - right.sequence || left.stage.localeCompare(right.stage)),
      funnel,
      // Only a link HR confirmed may move the accepted count or close the job.
      acceptedFromOdoo: resolved.confirmed ? funnel.accepted : null,
      candidates: applicants.slice(0, 150).map((applicant) => (canSeeSalary ? applicant : { ...applicant, expectedSalary: null, proposedSalary: null })),
    };
  } catch (error) {
    console.warn('[hr] Odoo pipeline unavailable:', error?.message ?? error);
    return { configured: true, connected: false, link: null };
  }
}

/**
 * The Odoo columns of the Active Hiring table — candidates since start and the
 * furthest stage reached — for every open job with a confirmed link. Read in
 * small parallel batches because this Odoo punishes both serial and wide.
 */
export async function pipelineSummaries(user) {
  const ctx = await recruitmentContext(user, { withTeam: false });
  if (!odooConfigured()) return { configured: false, summaries: {} };
  const open = ctx.requests.filter((request) => ['hiring', 'on_hold'].includes(request.status) && canSee(ctx, request) && ctx.links.get(request.id));
  const summaries = {};
  try {
    const stageRows = await stages();
    const order = new Map(stageRows.map((stage, index) => [stage.name, stage.sequence ?? index]));
    const queue = [...open];
    const worker = async () => {
      while (queue.length) {
        const request = queue.shift();
        const link = ctx.links.get(request.id);
        const since = sinceFor(request);
        const domain = [['job_id', '=', link.odooJobId]];
        if (since) domain.push(['create_date', '>=', `${since} 00:00:00`]);
        try {
          const groups = await readGroup('hr.applicant', domain, ['stage_id']);
          const stagesForJob = groups.map((row) => ({ stage: Array.isArray(row.stage_id) ? String(row.stage_id[1]) : 'Unstaged', count: Number(row.__count || 0) }));
          const excluded = new Set(ctx.policy.funnel.excluded ?? []);
          const reached = stagesForJob.filter((item) => item.count > 0 && !excluded.has(item.stage)).sort((left, right) => (order.get(right.stage) ?? -1) - (order.get(left.stage) ?? -1))[0];
          summaries[request.id] = { total: stagesForJob.reduce((sum, item) => sum + item.count, 0), furthestStage: reached?.stage ?? null };
        } catch {
          summaries[request.id] = null;
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    return { configured: true, summaries };
  } catch (error) {
    console.warn('[hr] Odoo pipeline summaries unavailable:', error?.message ?? error);
    return { configured: true, connected: false, summaries };
  }
}

export function clearPipelineCache() {
  pipelineCache.clear();
  stageCache = null;
}

export const __test = { funnelCounts, resolveLink, shapeApplicant };
