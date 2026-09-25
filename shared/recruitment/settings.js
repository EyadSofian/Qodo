/**
 * HR settings — every number HR V2 treats as policy, in one revisioned
 * document per organization.
 *
 * The defaults are the values management approved. An organization stores
 * only what it changed; `resolveHRSettings` lays that over the defaults, so a
 * default added in a later release reaches everybody who never touched it.
 * Arrays are replaced wholesale, never merged item by item — a classification
 * list merged with its defaults could never lose an entry.
 */

import { DEFAULT_SLA_BANDS, DEFAULT_WEEKEND, isIsoDate, RECRUITMENT_PRIORITIES } from './sla.js';
import { DEFAULT_CAPACITY } from './capacity.js';
import { DEFAULT_CLASSIFICATIONS } from './classification.js';
import { KPI_CATEGORIES, DEFAULT_KPI_RULES, validateWeights } from './kpi.js';

/**
 * The funnel reads Odoo stages by name. These are the production stages as
 * discovered on 2026-09-24; each funnel step counts applicants currently at
 * any of its stages *or a later one*, so "Interviewed" includes everybody who
 * has since moved to an offer.
 */
export const DEFAULT_FUNNEL = {
  filtered: ['HR Evaluation', 'Shortlisted I', 'Technical Evaluation', 'Final Review & Decision', 'Shortlisted II', 'Contract negotiation', 'Contract Signed', 'On boarding'],
  interviewed: ['Technical Evaluation', 'Final Review & Decision', 'Shortlisted II', 'Contract negotiation', 'Contract Signed', 'On boarding'],
  accepted: ['Shortlisted II', 'Contract negotiation', 'Contract Signed', 'On boarding'],
  offer: ['Contract negotiation', 'Contract Signed', 'On boarding'],
  hired: ['Contract Signed', 'On boarding'],
  excluded: ['Rejected', 'Next Patch'],
};

export const DEFAULT_QUARTERLY_CRITERIA = [
  { id: 'goals', ar: 'تحقيق الأهداف', en: 'Goal achievement', max: 30 },
  { id: 'quality', ar: 'جودة العمل', en: 'Quality of work', max: 25 },
  { id: 'collaboration', ar: 'التعاون والعمل الجماعي', en: 'Collaboration', max: 15 },
  { id: 'initiative', ar: 'المبادرة والتطوير', en: 'Initiative & growth', max: 15 },
  { id: 'discipline', ar: 'الالتزام والانضباط', en: 'Commitment & discipline', max: 15 },
];

export const DEFAULT_ONBOARDING_CHECKLIST = [
  { id: 'contract', ar: 'تجهيز العقد وتوقيعه', en: 'Prepare and sign the contract', owner: 'personnel' },
  { id: 'documents', ar: 'استلام المستندات الأساسية', en: 'Collect required documents', owner: 'personnel' },
  { id: 'insurance', ar: 'تسجيل التأمينات', en: 'Register social insurance', owner: 'personnel' },
  { id: 'email', ar: 'إنشاء البريد الرسمي', en: 'Create company e-mail', owner: 'it' },
  { id: 'accounts', ar: 'حسابات Qodo وOdoo', en: 'Qodo and Odoo accounts', owner: 'it' },
  { id: 'assets', ar: 'تسليم الجهاز والعهدة', en: 'Laptop and assets handed over', owner: 'it' },
  { id: 'seat', ar: 'تحديد المكتب ومكان الجلوس', en: 'Office seat assigned', owner: 'manager' },
  { id: 'induction', ar: 'جلسة التعريف مع المدير المباشر', en: 'Induction with the direct manager', owner: 'manager' },
];

export const DEFAULT_CLEARANCE_CHECKLIST = [
  { id: 'handover', ar: 'تسليم المهام والملفات', en: 'Work and files handed over', owner: 'manager' },
  { id: 'assets', ar: 'استلام الجهاز والعهدة', en: 'Laptop and assets returned', owner: 'it' },
  { id: 'accounts', ar: 'إيقاف الحسابات', en: 'Accounts disabled', owner: 'it' },
  { id: 'insurance', ar: 'إنهاء التأمينات', en: 'Social insurance closed', owner: 'personnel' },
  { id: 'settlement', ar: 'التسوية المالية النهائية', en: 'Final settlement', owner: 'personnel' },
  { id: 'certificate', ar: 'شهادة الخبرة', en: 'Experience certificate issued', owner: 'personnel' },
];

export const DEFAULT_HR_SETTINGS = {
  recruitment: {
    calendar: { weekend: DEFAULT_WEEKEND, holidays: [] },
    sla: {
      bands: DEFAULT_SLA_BANDS,
      dueSoonWorkingDays: 3,
      holdPausesClock: true,
    },
    capacity: DEFAULT_CAPACITY,
    classifications: DEFAULT_CLASSIFICATIONS,
    team: { include: [], exclude: [] },
    waits: { reviewWorkingDays: 2, approvalWorkingDays: 2, odooLinkWorkingDays: 2 },
    odoo: { funnel: DEFAULT_FUNNEL },
    // Who is told a request waits for final approval. Unset means every holder
    // of `hr.recruitment.approve`; the approval itself is never restricted.
    approvals: { finalApproverUserId: null },
  },
  kpi: {
    weights: Object.fromEntries(KPI_CATEGORIES.map((category) => [category.id, category.weight])),
    rules: {},
    customRules: [],
  },
  performance: { quarterlyCriteria: DEFAULT_QUARTERLY_CRITERIA },
  personnel: {
    onboardingChecklist: DEFAULT_ONBOARDING_CHECKLIST,
    clearanceChecklist: DEFAULT_CLEARANCE_CHECKLIST,
  },
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function merge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) return override === undefined ? base : override;
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    result[key] = isPlainObject(base[key]) && isPlainObject(value) ? merge(base[key], value) : value;
  }
  return result;
}

export function resolveHRSettings(stored) {
  const { id: _id, organizationId: _org, revision: _rev, createdAt: _c, updatedAt: _u, updatedBy: _b, ...values } = stored ?? {};
  return merge(structuredClone(DEFAULT_HR_SETTINGS), values);
}

const CODE = /^[a-z][a-z0-9_]{1,40}$/;
const int = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

/**
 * Validate a *resolved* settings object. Returns `null` or `{ code, path }`.
 * Run on the result of merging a patch, so a patch can never leave the
 * document in a state some other section would choke on.
 */
export function validateHRSettings(settings) {
  const fail = (code, path) => ({ code, path });
  const recruitment = settings?.recruitment;
  if (!recruitment) return fail('hr_settings_invalid', 'recruitment');

  const weekend = recruitment.calendar?.weekend;
  if (!Array.isArray(weekend) || weekend.length > 5 || weekend.some((day) => !int(day, 0, 6)) || new Set(weekend).size !== weekend.length) {
    return fail('hr_settings_weekend_invalid', 'recruitment.calendar.weekend');
  }
  const holidays = recruitment.calendar?.holidays;
  if (!Array.isArray(holidays) || holidays.length > 400 || holidays.some((day) => !isIsoDate(day))) {
    return fail('hr_settings_holidays_invalid', 'recruitment.calendar.holidays');
  }

  for (const priority of RECRUITMENT_PRIORITIES) {
    const band = recruitment.sla?.bands?.[priority];
    if (!band || !int(band.min, 1, 365) || !int(band.max, 1, 365) || !int(band.default, 1, 365) || band.min > band.default || band.default > band.max) {
      return fail('hr_settings_sla_band_invalid', `recruitment.sla.bands.${priority}`);
    }
  }
  if (!int(recruitment.sla?.dueSoonWorkingDays, 0, 30)) return fail('hr_settings_due_soon_invalid', 'recruitment.sla.dueSoonWorkingDays');
  if (typeof recruitment.sla?.holdPausesClock !== 'boolean') return fail('hr_settings_invalid', 'recruitment.sla.holdPausesClock');

  for (const priority of RECRUITMENT_PRIORITIES) {
    const limit = recruitment.capacity?.[priority];
    if (limit !== null && !int(limit, 0, 50)) return fail('hr_settings_capacity_invalid', `recruitment.capacity.${priority}`);
  }
  if (typeof recruitment.capacity?.countOnHold !== 'boolean') return fail('hr_settings_capacity_invalid', 'recruitment.capacity.countOnHold');

  const classifications = recruitment.classifications;
  if (!Array.isArray(classifications) || !classifications.length || classifications.length > 30) return fail('hr_settings_classifications_invalid', 'recruitment.classifications');
  const classIds = new Set();
  for (const item of classifications) {
    if (!CODE.test(String(item?.id ?? '')) || classIds.has(item.id)) return fail('hr_settings_classifications_invalid', 'recruitment.classifications');
    if (!String(item.ar ?? '').trim() || !String(item.en ?? '').trim()) return fail('hr_settings_classifications_invalid', 'recruitment.classifications');
    classIds.add(item.id);
  }

  for (const key of ['include', 'exclude']) {
    const list = recruitment.team?.[key];
    if (!Array.isArray(list) || list.length > 200 || list.some((code) => !/^[\w-]{1,20}$/.test(String(code)))) {
      return fail('hr_settings_team_invalid', `recruitment.team.${key}`);
    }
  }
  const approver = recruitment.approvals?.finalApproverUserId;
  if (approver !== null && approver !== undefined && !/^[\w-]{1,80}$/.test(String(approver))) return fail('hr_settings_invalid', 'recruitment.approvals.finalApproverUserId');
  for (const key of ['reviewWorkingDays', 'approvalWorkingDays', 'odooLinkWorkingDays']) {
    if (!int(recruitment.waits?.[key], 0, 60)) return fail('hr_settings_waits_invalid', `recruitment.waits.${key}`);
  }
  const funnel = recruitment.odoo?.funnel;
  for (const key of Object.keys(DEFAULT_FUNNEL)) {
    if (!Array.isArray(funnel?.[key]) || funnel[key].some((stage) => typeof stage !== 'string' || stage.length > 80)) {
      return fail('hr_settings_funnel_invalid', `recruitment.odoo.funnel.${key}`);
    }
  }

  const weightsError = validateWeights(settings.kpi?.weights);
  if (weightsError) return fail(weightsError, 'kpi.weights');
  const known = new Map(DEFAULT_KPI_RULES.map((rule) => [rule.id, rule]));
  for (const [ruleId, override] of Object.entries(settings.kpi?.rules ?? {})) {
    // `null` is how an override is reset to the catalogue default.
    if (override === null) continue;
    const rule = known.get(ruleId);
    if (!rule || !isPlainObject(override)) return fail('kpi_rule_unknown', `kpi.rules.${ruleId}`);
    const cap = Number(settings.kpi.weights[rule.category]);
    if (override.points !== undefined && (!Number.isFinite(Number(override.points)) || Number(override.points) <= 0 || Number(override.points) > cap)) {
      return fail('kpi_rule_points_invalid', `kpi.rules.${ruleId}`);
    }
    if (override.enabled !== undefined && typeof override.enabled !== 'boolean') return fail('kpi_rule_invalid', `kpi.rules.${ruleId}`);
  }
  const customIds = new Set();
  for (const rule of settings.kpi?.customRules ?? []) {
    if (!CODE.test(String(rule?.id ?? '')) || known.has(rule.id) || customIds.has(rule.id)) return fail('kpi_rule_invalid', 'kpi.customRules');
    if (!['hr_review', 'commitment', 'system_quality'].includes(rule.category)) return fail('kpi_rule_invalid', 'kpi.customRules');
    if (!String(rule.ar ?? '').trim() || !String(rule.en ?? '').trim()) return fail('kpi_rule_invalid', 'kpi.customRules');
    const cap = Number(settings.kpi.weights[rule.category]);
    if (!Number.isFinite(Number(rule.points)) || Number(rule.points) <= 0 || Number(rule.points) > cap) return fail('kpi_rule_points_invalid', 'kpi.customRules');
    customIds.add(rule.id);
  }

  const criteria = settings.performance?.quarterlyCriteria;
  if (!Array.isArray(criteria) || !criteria.length || criteria.length > 20) return fail('performance_criteria_invalid', 'performance.quarterlyCriteria');
  const criterionIds = new Set();
  for (const criterion of criteria) {
    if (!CODE.test(String(criterion?.id ?? '')) || criterionIds.has(criterion.id) || !int(criterion.max, 1, 100)) return fail('performance_criteria_invalid', 'performance.quarterlyCriteria');
    if (!String(criterion.ar ?? '').trim() || !String(criterion.en ?? '').trim()) return fail('performance_criteria_invalid', 'performance.quarterlyCriteria');
    criterionIds.add(criterion.id);
  }

  for (const key of ['onboardingChecklist', 'clearanceChecklist']) {
    const list = settings.personnel?.[key];
    if (!Array.isArray(list) || list.length > 40) return fail('personnel_checklist_invalid', `personnel.${key}`);
    const ids = new Set();
    for (const item of list) {
      if (!CODE.test(String(item?.id ?? '')) || ids.has(item.id) || !['personnel', 'manager', 'it'].includes(item.owner)) return fail('personnel_checklist_invalid', `personnel.${key}`);
      if (!String(item.ar ?? '').trim() || !String(item.en ?? '').trim()) return fail('personnel_checklist_invalid', `personnel.${key}`);
      ids.add(item.id);
    }
  }
  return null;
}

/** The part of the settings the recruitment rules read, in the shape they expect. */
export function recruitmentPolicy(settings) {
  const resolved = settings?.recruitment ? settings : resolveHRSettings(settings);
  const recruitment = resolved.recruitment;
  return {
    calendar: recruitment.calendar,
    bands: recruitment.sla.bands,
    dueSoonWorkingDays: recruitment.sla.dueSoonWorkingDays,
    holdPausesClock: recruitment.sla.holdPausesClock,
    capacity: recruitment.capacity,
    classifications: recruitment.classifications,
    waits: recruitment.waits,
    funnel: recruitment.odoo.funnel,
  };
}
