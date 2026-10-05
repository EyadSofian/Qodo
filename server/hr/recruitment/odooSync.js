/**
 * Odoo is the only source of recruitment jobs.
 *
 * The owner's decision (2026-10-05): the recruitment workbook is over, and the
 * desk carries exactly what Odoo publishes for Egypt - Engoaad — one Qodo
 * request per published job, owned by whoever owns it in Odoo. Nothing else
 * is on the desk: workbook rows, requests typed into Qodo and jobs Odoo no
 * longer publishes are archived (never deleted — the row, its activity and
 * its link stay, and Settings can still list them).
 *
 * Odoo says which jobs exist, what they are called, how many seats, who owns
 * them, and their schedule: HR keeps an Active Date and a Hiring Period (15 /
 * 30 / 45 / 60 days) on each job. The clock starts on the Active Date, the
 * job is due that many calendar days later (the next working day when that
 * lands on a weekend), and the period names the priority — 15 Critical, 30
 * Required, 45 and 60 Planned. Whenever either value changes in Odoo, Qodo
 * follows; a change made in Qodo stands until Odoo's value changes again.
 * Extensions and holds are Qodo's and are kept on top of Odoo's dates.
 *
 * Qodo still owns what Odoo has no field for: holds, extensions, hires
 * recorded, KPI and rewards. A job Odoo gives no period to arrives with no
 * priority and no clock until somebody sets one here.
 *
 * The sync never acts on a failed or empty read: an Odoo outage must not
 * archive the desk. A job that drops out and comes back gets its own request
 * back, clock and history intact.
 */

import { create, find, getStore } from '../../store.js';
import { classificationFromTitle } from '../../../shared/recruitment/classification.js';
import { addCalendarDays, currentDueDate, localDay, nextWorkingDayOnOrAfter, priorityForHiringPeriod, workingDaysBetween } from '../../../shared/recruitment/sla.js';
import { recruitmentPolicy } from '../../../shared/recruitment/settings.js';
import { COMMITTED_STATUSES, OPEN_STATUSES } from '../../../shared/recruitment/workflow.js';
import { organizationState } from '../../hrModule.js';
import { hrSettingsFor } from '../settings.js';
import { appendActivity, odooLinksFor, requestsFor, setOdooLink, stableId } from './data.js';
import { departmentIdFor } from './migration.js';
import { publishedJobs, recruitmentSourceIsOdoo } from './odooJobs.js';

export const ARCHIVE_NOT_FROM_ODOO = 'not_from_odoo';
export const ARCHIVE_UNPUBLISHED = 'odoo_unpublished';

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

/** What Qodo last saw in Odoo — the values a later change is measured against. */
function seen(job, previous = {}) {
  return {
    ...previous,
    jobId: job.id,
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
  const due = nextWorkingDayOnOrAfter(addCalendarDays(startDate, period), calendar);
  const target = Math.max(1, workingDaysBetween(startDate, due, calendar) ?? 0);
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
    originalDueDate: due,
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
  // An approved Qodo request HR already confirmed against a published job is
  // that job's request. A workbook row never is: the workbook is over.
  const adopted = new Map();
  for (const request of requests) {
    const jobId = Number(links.get(request.id)?.odooJobId);
    if (!jobId || request.archivedAt || request.source !== 'qodo' || !COMMITTED_STATUSES.includes(request.status)) continue;
    if (!adopted.has(jobId)) adopted.set(jobId, request);
  }

  const kept = new Set();
  for (const job of snapshot.jobs) {
    const recruiterCode = (job.recruiter && codeByOdooUser.get(job.recruiter.id)) || null;
    const own = byId.get(odooRequestId(organizationId, job.id)) ?? null;
    const request = own && !(own.archivedAt && own.archiveReason !== ARCHIVE_UNPUBLISHED) ? own : adopted.get(job.id) ?? null;
    if (!request) {
      plan.create.push({ job, document: newRequest({ organizationId, job, recruiterCode, today, stamp, calendar }) });
      continue;
    }
    kept.add(request.id);
    if (request.archivedAt) plan.restore.push({ id: request.id, job });
    const wanted = mirrored(job, recruiterCode, request);
    const patch = {};
    for (const [key, value] of Object.entries(wanted)) {
      if (canonical(request[key]) !== canonical(value)) patch[key] = value;
    }
    if ('recruiterCode' in patch) patch.assignedAt = recruiterCode ? stamp : null;
    const tracked = seen(job, request.odoo ?? { firstSeen: today });
    if (canonical(request.odoo) !== canonical(tracked)) {
      patch.odoo = tracked;
      // The schedule follows Odoo when Odoo's own values moved — not on every
      // tick, so a priority or deadline changed in Qodo is not undone.
      const moved = (request.odoo?.activeDate ?? null) !== tracked.activeDate || (request.odoo?.hiringPeriod ?? null) !== tracked.hiringPeriod;
      if (moved && OPEN_STATUSES.includes(request.status)) {
        Object.assign(patch, scheduleFromOdoo(job, { calendar, fallbackStart: tracked.firstSeen ?? today, sla: request.sla }) ?? {});
      }
    }
    if (Object.keys(patch).length) plan.update.push({ id: request.id, job, patch, previousRecruiterCode: request.recruiterCode ?? null });
  }

  for (const request of requests) {
    if (request.archivedAt || kept.has(request.id)) continue;
    // A job closed under this regime is history its recruiter earned.
    if (request.source === 'odoo' && request.status === 'completed') continue;
    plan.archive.push({ id: request.id, reason: request.source === 'odoo' ? ARCHIVE_UNPUBLISHED : ARCHIVE_NOT_FROM_ODOO });
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
      await appendActivity({ organizationId, requestId: id, type: 'restored', meta: { reason: 'odoo_published_again', jobId: job.id } });
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
