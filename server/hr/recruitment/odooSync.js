/**
 * The recruitment desk: Odoo's published jobs, and the requests management
 * approved.
 *
 * Two decisions by the owner on 2026-10-05, in this order:
 *
 *  1. The recruitment workbook is over. The desk shows what Odoo publishes
 *     for Egypt - Engoaad, owned by whoever owns it in Odoo. Workbook rows are
 *     archived (never deleted — the row, its activity and its link stay).
 *  2. The request flow of the original brief stays: a manager asks for a
 *     hire, the department manager reviews, the final approver approves, and
 *     *that* is when work starts and the clock is counted.
 *
 * So a published job has exactly one request on the desk:
 *
 *   - the approved Qodo request HR confirmed against it, when there is one.
 *     That request is Qodo's in full — who recruits, the priority, the clock
 *     from the approval day — and Odoo changes none of it; or
 *   - failing that, a request this sync keeps for it (`source: 'odoo'`,
 *     `ODOO-<job id>`): a job somebody published without going through the
 *     request flow. It still has to be worked and timed, so it takes Odoo's
 *     owner and Odoo's schedule — HR keeps an Active Date and a Hiring Period
 *     (15 / 30 / 45 / 60) on each job; the clock starts on the Active Date and
 *     runs that many *working* days (the approved classification table counts
 *     neither Friday nor Saturday), and the period names the priority. Odoo's
 *     schedule is re-applied only when Odoo's own values move, so a change
 *     made in Qodo stands until then. The screens mark such a job as having
 *     no approved request.
 *
 * Requests made in Qodo are never archived here, whatever their stage: a
 * draft, one waiting for approval, or one approved and not published yet (it
 * is on its recruiter's desk and the screens say it is not in Odoo yet).
 *
 * The sync never acts on a failed or empty read: an Odoo outage must not
 * archive the desk. A job that drops out and comes back gets its own request
 * back, clock and history intact.
 */

import { create, find, getStore } from '../../store.js';
import { classificationFromTitle } from '../../../shared/recruitment/classification.js';
import { addWorkingDays, currentDueDate, localDay, priorityForHiringPeriod } from '../../../shared/recruitment/sla.js';
import { recruitmentPolicy } from '../../../shared/recruitment/settings.js';
import { OPEN_STATUSES } from '../../../shared/recruitment/workflow.js';
import { organizationState } from '../../hrModule.js';
import { hrSettingsFor } from '../settings.js';
import { appendActivity, odooLinksFor, requestsFor, setOdooLink, stableId } from './data.js';
import { departmentIdFor } from './migration.js';
import { publishedJobs, recruitmentSourceIsOdoo } from './odooJobs.js';

/** A workbook row: the workbook no longer feeds recruitment. */
export const ARCHIVE_NOT_FROM_ODOO = 'not_from_odoo';
/** An Odoo-kept request whose job is no longer published. */
export const ARCHIVE_UNPUBLISHED = 'odoo_unpublished';
/** An Odoo-kept request whose job now has an approved Qodo request. */
export const ARCHIVE_REPLACED = 'replaced_by_approved_request';
/** The stages of a Qodo request that speak for a published job. */
const CLAIMING_STATUSES = ['hiring', 'on_hold', 'completed'];

export const odooRequestId = (organizationId, jobId) => stableId('rrq-odoo', organizationId, String(jobId));

/** Key order survives neither jsonb nor a spread, so objects are compared canonically. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

/** What Odoo decides about a request on every sync, as the fields Qodo stores. */
function mirrored(job, recruiterCode, request = null) {
  const fields = {
    title: job.name,
    department: job.department || '',
    departmentId: departmentIdFor(job.department),
    headcount: job.toRecruit,
    recruiterCode,
    unresolvedAssignees: job.recruiter && !recruiterCode ? [job.recruiter.name] : [],
  };
  if (job.salaryFrom || job.salaryTo) {
    // Odoo holds the figures only; the currency stays whatever Qodo knows.
    fields.salaryRange = { min: job.salaryFrom ?? null, max: job.salaryTo ?? null, currency: request?.salaryRange?.currency ?? null, text: request?.salaryRange?.text ?? '' };
  }
  return fields;
}

/**
 * How a Hiring Period becomes a due date. It was calendar days for one deploy;
 * naming the rule lets a job scheduled under the old reading be re-dated once.
 */
const SCHEDULE_RULE = 'working_days';

/** What Qodo last saw in Odoo — the values a later change is measured against. */
function seen(job, previous = {}) {
  return {
    ...previous,
    jobId: job.id,
    scheduleRule: SCHEDULE_RULE,
    activeDate: job.activeDate ?? null,
    hiringPeriod: job.hiringPeriodDays ?? null,
    seniority: job.seniority ?? null,
    status: job.recruitmentStatus ?? null,
    publishedDate: job.publishedDate ?? null,
  };
}

/**
 * Odoo's Active Date and Hiring Period as Qodo's priority and clock, or null
 * when the job has no period. `sla` is the clock already running, whose
 * extensions and holds are kept.
 */
export function scheduleFromOdoo(job, { calendar, fallbackStart, sla = null }) {
  const period = job.hiringPeriodDays;
  if (!period) return null;
  const startDate = job.activeDate ?? fallbackStart;
  const target = period;
  const next = {
    extendedWorkingDays: 0,
    pausedWorkingDays: 0,
    pausedSince: null,
    completedAt: null,
    actualWorkingDays: null,
    slaMet: null,
    ...(sla ?? {}),
    startDate,
    targetWorkingDays: target,
    targetSource: 'odoo_hiring_period',
    originalDueDate: addWorkingDays(startDate, target, calendar),
  };
  next.currentDueDate = currentDueDate(next, calendar);
  const priority = priorityForHiringPeriod(period);
  return { priority, prioritySource: priority ? 'odoo_hiring_period' : null, targetWorkingDays: target, hiringPeriodDays: period, sla: next };
}

function newRequest({ organizationId, job, recruiterCode, today, stamp, calendar }) {
  const classification = classificationFromTitle(job.name);
  const schedule = scheduleFromOdoo(job, { calendar, fallbackStart: today });
  return {
    id: odooRequestId(organizationId, job.id),
    organizationId,
    reference: `ODOO-${job.id}`,
    source: 'odoo',
    status: 'hiring',
    statusChangedAt: stamp,
    salaryRange: { min: null, max: null, currency: null, text: '' },
    ...mirrored(job, recruiterCode),
    location: 'Egypt',
    locationCode: 'EG',
    accepted: 0,
    classification,
    classificationSource: classification ? 'derived_from_title' : null,
    reason: '',
    reasonNote: '',
    responsibilities: '',
    tasks: '',
    successIndicators: '',
    requirements: '',
    requirementChecks: { demo: false, technicalTest: false, offer: false },
    presentationRequirement: '',
    supportRecruiterCodes: [],
    assignedAt: recruiterCode ? stamp : null,
    interviewManager: { name: '', userId: null },
    requestedBy: null,
    requestedByName: 'Odoo',
    notes: '',
    legacyValidation: '',
    // No period in Odoo means no priority and no clock yet; `firstSeen` is the
    // day a clock set here later is dated from.
    priority: null,
    prioritySource: null,
    targetWorkingDays: null,
    hiringPeriodDays: null,
    sla: null,
    ...(schedule ?? {}),
    odoo: seen(job, { firstSeen: today }),
    revision: 1,
  };
}

/**
 * What a sync would do — pure, so the rules are tested without Odoo or a
 * store. `requests` includes archived ones; `links` is requestId → link row.
 */
export function planOdooSync({ organizationId, snapshot, requests, links, profiles, today, calendar = {}, stamp = new Date().toISOString() }) {
  const plan = { skipped: null, create: [], restore: [], update: [], archive: [] };
  if (!snapshot?.connected) return { ...plan, skipped: 'odoo_unavailable' };
  if (!snapshot.jobs.length) return { ...plan, skipped: 'no_published_jobs' };

  const codeByOdooUser = new Map();
  for (const member of snapshot.team ?? []) {
    // Only somebody the HR file has, and has as active, can own a job on the desk.
    if (member.employeeCode && profiles.get(member.employeeCode)?.status === 'active') codeByOdooUser.set(member.id, member.employeeCode);
  }
  const byId = new Map(requests.map((request) => [request.id, request]));
  // An approved Qodo request HR confirmed against a published job speaks for
  // that job — also once it is completed, so a filled job that stays published
  // does not come back as new work. A workbook row never does.
  const claimed = new Map();
  for (const request of requests) {
    const jobId = Number(links.get(request.id)?.odooJobId);
    if (!jobId || request.archivedAt || request.source !== 'qodo' || !CLAIMING_STATUSES.includes(request.status)) continue;
    if (!claimed.has(jobId)) claimed.set(jobId, request);
  }

  const kept = new Set();
  for (const job of snapshot.jobs) {
    const own = byId.get(odooRequestId(organizationId, job.id)) ?? null;
    if (claimed.has(job.id)) {
      // Qodo's request stands as approved; the one kept for the job steps aside.
      if (own && !own.archivedAt && own.status !== 'completed') plan.archive.push({ id: own.id, reason: ARCHIVE_REPLACED });
      if (own) kept.add(own.id);
      continue;
    }
    const recruiterCode = (job.recruiter && codeByOdooUser.get(job.recruiter.id)) || null;
    if (!own) {
      plan.create.push({ job, document: newRequest({ organizationId, job, recruiterCode, today, stamp, calendar }) });
      continue;
    }
    kept.add(own.id);
    if (own.archivedAt) plan.restore.push({ id: own.id, job });
    const wanted = mirrored(job, recruiterCode, own);
    const patch = {};
    for (const [key, value] of Object.entries(wanted)) {
      if (canonical(own[key]) !== canonical(value)) patch[key] = value;
    }
    if ('recruiterCode' in patch) patch.assignedAt = recruiterCode ? stamp : null;
    const tracked = seen(job, own.odoo ?? { firstSeen: today });
    if (canonical(own.odoo) !== canonical(tracked)) {
      patch.odoo = tracked;
      // The schedule follows Odoo when Odoo's own values moved — not on every
      // tick, so a priority or deadline changed in Qodo is not undone.
      const redated = (own.odoo?.scheduleRule ?? null) !== tracked.scheduleRule && own.prioritySource !== 'manual';
      const moved = redated || (own.odoo?.activeDate ?? null) !== tracked.activeDate || (own.odoo?.hiringPeriod ?? null) !== tracked.hiringPeriod;
      if (moved && OPEN_STATUSES.includes(own.status)) {
        Object.assign(patch, scheduleFromOdoo(job, { calendar, fallbackStart: tracked.firstSeen ?? today, sla: own.sla }) ?? {});
      }
    }
    if (Object.keys(patch).length) plan.update.push({ id: own.id, job, patch, previousRecruiterCode: own.recruiterCode ?? null });
  }

  for (const request of requests) {
    if (kept.has(request.id)) continue;
    if (request.source === 'qodo') {
      // The first Odoo-only deploy archived Qodo's own requests too; they come back.
      if (request.archivedAt && request.archiveReason === ARCHIVE_NOT_FROM_ODOO) plan.restore.push({ id: request.id, job: null });
      continue;
    }
    if (request.archivedAt) continue;
    if (request.source === 'odoo') {
      // A job closed under this regime is history its recruiter earned.
      if (request.status !== 'completed') plan.archive.push({ id: request.id, reason: ARCHIVE_UNPUBLISHED });
      continue;
    }
    plan.archive.push({ id: request.id, reason: ARCHIVE_NOT_FROM_ODOO });
  }
  return plan;
}

let running = false;

/** Bring one organization's desk in line with Odoo. Idempotent; safe to run on every tick. */
export async function syncOdooJobs(organizationId, { snapshot = null } = {}) {
  if (!recruitmentSourceIsOdoo() || running) return null;
  running = true;
  try {
    const read = snapshot ?? (await publishedJobs({ refresh: true }));
    const [state, requests, links, { settings }] = await Promise.all([
      organizationState(organizationId),
      requestsFor(organizationId, { includeArchived: true }),
      odooLinksFor(organizationId),
      hrSettingsFor(organizationId),
    ]);
    const stamp = new Date().toISOString();
    const plan = planOdooSync({ organizationId, snapshot: read, requests, links, profiles: state.profiles, today: localDay(new Date(), 'Africa/Cairo'), calendar: recruitmentPolicy(settings).calendar, stamp });
    if (plan.skipped) return { skipped: plan.skipped, created: 0, restored: 0, updated: 0, archived: 0 };

    const store = await getStore();
    const revisionOf = new Map(requests.map((request) => [request.id, request.revision ?? 1]));
    const bump = (id) => {
      revisionOf.set(id, (revisionOf.get(id) ?? 1) + 1);
      return revisionOf.get(id);
    };
    const link = (requestId, job) => setOdooLink({ organizationId, requestId, odooJobId: job.id, odooJobName: job.name, matchType: 'odoo_source', actorId: null });

    for (const { job, document } of plan.create) {
      await create('recruitmentRequests', document);
      await link(document.id, job);
      await appendActivity({ organizationId, requestId: document.id, type: 'created_from_odoo', meta: { jobId: job.id, name: job.name, recruiter: job.recruiter?.name ?? null, recruiterCode: document.recruiterCode, activeDate: job.activeDate ?? null, hiringPeriod: job.hiringPeriodDays ?? null } });
    }
    for (const { id, job } of plan.restore) {
      await store.update('recruitmentRequests', id, { archivedAt: null, archivedBy: null, archiveReason: null, revision: bump(id) });
      await appendActivity({ organizationId, requestId: id, type: 'restored', meta: job ? { reason: 'odoo_published_again', jobId: job.id } : { reason: 'qodo_request_kept' } });
    }
    for (const { id, job, patch, previousRecruiterCode } of plan.update) {
      await store.update('recruitmentRequests', id, { ...patch, revision: bump(id) });
      if (!links.has(id) || Number(links.get(id).odooJobId) !== job.id) await link(id, job);
      await appendActivity({ organizationId, requestId: id, type: 'odoo_synced', meta: { jobId: job.id, fields: Object.keys(patch), ...('recruiterCode' in patch ? { previousRecruiterCode, recruiterCode: patch.recruiterCode } : {}), ...(patch.sla ? { activeDate: job.activeDate ?? null, hiringPeriod: job.hiringPeriodDays ?? null, dueDate: patch.sla.currentDueDate, priority: patch.priority } : {}) } });
    }
    for (const { id, reason } of plan.archive) {
      await store.update('recruitmentRequests', id, { archivedAt: stamp, archivedBy: null, archiveReason: reason, revision: bump(id) });
      await appendActivity({ organizationId, requestId: id, type: 'archived', meta: { reason } });
    }
    return { skipped: null, created: plan.create.length, restored: plan.restore.length, updated: plan.update.length, archived: plan.archive.length };
  } finally {
    running = false;
  }
}

/** Every organization, for boot and the scheduler. Never throws. */
export async function syncOdooJobsEverywhere() {
  if (!recruitmentSourceIsOdoo()) return;
  let snapshot;
  try {
    snapshot = await publishedJobs({ refresh: true });
  } catch (error) {
    console.warn('[hr] Odoo job sync skipped — Odoo unavailable:', error?.message ?? error);
    return;
  }
  for (const organization of await find('organizations')) {
    try {
      const result = await syncOdooJobs(organization.id, { snapshot });
      if (result && (result.created || result.restored || result.archived || result.updated)) {
        console.log(`[hr] Odoo job sync for ${organization.id}: ${result.created} new, ${result.restored} back, ${result.updated} updated, ${result.archived} archived`);
      } else if (result?.skipped) {
        console.warn(`[hr] Odoo job sync for ${organization.id} skipped: ${result.skipped}`);
      }
    } catch (error) {
      console.error('[hr] Odoo job sync failed', error);
    }
  }
}
