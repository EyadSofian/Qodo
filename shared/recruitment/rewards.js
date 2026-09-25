/**
 * Recruitment rewards — every three qualifying jobs become one reward batch.
 *
 * Amounts are data. The values management named (Agent 500, Team Leader 650,
 * Manager 1,200–1,500, Instructor EG 1,200–1,500, Instructor KSA 1,500–2,000)
 * are version 1 of a rule set stored in `recruitmentRewardRules`; changing one
 * writes version 2 and never rewrites a batch already priced under version 1,
 * because a batch keeps the rule id, version and amounts it was created with.
 *
 * A job counts once. A batch stores its exact job ids, and a job already in a
 * batch that was not cancelled is never eligible again — so approving,
 * rejecting or re-running the clock can never pay the same hire twice.
 */

import { locationCode } from './classification.js';

export const REWARD_BATCH_STATUSES = ['ready', 'approved', 'paid', 'rejected', 'cancelled'];

/** Statuses that consume their jobs. Only a cancelled batch hands them back. */
export const CONSUMING_BATCH_STATUSES = ['ready', 'approved', 'paid', 'rejected'];

export const DEFAULT_REWARD_RULES = {
  version: 1,
  jobsPerBatch: 3,
  // `per_category` fills a separate pool per reward category, so a batch is
  // always priced by one line of the table. `mixed` lets any three jobs form a
  // batch priced at the average of their categories.
  grouping: 'per_category',
  currency: 'EGP',
  eligibility: {
    requireCompleted: true,
    requireWithinSla: true,
    requireQualityPassed: true,
  },
  categories: [
    { id: 'agent', ar: 'إيجنت', en: 'Agent', classification: 'agent', location: null, amountMin: 500, amountMax: 500 },
    { id: 'team_leader', ar: 'قائد فريق', en: 'Team Leader', classification: 'team_leader', location: null, amountMin: 650, amountMax: 650 },
    { id: 'manager', ar: 'مدير', en: 'Manager', classification: 'manager', location: null, amountMin: 1200, amountMax: 1500 },
    { id: 'instructor_eg', ar: 'مدرب — مصر', en: 'Instructor EG', classification: 'instructor', location: 'EG', amountMin: 1200, amountMax: 1500 },
    { id: 'instructor_ksa', ar: 'مدرب — السعودية', en: 'Instructor KSA', classification: 'instructor', location: 'KSA', amountMin: 1500, amountMax: 2000 },
  ],
};

/** `null` when valid, else an error code. */
export function validateRewardRules(rules) {
  if (!rules || typeof rules !== 'object') return 'reward_rules_invalid';
  if (!Number.isInteger(rules.jobsPerBatch) || rules.jobsPerBatch < 1 || rules.jobsPerBatch > 20) return 'reward_jobs_per_batch_invalid';
  if (!['per_category', 'mixed'].includes(rules.grouping)) return 'reward_grouping_invalid';
  if (!/^[A-Z]{3}$/.test(String(rules.currency ?? ''))) return 'reward_currency_invalid';
  if (!Array.isArray(rules.categories) || !rules.categories.length) return 'reward_categories_required';
  const ids = new Set();
  for (const category of rules.categories) {
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(String(category.id ?? ''))) return 'reward_category_id_invalid';
    if (ids.has(category.id)) return 'reward_category_duplicate';
    ids.add(category.id);
    if (!String(category.ar ?? '').trim() || !String(category.en ?? '').trim()) return 'reward_category_label_required';
    if (!String(category.classification ?? '').trim()) return 'reward_category_classification_required';
    if (category.location !== null && category.location !== undefined && !['EG', 'KSA'].includes(category.location)) return 'reward_category_location_invalid';
    const min = Number(category.amountMin);
    const max = Number(category.amountMax);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min) return 'reward_category_amount_invalid';
  }
  return null;
}

/**
 * The reward category one job falls in. A location-specific line beats a
 * location-free one for the same classification, so "Instructor KSA" is never
 * priced as a generic instructor.
 */
export function rewardCategoryFor(request, rules = DEFAULT_REWARD_RULES) {
  const classification = request?.classification;
  if (!classification) return null;
  const location = request.locationCode ?? locationCode(request.location);
  const candidates = (rules?.categories ?? []).filter((category) => category.classification === classification);
  return candidates.find((category) => category.location && category.location === location)
    ?? candidates.find((category) => !category.location)
    ?? null;
}

/**
 * Why a job does or does not qualify, as a list of reasons — the rewards page
 * shows "not within SLA" rather than just leaving the job out.
 */
export function jobEligibility(request, { rules = DEFAULT_REWARD_RULES, qualityFlags = new Set(), batchedJobIds = new Set() } = {}) {
  const reasons = [];
  const eligibility = rules?.eligibility ?? {};
  if (batchedJobIds.has(request.id)) reasons.push('already_batched');
  if (eligibility.requireCompleted !== false && (request.status !== 'completed' || !request.sla?.completedAt)) reasons.push('not_completed');
  if (eligibility.requireWithinSla !== false && request.sla?.slaMet !== true) reasons.push('sla_not_met');
  if (eligibility.requireQualityPassed !== false && qualityFlags.has(request.id)) reasons.push('quality_failed');
  const category = rewardCategoryFor(request, rules);
  if (!category) reasons.push('no_reward_category');
  return { eligible: reasons.length === 0, reasons, category };
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

/**
 * A recruiter's reward position: the eligible, not-yet-batched jobs grouped
 * into pools, and the full batches those pools can form right now.
 *
 * Jobs are taken oldest completion first, so the batch that forms is the one
 * that has been waiting longest.
 */
export function rewardProgress({ employeeCode, requests, batches = [], qualityFlags = new Set(), rules = DEFAULT_REWARD_RULES }) {
  const batchedJobIds = new Set(
    batches
      .filter((batch) => CONSUMING_BATCH_STATUSES.includes(batch.status))
      .flatMap((batch) => batch.jobIds ?? [])
  );
  const owned = (requests ?? []).filter((request) => request.recruiterCode === employeeCode);
  const evaluated = owned
    .filter((request) => request.status === 'completed')
    .map((request) => ({ request, ...jobEligibility(request, { rules, qualityFlags, batchedJobIds }) }));
  const eligible = evaluated
    .filter((item) => item.eligible)
    .sort((left, right) => String(left.request.sla?.completedAt).localeCompare(String(right.request.sla?.completedAt)) || left.request.id.localeCompare(right.request.id));

  const size = rules.jobsPerBatch ?? 3;
  const pools = new Map();
  for (const item of eligible) {
    const key = rules.grouping === 'mixed' ? 'mixed' : item.category.id;
    pools.set(key, [...(pools.get(key) ?? []), item]);
  }

  const proposals = [];
  const progress = [];
  for (const [key, items] of pools) {
    const full = Math.floor(items.length / size);
    for (let index = 0; index < full; index += 1) {
      const chunk = items.slice(index * size, index * size + size);
      proposals.push({
        employeeCode,
        categoryId: key,
        jobIds: chunk.map((item) => item.request.id),
        amountMin: rules.grouping === 'mixed' ? average(chunk.map((item) => Number(item.category.amountMin))) : Number(chunk[0].category.amountMin),
        amountMax: rules.grouping === 'mixed' ? average(chunk.map((item) => Number(item.category.amountMax))) : Number(chunk[0].category.amountMax),
        currency: rules.currency,
        ruleVersion: rules.version,
      });
    }
    const remainder = items.slice(full * size);
    progress.push({
      categoryId: key,
      category: key === 'mixed' ? null : items[0].category,
      done: remainder.length,
      of: size,
      jobIds: remainder.map((item) => item.request.id),
    });
  }
  progress.sort((left, right) => right.done - left.done || String(left.categoryId).localeCompare(String(right.categoryId)));

  return {
    employeeCode,
    jobsPerBatch: size,
    progress,
    best: progress[0] ?? { categoryId: null, category: null, done: 0, of: size, jobIds: [] },
    proposals,
    ineligible: evaluated.filter((item) => !item.eligible).map((item) => ({ requestId: item.request.id, reasons: item.reasons })),
    batchedJobIds: [...batchedJobIds].filter((id) => owned.some((request) => request.id === id)),
  };
}
