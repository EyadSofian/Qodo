/**
 * Job requests — the recruitment desk's source of truth.
 *
 * Every mutation here follows the same shape: load the request, check the
 * person's authority *for this request* (a department manager reviews their
 * own department only), check the state machine, write the request, append the
 * immutable row that explains the change, then tell the people it affects.
 * Nothing about a request's status, deadline or owner changes any other way —
 * there is deliberately no generic "PATCH status".
 */

import { create, find, newId, now } from '../../store.js';
import { notifyEach } from '../../notify.js';
import { PERMISSIONS } from '../../../shared/permissions.js';
import { DEPARTMENTS } from '../../../shared/departments.js';
import { capacityCheck } from '../../../shared/recruitment/capacity.js';
import { locationCode } from '../../../shared/recruitment/classification.js';
import {
  addWorkingDays,
  completionFields,
  currentDueDate,
  isIsoDate,
  RECRUITMENT_PRIORITIES,
  slaBand,
  slaSnapshot,
  validateTarget,
  workingDaysBetween,
} from '../../../shared/recruitment/sla.js';
import { COMMENT_REQUIRED, OPEN_STATUSES, approvalTimeline, transitionFor } from '../../../shared/recruitment/workflow.js';
import { CONSUMING_BATCH_STATUSES, jobEligibility } from '../../../shared/recruitment/rewards.js';
import { kpiRules } from '../../../shared/recruitment/kpi.js';
import { HRError, forbidden, notFound } from '../errors.js';
import { appendActivity, appendApproval, requestById, rowsFor, saveRequest, setOdooLink } from './data.js';
import { employeeName, recruitmentContext, userNames, usersWith } from './context.js';
import { knownPhoto, odooEmployeeFor } from '../odooPeople.js';
import { photoUrlFor } from './team.js';

const DEPARTMENT_IDS = new Set(DEPARTMENTS.map((department) => department.id));
const CURRENCIES = ['EGP', 'SAR', 'USD'];
const REASONS = ['new', 'replacement', 'expansion', 'other'];
const LIMITS = {
  title: 140,
  department: 80,
  location: 60,
  reasonNote: 500,
  responsibilities: 4000,
  tasks: 4000,
  successIndicators: 2000,
  requirements: 4000,
  presentationRequirement: 500,
  notes: 2000,
};

const text = (value, max) => String(value ?? '').trim().slice(0, max);

/* ── Visibility and authority ────────────────────────────────────── */

export function canSee(ctx, request) {
  const { perms, user } = ctx;
  if (perms.view || perms.assign) return true;
  if (request.requestedBy === user.id) return true;
  if (request.status === 'draft') return false;
  if (perms.approve) return true;
  if (perms.review && request.departmentId === user.department) return true;
  const code = ctx.employeeCode;
  return Boolean(code && (request.recruiterCode === code || (request.supportRecruiterCodes ?? []).includes(code)));
}

function canReview(ctx, request) {
  // The final approver may stand in for a department with nobody to review it.
  return ctx.perms.approve || (ctx.perms.review && request.departmentId === ctx.user.department);
}

/** What this person may do to this request, right now. The UI reads it; the handlers re-check. */
export function abilitiesFor(ctx, request) {
  const { perms, user } = ctx;
  const status = request.status;
  const requester = request.requestedBy === user.id;
  const open = OPEN_STATUSES.includes(status);
  const runs = perms.assign || perms.approve;
  const recruiter = Boolean(ctx.employeeCode && request.recruiterCode === ctx.employeeCode);
  return {
    edit: status === 'draft' ? requester || perms.assign : open && runs,
    submit: status === 'draft' && (requester || perms.assign),
    review: status === 'pending_review' && canReview(ctx, request),
    approve: status === 'pending_approval' && perms.approve,
    assign: open && perms.assign,
    changePriority: open && (runs || (status === 'draft' && requester)),
    extend: ['hiring', 'on_hold'].includes(status) && perms.extend,
    hold: status === 'hiring' && runs,
    resume: status === 'on_hold' && runs,
    cancel: open && (runs || (requester && ['draft', 'pending_review'].includes(status))),
    recordAccepted: status === 'hiring' && (perms.assign || recruiter),
    linkOdoo: open && perms.assign,
    overrideCapacity: perms.override,
    kpiReview: perms.kpiReview,
  };
}

/* ── Serialisation ───────────────────────────────────────────────── */

/** A photo URL only for someone Odoo knows and who is not known to lack a photo. */
function photoFor(ctx, profile) {
  const odoo = profile && ctx.odooIndex ? odooEmployeeFor(profile, ctx.odooIndex) : null;
  return odoo && knownPhoto(odoo.id) !== false ? photoUrlFor(profile.employeeCode) : null;
}

function recruiterSummary(ctx, code) {
  if (!code) return null;
  const member = ctx.team.find((item) => item.employeeCode === code);
  const profile = ctx.profiles.get(code);
  return {
    employeeCode: code,
    name: { ar: employeeName(ctx, code, 'ar'), en: employeeName(ctx, code, 'en') },
    title: member?.title ?? profile?.title ?? '',
    photoUrl: member ? member.photoUrl : photoFor(ctx, profile),
    onTeam: Boolean(member),
    active: profile?.status === 'active',
  };
}

export function publicRequest(ctx, request) {
  const sla = slaSnapshot(request.sla, { today: ctx.today, calendar: ctx.policy.calendar, dueSoonWorkingDays: ctx.policy.dueSoonWorkingDays });
  const link = ctx.links.get(request.id) ?? null;
  return {
    ...request,
    slaSnapshot: sla,
    recruiter: recruiterSummary(ctx, request.recruiterCode),
    supportRecruiters: (request.supportRecruiterCodes ?? []).map((code) => recruiterSummary(ctx, code)),
    openSeats: Math.max(0, (Number(request.headcount) || 0) - (Number(request.accepted) || 0)),
    odooLink: link ? { jobId: link.odooJobId, name: link.odooJobName, matchType: link.matchType, linkedAt: link.linkedAt } : null,
    abilities: abilitiesFor(ctx, request),
  };
}

/* ── Input ───────────────────────────────────────────────────────── */

function cleanSalary(input) {
  if (input === undefined) return undefined;
  if (input === null) return { min: null, max: null, currency: null, text: '' };
  if (typeof input !== 'object' || Array.isArray(input)) throw new HRError('recruitment_salary_invalid');
  const number = (value) => (value === null || value === undefined || value === '' ? null : Number(value));
  const min = number(input.min);
  const max = number(input.max);
  if ((min !== null && (!Number.isFinite(min) || min < 0)) || (max !== null && (!Number.isFinite(max) || max < 0))) {
    throw new HRError('recruitment_salary_invalid');
  }
  if (min !== null && max !== null && max < min) throw new HRError('recruitment_salary_range_inverted');
  const currency = input.currency ? String(input.currency).toUpperCase() : null;
  if (currency && !CURRENCIES.includes(currency)) throw new HRError('recruitment_salary_invalid');
  return { min, max, currency: currency ?? (min !== null || max !== null ? 'EGP' : null), text: text(input.text, 120) };
}

/**
 * The editable fields of a request, normalised. Unknown keys are ignored;
 * status, SLA, owner and history are never accepted here.
 */
export function cleanRequestInput(input, ctx) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HRError('recruitment_input_invalid');
  const out = {};
  for (const key of ['title', 'department', 'location', 'reasonNote', 'responsibilities', 'tasks', 'successIndicators', 'requirements', 'presentationRequirement', 'notes']) {
    if (input[key] !== undefined) out[key] = text(input[key], LIMITS[key]);
  }
  if (input.departmentId !== undefined) {
    if (!DEPARTMENT_IDS.has(String(input.departmentId))) throw new HRError('recruitment_department_invalid');
    out.departmentId = String(input.departmentId);
  }
  if (input.locationCode !== undefined) {
    if (input.locationCode !== null && !['EG', 'KSA'].includes(input.locationCode)) throw new HRError('recruitment_location_invalid');
    out.locationCode = input.locationCode;
  } else if (out.location !== undefined) {
    out.locationCode = locationCode(out.location);
  }
  if (input.headcount !== undefined) {
    const headcount = Number(input.headcount);
    if (!Number.isInteger(headcount) || headcount < 1 || headcount > 200) throw new HRError('recruitment_headcount_invalid');
    out.headcount = headcount;
  }
  if (input.classification !== undefined) {
    if (input.classification === null || input.classification === '') out.classification = null;
    else {
      const known = ctx.policy.classifications.find((item) => item.id === input.classification);
      if (!known || known.active === false) throw new HRError('recruitment_classification_invalid');
      out.classification = known.id;
    }
    out.classificationSource = out.classification ? 'manual' : null;
  }
  if (input.reason !== undefined) {
    if (input.reason !== '' && !REASONS.includes(input.reason)) throw new HRError('recruitment_reason_invalid');
    out.reason = input.reason;
  }
  if (input.requirementChecks !== undefined) {
    const checks = input.requirementChecks ?? {};
    out.requirementChecks = { demo: Boolean(checks.demo), technicalTest: Boolean(checks.technicalTest), offer: Boolean(checks.offer) };
  }
  const salary = cleanSalary(input.salaryRange);
  if (salary !== undefined) out.salaryRange = salary;
  if (input.interviewManager !== undefined) {
    const manager = input.interviewManager ?? {};
    out.interviewManager = { name: text(manager.name, 80), userId: manager.userId ? String(manager.userId) : null };
  }
  if (input.priority !== undefined) {
    if (input.priority !== null && !RECRUITMENT_PRIORITIES.includes(input.priority)) throw new HRError('recruitment_priority_invalid');
    out.priority = input.priority;
    out.prioritySource = input.priority ? 'manual' : null;
  }
  if (input.targetWorkingDays !== undefined) {
    out.targetWorkingDays = input.targetWorkingDays === null ? null : Number(input.targetWorkingDays);
  }
  return out;
}

/** The band default fills a missing target; a stated target must sit inside the band. */
function settleTarget(fields, ctx) {
  if (!fields.priority) return { ...fields, targetWorkingDays: fields.targetWorkingDays ?? null };
  const target = fields.targetWorkingDays ?? slaBand(fields.priority, ctx.policy.bands)?.default ?? null;
  const problem = validateTarget(fields.priority, target, ctx.policy.bands);
  if (problem) throw new HRError(problem, 400, { band: slaBand(fields.priority, ctx.policy.bands) });
  return { ...fields, targetWorkingDays: target };
}

/** What a request still needs before it can be submitted. */
export function missingForSubmit(request) {
  const missing = [];
  if (!request.title) missing.push('title');
  if (!request.department) missing.push('department');
  if (!request.location) missing.push('location');
  if (!(Number(request.headcount) >= 1)) missing.push('headcount');
  if (!request.classification) missing.push('classification');
  if (!request.reason) missing.push('reason');
  if (!request.responsibilities) missing.push('responsibilities');
  if (!request.requirements) missing.push('requirements');
  if (!request.priority) missing.push('priority');
  if (!request.targetWorkingDays) missing.push('targetWorkingDays');
  return missing;
}

/* ── Capacity ────────────────────────────────────────────────────── */

/**
 * The capacity rule, enforced. Returns the check; throws 409 with the whole
 * picture when a limit breaks and nobody authorised an override, and 403 when
 * somebody asked for an override they are not allowed to give.
 */
export function enforceCapacity(ctx, { recruiterCode, priority, requestId, override = false, overrideReason = '' }) {
  if (!recruiterCode) return { ok: true, check: null, overridden: false };
  const check = capacityCheck({ recruiterCode, priority, requests: ctx.requests, limits: ctx.policy.capacity, excludeRequestId: requestId });
  const decorated = { ...check, recruiterName: { ar: employeeName(ctx, recruiterCode, 'ar'), en: employeeName(ctx, recruiterCode, 'en') } };
  if (check.ok) return { ok: true, check: decorated, overridden: false };
  if (!override) throw new HRError('recruitment_capacity_exceeded', 409, { capacity: decorated, canOverride: ctx.perms.override });
  if (!ctx.perms.override) throw new HRError('forbidden', 403, { missing: PERMISSIONS.HR_RECRUITMENT_OVERRIDE_CAPACITY, capacity: decorated });
  if (text(overrideReason, 500).length < 10) throw new HRError('recruitment_override_reason_required', 400, { capacity: decorated });
  return { ok: true, check: decorated, overridden: true };
}

/* ── Notifications ───────────────────────────────────────────────── */

const link = (request) => `/hr/recruitment/requests/${encodeURIComponent(request.id)}`;

async function reviewersFor(ctx, request) {
  const reviewers = await usersWith(ctx.organizationId, PERMISSIONS.HR_RECRUITMENT_REVIEW, (user) => user.department === request.departmentId);
  if (reviewers.length) return reviewers.map((user) => user.id);
  return approversFor(ctx);
}

async function approversFor(ctx) {
  const chosen = ctx.settings.recruitment?.approvals?.finalApproverUserId;
  const approvers = await usersWith(ctx.organizationId, PERMISSIONS.HR_RECRUITMENT_APPROVE);
  if (chosen && approvers.some((user) => user.id === chosen)) return [chosen];
  return approvers.map((user) => user.id);
}

async function hrDeskFor(ctx) {
  return (await usersWith(ctx.organizationId, PERMISSIONS.HR_RECRUITMENT_ASSIGN)).map((user) => user.id);
}

function recruiterUserIds(ctx, request) {
  return [request.recruiterCode, ...(request.supportRecruiterCodes ?? [])]
    .map((code) => ctx.profiles.get(code)?.linkedUserId)
    .filter(Boolean);
}

async function tell(ctx, userIds, request, { type, title, body }) {
  await notifyEach([...new Set(userIds)], ctx.user.id, { type, title, body, link: link(request) });
}

/* ── Reads ───────────────────────────────────────────────────────── */

export async function listRequests(user, filters = {}) {
  const ctx = await recruitmentContext(user);
  let rows = ctx.requests.filter((request) => canSee(ctx, request));
  if (filters.scope === 'mine') rows = rows.filter((request) => request.requestedBy === user.id);
  if (filters.status) {
    const wanted = new Set(String(filters.status).split(','));
    rows = rows.filter((request) => wanted.has(request.status));
  }
  return { requests: rows.map((request) => publicRequest(ctx, request)), today: ctx.today, context: publicContext(ctx) };
}

export function publicContext(ctx) {
  return {
    today: ctx.today,
    policy: {
      bands: ctx.policy.bands,
      capacity: ctx.policy.capacity,
      classifications: ctx.policy.classifications,
      dueSoonWorkingDays: ctx.policy.dueSoonWorkingDays,
      weekend: ctx.policy.calendar.weekend,
    },
    perms: ctx.perms,
    employeeCode: ctx.employeeCode,
    team: ctx.team,
  };
}

export async function requestDetail(user, id) {
  const ctx = await recruitmentContext(user);
  const request = ctx.requests.find((item) => item.id === String(id));
  if (!request) throw notFound('recruitment_request_not_found');
  if (!canSee(ctx, request)) throw forbidden();
  const [approvals, assignments, extensions, activity] = await Promise.all([
    rowsFor('recruitmentApprovals', request.id),
    rowsFor('recruitmentAssignments', request.id),
    rowsFor('recruitmentExtensions', request.id),
    rowsFor('recruitmentActivity', request.id),
  ]);
  const people = await userNames(ctx.organizationId);
  const actor = (row) => ({ ...row, actorName: row.actorName || people.get(row.actorId) || '' });
  // Performance data about the recruiter — deductions and rewards — is for the
  // people who run or judge recruitment and for the recruiter, not for the
  // department manager who asked for the hire.
  const seesPerformance = ctx.perms.view || ctx.perms.kpiReview || ctx.perms.rewards || ctx.perms.approve || Boolean(ctx.employeeCode && request.recruiterCode === ctx.employeeCode);
  let performance = null;
  if (seesPerformance) {
    const [{ activeRewardRules, qualityFlags }, events, batches] = await Promise.all([
      import('./rewards.js'),
      find('recruitmentKpiEvents', (event) => event.requestId === request.id),
      find('recruitmentRewardBatches', (batch) => batch.organizationId === ctx.organizationId && (batch.jobIds ?? []).includes(request.id)),
    ]);
    const [rules, flags] = await Promise.all([activeRewardRules(ctx.organizationId), qualityFlags(ctx.organizationId)]);
    const ruleBook = new Map(kpiRules(ctx.settings).map((rule) => [rule.id, rule]));
    const batch = batches.find((item) => CONSUMING_BATCH_STATUSES.includes(item.status)) ?? null;
    const eligibility = jobEligibility(request, { rules, qualityFlags: flags, batchedJobIds: new Set(batch ? [request.id] : []) });
    performance = {
      kpiEvents: events
        .map((event) => ({ ...event, rule: ruleBook.get(event.rule) ?? { id: event.rule, ar: event.rule, en: event.rule }, reviewerName: event.reviewerId ? people.get(event.reviewerId) ?? '' : '' }))
        .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt))),
      reward: {
        eligible: eligibility.eligible,
        reasons: eligibility.reasons,
        category: eligibility.category,
        batch: batch ? { id: batch.id, status: batch.status, amountMin: batch.amountMin, amountMax: batch.amountMax, amountApproved: batch.amountApproved, currency: batch.currency } : null,
        rulesVersion: rules.version,
      },
    };
  }
  return {
    request: publicRequest(ctx, request),
    timeline: approvalTimeline(request, approvals).map((step) => ({ ...step, event: step.event ? actor(step.event) : null })),
    approvals: approvals.map(actor),
    assignments: assignments.map((row) => ({ ...actor(row), recruiter: recruiterSummary(ctx, row.recruiterCode), previous: recruiterSummary(ctx, row.previousRecruiterCode) })),
    extensions: extensions.map(actor),
    activity: activity.map(actor).reverse(),
    performance,
    context: publicContext(ctx),
  };
}

/* ── Writes ──────────────────────────────────────────────────────── */

async function nextReference(ctx) {
  const year = ctx.today.slice(0, 4);
  const taken = new Set(ctx.requests.map((request) => request.reference));
  let sequence = ctx.requests.filter((request) => String(request.reference ?? '').startsWith(`REQ-${year}-`)).length + 1;
  let reference = `REQ-${year}-${String(sequence).padStart(4, '0')}`;
  while (taken.has(reference)) {
    sequence += 1;
    reference = `REQ-${year}-${String(sequence).padStart(4, '0')}`;
  }
  return reference;
}

async function recordAssignment(ctx, request, { recruiterCode, previousRecruiterCode, reason, enforcement }) {
  await create('recruitmentAssignments', {
    organizationId: ctx.organizationId,
    requestId: request.id,
    recruiterCode,
    previousRecruiterCode: previousRecruiterCode ?? null,
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    reason: text(reason, 500),
    override: Boolean(enforcement?.overridden),
    overrideReason: enforcement?.overridden ? text(enforcement.overrideReason, 500) : '',
    capacity: enforcement?.check ? { current: enforcement.check.current, projected: enforcement.check.projected, limits: enforcement.check.limits, exceeded: enforcement.check.exceeded } : null,
  });
}

function requireTeamMember(ctx, recruiterCode) {
  if (!ctx.teamCodes.has(String(recruiterCode))) throw new HRError('recruitment_recruiter_not_on_team', 400);
}

export async function createRequest(user, input = {}) {
  const ctx = await recruitmentContext(user);
  if (!ctx.perms.request && !ctx.perms.assign) throw forbidden(PERMISSIONS.HR_RECRUITMENT_REQUEST);
  const fields = settleTarget(cleanRequestInput(input, ctx), ctx);
  if (!fields.title) throw new HRError('recruitment_title_required');

  const id = `rrq-${newId()}`;
  let recruiterCode = null;
  let enforcement = null;
  if (input.recruiterCode) {
    if (!ctx.perms.assign) throw forbidden(PERMISSIONS.HR_RECRUITMENT_ASSIGN);
    recruiterCode = String(input.recruiterCode);
    requireTeamMember(ctx, recruiterCode);
    enforcement = enforceCapacity(ctx, { recruiterCode, priority: fields.priority, requestId: id, override: input.override, overrideReason: input.overrideReason });
    enforcement.overrideReason = input.overrideReason;
  }

  const stamp = now();
  const request = await create('recruitmentRequests', {
    id,
    organizationId: ctx.organizationId,
    reference: await nextReference(ctx),
    source: 'qodo',
    status: 'draft',
    statusChangedAt: stamp,
    title: '',
    department: '',
    departmentId: DEPARTMENT_IDS.has(user.department) ? user.department : 'general',
    location: '',
    locationCode: null,
    headcount: 1,
    accepted: 0,
    classification: null,
    classificationSource: null,
    priority: null,
    prioritySource: null,
    reason: '',
    reasonNote: '',
    responsibilities: '',
    tasks: '',
    successIndicators: '',
    requirements: '',
    requirementChecks: { demo: false, technicalTest: false, offer: false },
    presentationRequirement: '',
    salaryRange: { min: null, max: null, currency: null, text: '' },
    targetWorkingDays: null,
    recruiterCode,
    supportRecruiterCodes: [],
    unresolvedAssignees: [],
    assignedAt: recruiterCode ? stamp : null,
    interviewManager: { name: '', userId: null },
    requestedBy: user.id,
    requestedByName: user.name,
    notes: '',
    legacyValidation: '',
    sla: null,
    revision: 1,
    ...fields,
  });
  await appendActivity({ organizationId: ctx.organizationId, requestId: id, type: 'created', actorId: user.id, meta: { reference: request.reference } });
  if (recruiterCode) {
    ctx.requests.push(request);
    await recordAssignment(ctx, request, { recruiterCode, previousRecruiterCode: null, reason: input.assignReason, enforcement });
  }
  if (input.submit) return transition(user, id, 'submit', { comment: input.comment });
  return requestDetail(user, id);
}

export async function updateRequest(user, id, input = {}) {
  const ctx = await recruitmentContext(user);
  const request = ctx.requests.find((item) => item.id === String(id));
  if (!request) throw notFound('recruitment_request_not_found');
  if (!canSee(ctx, request)) throw forbidden();
  const abilities = abilitiesFor(ctx, request);
  if (!abilities.edit) throw new HRError(OPEN_STATUSES.includes(request.status) ? 'forbidden' : 'recruitment_request_closed', OPEN_STATUSES.includes(request.status) ? 403 : 409);
  if (input.revision !== undefined && Number(input.revision) !== Number(request.revision ?? 1)) {
    throw new HRError('recruitment_request_conflict', 409, { revision: request.revision ?? 1 });
  }
  const fields = cleanRequestInput(input, ctx);
  // Priority and target on a live job move through `changePriority`, which
  // re-checks capacity and records why the clock changed.
  if (request.status !== 'draft') {
    delete fields.priority;
    delete fields.prioritySource;
    delete fields.targetWorkingDays;
  }
  if (!Object.keys(fields).length) throw new HRError('recruitment_patch_empty');
  let settled = fields;
  if (request.status === 'draft' && ('priority' in fields || 'targetWorkingDays' in fields)) {
    const priority = 'priority' in fields ? fields.priority : request.priority;
    // A new priority without a stated target starts from its own band's default.
    const target = 'targetWorkingDays' in fields ? fields.targetWorkingDays : priority === request.priority ? request.targetWorkingDays : null;
    settled = { ...fields, ...settleTarget({ priority, targetWorkingDays: target }, ctx) };
  }
  if (settled.headcount !== undefined && settled.headcount < (Number(request.accepted) || 0)) throw new HRError('recruitment_headcount_below_accepted');
  await saveRequest(request.id, { ...settled, revision: (request.revision ?? 1) + 1 });
  await appendActivity({ organizationId: ctx.organizationId, requestId: request.id, type: 'edited', actorId: user.id, meta: { fields: Object.keys(fields) } });
  return requestDetail(user, request.id);
}

/**
 * One workflow step. `action` is a key of TRANSITIONS; the reviewing and
 * approving endpoints translate their `decision` into one.
 */
export async function transition(user, id, action, { comment = '', override = false, overrideReason = '' } = {}) {
  const ctx = await recruitmentContext(user);
  const request = ctx.requests.find((item) => item.id === String(id));
  if (!request) throw notFound('recruitment_request_not_found');
  if (!canSee(ctx, request)) throw forbidden();
  const abilities = abilitiesFor(ctx, request);
  const allowed = {
    submit: abilities.submit,
    review_approve: abilities.review,
    review_return: abilities.review,
    review_reject: abilities.review,
    approve: abilities.approve,
    approve_return: abilities.approve,
    approve_reject: abilities.approve,
    hold: abilities.hold,
    resume: abilities.resume,
    cancel: abilities.cancel,
  };
  const step = transitionFor(request.status, action);
  // A step that is invalid from this status is a 409 whoever asks; a valid step
  // the person may not take is a 403. Checking the state first means an
  // approver cannot learn anything by probing statuses they cannot see.
  if (!step.ok) throw new HRError(step.error, 409, { from: request.status, action });
  if (!allowed[action]) throw forbidden();
  const note = text(comment, 2000);
  if (COMMENT_REQUIRED.has(action) && note.length < 3) throw new HRError('recruitment_comment_required');

  const stamp = now();
  const patch = { status: step.to, statusChangedAt: stamp, revision: (request.revision ?? 1) + 1 };
  const approvalRows = [];

  if (action === 'submit') {
    const missing = missingForSubmit(request);
    if (missing.length) throw new HRError('recruitment_request_incomplete', 400, { missing });
    approvalRows.push({ stage: 'request', action, decision: 'submitted', fromStatus: request.status, toStatus: step.to, comment: note });
    // A request written by somebody who reviews that department has had its
    // department review: the review is recorded as theirs, said out loud.
    if (canReview(ctx, request) && ctx.perms.review && request.departmentId === user.department) {
      patch.status = 'pending_approval';
      approvalRows.push({ stage: 'department_review', action: 'review_approve', decision: 'approved', fromStatus: 'pending_review', toStatus: 'pending_approval', comment: note || 'Submitted by the department reviewer', selfReviewed: true });
    }
  } else if (action === 'approve') {
    const problem = validateTarget(request.priority, request.targetWorkingDays, ctx.policy.bands);
    if (problem) throw new HRError(problem, 400, { band: slaBand(request.priority, ctx.policy.bands) });
    const enforcement = enforceCapacity(ctx, { recruiterCode: request.recruiterCode, priority: request.priority, requestId: request.id, override, overrideReason });
    if (enforcement.overridden) {
      await recordAssignment(ctx, request, { recruiterCode: request.recruiterCode, previousRecruiterCode: request.recruiterCode, reason: 'Capacity re-checked at final approval', enforcement: { ...enforcement, overrideReason } });
    }
    // The clock starts here and nowhere else.
    const sla = {
      startDate: ctx.today,
      targetWorkingDays: request.targetWorkingDays,
      targetSource: 'approved',
      extendedWorkingDays: 0,
      pausedWorkingDays: 0,
      pausedSince: null,
      completedAt: null,
      actualWorkingDays: null,
      slaMet: null,
    };
    sla.originalDueDate = addWorkingDays(sla.startDate, sla.targetWorkingDays, ctx.policy.calendar);
    sla.currentDueDate = sla.originalDueDate;
    patch.sla = sla;
    patch.approvedAt = stamp;
    patch.approvedBy = user.id;
    approvalRows.push({ stage: step.stage, action, decision: step.decision, fromStatus: request.status, toStatus: step.to, comment: note });
  } else if (action === 'hold') {
    if (ctx.policy.holdPausesClock && request.sla?.startDate) {
      patch.sla = { ...request.sla, pausedSince: ctx.today };
    }
    approvalRows.push({ stage: step.stage, action, decision: step.decision, fromStatus: request.status, toStatus: step.to, comment: note });
  } else if (action === 'resume') {
    if (!ctx.policy.capacity.countOnHold) {
      const enforcement = enforceCapacity(ctx, { recruiterCode: request.recruiterCode, priority: request.priority, requestId: request.id, override, overrideReason });
      if (enforcement.overridden) {
        await recordAssignment(ctx, request, { recruiterCode: request.recruiterCode, previousRecruiterCode: request.recruiterCode, reason: 'Capacity re-checked on resume', enforcement: { ...enforcement, overrideReason } });
      }
    }
    if (request.sla?.pausedSince) {
      const paused = Math.max(0, workingDaysBetween(request.sla.pausedSince, ctx.today, ctx.policy.calendar) ?? 0);
      const sla = { ...request.sla, pausedWorkingDays: (Number(request.sla.pausedWorkingDays) || 0) + paused, pausedSince: null };
      sla.currentDueDate = currentDueDate(sla, ctx.policy.calendar);
      patch.sla = sla;
    }
    approvalRows.push({ stage: step.stage, action, decision: step.decision, fromStatus: request.status, toStatus: step.to, comment: note });
  } else {
    approvalRows.push({ stage: step.stage, action, decision: step.decision, fromStatus: request.status, toStatus: step.to, comment: note });
  }

  await saveRequest(request.id, patch);
  for (const row of approvalRows) {
    await appendApproval({ organizationId: ctx.organizationId, requestId: request.id, actorId: user.id, actorName: user.name, ...row });
  }
  await appendActivity({ organizationId: ctx.organizationId, requestId: request.id, type: `status.${action}`, actorId: user.id, meta: { from: request.status, to: patch.status, comment: note || null } });

  const title = request.title || request.reference;
  if (patch.status === 'pending_review') {
    await tell(ctx, await reviewersFor(ctx, request), request, { type: 'recruitment.review_needed', title: { ar: 'طلب وظيفة بانتظار مراجعة القسم', en: 'A job request needs department review' }, body: title });
  } else if (patch.status === 'pending_approval') {
    await tell(ctx, await approversFor(ctx), request, { type: 'recruitment.approval_needed', title: { ar: 'طلب وظيفة بانتظار الاعتماد النهائي', en: 'A job request needs final approval' }, body: title });
  } else if (patch.status === 'hiring' && action === 'approve') {
    await tell(ctx, [request.requestedBy, ...recruiterUserIds(ctx, request), ...(await hrDeskFor(ctx))].filter(Boolean), request, { type: 'recruitment.approved', title: { ar: 'تم اعتماد الوظيفة وبدأ التعيين', en: 'Job approved — hiring has started' }, body: title });
  } else if (['draft', 'rejected'].includes(patch.status)) {
    await tell(ctx, [request.requestedBy].filter(Boolean), request, {
      type: patch.status === 'draft' ? 'recruitment.returned' : 'recruitment.rejected',
      title: patch.status === 'draft' ? { ar: 'أُعيد طلب الوظيفة للتعديل', en: 'Your job request was returned for changes' } : { ar: 'رُفض طلب الوظيفة', en: 'Your job request was rejected' },
      body: `${title}${note ? ` — ${note}` : ''}`,
    });
  } else if (['on_hold', 'hiring', 'cancelled'].includes(patch.status)) {
    const labels = {
      on_hold: { ar: 'تم تعليق الوظيفة', en: 'Job put on hold' },
      hiring: { ar: 'استُؤنف التعيين', en: 'Hiring resumed' },
      cancelled: { ar: 'أُلغيت الوظيفة', en: 'Job cancelled' },
    };
    await tell(ctx, [request.requestedBy, ...recruiterUserIds(ctx, request)].filter(Boolean), request, { type: `recruitment.${patch.status}`, title: labels[patch.status], body: `${title}${note ? ` — ${note}` : ''}` });
  }
  return requestDetail(user, request.id);
}

export async function review(user, id, { decision, comment }) {
  const map = { approve: 'review_approve', return: 'review_return', reject: 'review_reject' };
  if (!map[decision]) throw new HRError('recruitment_decision_invalid');
  return transition(user, id, map[decision], { comment });
}

export async function approve(user, id, { decision, comment, override, overrideReason }) {
  const map = { approve: 'approve', return: 'approve_return', reject: 'approve_reject' };
  if (!map[decision]) throw new HRError('recruitment_decision_invalid');
  return transition(user, id, map[decision], { comment, override, overrideReason });
}

export async function assign(user, id, { recruiterCode, reason = '', override = false, overrideReason = '' } = {}) {
  const ctx = await recruitmentContext(user);
  const request = ctx.requests.find((item) => item.id === String(id));
  if (!request) throw notFound('recruitment_request_not_found');
  if (!abilitiesFor(ctx, request).assign) {
    if (!OPEN_STATUSES.includes(request.status)) throw new HRError('recruitment_request_closed', 409);
    throw forbidden(PERMISSIONS.HR_RECRUITMENT_ASSIGN);
  }
  const code = recruiterCode === null ? null : String(recruiterCode ?? '');
  if (code === '') throw new HRError('recruitment_recruiter_required');
  if (code === request.recruiterCode) throw new HRError('recruitment_recruiter_unchanged', 409);
  let enforcement = null;
  if (code) {
    requireTeamMember(ctx, code);
    enforcement = enforceCapacity(ctx, { recruiterCode: code, priority: request.priority, requestId: request.id, override, overrideReason });
  }
  const stamp = now();
  await saveRequest(request.id, {
    recruiterCode: code,
    supportRecruiterCodes: (request.supportRecruiterCodes ?? []).filter((item) => item !== code),
    assignedAt: code ? stamp : null,
    assignedBy: user.id,
    revision: (request.revision ?? 1) + 1,
  });
  await recordAssignment(ctx, request, { recruiterCode: code, previousRecruiterCode: request.recruiterCode, reason, enforcement: enforcement ? { ...enforcement, overrideReason } : null });
  await appendActivity({ organizationId: ctx.organizationId, requestId: request.id, type: code ? 'assigned' : 'unassigned', actorId: user.id, meta: { recruiterCode: code, previous: request.recruiterCode, override: Boolean(enforcement?.overridden) } });
  const recruiterUser = code ? ctx.profiles.get(code)?.linkedUserId : null;
  if (recruiterUser) {
    await tell(ctx, [recruiterUser], request, { type: 'recruitment.assigned', title: { ar: 'أُسندت إليك وظيفة', en: 'A job was assigned to you' }, body: request.title || request.reference });
  }
  return requestDetail(user, request.id);
}

/**
 * Move a job between Critical, Required and Planned. Capacity is recalculated
 * *before* anything is saved; on a live job the SLA target moves with it and
 * the change is recorded with its reason, never silently.
 */
export async function changePriority(user, id, { priority, targetWorkingDays, reason = '', override = false, overrideReason = '' } = {}) {
  const ctx = await recruitmentContext(user);
  const request = ctx.requests.find((item) => item.id === String(id));
  if (!request) throw notFound('recruitment_request_not_found');
  if (!abilitiesFor(ctx, request).changePriority) {
    if (!OPEN_STATUSES.includes(request.status)) throw new HRError('recruitment_request_closed', 409);
    throw forbidden(PERMISSIONS.HR_RECRUITMENT_ASSIGN);
  }
  if (!RECRUITMENT_PRIORITIES.includes(priority)) throw new HRError('recruitment_priority_invalid');
  const target = targetWorkingDays === undefined || targetWorkingDays === null ? slaBand(priority, ctx.policy.bands)?.default : Number(targetWorkingDays);
  const problem = validateTarget(priority, target, ctx.policy.bands);
  if (problem) throw new HRError(problem, 400, { band: slaBand(priority, ctx.policy.bands) });
  if (priority === request.priority && target === request.targetWorkingDays) throw new HRError('recruitment_priority_unchanged', 409);
  const live = ['hiring', 'on_hold'].includes(request.status);
  if (live && text(reason, 500).length < 5) throw new HRError('recruitment_reason_required');

  const enforcement = enforceCapacity(ctx, { recruiterCode: request.recruiterCode, priority, requestId: request.id, override, overrideReason });
  const patch = { priority, prioritySource: 'manual', targetWorkingDays: target, revision: (request.revision ?? 1) + 1 };
  if (live && request.sla?.startDate) {
    const sla = { ...request.sla, targetWorkingDays: target };
    sla.currentDueDate = currentDueDate(sla, ctx.policy.calendar);
    patch.sla = sla;
  }
  await saveRequest(request.id, patch);
  if (enforcement.overridden) {
    await recordAssignment(ctx, request, { recruiterCode: request.recruiterCode, previousRecruiterCode: request.recruiterCode, reason: `Priority changed to ${priority}`, enforcement: { ...enforcement, overrideReason } });
  }
  await appendActivity({
    organizationId: ctx.organizationId,
    requestId: request.id,
    type: 'priority_changed',
    actorId: user.id,
    meta: { from: request.priority, to: priority, previousTarget: request.targetWorkingDays, target, reason: text(reason, 500) || null, override: enforcement.overridden },
  });
  return requestDetail(user, request.id);
}

/**
 * Extend — the final approver's dedicated power. Adds working days to the
 * allowance and writes an immutable record of the dates on both sides; the
 * original due date is never touched.
 */
export async function extend(user, id, { addWorkingDays: days, reason = '', note = '' } = {}) {
  const ctx = await recruitmentContext(user);
  const request = ctx.requests.find((item) => item.id === String(id));
  if (!request) throw notFound('recruitment_request_not_found');
  if (!ctx.perms.extend) throw forbidden(PERMISSIONS.HR_RECRUITMENT_EXTEND);
  if (!['hiring', 'on_hold'].includes(request.status) || !request.sla?.startDate) throw new HRError('recruitment_extend_not_active', 409);
  const added = Number(days);
  if (!Number.isInteger(added) || added < 1 || added > 60) throw new HRError('recruitment_extension_days_invalid');
  const why = text(reason, 500);
  if (why.length < 5) throw new HRError('recruitment_extension_reason_required');

  const before = slaSnapshot(request.sla, { today: ctx.today, calendar: ctx.policy.calendar });
  const sla = { ...request.sla, extendedWorkingDays: (Number(request.sla.extendedWorkingDays) || 0) + added };
  const after = slaSnapshot(sla, { today: ctx.today, calendar: ctx.policy.calendar });
  sla.currentDueDate = currentDueDate(sla, ctx.policy.calendar);
  const extension = await create('recruitmentExtensions', {
    organizationId: ctx.organizationId,
    requestId: request.id,
    previousDueDate: before.dueDate,
    newDueDate: after.dueDate,
    originalDueDate: before.originalDueDate,
    addedWorkingDays: added,
    reason: why,
    note: text(note, 1000),
    actorId: user.id,
    actorName: user.name,
  });
  await saveRequest(request.id, { sla, revision: (request.revision ?? 1) + 1 });
  await appendActivity({ organizationId: ctx.organizationId, requestId: request.id, type: 'extended', actorId: user.id, meta: { extensionId: extension.id, added, previousDueDate: before.dueDate, newDueDate: after.dueDate } });
  await tell(ctx, [request.requestedBy, ...recruiterUserIds(ctx, request), ...(await hrDeskFor(ctx))].filter(Boolean), request, {
    type: 'recruitment.extended',
    title: { ar: 'تم مد مهلة الوظيفة', en: 'Job deadline extended' },
    body: `${request.title || request.reference}: ${before.dueDate} → ${after.dueDate}`,
  });
  return requestDetail(user, request.id);
}

/**
 * How many candidates have been accepted. Reaching the headcount closes the job
 * — the business rule, applied here so it cannot be forgotten by a screen.
 */
export async function recordAccepted(user, id, { accepted, note = '', completedAt = null } = {}) {
  const ctx = await recruitmentContext(user);
  const request = ctx.requests.find((item) => item.id === String(id));
  if (!request) throw notFound('recruitment_request_not_found');
  if (!abilitiesFor(ctx, request).recordAccepted) {
    if (request.status !== 'hiring') throw new HRError('recruitment_not_hiring', 409);
    throw forbidden(PERMISSIONS.HR_RECRUITMENT_ASSIGN);
  }
  const count = Number(accepted);
  if (!Number.isInteger(count) || count < 0 || count > 500) throw new HRError('recruitment_accepted_invalid');
  if (count === (Number(request.accepted) || 0)) throw new HRError('recruitment_accepted_unchanged', 409);
  const closing = Number(request.headcount) > 0 && count >= Number(request.headcount);
  let closedOn = ctx.today;
  if (closing && completedAt) {
    if (!isIsoDate(completedAt) || completedAt > ctx.today || (request.sla?.startDate && completedAt < request.sla.startDate)) {
      throw new HRError('recruitment_completion_date_invalid');
    }
    closedOn = completedAt;
  }
  const patch = { accepted: count, revision: (request.revision ?? 1) + 1 };
  if (closing) {
    patch.status = 'completed';
    patch.statusChangedAt = now();
    patch.sla = request.sla?.startDate ? { ...request.sla, ...completionFields(request.sla, closedOn, ctx.policy.calendar) } : request.sla;
  }
  await saveRequest(request.id, patch);
  await appendActivity({ organizationId: ctx.organizationId, requestId: request.id, type: 'accepted_recorded', actorId: user.id, meta: { from: request.accepted ?? 0, to: count, note: text(note, 500) || null } });
  if (closing) {
    await appendApproval({ organizationId: ctx.organizationId, requestId: request.id, stage: 'hiring', action: 'complete', decision: 'completed', fromStatus: request.status, toStatus: 'completed', actorId: user.id, actorName: user.name, comment: `${count}/${request.headcount}` });
    const completed = { ...request, ...patch };
    await afterCompletion(ctx, completed);
  }
  return requestDetail(user, request.id);
}

/** What a completed job sets in motion: rewards, the new-hire handoff, and the people to tell. */
async function afterCompletion(ctx, request) {
  const [{ syncRewardBatches }, { createOnboardingHandoff }] = await Promise.all([
    import('./rewards.js'),
    import('../personnel.js'),
  ]);
  await syncRewardBatches(ctx.organizationId).catch((error) => console.error('[hr] reward sync failed', error));
  await createOnboardingHandoff({ organizationId: ctx.organizationId, request, actor: ctx.user }).catch((error) => console.error('[hr] onboarding handoff failed', error));
  const met = request.sla?.slaMet;
  await tell(ctx, [request.requestedBy, ...recruiterUserIds(ctx, request), ...(await hrDeskFor(ctx))].filter(Boolean), request, {
    type: 'recruitment.completed',
    title: met === true ? { ar: 'اكتملت الوظيفة داخل الـSLA', en: 'Job completed within SLA' } : met === false ? { ar: 'اكتملت الوظيفة بعد موعدها', en: 'Job completed after its due date' } : { ar: 'اكتملت الوظيفة', en: 'Job completed' },
    body: request.title || request.reference,
  });
}

export async function linkOdooJob(user, id, { jobId }) {
  const ctx = await recruitmentContext(user, { withTeam: false });
  const request = ctx.requests.find((item) => item.id === String(id));
  if (!request) throw notFound('recruitment_request_not_found');
  if (!ctx.perms.assign) throw forbidden(PERMISSIONS.HR_RECRUITMENT_ASSIGN);
  const { odooRecruitmentJob } = await import('../../hrRecruitmentOdoo.js');
  if (jobId === null) {
    await setOdooLink({ organizationId: ctx.organizationId, requestId: request.id, odooJobId: null, actorId: user.id });
    await appendActivity({ organizationId: ctx.organizationId, requestId: request.id, type: 'odoo_unlinked', actorId: user.id, meta: { previous: ctx.links.get(request.id)?.odooJobId ?? null } });
    return { link: null };
  }
  const numeric = Number(jobId);
  if (!Number.isInteger(numeric) || numeric <= 0) throw new HRError('hr_odoo_job_invalid');
  const job = await odooRecruitmentJob(numeric);
  if (!job) throw new HRError('hr_odoo_job_not_found', 404);
  const saved = await setOdooLink({ organizationId: ctx.organizationId, requestId: request.id, odooJobId: numeric, odooJobName: String(job.name ?? ''), matchType: 'manual', actorId: user.id });
  await appendActivity({ organizationId: ctx.organizationId, requestId: request.id, type: 'odoo_linked', actorId: user.id, meta: { jobId: numeric, name: job.name, previous: ctx.links.get(request.id)?.odooJobId ?? null } });
  return { link: { jobId: saved.odooJobId, name: saved.odooJobName, matchType: saved.matchType, linkedAt: saved.linkedAt } };
}

/** Capacity preview for the assignment dialog — the same rule the write enforces. */
export async function capacityPreview(user, { recruiterCode, priority, requestId = null }) {
  const ctx = await recruitmentContext(user);
  if (!ctx.perms.assign && !ctx.perms.view && !ctx.perms.approve) throw forbidden(PERMISSIONS.HR_RECRUITMENT_VIEW);
  const check = capacityCheck({ recruiterCode: String(recruiterCode), priority, requests: ctx.requests, limits: ctx.policy.capacity, excludeRequestId: requestId });
  return { capacity: { ...check, recruiterName: { ar: employeeName(ctx, recruiterCode, 'ar'), en: employeeName(ctx, recruiterCode, 'en') } }, canOverride: ctx.perms.override };
}

export { requestById };
