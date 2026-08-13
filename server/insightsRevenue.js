/**
 * The accounting authority for course revenue.
 *
 * Odoo sale lines are still the right source for confirmed demand and package
 * matching, but they are not a safe money ledger: the database contains more
 * than one currency and `price_subtotal` carries no common-currency guarantee.
 * Insights Hub has already solved that accounting problem from Paid Invoices,
 * using Payment Date and the normalized `USD Paid` value. This reader keeps
 * that policy in one place. The boundary is the actual paid eLearning product
 * catalogue from Odoo — not a word such as "Recorded" in the product name.
 * That matters because exam simulators and many recorded products do not carry
 * that word, while Event/attendance products live beside them in accounting.
 */

import { makeCache } from './cache.js';
import { findOne } from './store.js';

const DEFAULT_INSIGHTS_URL = 'https://engosoft-insights-hub-production.up.railway.app';
const FETCH_TIMEOUT_MS = 75_000;
const cache = makeCache(15 * 60_000);
const accountingCache = makeCache(15 * 60_000);

const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const money = (value) => Math.round((number(value) + Number.EPSILON) * 100) / 100;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizedProductName(value) {
  return String(value || '')
    .replace(/^\s*\[[^\]]+\]\s*/, '')
    .toLocaleLowerCase('en')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ة]/g, 'ه')
    .replace(/[ى]/g, 'ي')
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function catalogMatcher(catalog) {
  const aliases = new Set();
  const products = new Set();
  for (const course of Array.isArray(catalog) ? catalog : []) {
    const names = typeof course === 'string' ? [course] : [course?.productName, course?.name];
    const canonical = normalizedProductName(course?.productName || course?.name || course);
    if (canonical) products.add(canonical);
    for (const name of names) {
      const normalized = normalizedProductName(name);
      if (normalized) aliases.add(normalized);
    }
  }
  return {
    aliases,
    products,
    matches: (name) => aliases.has(normalizedProductName(name)),
    key: [...aliases].sort().join('\u001f'),
  };
}

function nonEventProductRevenue(product) {
  const eventRevenue = (Array.isArray(product?.events) ? product.events : []).reduce(
    (sum, event) => sum + number(event?.revenueUsd),
    0
  );
  return number(product?.revenueUsd) - eventRevenue;
}

function eventBillingMode(row) {
  const product = normalizedProductName(row?.product);
  const event = normalizedProductName(row?.event);
  if (!/(^| )event( |$)|attendance/.test(product)) return null;
  if (/offline|riyadh/.test(product) || /offline|riyadh/.test(event)) return 'offline';
  if (/online/.test(product) || /online/.test(event)) return 'online';
  return 'unknown';
}

function exactInvoiceCount(rows) {
  return new Set(
    rows
      .filter((row) => !row?.isCreditNote)
      .map((row) => row?.movement)
      .filter(Boolean)
  ).size;
}

/**
 * Paid classroom-event revenue that can be proved from Insights Hub.
 *
 * Generic "Event" products are deliberately not guessed as classroom sales:
 * several of them point at events whose names say Online, while other invoice
 * lines carry no event relation at all. Only an explicit Offline/Riyadh marker
 * is allowed into the amount shown to management. The excluded buckets make
 * the data-quality gap visible instead of silently inventing a mapping.
 */
export function buildOfflineEventsRevenueSnapshot(payload) {
  const detail = payload?.detail;
  const allRows = Array.isArray(detail?.rows) ? detail.rows : [];
  const exact = Array.isArray(detail?.rows) && detail?.truncated === false;
  const eventRows = allRows.filter((row) => eventBillingMode(row));
  const offlineRows = eventRows.filter((row) => eventBillingMode(row) === 'offline');
  const onlineRows = eventRows.filter((row) => eventBillingMode(row) === 'online');
  const unknownRows = eventRows.filter((row) => eventBillingMode(row) === 'unknown');

  const productsByName = new Map();
  for (const row of offlineRows) {
    const key = normalizedProductName(row?.product) || `line-${row?.id}`;
    const product = productsByName.get(key) ?? {
      key,
      name: String(row?.product || 'بدون اسم'),
      amount: 0,
      movements: new Set(),
      events: new Set(),
      unassignedLines: 0,
    };
    product.amount += number(row?.usdPaid);
    if (!row?.isCreditNote && row?.movement) product.movements.add(row.movement);
    if (row?.event) product.events.add(String(row.event));
    else product.unassignedLines += 1;
    productsByName.set(key, product);
  }

  const products = [...productsByName.values()]
    .map((product) => ({
      key: product.key,
      name: product.name,
      amount: money(product.amount),
      invoices: product.movements.size,
      events: [...product.events],
      unassignedLines: product.unassignedLines,
    }))
    .sort((a, b) => b.amount - a.amount || b.invoices - a.invoices || a.name.localeCompare(b.name));

  const unassignedRows = offlineRows.filter((row) => !row?.event);
  return {
    amount: money(offlineRows.reduce((sum, row) => sum + number(row?.usdPaid), 0)),
    invoices: exactInvoiceCount(offlineRows),
    invoiceCountExact: exact,
    productLines: offlineRows.length,
    products,
    unassignedInvoices: exactInvoiceCount(unassignedRows),
    unassignedProductLines: unassignedRows.length,
    excludedOnlineAmount: money(onlineRows.reduce((sum, row) => sum + number(row?.usdPaid), 0)),
    excludedOnlineInvoices: exactInvoiceCount(onlineRows),
    excludedUnknownAmount: money(unknownRows.reduce((sum, row) => sum + number(row?.usdPaid), 0)),
    excludedUnknownInvoices: exactInvoiceCount(unknownRows),
    currency: 'USD',
    scope: 'explicit_offline_event_invoice_lines',
    source: {
      app: 'Insights Hub',
      tab: payload?.source?.tab || 'Paid Invoices',
      dateBasis: payload?.source?.dateBasis || 'Payment Date',
      valueBasis: payload?.source?.valueBasis || 'USD Paid',
      grain: payload?.source?.grain || 'invoice_product_line',
      matchingBasis: 'Explicit Offline Attendance/Riyadh event products',
      repository: 'https://github.com/EyadSofian/Engosoft-Insights-Hub',
      appUrl: DEFAULT_INSIGHTS_URL,
    },
    authority:
      payload?.health?.accountingAuthority ||
      payload?.health?.accounting?.authority ||
      payload?.health?.accounting?.source ||
      null,
    syncedAt: payload?.health?.lastSuccessfulSyncAt || payload?.syncedAt || null,
    stale: Boolean(payload?.stale),
  };
}

/** Pure reducer kept exported so the catalogue/accounting join is regression-tested. */
export function buildElearningRevenueSnapshot(payload, catalog) {
  const matcher = catalogMatcher(catalog);
  const accountingProducts = (payload?.courses?.families || []).flatMap(
    (family) => family?.products || []
  );
  const matchedProducts = accountingProducts.filter((product) => matcher.matches(product?.name));
  const families = (Array.isArray(payload?.courses?.families) ? payload.courses.families : [])
    .map((family) => {
      const products = (Array.isArray(family?.products) ? family.products : []).filter(
        (product) => matcher.matches(product?.name)
      );
      if (!products.length) return null;
      return {
        key: String(family?.familyKey || family?.family || ''),
        name: String(family?.family || family?.familyKey || 'بدون تصنيف'),
        amount: money(products.reduce((sum, product) => sum + nonEventProductRevenue(product), 0)),
        // Product invoice counts can overlap inside a family. This is used only
        // as a fallback when the endpoint's uncapped detail is unavailable.
        invoices: products.reduce((sum, product) => sum + number(product?.invoices), 0),
        productLines: products.reduce((sum, product) => sum + number(product?.lines), 0),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.amount - a.amount || b.invoices - a.invoices || a.name.localeCompare(b.name));

  const detail = payload?.detail;
  const detailRows = Array.isArray(detail?.rows)
    ? detail.rows.filter(
        (row) => matcher.matches(row?.product) && !row?.event && !row?.eventStage
      )
    : [];
  const exactInvoices = new Set(
    detailRows
      .filter((row) => !row?.isCreditNote)
      .map((row) => row?.movement)
      .filter(Boolean)
  ).size;
  const invoiceCountExact = Array.isArray(detail?.rows) && detail?.truncated === false;
  const matchedAccountingProducts = new Set(
    matchedProducts.map((product) => normalizedProductName(product?.name))
  ).size;
  const products = matchedProducts
    .map((product) => {
      const key = normalizedProductName(product?.name);
      const rows = detailRows.filter((row) => normalizedProductName(row?.product) === key);
      const amount = invoiceCountExact
        ? rows.reduce((sum, row) => sum + number(row?.usdPaid), 0)
        : nonEventProductRevenue(product);
      return {
        key,
        name: String(product?.name || 'بدون اسم'),
        amount: money(amount),
      };
    })
    .filter((product) => product.amount !== 0)
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));

  return {
    amount: money(
      invoiceCountExact
        ? detailRows.reduce((sum, row) => sum + number(row?.usdPaid), 0)
        : matchedProducts.reduce((sum, product) => sum + nonEventProductRevenue(product), 0)
    ),
    invoices: invoiceCountExact
      ? exactInvoices
      : families.reduce((sum, family) => sum + family.invoices, 0),
    invoiceCountExact,
    productLines: invoiceCountExact
      ? detailRows.length
      : families.reduce((sum, family) => sum + family.productLines, 0),
    families,
    products,
    currency: 'USD',
    scope: 'odoo_elearning_catalog',
    catalogProducts: matcher.products.size,
    matchedAccountingProducts,
    source: {
      app: 'Insights Hub',
      tab: payload?.source?.tab || 'Paid Invoices',
      dateBasis: payload?.source?.dateBasis || 'Payment Date',
      valueBasis: payload?.source?.valueBasis || 'USD Paid',
      grain: payload?.source?.grain || 'invoice_product_line',
      matchingBasis: 'Odoo eLearning product catalogue',
      repository: 'https://github.com/EyadSofian/Engosoft-Insights-Hub',
      appUrl: DEFAULT_INSIGHTS_URL,
    },
    authority:
      payload?.health?.accountingAuthority ||
      payload?.health?.accounting?.authority ||
      payload?.health?.accounting?.source ||
      null,
    syncedAt: payload?.health?.lastSuccessfulSyncAt || payload?.syncedAt || null,
    stale: Boolean(payload?.stale),
  };
}

async function insightsBaseUrl() {
  const app = await findOne('apps', (item) => item.id === 'insights');
  return String(app?.url || DEFAULT_INSIGHTS_URL).replace(/\/$/, '');
}

async function fetchAccountingSnapshot(base, from, to, catalog) {
  const payload = await fetchAccountingPayload(base, from, to);
  const matcher = catalogMatcher(catalog);
  return cache.get(`elearning:${from}:${to}:${matcher.key}`, async () => {
    const value = buildElearningRevenueSnapshot(payload, catalog);
    return {
      ...value,
      source: { ...value.source, appUrl: base },
      fetchedAt: new Date().toISOString(),
    };
  });
}

async function fetchAccountingPayload(base, from, to) {
  const url = new URL('/api/accounting', base);
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  // Be explicit even though it is the Insights default. Revenue must follow the
  // payment period selected by the manager, never silently switch to invoice date.
  url.searchParams.set('dateBasis', 'payment');

  return accountingCache.get(String(url), async () => {
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
        return await response.json();
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

async function fetchOfflineEventsSnapshot(base, from, to) {
  const payload = await fetchAccountingPayload(base, from, to);
  const value = buildOfflineEventsRevenueSnapshot(payload);
  return {
    ...value,
    source: { ...value.source, appUrl: base },
    fetchedAt: new Date().toISOString(),
  };
}

export async function elearningRevenueForPeriod(period, catalog) {
  if (!Array.isArray(catalog) || !catalog.length) throw new Error('elearning_catalog_unavailable');
  const base = await insightsBaseUrl();
  // One request at a time intentionally. Railway may be asleep on first use;
  // two simultaneous cold-start connections made one of them time out even
  // though the service was healthy. The current period wakes it for comparison.
  const current = await fetchAccountingSnapshot(base, period.from, period.to, catalog);
  const previous = await fetchAccountingSnapshot(base, period.previousFrom, period.previousTo, catalog);
  return {
    current,
    previous,
    currency: 'USD',
    source: current.source,
    stale: Boolean(current.stale || previous.stale),
  };
}

export async function eventsRevenueForPeriod(period) {
  const base = await insightsBaseUrl();
  const current = await fetchOfflineEventsSnapshot(base, period.from, period.to);
  const previous = await fetchOfflineEventsSnapshot(base, period.previousFrom, period.previousTo);
  return {
    current,
    previous,
    currency: 'USD',
    source: current.source,
    stale: Boolean(current.stale || previous.stale),
  };
}

/**
 * Ask Insights Hub to reconcile Accounting with Odoo immediately.
 *
 * This is called only from the manager's explicit refresh button.  Normal page
 * views continue reading the durable accounting snapshot and do not launch a
 * broad Odoo invoice scan.  Insights Hub owns the safety gate: if the direct
 * response is partial, its last-good PostgreSQL numbers stay authoritative.
 */
export async function refreshInsightsRevenueSource() {
  const base = await insightsBaseUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 105_000);
  try {
    const response = await fetch(new URL('/api/refresh', base), {
      method: 'POST',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'Engosoft-Workspace/1.0' },
    });
    if (!response.ok) throw new Error(`insights_refresh_http_${response.status}`);
    const result = await response.json();
    clearInsightsRevenueCache();
    return {
      ok: true,
      authority: result?.accounting?.authority ?? null,
      directAccepted: Boolean(result?.accounting?.direct?.accepted),
      directAttempted: Boolean(result?.accounting?.direct?.attempted),
      syncedAt: result?.accounting?.syncedAt ?? result?.syncedAt ?? null,
      warning: result?.accounting?.direct?.error || null,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function clearInsightsRevenueCache() {
  cache.clear();
  accountingCache.clear();
}
