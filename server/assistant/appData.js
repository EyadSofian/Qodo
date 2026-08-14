/**
 * Reading the numbers that live *inside* the sibling dashboards.
 *
 * Until now the assistant could only see workspace data (tasks, people, apps)
 * and had to answer "that figure is in the Insights Hub, go and open it". These
 * fetch the summary endpoints those dashboards already expose, so it can answer
 * the question instead of redirecting.
 *
 * Two things this deliberately does NOT do:
 *
 * 1. Pass the raw payload to the model. `/api/sales` alone is ~1 MB and
 *    `/api/overview` ~46 KB; that is both expensive and worse for accuracy than
 *    a small object of the figures a person actually asks about. Each fetch is
 *    reduced to a flat summary here.
 * 2. Invent a number when a dashboard is unreachable. Every failure returns an
 *    explicit `error`, which the model is instructed to relay rather than paper
 *    over.
 */

import { findOne } from '../store.js';
import { canOpenApp } from '../../shared/permissions.js';

/** Dashboards change on a sync cadence, not per request — a short cache is plenty. */
const CACHE_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20_000;
const cache = new Map();

async function fetchJson(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'Engosoft-Workspace/1.0' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const value = await response.json();
    cache.set(url, { at: Date.now(), value });
    return value;
  } finally {
    clearTimeout(timer);
  }
}

/** The registry is the source of truth for URLs, so an edited tile stays correct. */
async function appUrl(appId, fallback) {
  const app = await findOne('apps', (a) => a.id === appId);
  const base = (app?.url ?? fallback ?? '').replace(/\/$/, '');
  return base || null;
}

const round = (n, places = 2) =>
  typeof n === 'number' && Number.isFinite(n) ? Number(n.toFixed(places)) : null;

const seconds = (n) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.round(n / 60) : null;

/* ------------------------------------------------------------------ */

export async function insightsMetrics(_input, user, lang) {
  if (!canOpenApp(user, 'insights')) {
    return { error: lang === 'en' ? 'You do not have access to Insights Hub.' : 'لا تملك صلاحية الوصول إلى Insights Hub.' };
  }
  const base = await appUrl('insights', 'https://engosoft-insights-hub-production.up.railway.app');
  if (!base) return { error: 'The Insights Hub app is not registered in the workspace.' };

  let data;
  try {
    data = await fetchJson(`${base}/api/overview`);
  } catch (err) {
    return {
      error:
        lang === 'en'
          ? `Could not reach the Insights Hub (${err.message}). Do not guess a figure — say it is unavailable.`
          : `تعذّر الوصول إلى Insights Hub (${err.message}). لا تُخمّن رقماً — أخبر المستخدم أنه غير متاح.`,
    };
  }

  const t = data.totals ?? {};
  return {
    source: 'Insights Hub',
    // The dashboard reports its own sync time; stale data is a real answer.
    lastSyncedAt: data.syncedAt ?? null,
    dateRange: { from: data.coverage?.adsDateMin ?? null, to: data.coverage?.adsDateMax ?? null },
    currencyNote: 'Spend and revenue are in the currency the dashboard reports; it does not label one.',
    spend: {
      total: round(t.spend),
      meta: round(t.spendMeta),
      snapchat: round(t.spendSnap),
      cpc: round(t.cpc, 3),
      cpm: round(t.cpm, 3),
    },
    reach: {
      impressions: t.impressions ?? null,
      clicks: t.clicksAll ?? null,
      ctrPercent: round(t.ctrAll),
    },
    leads: {
      fromPlatforms: t.platformLeads ?? null,
      inCrm: t.crmLeads ?? null,
      fromCampaigns: t.leadsFromCampaign ?? null,
      other: t.leadsOther ?? null,
    },
    outcomes: {
      won: t.won ?? null,
      lost: t.lost ?? null,
      conversionRatePercent: round(t.conversionRate),
      avgDaysToClose: round(t.avgCloseDays, 1),
      revenue: round(t.revenue),
      attributedRevenue: round(t.attributedRevenue),
    },
    bestCampaign: data.best ? { name: data.best.name, spend: round(data.best.spend) } : null,
    biggestLeak: data.leak ? { name: data.leak.name, spend: round(data.leak.spend) } : null,
  };
}

export async function supportMetrics(_input, user, lang) {
  if (!canOpenApp(user, 'support')) {
    return { error: lang === 'en' ? 'You do not have access to Support Analytics.' : 'لا تملك صلاحية الوصول إلى تحليلات خدمة العملاء.' };
  }
  const base = await appUrl('support', 'https://chatwootdashpoard-production.up.railway.app');
  if (!base) return { error: 'The Support Analytics app is not registered in the workspace.' };

  let data;
  try {
    data = await fetchJson(`${base}/api/overview`);
  } catch (err) {
    return {
      error:
        lang === 'en'
          ? `Could not reach Support Analytics (${err.message}). Do not guess a figure — say it is unavailable.`
          : `تعذّر الوصول إلى تحليلات خدمة العملاء (${err.message}). لا تُخمّن رقماً — أخبر المستخدم أنه غير متاح.`,
    };
  }

  const k = data.kpis ?? {};
  return {
    source: 'Support Analytics (Chatwoot)',
    conversations: {
      total: k.totalConversations ?? null,
      openNow: k.openNow ?? null,
      awaitingReply: k.needsReply ?? null,
    },
    // Raw seconds are unreadable in an answer; minutes are what people say.
    responseTime: {
      averageMinutes: seconds(k.avgResponseSeconds),
      medianMinutes: seconds(k.medianResponseSeconds),
      note: 'Measured from assignment, not from the customer message.',
    },
    resolutionTime: { averageMinutes: seconds(k.avgResolutionSeconds) },
    slaBreaches: k.slaBreaches ?? null,
    campaigns: { sent: k.campaignsSent ?? null, replies: k.campaignReplies ?? null },
  };
}

export const APP_DATA_TOOLS = [
  {
    name: 'insights_metrics',
    description:
      'Marketing and sales figures from the Insights Hub dashboard: ad spend across Meta and Snapchat, ' +
      'impressions, clicks, CPC, leads, won and lost deals, conversion rate and revenue. ' +
      'Call this for any question about advertising cost, lead volume, sales performance or revenue. ' +
      'These are live figures — never answer such a question from memory.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'support_metrics',
    description:
      'Customer-service figures from the Support Analytics dashboard: conversation volume, how many are ' +
      'open or awaiting a reply, response and resolution times, SLA breaches and campaign replies. ' +
      'Call this for any question about customer support load, response speed or service level.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

export const APP_DATA_EXECUTORS = {
  insights_metrics: insightsMetrics,
  support_metrics: supportMetrics,
};

export const APP_DATA_LABELS = {
  insights_metrics: { ar: 'يقرأ أرقام التسويق والمبيعات', en: 'Reading marketing figures' },
  support_metrics: { ar: 'يقرأ أرقام خدمة العملاء', en: 'Reading support figures' },
};
