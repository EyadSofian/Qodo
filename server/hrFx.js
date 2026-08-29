const BANQUE_MISR_RATES_URL =
  'https://www.banquemisr.com/en/Home/CAPITAL-MARKETS/Exchange-Rates-and-Currencies?sc_lang=ar-EG';

const FALLBACK_RATE = Object.freeze({
  buy: 50.17,
  sell: 50.27,
  asOf: '2026-08-29',
  source: 'Banque Misr',
  sourceUrl: BANQUE_MISR_RATES_URL,
  live: false,
});

const CACHE_MS = 6 * 60 * 60 * 1_000;
let cached = null;

function configuredRate() {
  const sell = Number(process.env.HR_USD_EGP_RATE);
  if (!Number.isFinite(sell) || sell <= 0) return null;
  const buy = Number(process.env.HR_USD_EGP_BUY_RATE);
  return {
    buy: Number.isFinite(buy) && buy > 0 ? buy : sell,
    sell,
    asOf: process.env.HR_USD_EGP_RATE_DATE || new Date().toISOString().slice(0, 10),
    source: process.env.HR_USD_EGP_RATE_SOURCE || 'Configured rate',
    sourceUrl: process.env.HR_USD_EGP_RATE_SOURCE_URL || '',
    live: false,
  };
}

function parseBanqueMisr(html) {
  const date = String(html).match(/<div class="generic-details-title">\s*<p>(\d{2})-(\d{2})-(\d{4})/i);
  const usdRow = String(html).match(
    /<tr>\s*<td>[\s\S]*?usd\.ashx[\s\S]*?<\/td>\s*<td>([\d.]+)<\/td>\s*<td>([\d.]+)<\/td>/i
  );
  if (!date || !usdRow) return null;
  const buy = Number(usdRow[1]);
  const sell = Number(usdRow[2]);
  if (![buy, sell].every((value) => Number.isFinite(value) && value > 10 && value < 200)) return null;
  return {
    buy,
    sell,
    asOf: `${date[3]}-${date[2]}-${date[1]}`,
    source: 'Banque Misr',
    sourceUrl: BANQUE_MISR_RATES_URL,
    live: true,
  };
}

/**
 * The dashboard converts EGP into the amount of USD the company could buy, so
 * it deliberately uses the bank's USD selling rate. A dated fallback keeps a
 * payroll screen useful during a bank outage and is always labelled as such.
 */
export async function usdEgpRate() {
  const configured = configuredRate();
  if (configured) return configured;
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) return cached.value;
  if (process.env.HR_FX_LIVE === 'off') return FALLBACK_RATE;

  try {
    const response = await fetch(BANQUE_MISR_RATES_URL, {
      headers: { 'User-Agent': 'Engosoft-HR/1.0' },
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) throw new Error(`fx_http_${response.status}`);
    const parsed = parseBanqueMisr(await response.text());
    if (!parsed) throw new Error('fx_layout_changed');
    cached = { fetchedAt: Date.now(), value: parsed };
    return parsed;
  } catch (error) {
    console.warn('[hr] live USD/EGP rate unavailable:', error?.message ?? error);
    return FALLBACK_RATE;
  }
}

export const __test = { parseBanqueMisr };
