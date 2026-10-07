import { find, findOne, getStore, create } from '../store.js';
import { can, PERMISSIONS } from '../../shared/permissions.js';
import { organizationOf } from '../../shared/organization.js';
import { organizationState } from '../hrModule.js';
import { odooEmployeeIndex } from './odooPeople.js';
import { odooResolver } from './odooHR.js';
import { ownOdooEmployee, teamOdooIds } from './teamReach.js';
import { HRError, forbidden, notFound } from './errors.js';
import { makeCache } from '../cache.js';
import { localDay } from '../../shared/recruitment/sla.js';

const cache = makeCache(10 * 60_000);
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const automatic = new Set(['paid_revenue', 'operational_sales', 'outbound_calls', 'answered_calls']);
const keyOf = (organizationId, code, month) => `performance-plan:${organizationId}:${code}:${month}`;
const number = (value) => value === '' || value === null || value === undefined ? null : Number(value);

function periodOf(value) {
  const month = String(value || localDay().slice(0, 7));
  if (!monthPattern.test(month)) throw new HRError('performance_period_invalid');
  return month;
}

function monthEnd(month) {
  const [year, part] = month.split('-').map(Number);
  return new Date(Date.UTC(year, part, 0)).toISOString().slice(0, 10);
}

function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

async function salesSnapshot(month) {
  return cache.get(month, async () => {
    const base = String(process.env.INSIGHTS_HUB_URL || 'https://engosoft-insights-hub-production.up.railway.app').replace(/\/+$/, '');
    const url = `${base}/api/teams?${new URLSearchParams({ from: `${month}-01`, to: monthEnd(month) })}`;
    const headers = { Accept: 'application/json' };
    if (process.env.INSIGHTS_INTERNAL_SECRET) headers['x-service-secret'] = process.env.INSIGHTS_INTERNAL_SECRET;
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(18_000) });
    if (!response.ok) throw new Error(`Insights Hub HTTP ${response.status}`);
    const data = await response.json();
    return { agents: Array.isArray(data.agents) ? data.agents : [], sla: data.sla || null, fetchedAt: new Date().toISOString() };
  });
}

function matchAgent(profile, odoo, agents) {
  const id = odoo?.id;
  const byId = id ? agents.filter((agent) => String(agent.target?.employeeId || '') === String(id)) : [];
  if (byId.length === 1) return byId[0];
  const names = [profile.nameEnglish, odoo?.name].map(normalize).filter(Boolean);
  const byName = agents.filter((agent) => names.includes(normalize(agent.name)) || names.includes(normalize(agent.displayName)));
  return byName.length === 1 ? byName[0] : null;
}

function actualOf(indicator, agent, snapshot) {
  if (!automatic.has(indicator.source) || !agent) return indicator.actual ?? null;
  if (indicator.source === 'paid_revenue') return Number.isFinite(agent.paidRevenue) ? agent.paidRevenue : null;
  if (indicator.source === 'operational_sales') return Number.isFinite(agent.operationalSales) ? agent.operationalSales : null;
  if (!snapshot?.sla?.callsAvailable) return null;
  const value = indicator.source === 'outbound_calls' ? agent.outboundCalls : agent.answeredCalls;
  return Number.isFinite(value) ? value : null;
}

function publicPlan(plan, agent, snapshot) {
  const indicators = (plan?.indicators || []).map((indicator) => {
    const actual = actualOf(indicator, agent, snapshot);
    const ratio = actual === null || !Number.isFinite(indicator.target) || indicator.target <= 0 ? null : Math.min(1, Math.max(0, actual / indicator.target));
    return { ...indicator, actual, ratio, points: ratio === null ? null : ratio * indicator.weight };
  });
  const measured = indicators.filter((indicator) => indicator.points !== null);
  return {
    ...plan,
    indicators,
    score: measured.length === indicators.length && indicators.length ? measured.reduce((sum, indicator) => sum + indicator.points, 0) : null,
    measured: measured.length,
    total: indicators.length,
    sales: agent ? {
      paidRevenue: agent.paidRevenue ?? null,
      operationalSales: agent.operationalSales ?? null,
      outboundCalls: snapshot?.sla?.callsAvailable ? agent.outboundCalls : null,
      answeredCalls: snapshot?.sla?.callsAvailable ? agent.answeredCalls : null,
      target: agent.target?.target ?? null,
    } : null,
  };
}

async function scope(user) {
  const state = await organizationState(organizationOf(user));
  const profiles = [...state.profiles.values()].filter((profile) => profile.status === 'active' && profile.sources.master);
  const index = await odooEmployeeIndex({ timeoutMs: 6000 });
  const resolver = odooResolver(profiles, index);
  // Odoo's manager tree is the assignment authority. A manager needs no
  // blanket HR permission to define indicators for their own direct reports.
  const manager = index ? ownOdooEmployee(user, profiles, resolver, index) : null;
  const teamCodes = manager ? new Set([...teamOdooIds(index.rows, manager.id)].map((id) => resolver.codeFor(id)).filter(Boolean)) : new Set();
  const own = profiles.find((profile) => profile.linkedUserId === user.id);
  const globalRead = can(user, PERMISSIONS.HR_VIEW) || can(user, PERMISSIONS.HR_PERFORMANCE_REVIEW);
  const globalEdit = can(user, PERMISSIONS.HR_PERFORMANCE_REVIEW) || can(user, PERMISSIONS.HR_MANAGE);
  const visible = profiles.filter((profile) => globalRead || profile.employeeCode === own?.employeeCode || teamCodes.has(profile.employeeCode));
  return { visible, resolver, globalEdit, teamCodes, own };
}

export async function performancePlansFor(user, period) {
  const month = periodOf(period);
  const organizationId = organizationOf(user);
  const { visible, resolver, globalEdit, teamCodes } = await scope(user);
  const stored = await find('performancePlans', (plan) => plan.organizationId === organizationId && plan.period === month);
  let snapshot = null;
  let sourceError = null;
  if (visible.length) {
    try { snapshot = await salesSnapshot(month); } catch (error) { sourceError = error.message; }
  }
  return {
    period: month,
    source: { name: 'Insights Hub', fetchedAt: snapshot?.fetchedAt ?? null, stale: Boolean(snapshot?.stale), callsAvailable: Boolean(snapshot?.sla?.callsAvailable), error: sourceError },
    people: visible.map((profile) => {
      const code = profile.employeeCode;
      const odoo = resolver.odooFor(code);
      const agent = snapshot ? matchAgent(profile, odoo, snapshot.agents) : null;
      const plan = stored.find((item) => item.employeeCode === code) ?? null;
      return {
        employeeCode: code,
        name: { ar: profile.nameArabic || profile.nameEnglish, en: profile.nameEnglish || profile.nameArabic },
        title: profile.title || '',
        department: profile.department || profile.sector || '',
        canEdit: Boolean(globalEdit || teamCodes.has(code)),
        plan: plan ? publicPlan(plan, agent, snapshot) : null,
        sales: agent ? publicPlan({ indicators: [] }, agent, snapshot).sales : null,
        salesMatched: Boolean(agent),
      };
    }),
  };
}

export async function savePerformancePlan(user, code, period, input) {
  const month = periodOf(period);
  const { visible, globalEdit, teamCodes } = await scope(user);
  const profile = visible.find((item) => item.employeeCode === String(code));
  if (!profile) throw notFound('hr_employee_not_found');
  if (!globalEdit && !teamCodes.has(profile.employeeCode)) throw forbidden(PERMISSIONS.HR_PERFORMANCE_REVIEW);
  const raw = input?.indicators;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 20) throw new HRError('performance_indicators_invalid');
  const indicators = raw.map((row, index) => {
    const name = String(row.name || '').trim().slice(0, 160);
    const weight = Number(row.weight);
    const target = number(row.target);
    const source = automatic.has(row.source) ? row.source : 'manual';
    const actual = source === 'manual' ? number(row.actual) : null;
    if (!name || !Number.isFinite(weight) || weight <= 0 || weight > 100 || target === null || !Number.isFinite(target) || target <= 0 || (actual !== null && (!Number.isFinite(actual) || actual < 0))) throw new HRError('performance_indicator_invalid', 400, { index });
    return { id: String(row.id || `kpi-${index + 1}`).slice(0, 50), name, weight, target, actual, source, unit: String(row.unit || '').trim().slice(0, 30) };
  });
  if (new Set(indicators.map((row) => row.id)).size !== indicators.length) throw new HRError('performance_indicator_duplicate');
  if (Math.abs(indicators.reduce((sum, row) => sum + row.weight, 0) - 100) > 0.001) throw new HRError('performance_weights_invalid');
  const organizationId = organizationOf(user);
  const id = keyOf(organizationId, profile.employeeCode, month);
  const current = await findOne('performancePlans', (item) => item.id === id);
  const plan = { organizationId, employeeCode: profile.employeeCode, period: month, indicators, status: input?.publish === true ? 'published' : 'draft', updatedBy: user.id, updatedAt: new Date().toISOString(), revision: (current?.revision || 0) + 1 };
  if (current) await (await getStore()).update('performancePlans', id, plan);
  else await create('performancePlans', { id, ...plan });
  return { plan: { id, ...plan } };
}
