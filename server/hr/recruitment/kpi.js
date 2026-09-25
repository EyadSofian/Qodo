/**
 * Recruitment KPI — the stored evidence behind every point.
 *
 * Scores are derived on read from `shared/recruitment/kpi.js`; what is stored
 * is the evidence: one `recruitmentKpiEvents` row per deduction, carrying the
 * employee, the job, the category, the rule, the points, the reason, the
 * reviewer and the date. A deduction is never edited or deleted. A reviewer
 * who finds it wrong voids it with a reason, and the void is itself recorded.
 */

import { createIfAbsent, find, findOne, getStore, now } from '../../store.js';
import { PERMISSIONS } from '../../../shared/permissions.js';
import { organizationOf } from '../../../shared/organization.js';
import { KPI_PERIOD, automaticEventKey, kpiRules, recruiterKpi } from '../../../shared/recruitment/kpi.js';
import { isIsoDate, workingDaysBetween } from '../../../shared/recruitment/sla.js';
import { HRError, forbidden, notFound } from '../errors.js';
import { hasRecruitmentAccess, recruitmentContext, userNames } from './context.js';
import { appendActivity, stableId } from './data.js';
import { existingFields, searchRead } from '../../odoo.js';
import { jobApplicants } from './odooPipeline.js';

async function eventsFor(organizationId) {
  return find('recruitmentKpiEvents', (event) => organizationOf(event) === organizationId);
}

function periodOrCurrent(period, today) {
  const value = String(period || today.slice(0, 7));
  if (!KPI_PERIOD.test(value)) throw new HRError('kpi_period_invalid');
  return value;
}

function mayRead(ctx, employeeCode) {
  return ctx.perms.view || ctx.perms.kpiReview || ctx.perms.approve || ctx.employeeCode === employeeCode;
}

/** Every team member's month, for the KPI page and the recruiter cards. */
export async function kpiOverview(user, { period } = {}) {
  const ctx = await recruitmentContext(user);
  if (!hasRecruitmentAccess(ctx)) throw forbidden(PERMISSIONS.HR_RECRUITMENT_VIEW);
  const month = periodOrCurrent(period, ctx.today);
  const events = await eventsFor(ctx.organizationId);
  const members = ctx.team.filter((member) => mayRead(ctx, member.employeeCode));
  return {
    period: month,
    categories: recruiterKpi({ employeeCode: '', period: month, requests: [], events: [], settings: ctx.settings, today: ctx.today }).categories.map(({ id, ar, en, weight, mode }) => ({ id, ar, en, weight, mode })),
    recruiters: members.map((member) => {
      const kpi = recruiterKpi({ employeeCode: member.employeeCode, period: month, requests: ctx.requests, events, settings: ctx.settings, today: ctx.today, calendar: ctx.policy.calendar });
      return {
        member,
        percent: kpi.percent,
        score: kpi.score,
        measuredWeight: kpi.measuredWeight,
        complete: kpi.complete,
        categories: kpi.categories.map(({ id, weight, score, measured, deducted, events: rows }) => ({ id, weight, score, measured, deducted, deductions: rows.filter((row) => !row.voidedAt).length })),
      };
    }),
    rules: kpiRules(ctx.settings).filter((rule) => rule.enabled),
    canReview: ctx.perms.kpiReview,
  };
}

/** "Why this score?" — every category, every job and every deduction behind it. */
export async function kpiDetail(user, employeeCode, { period } = {}) {
  const ctx = await recruitmentContext(user);
  const code = String(employeeCode);
  if (!mayRead(ctx, code)) throw forbidden(PERMISSIONS.HR_RECRUITMENT_VIEW);
  const member = ctx.team.find((item) => item.employeeCode === code) ?? null;
  if (!member && !ctx.profiles.has(code)) throw notFound('hr_employee_not_found');
  const month = periodOrCurrent(period, ctx.today);
  const [events, names] = await Promise.all([eventsFor(ctx.organizationId), userNames(ctx.organizationId)]);
  const kpi = recruiterKpi({ employeeCode: code, period: month, requests: ctx.requests, events, settings: ctx.settings, today: ctx.today, calendar: ctx.policy.calendar });
  const titles = new Map(ctx.requests.map((request) => [request.id, { title: request.title, reference: request.reference }]));
  for (const category of kpi.categories) {
    category.events = category.events.map((event) => ({
      ...event,
      reviewerName: event.reviewerId ? names.get(event.reviewerId) ?? '' : '',
      voidedByName: event.voidedBy ? names.get(event.voidedBy) ?? '' : '',
      job: event.requestId ? titles.get(event.requestId) ?? null : null,
    }));
  }
  return { member, kpi, canReview: ctx.perms.kpiReview && ctx.employeeCode !== code };
}

/**
 * Record one deduction. Reviewer, reason and rule are mandatory; a job is
 * mandatory for job rules; the optional presentation rule also requires the
 * job's own request to have defined the requirement in writing. The client
 * sends an idempotency key, so a double-click is one deduction, not two.
 */
export async function createKpiEvent(user, input = {}) {
  const ctx = await recruitmentContext(user);
  if (!ctx.perms.kpiReview) throw forbidden(PERMISSIONS.HR_RECRUITMENT_KPI_REVIEW);
  const employeeCode = String(input.employeeCode ?? '');
  if (!ctx.teamCodes.has(employeeCode)) throw new HRError('kpi_employee_not_on_team');
  if (ctx.employeeCode && ctx.employeeCode === employeeCode) throw new HRError('kpi_self_review_forbidden', 403);
  const rule = kpiRules(ctx.settings).find((item) => item.id === input.rule);
  if (!rule || !rule.enabled) throw new HRError('kpi_rule_unknown');
  if (rule.category === 'hiring_target') throw new HRError('kpi_rule_unknown');

  const reason = String(input.reason ?? '').trim().slice(0, 1500);
  const minimum = rule.minReasonLength ?? 10;
  if (reason.length < minimum) throw new HRError('kpi_reason_required', 400, { minLength: minimum });

  let requestId = null;
  if (rule.requiresJob || input.requestId) {
    const request = ctx.requests.find((item) => item.id === String(input.requestId ?? ''));
    if (!request) throw new HRError('kpi_job_required');
    const owns = request.recruiterCode === employeeCode || (request.supportRecruiterCodes ?? []).includes(employeeCode);
    if (!owns) throw new HRError('kpi_job_not_owned');
    if (rule.requiresJobField && !String(request[rule.requiresJobField] ?? '').trim()) {
      throw new HRError('kpi_job_requirement_not_defined', 400, { field: rule.requiresJobField });
    }
    requestId = request.id;
  }

  const occurredOn = input.occurredOn ? String(input.occurredOn) : ctx.today;
  if (!isIsoDate(occurredOn) || occurredOn > ctx.today || (workingDaysBetween(occurredOn, ctx.today) ?? 0) > 130) {
    throw new HRError('kpi_date_invalid');
  }
  const count = input.count === undefined ? 1 : Number(input.count);
  if (!Number.isInteger(count) || count < 1 || count > 5) throw new HRError('kpi_count_invalid');
  const key = String(input.idempotencyKey ?? '').trim();
  if (!/^[\w-]{8,80}$/.test(key)) throw new HRError('kpi_idempotency_key_required');

  const result = await createIfAbsent('recruitmentKpiEvents', {
    id: stableId('kpe', ctx.organizationId, user.id, key),
    organizationId: ctx.organizationId,
    employeeCode,
    requestId,
    period: occurredOn.slice(0, 7),
    occurredOn,
    category: rule.category,
    rule: rule.id,
    points: rule.points,
    count,
    deduction: rule.points * count,
    reason,
    evidence: String(input.evidence ?? '').trim().slice(0, 1500),
    note: String(input.note ?? '').trim().slice(0, 1500),
    reviewerId: user.id,
    source: 'manual',
    voidedAt: null,
    voidedBy: null,
    voidReason: '',
  });
  if (result.created && requestId) {
    await appendActivity({ organizationId: ctx.organizationId, requestId, type: 'kpi_deduction', actorId: user.id, meta: { eventId: result.doc.id, rule: rule.id, deduction: result.doc.deduction, employeeCode } });
  }
  return { event: result.doc, duplicate: !result.created };
}

export async function voidKpiEvent(user, id, { reason } = {}) {
  const ctx = await recruitmentContext(user, { withTeam: false });
  if (!ctx.perms.kpiReview) throw forbidden(PERMISSIONS.HR_RECRUITMENT_KPI_REVIEW);
  const event = await findOne('recruitmentKpiEvents', (row) => row.id === String(id) && organizationOf(row) === ctx.organizationId);
  if (!event) throw notFound('kpi_event_not_found');
  if (event.voidedAt) throw new HRError('kpi_event_already_void', 409);
  const why = String(reason ?? '').trim().slice(0, 1000);
  if (why.length < 10) throw new HRError('kpi_reason_required', 400, { minLength: 10 });
  const updated = await (await getStore()).update('recruitmentKpiEvents', event.id, { voidedAt: now(), voidedBy: user.id, voidReason: why });
  if (event.requestId) {
    await appendActivity({ organizationId: ctx.organizationId, requestId: event.requestId, type: 'kpi_deduction_voided', actorId: user.id, meta: { eventId: event.id, reason: why } });
  }
  return { event: updated };
}

/* ── Automatic checks ────────────────────────────────────────────── */

/**
 * The checks the database can answer, raised by the clock once per finding.
 * The deterministic id is the finding's own identity — rule, job, applicant —
 * so running this every day (or twice after a restart) never deducts twice.
 */
export async function runAutomaticKpiChecks(organizationId, { ctx, withOdoo = true } = {}) {
  const context = ctx;
  const rules = new Map(kpiRules(context.settings).filter((rule) => rule.enabled && rule.automatic).map((rule) => [rule.id, rule]));
  const raised = [];
  const raise = async ({ rule, request, applicantId = null, reason, evidence }) => {
    const definition = rules.get(rule);
    if (!definition || !request.recruiterCode) return;
    const key = automaticEventKey({ rule, requestId: request.id, applicantId });
    const result = await createIfAbsent('recruitmentKpiEvents', {
      id: stableId('kpa', organizationId, key),
      organizationId,
      employeeCode: request.recruiterCode,
      requestId: request.id,
      period: context.today.slice(0, 7),
      occurredOn: context.today,
      category: definition.category,
      rule,
      points: definition.points,
      count: 1,
      deduction: definition.points,
      reason,
      evidence,
      note: '',
      reviewerId: null,
      source: 'automatic',
      dedupeKey: key,
      voidedAt: null,
      voidedBy: null,
      voidReason: '',
    });
    if (result.created) raised.push(result.doc);
  };

  const live = context.requests.filter((request) => request.status === 'hiring' && request.source === 'qodo');
  for (const request of live) {
    const waited = request.sla?.startDate ? workingDaysBetween(request.sla.startDate, context.today, context.policy.calendar) ?? 0 : 0;
    if (!context.links.get(request.id) && waited > (context.policy.waits.odooLinkWorkingDays ?? 2) + 3) {
      await raise({
        rule: 'odoo_job_not_linked',
        request,
        reason: `Hiring for ${waited} working days without a linked Odoo job.`,
        evidence: `SLA start ${request.sla?.startDate}`,
      });
    }
  }

  if (withOdoo) {
    const candidates = context.requests.filter((request) => ['hiring', 'completed'].includes(request.status) && request.source === 'qodo' && context.links.get(request.id));
    for (const request of candidates) {
      const link = context.links.get(request.id);
      let applicants;
      try {
        applicants = await jobApplicants(link.odooJobId, request.sla?.startDate ?? null);
      } catch {
        continue;
      }
      const funnel = context.policy.funnel;
      // `attachment_number` is computed per row in Python, so it is read only
      // for the handful of accepted candidates, never across the whole job.
      const acceptedIds = applicants.filter((item) => !item.refused && funnel.accepted.includes(item.stage)).map((item) => item.id);
      if (acceptedIds.length && rules.has('cv_missing')) {
        try {
          const fields = await existingFields('hr.applicant', ['attachment_number']);
          if (fields.length) {
            const rows = await searchRead('hr.applicant', [['id', 'in', acceptedIds]], fields, { context: { active_test: false } });
            for (const row of rows) {
              if (Number(row.attachment_number) > 0) continue;
              const applicant = applicants.find((item) => item.id === row.id);
              await raise({ rule: 'cv_missing', request, applicantId: row.id, reason: `Accepted candidate ${applicant?.name ?? row.id} has no CV attached in Odoo.`, evidence: applicant?.url ?? '' });
            }
          }
        } catch {
          // An unreadable attachment count is not evidence of a missing CV.
        }
      }
      for (const applicant of applicants) {
        if (applicant.refused) continue;
        const accepted = funnel.accepted.includes(applicant.stage);
        const offered = funnel.offer.includes(applicant.stage);
        const interviewed = funnel.interviewed.includes(applicant.stage);
        if (accepted && (!applicant.hasEmail || !applicant.hasPhone || !applicant.expectedSalary)) {
          await raise({ rule: 'candidate_record_incomplete', request, applicantId: applicant.id, reason: `Accepted candidate ${applicant.name} is missing ${[!applicant.hasEmail && 'e-mail', !applicant.hasPhone && 'phone', !applicant.expectedSalary && 'expected salary'].filter(Boolean).join(', ')} in Odoo.`, evidence: applicant.url ?? '' });
        }
        if (offered && request.requirementChecks?.offer && !applicant.proposedSalary) {
          await raise({ rule: 'offer_record_missing', request, applicantId: applicant.id, reason: `Offer stage reached for ${applicant.name} without a proposed salary recorded in Odoo.`, evidence: applicant.url ?? '' });
        }
        if (interviewed && applicant.meetings === 0) {
          await raise({ rule: 'interview_not_scheduled', request, applicantId: applicant.id, reason: `${applicant.name} is at ${applicant.stage} with no interview meeting in Odoo.`, evidence: applicant.url ?? '' });
        }
      }
    }
  }
  return raised;
}

