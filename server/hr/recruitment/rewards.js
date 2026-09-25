/**
 * Recruitment rewards — rule versions, eligibility and batches, persisted.
 *
 * A batch's id is derived from its exact, sorted job ids, and it is written with
 * `createIfAbsent`: the clock can propose the same three jobs a thousand times
 * and there will still be one batch. Eligibility itself excludes any job already
 * inside a batch that was not cancelled, so no job is ever paid twice.
 */

import { createIfAbsent, find, findOne, getStore, now } from '../../store.js';
import { PERMISSIONS } from '../../../shared/permissions.js';
import { organizationOf } from '../../../shared/organization.js';
import { DEFAULT_REWARD_RULES, REWARD_BATCH_STATUSES, rewardProgress, validateRewardRules } from '../../../shared/recruitment/rewards.js';
import { notifyEach } from '../../notify.js';
import { HRError, forbidden, notFound } from '../errors.js';
import { hasRecruitmentAccess, recruitmentContext, userNames, usersWith } from './context.js';
import { requestsFor, stableId } from './data.js';

const ruleId = (organizationId, version) => `rrr-${organizationId}-${version}`;

export async function rewardRuleVersions(organizationId) {
  return (await find('recruitmentRewardRules', (row) => organizationOf(row) === organizationId))
    .sort((left, right) => right.version - left.version);
}

/** The rules in force. Version 1 is the approved table, written the first time anybody asks. */
export async function activeRewardRules(organizationId) {
  const versions = await rewardRuleVersions(organizationId);
  if (versions.length) return versions[0];
  const { doc } = await createIfAbsent('recruitmentRewardRules', {
    id: ruleId(organizationId, 1),
    organizationId,
    ...structuredClone(DEFAULT_REWARD_RULES),
    version: 1,
    createdBy: null,
    note: 'Approved initial values',
  });
  return doc;
}

/** A new version of the rules. Amounts are policy, so this sits behind HR settings. */
export async function saveRewardRules(user, input = {}) {
  const ctx = await recruitmentContext(user, { withTeam: false });
  if (!ctx.perms.settings) throw forbidden(PERMISSIONS.HR_SETTINGS_MANAGE);
  const current = await activeRewardRules(ctx.organizationId);
  const next = {
    jobsPerBatch: Number(input.jobsPerBatch ?? current.jobsPerBatch),
    grouping: input.grouping ?? current.grouping,
    currency: String(input.currency ?? current.currency).toUpperCase(),
    eligibility: {
      requireCompleted: input.eligibility?.requireCompleted ?? current.eligibility.requireCompleted,
      requireWithinSla: input.eligibility?.requireWithinSla ?? current.eligibility.requireWithinSla,
      requireQualityPassed: input.eligibility?.requireQualityPassed ?? current.eligibility.requireQualityPassed,
    },
    categories: Array.isArray(input.categories)
      ? input.categories.map((category) => ({
          id: String(category.id ?? ''),
          ar: String(category.ar ?? '').trim().slice(0, 60),
          en: String(category.en ?? '').trim().slice(0, 60),
          classification: String(category.classification ?? ''),
          location: category.location || null,
          amountMin: Number(category.amountMin),
          amountMax: Number(category.amountMax),
        }))
      : current.categories,
  };
  // Booleans only — a string "false" must not read as true.
  for (const key of Object.keys(next.eligibility)) next.eligibility[key] = next.eligibility[key] === true;
  const problem = validateRewardRules({ ...next, version: current.version + 1 });
  if (problem) throw new HRError(problem);
  const unknownClass = next.categories.find((category) => !ctx.policy.classifications.some((item) => item.id === category.classification));
  if (unknownClass) throw new HRError('reward_category_classification_unknown', 400, { classification: unknownClass.classification });
  const version = current.version + 1;
  // The version id is fixed, so of two editors saving at once exactly one wins
  // and the other is told to reload — neither overwrites the other's rules.
  const result = await createIfAbsent('recruitmentRewardRules', {
    id: ruleId(ctx.organizationId, version),
    organizationId: ctx.organizationId,
    ...next,
    version,
    createdBy: user.id,
    note: String(input.note ?? '').trim().slice(0, 500),
  });
  if (!result.created) throw new HRError('reward_rules_conflict', 409, { version: current.version });
  return result.doc;
}

async function batchesFor(organizationId) {
  return find('recruitmentRewardBatches', (row) => organizationOf(row) === organizationId);
}

/** Jobs that failed a quality condition: any live HR-review or system-quality deduction on them. */
export async function qualityFlags(organizationId) {
  const events = await find('recruitmentKpiEvents', (event) => organizationOf(event) === organizationId && !event.voidedAt && event.requestId);
  return new Set(events.filter((event) => ['hr_review', 'system_quality'].includes(event.category)).map((event) => event.requestId));
}

/** Form every batch that is due. Idempotent; returns the batches it created. */
export async function syncRewardBatches(organizationId) {
  const [rules, requests, batches, flags] = await Promise.all([
    activeRewardRules(organizationId),
    requestsFor(organizationId),
    batchesFor(organizationId),
    qualityFlags(organizationId),
  ]);
  const recruiters = [...new Set(requests.filter((request) => request.status === 'completed' && request.recruiterCode).map((request) => request.recruiterCode))];
  const created = [];
  for (const employeeCode of recruiters) {
    const progress = rewardProgress({ employeeCode, requests, batches, qualityFlags: flags, rules });
    for (const proposal of progress.proposals) {
      const jobIds = [...proposal.jobIds].sort();
      const result = await createIfAbsent('recruitmentRewardBatches', {
        id: stableId('rwb', organizationId, ...jobIds),
        organizationId,
        employeeCode,
        jobIds: proposal.jobIds,
        categoryId: proposal.categoryId,
        ruleId: rules.id,
        ruleVersion: rules.version,
        amountMin: proposal.amountMin,
        amountMax: proposal.amountMax,
        amountApproved: null,
        currency: proposal.currency,
        status: 'ready',
        approverId: null,
        decidedAt: null,
        decisionNote: '',
        paidAt: null,
      });
      if (result.created) {
        created.push(result.doc);
        batches.push(result.doc);
      }
    }
  }
  if (created.length) {
    const managers = (await usersWith(organizationId, PERMISSIONS.HR_RECRUITMENT_REWARDS_MANAGE)).map((user) => user.id);
    for (const batch of created) {
      await notifyEach(managers, null, {
        type: 'recruitment.reward_ready',
        title: { ar: 'دفعة مكافأة جاهزة للاعتماد', en: 'A reward batch is ready for approval' },
        body: `#${batch.employeeCode} · ${batch.jobIds.length}`,
        link: `/hr/recruitment/rewards?recruiter=${encodeURIComponent(batch.employeeCode)}`,
      });
    }
  }
  return created;
}

export async function rewardsOverview(user) {
  const ctx = await recruitmentContext(user);
  if (!hasRecruitmentAccess(ctx)) throw forbidden(PERMISSIONS.HR_RECRUITMENT_VIEW);
  const [rules, batches, flags, names, versions] = await Promise.all([
    activeRewardRules(ctx.organizationId),
    batchesFor(ctx.organizationId),
    qualityFlags(ctx.organizationId),
    userNames(ctx.organizationId),
    rewardRuleVersions(ctx.organizationId),
  ]);
  const seeAll = ctx.perms.view || ctx.perms.rewards || ctx.perms.approve;
  const members = ctx.team.filter((member) => seeAll || member.employeeCode === ctx.employeeCode);
  const titles = new Map(ctx.requests.map((request) => [request.id, { id: request.id, title: request.title, reference: request.reference, completedAt: request.sla?.completedAt ?? null, classification: request.classification, locationCode: request.locationCode }]));
  return {
    rules,
    versions: versions.map(({ id, version, createdAt, createdBy, note }) => ({ id, version, createdAt, createdByName: createdBy ? names.get(createdBy) ?? '' : '', note })),
    recruiters: members.map((member) => {
      const progress = rewardProgress({ employeeCode: member.employeeCode, requests: ctx.requests, batches, qualityFlags: flags, rules });
      return {
        member,
        progress: progress.progress.map((pool) => ({ ...pool, jobs: pool.jobIds.map((id) => titles.get(id)).filter(Boolean) })),
        best: progress.best,
        ineligible: progress.ineligible.map((item) => ({ ...item, job: titles.get(item.requestId) ?? null })),
      };
    }),
    batches: batches
      .filter((batch) => seeAll || batch.employeeCode === ctx.employeeCode)
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .map((batch) => ({
        ...batch,
        jobs: batch.jobIds.map((id) => titles.get(id)).filter(Boolean),
        approverName: batch.approverId ? names.get(batch.approverId) ?? '' : '',
        member: ctx.team.find((member) => member.employeeCode === batch.employeeCode) ?? null,
      })),
    canManage: ctx.perms.rewards,
    canEditRules: ctx.perms.settings,
  };
}

const DECISIONS = {
  approve: { from: ['ready'], to: 'approved' },
  reject: { from: ['ready'], to: 'rejected' },
  pay: { from: ['approved'], to: 'paid' },
  cancel: { from: ['ready', 'approved'], to: 'cancelled' },
};

export async function decideRewardBatch(user, id, { decision, note = '', amountApproved = null } = {}) {
  const ctx = await recruitmentContext(user, { withTeam: false });
  if (!ctx.perms.rewards) throw forbidden(PERMISSIONS.HR_RECRUITMENT_REWARDS_MANAGE);
  const batch = await findOne('recruitmentRewardBatches', (row) => row.id === String(id) && organizationOf(row) === ctx.organizationId);
  if (!batch) throw notFound('reward_batch_not_found');
  const rule = DECISIONS[decision];
  if (!rule) throw new HRError('reward_decision_invalid');
  if (!rule.from.includes(batch.status)) throw new HRError('reward_transition_invalid', 409, { from: batch.status, decision });
  const text = String(note ?? '').trim().slice(0, 1000);
  if (['reject', 'cancel'].includes(decision) && text.length < 5) throw new HRError('reward_reason_required');
  const patch = { status: rule.to, decisionNote: text || batch.decisionNote };
  if (decision === 'approve') {
    const amount = amountApproved === null || amountApproved === undefined || amountApproved === '' ? batch.amountMax : Number(amountApproved);
    // The approved figure must sit inside the band the rule version priced.
    if (!Number.isFinite(amount) || amount < batch.amountMin || amount > batch.amountMax) throw new HRError('reward_amount_out_of_range', 400, { min: batch.amountMin, max: batch.amountMax });
    Object.assign(patch, { amountApproved: amount, approverId: user.id, decidedAt: now() });
  }
  if (decision === 'reject') Object.assign(patch, { approverId: user.id, decidedAt: now() });
  if (decision === 'pay') patch.paidAt = now();
  const updated = await (await getStore()).update('recruitmentRewardBatches', batch.id, patch);
  return { batch: updated, statuses: REWARD_BATCH_STATUSES };
}
