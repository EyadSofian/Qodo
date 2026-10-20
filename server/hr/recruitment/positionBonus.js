import { createIfAbsent, find } from '../../store.js';
import { PERMISSIONS } from '../../../shared/permissions.js';
import { organizationOf } from '../../../shared/organization.js';
import { workingDaysBetween } from '../../../shared/recruitment/sla.js';
import { HRError, forbidden } from '../errors.js';
import { recruitmentContext, usersWith } from './context.js';
import { stableId } from './data.js';
import { updateHRSettings } from '../settings.js';

export const titleKey = (value) => String(value || '').normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g, ' ').trim();

export async function positionBonusRules(organizationId) {
  const versions = await find('recruitmentPositionBonusRules', (row) => organizationOf(row) === organizationId);
  const latest = new Map();
  for (const row of versions.sort((a, b) => a.version - b.version)) latest.set(row.titleKey, row);
  return [...latest.values()].sort((a, b) => a.title.localeCompare(b.title, 'ar'));
}

export async function positionBonusRuleFor(organizationId, title) {
  const key = titleKey(title);
  if (!key) return null;
  return (await positionBonusRules(organizationId)).find((rule) => rule.titleKey === key && rule.active) ?? null;
}

export async function savePositionBonusRule(user, input) {
  const ctx = await recruitmentContext(user, { withTeam: false });
  if (!ctx.perms.settings) throw forbidden(PERMISSIONS.HR_SETTINGS_MANAGE);
  const title = String(input?.title || '').trim().slice(0, 140);
  const key = titleKey(title);
  const days = Number(input?.targetWorkingDays);
  const amount = Number(input?.bonusAmount);
  const currency = String(input?.currency || 'EGP').toUpperCase();
  if (!title || !key || !Number.isInteger(days) || days < 1 || days > 365 || !Number.isFinite(amount) || amount < 0 || amount > 1_000_000 || !['EGP', 'SAR', 'USD'].includes(currency)) throw new HRError('position_bonus_rule_invalid');
  const versions = await find('recruitmentPositionBonusRules', (row) => organizationOf(row) === ctx.organizationId && row.titleKey === key);
  const current = versions.sort((a, b) => b.version - a.version)[0] ?? null;
  const version = (current?.version || 0) + 1;
  const rule = {
    id: stableId('pbr', ctx.organizationId, key, version), organizationId: ctx.organizationId,
    title, titleKey: key, targetWorkingDays: days, bonusAmount: amount,
    currency, active: input?.active !== false, version, createdBy: user.id,
  };
  const inserted = await createIfAbsent('recruitmentPositionBonusRules', rule);
  if (!inserted.created) throw new HRError('position_bonus_rule_conflict', 409);
  return { rule };
}

export async function savePositionBonusConfirmer(user, input) {
  const ctx = await recruitmentContext(user, { withTeam: false });
  if (!ctx.perms.settings) throw forbidden(PERMISSIONS.HR_SETTINGS_MANAGE);
  const candidate = String(input?.confirmerUserId || '').trim();
  const approvers = await usersWith(ctx.organizationId, PERMISSIONS.HR_RECRUITMENT_APPROVE);
  if (!candidate || !approvers.some((entry) => entry.id === candidate)) throw new HRError('position_bonus_confirmer_invalid');
  await updateHRSettings({ organizationId: ctx.organizationId, revision: ctx.settingsRevision, actorId: user.id,
    patch: { recruitment: { approvals: { finalApproverUserId: candidate } } },
  });
  return { confirmerUserId: candidate };
}

/** A confirmed vacancy is priced by its stored version. Late cases stay pending
 * until management supplies the approved late-hiring policy. */
export function positionBonusFor(request, rule, calendar) {
  const startDate = request.confirmedDate || request.sla?.startDate || null;
  const closedDate = request.closedDate || request.sla?.completedAt || null;
  const duration = startDate && closedDate ? workingDaysBetween(startDate, closedDate, calendar) : null;
  const base = { requestId: request.id, reference: request.reference, title: request.title, recruiterCode: request.recruiterCode,
    status: request.status, requestDate: request.requestDate || request.createdAt?.slice(0, 10) || null,
    requirementsSubmittedDate: request.requirementsSubmittedDate || request.requirementsSubmittedAt?.slice(0, 10) || null,
    confirmedDate: startDate, openDate: request.openDate || request.sla?.startDate || null,
    closedDate, hiringDurationWorkingDays: duration, rule: rule || null, amount: null, currency: rule?.currency || null };
  if (!rule) return { ...base, outcome: 'no_rule' };
  if (request.source !== 'qodo' || !startDate) return { ...base, outcome: 'awaiting_confirmation' };
  if (request.status === 'closed') return { ...base, outcome: 'closed_no_hire' };
  if (!closedDate || request.status !== 'completed') return { ...base, outcome: 'open' };
  if (duration === null || duration < 0) return { ...base, outcome: 'date_review' };
  if (duration > rule.targetWorkingDays) return { ...base, outcome: 'late_pending_policy' };
  return { ...base, outcome: 'earned', amount: rule.bonusAmount };
}

export async function positionBonusOverview(user) {
  const ctx = await recruitmentContext(user, { withTeam: false });
  if (!ctx.perms.view && !ctx.perms.rewards && !ctx.perms.approve && !ctx.perms.settings) throw forbidden(PERMISSIONS.HR_RECRUITMENT_VIEW);
  const rules = await positionBonusRules(ctx.organizationId);
  const approvers = (await usersWith(ctx.organizationId, PERMISSIONS.HR_RECRUITMENT_APPROVE)).map(({ id, name }) => ({ id, name }));
  const current = new Map(rules.filter((rule) => rule.active).map((rule) => [rule.titleKey, rule]));
  const rows = ctx.requests.filter((request) => request.source === 'qodo').map((request) => {
    const rule = request.positionBonusRule || current.get(titleKey(request.title)) || null;
    // Completed historical vacancies are never priced retrospectively.
    const applicable = request.status === 'completed' && !request.positionBonusRule ? null : rule;
    return positionBonusFor(request, applicable, ctx.policy.calendar);
  });
  const closed = rows.filter((row) => row.closedDate && row.hiringDurationWorkingDays !== null);
  const earnedByCurrency = {};
  for (const row of rows.filter((item) => item.outcome === 'earned')) earnedByCurrency[row.currency] = (earnedByCurrency[row.currency] || 0) + row.amount;
  return { rules, rows, canEdit: ctx.perms.settings, confirmerUserId: ctx.confirmerUserId, approvers,
    summary: {
      open: rows.filter((row) => ['hiring', 'on_hold'].includes(row.status)).length,
      closed: closed.length,
      averageWorkingDays: closed.length ? closed.reduce((sum, row) => sum + row.hiringDurationWorkingDays, 0) / closed.length : null,
      earnedByCurrency,
      pending: rows.filter((row) => row.outcome === 'late_pending_policy').length,
      missingRules: rows.filter((row) => row.outcome === 'no_rule').length,
    } };
}
