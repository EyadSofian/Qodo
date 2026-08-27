/**
 * KPI scoring — the one place a number becomes a grade.
 *
 * The approved workbooks disagree about presentation and agree about
 * arithmetic, so the engine keeps a single path:
 *
 *   ratio  = how far a KPI got toward its target, capped at 100%
 *   group  = the weighted average of its measured KPIs
 *   score  = group.weight x that average, zeroed if the group has a floor it
 *            missed
 *   total  = the sum of group scores over the weight that was actually measured
 *
 * Three refinements sit on top, each carried by the template rather than by an
 * `if` on the template's name:
 *
 *   `bands`          — a tiered entitlement table. The sales card does not pay
 *                      92% of the target as 92%; it pays it as 70%.
 *   `minimumRatio`   — a floor. The marketing card treats a category below its
 *                      floor as zero rather than as partial credit.
 *   `incentiveBands` — a cash deduction ladder. The category's score becomes
 *                      the share of the monthly incentive that survives.
 *
 * Unmeasured KPIs are excluded, never read as zero. A month with two of twenty
 * numbers filled in is an incomplete month, not a catastrophic one — so the
 * engine reports `completeness` beside the score and refuses to let a
 * scorecard be finalised until every KPI has been answered.
 */

import { KPI_TEMPLATES } from './kpiCatalogue.js';

export { KPI_TEMPLATES };

export const KPI_AUDIENCES = [
  { id: 'manager', ar: 'المديرون', en: 'Managers' },
  { id: 'employee', ar: 'الموظفون', en: 'Employees' },
];

/**
 * `na` is deliberately not zero. A review item that does not apply to this
 * month would otherwise punish the person it does not apply to, which is the
 * exact note the recruitment workbook leaves for its own reviewers.
 */
export const KPI_CHECK_STATES = [
  { id: 'done', ar: 'تم', en: 'Done', value: 1 },
  { id: 'partial', ar: 'جزئي', en: 'Partial', value: 0.5 },
  { id: 'missed', ar: 'لم يتم', en: 'Not done', value: 0 },
  { id: 'na', ar: 'غير منطبق', en: 'Not applicable', value: null },
];

const CHECK_VALUES = new Map(KPI_CHECK_STATES.map((state) => [state.id, state.value]));

/**
 * The shared rating ladder. Every workbook prints these same five bands.
 *
 * The colours run green to red in one direction and never double back. A grade
 * scale is the one place in this app where colour carries the meaning rather
 * than decorating it, so it deliberately does not follow the brand ramp: two
 * adjacent bands that read as "blue then orange" would leave the reader
 * working out which of them is better.
 */
export const KPI_RATINGS = [
  { id: 'excellent', min: 90, ar: 'ممتاز', en: 'Excellent', color: '#16A34A' },
  { id: 'very_good', min: 80, ar: 'جيد جداً', en: 'Very good', color: '#65A30D' },
  { id: 'good', min: 70, ar: 'جيد', en: 'Good', color: '#F59E0B' },
  { id: 'fair', min: 60, ar: 'مقبول', en: 'Fair', color: '#EA580C' },
  { id: 'weak', min: -Infinity, ar: 'ضعيف', en: 'Weak', color: '#DC2626' },
];

export const KPI_STATUSES = ['draft', 'final'];

export function kpiTemplateById(id) {
  return KPI_TEMPLATES.find((template) => template.id === String(id)) ?? null;
}

export function kpiRatingFor(percent) {
  if (!Number.isFinite(percent)) return null;
  return KPI_RATINGS.find((rating) => percent >= rating.min) ?? KPI_RATINGS.at(-1);
}

/**
 * A number, or `null` for anything that is not one.
 *
 * The blank cases have to be rejected before `Number` sees them: `Number(null)`
 * and `Number('')` are both `0`, which would turn "nobody filled this in" into
 * "they scored nothing".
 */
function finite(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * How far `actual` got toward `target`, before any cap.
 *
 * The two directions are not mirror images at zero: hitting zero on a
 * lower-is-better measure (no repeat violations, no resignations) is a perfect
 * month, while hitting zero on a higher-is-better measure is an empty one.
 */
export function kpiRawRatio({ direction, target, actual }) {
  const goal = finite(target);
  const value = finite(actual);
  if (value === null || goal === null) return null;
  if (direction === 'lower') {
    if (value <= 0) return goal <= 0 ? 1 : 1;
    if (goal <= 0) return 0;
    return goal / value;
  }
  if (goal <= 0) return value > 0 ? 1 : 0;
  return value / goal;
}

function bandValue(bands, ratio, key) {
  if (!Array.isArray(bands) || ratio === null) return null;
  const ordered = [...bands].sort((left, right) => right.min - left.min);
  return (ordered.find((band) => ratio >= band.min) ?? ordered.at(-1))?.[key] ?? null;
}

/** The share of the KPI's weight it earned: capped, or taken from its bands. */
export function kpiRatio(kpi, actual, targetOverride) {
  const target = finite(targetOverride) ?? finite(kpi.target);
  const raw = kpiRawRatio({ direction: kpi.direction, target, actual });
  if (raw === null) return { raw: null, ratio: null, target };
  if (Array.isArray(kpi.bands) && kpi.bands.length) {
    return { raw, ratio: bandValue(kpi.bands, raw, 'entitlement') ?? 0, target };
  }
  return { raw, ratio: Math.min(1, Math.max(0, raw)), target };
}

/**
 * Verification rate for one checklist. `null` means nobody has reviewed
 * anything yet, which the caller reads as "do not multiply", not as "zero".
 */
export function kpiChecklistRatio(checklist, checks) {
  let sum = 0;
  let counted = 0;
  let notApplicable = 0;
  let answered = 0;
  for (const item of checklist ?? []) {
    const state = checks?.[item.id];
    if (!CHECK_VALUES.has(state)) continue;
    answered += 1;
    const value = CHECK_VALUES.get(state);
    if (value === null) {
      notApplicable += 1;
      continue;
    }
    sum += value;
    counted += 1;
  }
  return {
    ratio: counted ? sum / counted : null,
    counted,
    notApplicable,
    answered,
    total: checklist?.length ?? 0,
  };
}

function scoreGroup(group, entry, checklistMode) {
  const kpis = group.kpis.map((kpi) => {
    const stored = entry.values?.[kpi.id] ?? {};
    const { raw, ratio, target } = kpiRatio(kpi, stored.actual, stored.target);
    return {
      id: kpi.id,
      ar: kpi.ar,
      unit: kpi.unit,
      direction: kpi.direction,
      weight: kpi.weight,
      target,
      actual: finite(stored.actual),
      note: String(stored.note ?? '').slice(0, 500),
      rawRatio: raw,
      ratio,
      measured: ratio !== null,
    };
  });

  const measured = kpis.filter((kpi) => kpi.measured);
  const measuredWeight = measured.reduce((sum, kpi) => sum + kpi.weight, 0);
  const rawRatio = measuredWeight
    ? measured.reduce((sum, kpi) => sum + kpi.weight * kpi.ratio, 0) / measuredWeight
    : null;

  for (const kpi of kpis) {
    // Each KPI's share of the group's points, so a UI can show where a group
    // lost its marks without re-deriving the weighting rule.
    kpi.score = kpi.measured && measuredWeight
      ? (kpi.weight / measuredWeight) * group.weight * kpi.ratio
      : null;
  }

  const checklist = kpiChecklistRatio(group.checklist, entry.checks);
  const incentiveTarget = finite(entry.incentives?.[group.id]);
  let incentive = null;
  let ratio = rawRatio;

  if (Array.isArray(group.incentiveBands) && group.incentiveBands.length && rawRatio !== null) {
    // The ladder is read against the uncapped achievement, because "100% or
    // more" is a band of its own and a capped ratio could never reach it.
    const reference = measured.length === 1 && measured[0].rawRatio !== null ? measured[0].rawRatio : rawRatio;
    const step = bandValue(group.incentiveBands, reference, 'deduction');
    const target = incentiveTarget ?? 0;
    const deduction = step === 'all' ? target : Math.min(target, finite(step) ?? 0);
    const net = Math.max(0, target - deduction);
    incentive = { target, deduction, net, achievement: reference };
    if (target > 0) ratio = net / target;
    else if (step === 'all') ratio = 0;
  }

  const gated = group.minimumRatio !== null && ratio !== null && ratio < group.minimumRatio;
  const verification = checklistMode === 'multiplier' && checklist.ratio !== null ? checklist.ratio : 1;
  const performanceScore = ratio === null ? null : group.weight * ratio;
  const score = performanceScore === null ? null : (gated ? 0 : performanceScore * verification);

  return {
    id: group.id,
    ar: group.ar,
    en: group.en,
    weight: group.weight,
    minimumRatio: group.minimumRatio,
    kpis,
    checklist,
    incentive,
    rawRatio,
    ratio,
    gated,
    performanceScore,
    score,
    percent: ratio === null ? null : (gated ? 0 : ratio * verification * 100),
    measuredWeight,
    measuredCount: measured.length,
    kpiCount: kpis.length,
  };
}

/**
 * Score one scorecard against its template.
 *
 * `entry.values[kpiId]` carries `{ actual, target?, note? }` — the optional
 * target is how a scorecard remembers the number it was actually judged
 * against when management revised a catalogue default mid-year.
 */
export function scoreScorecard(template, entry = {}) {
  if (!template) throw new Error('kpi_template_required');
  const groups = template.groups.map((group) => scoreGroup(group, entry, template.checklistMode));
  const scored = groups.filter((group) => group.score !== null);
  const measuredWeight = scored.reduce((sum, group) => sum + group.weight, 0);
  const totalWeight = template.groups.reduce((sum, group) => sum + group.weight, 0);

  const performance = scored.reduce((sum, group) => sum + group.performanceScore, 0);
  const score = scored.reduce((sum, group) => sum + group.score, 0);
  const percent = measuredWeight ? (score / measuredWeight) * 100 : null;

  const checklists = groups.map((group) => group.checklist);
  const checklistCounted = checklists.reduce((sum, item) => sum + item.counted, 0);
  const verification = checklistCounted
    ? checklists.reduce((sum, item) => sum + (item.ratio ?? 0) * item.counted, 0) / checklistCounted
    : null;

  const kpiCount = groups.reduce((sum, group) => sum + group.kpiCount, 0);
  const measuredCount = groups.reduce((sum, group) => sum + group.measuredCount, 0);
  const checkTotal = checklists.reduce((sum, item) => sum + item.total, 0);
  const checkAnswered = checklists.reduce((sum, item) => sum + item.answered, 0);

  return {
    templateId: template.id,
    groups,
    performance: {
      score: measuredWeight ? performance : null,
      percent: measuredWeight ? (performance / measuredWeight) * 100 : null,
    },
    verification: { ratio: verification, counted: checklistCounted, answered: checkAnswered, total: checkTotal },
    approved: {
      score,
      max: measuredWeight,
      totalWeight,
      percent,
      rating: kpiRatingFor(percent),
    },
    completeness: {
      kpis: kpiCount,
      measured: measuredCount,
      checks: checkTotal,
      answered: checkAnswered,
      complete: measuredCount === kpiCount && checkAnswered === checkTotal,
    },
  };
}

/** Every axis of every template, keyed for a summary table. */
export function kpiTemplateSummary(template) {
  return {
    id: template.id,
    audience: template.audience,
    department: template.department,
    ar: template.ar,
    en: template.en,
    descAr: template.descAr,
    descEn: template.descEn,
    checklistMode: template.checklistMode,
    sourceFile: template.sourceFile,
    groups: template.groups.length,
    kpis: template.groups.reduce((sum, group) => sum + group.kpis.length, 0),
    checks: template.groups.reduce((sum, group) => sum + group.checklist.length, 0),
    weight: template.groups.reduce((sum, group) => sum + group.weight, 0),
  };
}
