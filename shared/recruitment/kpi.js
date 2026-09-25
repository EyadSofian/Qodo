/**
 * Recruitment KPI — 100 points in four categories.
 *
 *   HR Review Quality          30   deductions recorded by a reviewer
 *   Hiring Target / SLA        30   computed from the jobs themselves
 *   Commitment & Discipline    20   deductions recorded by a reviewer
 *   System & Process Quality   20   automatic checks + reviewer deductions
 *
 * A category's weight is its ceiling, not the price of one mistake: each
 * violation deducts its own configured points inside the category, and the
 * category never drops below zero. "A missing CV costs the recruiter 30%" is
 * exactly the reading this module exists to prevent.
 *
 * Two things are deliberately *not* here:
 *
 *  • Any judgement about appearance or any protected attribute. The historical
 *    workbook wording is not carried over. A role that genuinely needs a
 *    defined professional presentation can enable the manual rule below, which
 *    only a reviewer can record, only against a job whose request states the
 *    requirement, and only with written, job-related reasoning.
 *  • Anything the database can check. Where Odoo or Qodo can verify a fact,
 *    the check is automatic and a reviewer's role is to void a false positive
 *    with a reason — not to be asked to rate it.
 */

import { slaSnapshot } from './sla.js';

export const KPI_CATEGORIES = [
  { id: 'hr_review', ar: 'جودة مراجعة الموارد البشرية', en: 'HR Review Quality', weight: 30, mode: 'deductions' },
  { id: 'hiring_target', ar: 'هدف التعيين والالتزام بالـSLA', en: 'Hiring Target / SLA', weight: 30, mode: 'computed' },
  { id: 'commitment', ar: 'الالتزام والانضباط', en: 'Commitment & Discipline', weight: 20, mode: 'deductions' },
  { id: 'system_quality', ar: 'جودة النظام والإجراءات', en: 'System & Process Quality', weight: 20, mode: 'deductions' },
];

/**
 * The rule book. `points` is what one occurrence deducts inside its category.
 * `automatic` rules are raised by the clock from data; everything else needs a
 * reviewer, a reason and a date. `requiresJob` means the deduction must name
 * the job it happened on.
 */
export const DEFAULT_KPI_RULES = [
  { id: 'candidate_mismatch', category: 'hr_review', points: 5, requiresJob: true, ar: 'مرشح لا يطابق متطلبات الوظيفة', en: 'Candidate does not match the job requirements' },
  { id: 'prohibited_company', category: 'hr_review', points: 5, requiresJob: true, ar: 'مرشح من شركة ضمن قائمة الحظر', en: 'Candidate comes from a prohibited-company list' },
  { id: 'communication_requirement', category: 'hr_review', points: 3, requiresJob: true, humanReviewOnly: true, minReasonLength: 30, ar: 'متطلب تواصل خاص بالوظيفة لم يتحقق (مراجعة بشرية)', en: 'Role-relevant communication requirement not met (human-reviewed)' },
  { id: 'demo_missing', category: 'hr_review', points: 4, requiresJob: true, ar: 'الـDemo المطلوب لم يُنفَّذ', en: 'Required demo missing' },
  { id: 'offer_missing', category: 'hr_review', points: 4, requiresJob: true, ar: 'العرض الوظيفي المطلوب غير موجود', en: 'Required offer missing' },
  { id: 'technical_test_missing', category: 'hr_review', points: 4, requiresJob: true, ar: 'الاختبار الفني المطلوب لم يُنفَّذ', en: 'Required technical test missing' },
  { id: 'candidate_data_incomplete', category: 'hr_review', points: 2, requiresJob: true, ar: 'بيانات المرشح غير مكتملة', en: 'Candidate data incomplete' },
  { id: 'expected_salary_missing', category: 'hr_review', points: 2, requiresJob: true, ar: 'الراتب المتوقع غير مسجّل', en: 'Expected salary missing' },
  { id: 'salary_out_of_range', category: 'hr_review', points: 4, requiresJob: true, ar: 'راتب خارج النطاق المعتمد للشركة', en: 'Salary outside the approved company range' },
  {
    id: 'presentation_requirement',
    category: 'hr_review',
    points: 3,
    enabled: false,
    requiresJob: true,
    requiresJobField: 'presentationRequirement',
    humanReviewOnly: true,
    minReasonLength: 40,
    ar: 'متطلب مظهر مهني محدد في طلب الوظيفة لم يتحقق (مراجعة بشرية بسبب مكتوب)',
    en: 'Role-defined professional presentation requirement not met (human review, written reason)',
  },

  { id: 'instructions', category: 'commitment', points: 4, ar: 'عدم اتباع التعليمات', en: 'Instructions not followed' },
  { id: 'punctuality', category: 'commitment', points: 4, ar: 'عدم الالتزام بالمواعيد', en: 'Punctuality' },
  { id: 'commitments', category: 'commitment', points: 4, ar: 'عدم الوفاء بالالتزامات', en: 'Commitments not met' },
  { id: 'discipline', category: 'commitment', points: 4, ar: 'الانضباط في العمل', en: 'Work discipline' },
  { id: 'professional_communication', category: 'commitment', points: 4, ar: 'التواصل المهني', en: 'Professional communication' },

  { id: 'cv_missing', category: 'system_quality', points: 3, automatic: true, requiresJob: true, ar: 'مرشح مقبول بدون سيرة ذاتية على Odoo', en: 'Accepted candidate without a CV in Odoo' },
  { id: 'offer_record_missing', category: 'system_quality', points: 3, automatic: true, requiresJob: true, ar: 'عرض وظيفي غير مسجّل حيث يلزم', en: 'Offer not recorded where required' },
  { id: 'candidate_record_incomplete', category: 'system_quality', points: 2, automatic: true, requiresJob: true, ar: 'ملف المرشح المقبول ناقص (بريد/هاتف/راتب متوقع)', en: 'Accepted candidate record incomplete (email, phone or expected salary)' },
  { id: 'interview_not_scheduled', category: 'system_quality', points: 2, automatic: true, requiresJob: true, ar: 'مرشح في مرحلة المقابلة بدون موعد مسجّل', en: 'Interview-stage candidate without a scheduled interview' },
  { id: 'odoo_job_not_linked', category: 'system_quality', points: 2, automatic: true, requiresJob: true, ar: 'وظيفة نشطة بدون ربط بوظيفة Odoo', en: 'Active job without a linked Odoo job' },
  { id: 'wrong_form', category: 'system_quality', points: 2, requiresJob: true, ar: 'استخدام نموذج غير صحيح', en: 'Incorrect form used' },
  { id: 'stages_not_followed', category: 'system_quality', points: 2, requiresJob: true, ar: 'عدم اتباع مراحل التوظيف', en: 'Recruitment stages not followed' },
  { id: 'incorrect_candidate_info', category: 'system_quality', points: 3, requiresJob: true, ar: 'بيانات مرشح غير صحيحة', en: 'Incorrect candidate information' },
];

export const KPI_PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export function kpiCategories(settings) {
  const weights = settings?.kpi?.weights ?? {};
  return KPI_CATEGORIES.map((category) => ({
    ...category,
    weight: Number.isFinite(Number(weights[category.id])) ? Number(weights[category.id]) : category.weight,
  }));
}

/** Catalogue rules with the organization's point/enable overrides and any custom manual rules. */
export function kpiRules(settings) {
  const overrides = settings?.kpi?.rules ?? {};
  const base = DEFAULT_KPI_RULES.map((rule) => {
    const override = overrides[rule.id] ?? {};
    return {
      ...rule,
      enabled: override.enabled ?? rule.enabled ?? true,
      points: Number.isFinite(Number(override.points)) ? Number(override.points) : rule.points,
    };
  });
  const custom = (settings?.kpi?.customRules ?? []).map((rule) => ({ ...rule, custom: true, automatic: false, enabled: rule.enabled ?? true }));
  return [...base, ...custom];
}

/** `null` when the weights are a valid 100-point split, else an error code. */
export function validateWeights(weights) {
  const values = KPI_CATEGORIES.map((category) => Number(weights?.[category.id]));
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) return 'kpi_weight_invalid';
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.abs(total - 100) < 1e-9 ? null : 'kpi_weights_must_total_100';
}

function periodOf(date) {
  return String(date ?? '').slice(0, 7);
}

/**
 * The month a job's SLA outcome is decided in: the day it closed, or — for a
 * job that missed — the day it fell due. A 60-day Planned job assigned in
 * September is therefore judged in November, not failed in September.
 */
export function decisionDate(request, snapshot) {
  if (!snapshot?.started) return null;
  if (snapshot.completedAt) {
    return snapshot.slaMet ? snapshot.completedAt : snapshot.dueDate;
  }
  if (snapshot.state === 'overdue') return snapshot.dueDate;
  return null;
}

/**
 * Hiring Target / SLA: `weight × on-time ÷ evaluated`, with the job list kept
 * so "Why this score?" can show every job behind the fraction.
 */
export function hiringTargetScore({ employeeCode, period, requests, weight = 30, today, calendar, dueSoonWorkingDays }) {
  const owned = (requests ?? []).filter((request) => request.recruiterCode === employeeCode);
  const assignedThisMonth = owned.filter((request) => periodOf(request.assignedAt) === period);
  const evaluated = [];
  for (const request of owned) {
    if (!request.sla?.startDate) continue;
    if (!['hiring', 'on_hold', 'completed'].includes(request.status)) continue;
    // A migrated "done" job with no completion date has an unknown outcome.
    // Scoring it would call it late on the strength of a date nobody wrote down.
    if (request.status === 'completed' && !request.sla.completedAt) continue;
    const snapshot = slaSnapshot(request.sla, { today, calendar, dueSoonWorkingDays });
    const decided = decisionDate(request, snapshot);
    if (!decided || periodOf(decided) !== period) continue;
    evaluated.push({
      requestId: request.id,
      title: request.title,
      reference: request.reference,
      completedAt: snapshot.completedAt,
      dueDate: snapshot.dueDate,
      onTime: Boolean(snapshot.completedAt && snapshot.slaMet),
      outcome: snapshot.completedAt ? (snapshot.slaMet ? 'completed_on_time' : 'completed_late') : 'not_completed',
      actualWorkingDays: snapshot.actualWorkingDays,
      targetWorkingDays: snapshot.targetWorkingDays,
    });
  }
  const completed = evaluated.filter((item) => item.completedAt).length;
  const onTime = evaluated.filter((item) => item.onTime).length;
  return {
    measured: evaluated.length > 0,
    score: evaluated.length ? (weight * onTime) / evaluated.length : null,
    weight,
    assignedThisMonth: assignedThisMonth.length,
    evaluated: evaluated.length,
    completed,
    completedOnTime: onTime,
    notCompleted: evaluated.length - completed,
    jobs: evaluated,
  };
}

/**
 * One recruiter's month.
 *
 * `events` are `recruitmentKpiEvents` rows; voided rows are shown but never
 * counted. A deduction category with no events is a clean month and scores its
 * full weight; Hiring Target with no job decided this month is *unmeasured*
 * and is excluded from the total rather than read as either 0 or 30.
 */
export function recruiterKpi({ employeeCode, period, requests, events, settings, today, calendar }) {
  const categories = kpiCategories(settings);
  const rules = new Map(kpiRules(settings).map((rule) => [rule.id, rule]));
  const mine = (events ?? []).filter((event) => event.employeeCode === employeeCode && event.period === period);
  const result = categories.map((category) => {
    if (category.mode === 'computed') {
      const target = hiringTargetScore({
        employeeCode,
        period,
        requests,
        weight: category.weight,
        today,
        calendar,
        dueSoonWorkingDays: settings?.recruitment?.sla?.dueSoonWorkingDays,
      });
      return {
        id: category.id,
        ar: category.ar,
        en: category.en,
        weight: category.weight,
        mode: category.mode,
        measured: target.measured,
        score: target.score,
        deducted: target.measured ? category.weight - target.score : 0,
        detail: target,
        events: [],
      };
    }
    const own = mine.filter((event) => event.category === category.id);
    const counted = own.filter((event) => !event.voidedAt);
    const deducted = counted.reduce((sum, event) => sum + Math.max(0, Number(event.deduction) || 0), 0);
    return {
      id: category.id,
      ar: category.ar,
      en: category.en,
      weight: category.weight,
      mode: category.mode,
      measured: true,
      score: Math.max(0, category.weight - deducted),
      deducted: Math.min(category.weight, deducted),
      detail: null,
      events: own
        .map((event) => ({ ...event, rule: rules.get(event.rule) ?? { id: event.rule, ar: event.rule, en: event.rule } }))
        .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt))),
    };
  });
  const measured = result.filter((category) => category.measured);
  const measuredWeight = measured.reduce((sum, category) => sum + category.weight, 0);
  const score = measured.reduce((sum, category) => sum + category.score, 0);
  return {
    employeeCode,
    period,
    categories: result,
    score,
    measuredWeight,
    percent: measuredWeight ? (score / measuredWeight) * 100 : null,
    complete: measured.length === result.length,
  };
}

/** Stable identity for an automatic finding, so the clock can raise it once and only once. */
export function automaticEventKey({ rule, requestId, applicantId = null }) {
  return [rule, requestId, applicantId ?? '-'].join('|');
}
