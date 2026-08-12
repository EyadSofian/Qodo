/**
 * The accounting authority for course revenue.
 *
 * Odoo sale lines are still the right source for confirmed demand and package
 * matching, but they are not a safe money ledger: the database contains more
 * than one currency and `price_subtotal` carries no common-currency guarantee.
 * Insights Hub has already solved that accounting problem from Paid Invoices,
 * using Payment Date and the normalized `USD Paid` value. This reader keeps
 * that policy in one place and selects only the `recorded` modality so an Event
 * or attendance product can never leak into the eLearning page.
 */

import { makeCache } from './cache.js';
import { findOne } from './store.js';

const DEFAULT_INSIGHTS_URL = 'https://engosoft-insights-hub-production.up.railway.app';
const FETCH_TIMEOUT_MS = 75_000;
const cache = makeCache(15 * 60_000);

const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const money = (value) => Math.round((number(value) + Number.EPSILON) * 100) / 100;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function recordedBreakdown(rows) {
  return Array.isArray(rows) ? rows.find((row) => row?.key === 'recorded') ?? null : null;
}

/** Pure reducer kept exported so the accounting boundary is regression-tested. */
export function buildRecordedRevenueSnapshot(payload) {
  const recorded = recordedBreakdown(payload?.courses?.variants);
  const families = (Array.isArray(payload?.courses?.families) ? payload.courses.families : [])
    .map((family) => {
      const breakdown = recordedBreakdown(family?.variants);
      if (!breakdown) return null;
      const products = (Array.isArray(family?.products) ? family.products : []).filter(
        (product) => product?.variantKey === 'recorded'
      );
      return {
        key: String(family?.familyKey || family?.family || ''),
        name: String(family?.family || family?.familyKey || 'بدون تصنيف'),
        amount: money(breakdown.revenueUsd),
        invoices: number(breakdown.invoices),
        productLines: products.reduce((sum, product) => sum + number(product?.lines), 0),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.amount - a.amount || b.invoices - a.invoices || a.name.localeCompare(b.name));

  return {
    amount: money(recorded?.revenueUsd),
    invoices: number(recorded?.invoices),
    productLines: families.reduce((sum, family) => sum + family.productLines, 0),
    families,
    currency: 'USD',
    modality: 'recorded',
    source: {
      app: 'Insights Hub',
      tab: payload?.source?.tab || 'Paid Invoices',
      dateBasis: payload?.source?.dateBasis || 'Payment Date',
      valueBasis: payload?.source?.valueBasis || 'USD Paid',
      grain: payload?.source?.grain || 'invoice_product_line',
      repository: 'https://github.com/EyadSofian/Engosoft-Insights-Hub',
    },
    authority:
      payload?.health?.accountingAuthority ||
      payload?.health?.accounting?.authority ||
      payload?.health?.accounting?.source ||
      null,
    syncedAt: payload?.health?.lastSuccessfulSyncAt || payload?.syncedAt || null,
  };
}

async function insightsBaseUrl() {
  const app = await findOne('apps', (item) => item.id === 'insights');
  return String(app?.url || DEFAULT_INSIGHTS_URL).replace(/\/$/, '');
}

async function fetchAccountingSnapshot(base, from, to) {
  const url = new URL('/api/accounting', base);
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  // Be explicit even though it is the Insights default. Revenue must follow the
  // payment period selected by the manager, never silently switch to invoice date.
  url.searchParams.set('dateBasis', 'payment');

  return cache.get(url.toString(), async () => {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: 'application/json', 'User-Agent': 'Engosoft-Workspace/1.0' },
        });
        if (!response.ok) throw new Error(`insights_http_${response.status}`);
        const value = buildRecordedRevenueSnapshot(await response.json());
        return { ...value, fetchedAt: new Date().toISOString() };
      } catch (error) {
        lastError = error;
        if (attempt === 0) await pause(350);
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  });
}

export async function recordedRevenueForPeriod(period) {
  const base = await insightsBaseUrl();
  // One request at a time intentionally. Railway may be asleep on first use;
  // two simultaneous cold-start connections made one of them time out even
  // though the service was healthy. The current period wakes it for comparison.
  const current = await fetchAccountingSnapshot(base, period.from, period.to);
  const previous = await fetchAccountingSnapshot(base, period.previousFrom, period.previousTo);
  return {
    current,
    previous,
    currency: 'USD',
    source: current.source,
    stale: Boolean(current.stale || previous.stale),
  };
}

export function clearInsightsRevenueCache() {
  cache.clear();
}
