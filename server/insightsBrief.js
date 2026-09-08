const DEFAULT_BRIEF_TIMES = '11:30,19:00';

const finite = (value) => {
  if (value === null || value === undefined || value === '') return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
};

/** Parse a comma-separated Cairo clock such as `11:30,19:00`. */
export function parseBriefTimes(value = DEFAULT_BRIEF_TIMES) {
  const minutes = String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const match = /^(\d{1,2}):(\d{2})$/.exec(item);
      if (!match) return null;
      const hour = Number(match[1]);
      const minute = Number(match[2]);
      if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
      return hour * 60 + minute;
    })
    .filter((item) => item !== null);

  return [...new Set(minutes)].sort((a, b) => a - b);
}

/**
 * Return the latest scheduled slot that is due today and has not been sent.
 * If Railway restarts at 11:34, the 11:30 summary is sent late rather than
 * silently disappearing. At 19:00 the later slot becomes due in the same way.
 */
export function latestDueBriefSlot({ day, hour, minute, times, lastSlot }) {
  const now = hour * 60 + minute;
  const due = times.filter((clock) => clock <= now).at(-1);
  if (due === undefined) return null;
  const slot = `${day}T${String(Math.floor(due / 60)).padStart(2, '0')}:${String(due % 60).padStart(2, '0')}`;
  return slot === lastSlot ? null : slot;
}

export function briefSlotLabel(slot) {
  const match = /T(\d{2}):(\d{2})$/.exec(String(slot));
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = match[2];
  const twelveHour = hour % 12 || 12;
  return `${twelveHour}:${minute} ${hour < 12 ? 'ص' : 'م'}`;
}

const integer = (value) => Math.round(value).toLocaleString('en-US');
const decimal = (value) => value.toLocaleString('en-US', { maximumFractionDigits: 1 });
const money = (value) => `$${Math.round(value).toLocaleString('en-US')}`;

function rangeLabel(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return '';
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  const month = new Intl.DateTimeFormat('ar-EG', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(end);
  return start.getUTCMonth() === end.getUTCMonth()
    ? `${start.getUTCDate()}–${end.getUTCDate()} ${month}`
    : `${from} – ${to}`;
}

function shortLabel(value, max = 34) {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function atRiskCampaigns(overview) {
  const rows = Array.isArray(overview?.activity?.atRisk) ? overview.activity.atRisk : [];
  return rows.filter((row) => row && (row.campaignName || row.name));
}

function lowestMeasuredEmployees(teams) {
  const agents = Array.isArray(teams?.agents) ? teams.agents : [];
  return agents
    .filter((agent) => {
      const score = finite(agent?.performanceScore?.overall);
      const coverage = finite(agent?.performanceScore?.dataCoverage);
      return score !== null && coverage !== null && coverage >= 50 && agent?.target?.complete === true;
    })
    .sort((a, b) => a.performanceScore.overall - b.performanceScore.overall)
    .slice(0, 3);
}

/**
 * Build one compact management notification from the four dashboard views.
 * Missing endpoints omit their own line; they never turn into a misleading 0.
 */
export function buildInsightsBrief({ overview, leads, teams, website, from, to }) {
  const totals = leads?.totals ?? overview?.totals ?? {};
  const totalLeads = finite(totals.totalLeads);
  const paidInvoices = finite(totals.orders);
  const lost = finite(totals.lost);
  const followUp = finite(leads?.pipeline?.followUp);
  const conversion =
    totalLeads !== null && totalLeads > 0 && paidInvoices !== null
      ? (paidInvoices / totalLeads) * 100
      : null;
  const campaigns = atRiskCampaigns(overview);
  const employees = lowestMeasuredEmployees(teams);
  const websiteSales = finite(website?.totals?.sales);
  const websiteSpend = finite(website?.totals?.websiteCampaignSpend);
  const websiteRoas =
    websiteSales !== null && websiteSpend !== null && websiteSpend > 0
      ? websiteSales / websiteSpend
      : null;

  const lines = [];
  const period = rangeLabel(from, to);
  if (period) lines.push(`الفترة: ${period}.`);

  const leadParts = [
    totalLeads !== null ? `${integer(totalLeads)} إجمالي` : null,
    lost !== null ? `${integer(lost)} Lost` : null,
    followUp !== null ? `${integer(followUp)} متابعة` : null,
  ].filter(Boolean);
  if (leadParts.length) lines.push(`مؤشر الليدز: ${leadParts.join(' · ')}.`);

  if (paidInvoices !== null && conversion !== null) {
    lines.push(
      `التحويل الحقيقي: ${integer(paidInvoices)} فاتورة مدفوعة ÷ ${integer(totalLeads)} ليد = ${decimal(conversion)}%.`
    );
  } else if (paidInvoices !== null) {
    lines.push(`الفواتير المدفوعة: ${integer(paidInvoices)}.`);
  }

  if (websiteSales !== null || websiteSpend !== null) {
    const parts = [
      websiteSales !== null ? `${money(websiteSales)} مبيعات` : null,
      websiteSpend !== null ? `${money(websiteSpend)} إنفاق` : null,
      websiteRoas !== null ? `عائد ${decimal(websiteRoas)}×` : null,
    ].filter(Boolean);
    lines.push(`الموقع: ${parts.join(' · ')}.`);
  }

  if (campaigns.length) {
    const names = campaigns
      .slice(0, 2)
      .map((campaign) => shortLabel(campaign.campaignName ?? campaign.name))
      .join('، ');
    lines.push(`تحتاج مراجعة: ${integer(campaigns.length)} حملة — ${names}.`);
  }

  if (employees.length) {
    const names = employees
      .map(
        (employee) =>
          `${shortLabel(employee.displayName ?? employee.name, 25)} (${decimal(employee.performanceScore.overall)}/100)`
      )
      .join('، ');
    lines.push(`أقل 3 موظفين حسب مؤشر الأداء العام: ${names}.`);
  }

  // A period on its own is not a useful notification.
  if (lines.length <= (period ? 1 : 0)) return null;
  return { body: lines.join('\n'), campaigns: campaigns.length, employees: employees.length };
}

async function fetchJson(url, fetchFn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetchFn(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchInsightsBriefData(baseUrl, { from, to }, fetchFn = fetch) {
  const base = baseUrl.replace(/\/$/, '');
  const query = new URLSearchParams({ from, to }).toString();
  const [overview, leads, teams, website] = await Promise.all(
    ['overview', 'leads', 'teams', 'website'].map((endpoint) =>
      fetchJson(`${base}/api/${endpoint}?${query}`, fetchFn)
    )
  );
  return { overview, leads, teams, website };
}
