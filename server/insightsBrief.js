const DEFAULT_BRIEF_TIMES = "11:30,19:00";

const finite = (value) => {
  if (value === null || value === undefined || value === "") return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
};

/** Parse a comma-separated Cairo clock such as `11:30,19:00`. */
export function parseBriefTimes(value = DEFAULT_BRIEF_TIMES) {
  const minutes = String(value)
    .split(",")
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
  const slot = `${day}T${String(Math.floor(due / 60)).padStart(2, "0")}:${String(due % 60).padStart(2, "0")}`;
  return slot === lastSlot ? null : slot;
}

export function briefSlotLabel(slot) {
  const match = /T(\d{2}):(\d{2})$/.exec(String(slot));
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = match[2];
  const twelveHour = hour % 12 || 12;
  return `${twelveHour}:${minute} ${hour < 12 ? "ص" : "م"}`;
}

const integer = (value) => Math.round(value).toLocaleString("en-US");
const decimal = (value) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 1 });
const money = (value) => `${Math.round(value).toLocaleString("en-US")} دولار`;
const moneyEn = (value) => `$${Math.round(value).toLocaleString("en-US")}`;

function rangeLabel(from, to, lang = "ar") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
    return "";
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  const month = new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(end);
  return start.getUTCMonth() === end.getUTCMonth()
    ? `${start.getUTCDate()}–${end.getUTCDate()} ${month}`
    : `${from} – ${to}`;
}

function shortLabel(value, max = 34) {
  const clean = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Keep a Latin proper noun together inside an Arabic sentence. */
const isolate = (value) => `\u2068${value}\u2069`;

function atRiskCampaigns(overview) {
  const rows = Array.isArray(overview?.activity?.atRisk)
    ? overview.activity.atRisk
    : [];
  return rows.filter((row) => row && (row.campaignName || row.name));
}

function lowestMeasuredEmployees(teams) {
  const agents = Array.isArray(teams?.agents) ? teams.agents : [];
  return agents
    .filter((agent) => {
      const score = finite(agent?.performanceScore?.overall);
      const coverage = finite(agent?.performanceScore?.dataCoverage);
      return (
        score !== null &&
        coverage !== null &&
        coverage >= 50 &&
        agent?.target?.complete === true
      );
    })
    .sort((a, b) => a.performanceScore.overall - b.performanceScore.overall)
    .slice(0, 3);
}

/**
 * Build short, separate management notifications from the dashboard views.
 * Missing endpoints omit their own notification; they never turn into a
 * misleading zero or make the remaining summaries disappear.
 */
export function buildInsightsBriefNotifications({
  overview,
  leads,
  teams,
  website,
  from,
  to,
}) {
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
  const websiteAttributionAvailable =
    website?.websiteCampaignAttribution?.sourceAvailable === true;
  const linkedWebsiteRevenue = websiteAttributionAvailable
    ? finite(website?.websiteCampaignAttribution?.attributedRevenue)
    : null;
  const websiteRoas =
    linkedWebsiteRevenue !== null &&
    linkedWebsiteRevenue > 0 &&
    websiteSpend !== null &&
    websiteSpend > 0
      ? linkedWebsiteRevenue / websiteSpend
      : null;

  const periodAr = rangeLabel(from, to, "ar");
  const periodEn = rangeLabel(from, to, "en");
  const periodPrefixAr = periodAr ? `خلال ${periodAr}: ` : "";
  const periodPrefixEn = periodEn ? `For ${periodEn}: ` : "";
  const notifications = [];

  const leadParts = [
    totalLeads !== null ? `${integer(totalLeads)} عميلًا محتملًا` : null,
    paidInvoices !== null ? `${integer(paidInvoices)} فاتورة مدفوعة` : null,
    conversion !== null ? `معدل التحويل الفعلي ${decimal(conversion)}%` : null,
    followUp !== null ? `${integer(followUp)} حالة متابعة` : null,
    lost !== null ? `${integer(lost)} صفقة خاسرة` : null,
  ].filter(Boolean);
  if (leadParts.length) {
    const leadPartsEn = [
      totalLeads !== null ? `${integer(totalLeads)} potential customers` : null,
      paidInvoices !== null ? `${integer(paidInvoices)} paid invoices` : null,
      conversion !== null ? `${decimal(conversion)}% actual conversion` : null,
      followUp !== null ? `${integer(followUp)} follow-up cases` : null,
      lost !== null ? `${integer(lost)} lost deals` : null,
    ].filter(Boolean);
    notifications.push({
      key: "leads",
      type: "insights.leads_summary",
      title: {
        ar: "ملخص العملاء المحتملين",
        en: "Potential customers summary",
      },
      body: {
        ar: `${periodPrefixAr}${leadParts.join("، ")}.`,
        en: `${periodPrefixEn}${leadPartsEn.join(", ")}.`,
      },
    });
  }

  if (websiteSales !== null || websiteSpend !== null) {
    const parts = [
      websiteSales !== null ? `${money(websiteSales)} مبيعات` : null,
      websiteSpend !== null ? `${money(websiteSpend)} إنفاق` : null,
    ].filter(Boolean);
    const result =
      websiteRoas !== null
        ? ` كل دولار إنفاق حقق ${decimal(websiteRoas)} دولار مبيعات مرتبطة بالحملات.`
        : websiteSpend !== null && websiteSpend > 0
          ? " لا يوجد إيراد مبيعات مربوط مباشرة بهذه الحملات، لذلك لا يمكن عرض عائد إعلاني موثوق."
          : "";
    const partsEn = [
      websiteSales !== null ? `${moneyEn(websiteSales)} in sales` : null,
      websiteSpend !== null ? `${moneyEn(websiteSpend)} in ad spend` : null,
    ].filter(Boolean);
    const resultEn =
      websiteRoas !== null
        ? ` Each dollar of spend generated ${decimal(websiteRoas)} dollars in campaign-attributed sales.`
        : websiteSpend !== null && websiteSpend > 0
          ? " No sales revenue is directly attributed to these campaigns, so a reliable advertising return cannot be shown."
          : "";
    notifications.push({
      key: "website",
      type: "insights.website_summary",
      title: {
        ar:
          websiteRoas !== null ? "عائد حملات الموقع" : "مبيعات الموقع وحملاته",
        en:
          websiteRoas !== null
            ? "Website campaign return"
            : "Website sales and campaigns",
      },
      body: {
        ar: `${periodPrefixAr}${parts.join("، ")}.${result}`,
        en: `${periodPrefixEn}${partsEn.join(", ")}.${resultEn}`,
      },
    });
  }

  if (campaigns.length) {
    const names = campaigns
      .slice(0, 2)
      .map((campaign) => shortLabel(campaign.campaignName ?? campaign.name));
    const namesAr = names.map(isolate).join("، ");
    notifications.push({
      key: "campaigns",
      type: "insights.campaigns_review",
      title: { ar: "حملات تحتاج مراجعة", en: "Campaigns need review" },
      body: {
        ar: `${periodPrefixAr}${integer(campaigns.length)} حملة تحتاج تدخلًا. أبرزها: ${namesAr}.`,
        en: `${periodPrefixEn}${integer(campaigns.length)} campaigns need attention. Leading items: ${names.join(", ")}.`,
      },
    });
  }

  if (employees.length) {
    const names = employees.map(
      (employee) =>
        `${shortLabel(employee.displayName ?? employee.name, 25)}: ${decimal(employee.performanceScore.overall)} من 100`,
    );
    const namesAr = names.map(isolate).join("، ");
    const namesEn = employees
      .map(
        (employee) =>
          `${shortLabel(employee.displayName ?? employee.name, 25)}: ${decimal(employee.performanceScore.overall)} out of 100`,
      )
      .join(", ");
    notifications.push({
      key: "employees",
      type: "insights.employees_attention",
      title: {
        ar: "أداء الموظفين يحتاج متابعة",
        en: "Employee performance needs follow-up",
      },
      body: {
        ar: `${periodPrefixAr}أقل 3 نتائج حسب مؤشر الأداء العام: ${namesAr}.`,
        en: `${periodPrefixEn}the three lowest measured performance scores are ${namesEn}.`,
      },
    });
  }

  return notifications;
}

async function fetchJson(url, fetchFn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetchFn(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchInsightsBriefData(
  baseUrl,
  { from, to },
  fetchFn = fetch,
) {
  const base = baseUrl.replace(/\/$/, "");
  const query = new URLSearchParams({ from, to }).toString();
  const [overview, leads, teams, website] = await Promise.all(
    ["overview", "leads", "teams", "website"].map((endpoint) =>
      fetchJson(`${base}/api/${endpoint}?${query}`, fetchFn),
    ),
  );
  return { overview, leads, teams, website };
}
