/**
 * What one MCP key may reach.
 *
 * A key names, per dashboard, either everything (`null`), nothing (absent or
 * `false`) or a list of sections. Sections are coarse on purpose ("HR",
 * "Ads & campaigns", "P&L") so an owner can grant them without knowing the API,
 * and each maps to the tools and endpoint paths behind it.
 *
 * Fail-closed throughout: a tool, endpoint or surface that no section claims is
 * refused whenever that dashboard is restricted, so a new page is never opened
 * to a restricted key by accident. Unrestricted dashboards (`null`) are not
 * checked beyond the route's own permissions.
 */

/** `prefix*` matches a path prefix; anything else must match exactly. */
const matches = (path, patterns) =>
  patterns.some((pattern) => (pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : path === pattern));

export const SECTIONS = {
  qodo: {
    hr: {
      ar: 'الموارد البشرية (الموظفين، المرتبات، الأداء، الإجازات، التوظيف)',
      en: 'HR (employees, payroll, performance, leave, recruitment)',
      paths: ['/api/hr/*', '/api/hr-operations/*'],
      tools: ['hr_employee_profile', 'hr_attendance_today'],
    },
    kpi: { ar: 'مؤشرات الأداء KPI', en: 'KPI scorecards', paths: ['/api/kpi/*'], tools: [] },
    tasks: {
      ar: 'المهام والأقسام',
      en: 'Tasks and departments',
      paths: ['/api/tasks', '/api/tasks/*'],
      tools: ['search_tasks', 'task_summary', 'list_departments', 'create_task'],
    },
    projects: {
      ar: 'المشاريع',
      en: 'Projects',
      paths: ['/api/projects', '/api/projects/*'],
      tools: ['list_projects', 'project_health', 'project_overdue_work', 'project_workload'],
    },
    learning: { ar: 'إنتاج الكورسات', en: 'Learning production', paths: ['/api/learning-production/*'], tools: [] },
    events: { ar: 'الإيفنتات والتعليم الإلكتروني', en: 'Events & e-learning', paths: ['/api/events/*'], tools: [] },
    calendar: {
      ar: 'التقويم والحجوزات والمكاتب',
      en: 'Calendar, booking and offices',
      paths: ['/api/calendar/*', '/api/booking', '/api/booking/*', '/api/book/*', '/api/offices', '/api/offices/*'],
      tools: [],
    },
    management: { ar: 'مكتب الإدارة', en: 'Management desk', paths: ['/api/management/*'], tools: [] },
    prices: { ar: 'الأسعار', en: 'Prices', paths: ['/api/prices/*'], tools: [] },
    workspace: {
      ar: 'الفريق والتطبيقات وسجل النشاط',
      en: 'Team, apps and activity log',
      paths: ['/api/users', '/api/users/*', '/api/apps', '/api/apps/*', '/api/notifications', '/api/notifications/*', '/api/assistant/*', '/api/health'],
      tools: ['list_team', 'list_apps', 'recent_activity', 'support_metrics'],
    },
  },
  insights: {
    marketing: {
      ar: 'الإعلانات والحملات والكرييتف والموقع والسوشيال',
      en: 'Ads, campaigns, creatives, website and social',
      paths: [
        '/api/overview', '/api/overview-revenue-source', '/api/campaigns', '/api/campaign-risk', '/api/ads', '/api/ads-creatives',
        '/api/acquisition/*', '/api/media-buyers', '/api/media-plan', '/api/media-plan-activity', '/api/media-plan-leads',
        '/api/meta-destination-mix', '/api/meta/*', '/api/attribution/*', '/api/landing-attribution/*', '/api/website',
        '/api/organic', '/api/source-reconciliation', '/api/marketing-costs',
      ],
      surfaces: ['overview', 'campaigns', 'ads', 'website', 'social_media', 'acquisition_performance', 'attribution', 'organic', 'media_buyers', 'media_plan', 'number_review'],
      tools: ['insights_metrics'],
    },
    crm: {
      ar: 'الليدز والـ CRM والفرق والمكالمات',
      en: 'Leads, CRM, teams and calls',
      paths: [
        '/api/leads', '/api/lead-*', '/api/uncalled-leads', '/api/weekly-lead-followup', '/api/quarter-leads-review',
        '/api/course-lead-alerts', '/api/lost', '/api/lost-*', '/api/crm-calls', '/api/employee-*', '/api/teams', '/api/targets',
        '/api/daily-updates', '/api/weekend', '/api/management-review', '/api/yoy', '/api/telegram/preview',
      ],
      surfaces: ['leads', 'lost', 'teams', 'weekend', 'yoy', 'management_review', 'daily_updates', 'quarter_leads_review'],
      tools: [],
    },
    sales: {
      ar: 'المبيعات والمحاسبة والكورسات والأسعار (من غير الأرباح والخسائر)',
      en: 'Sales, accounting, courses and pricing (without P&L)',
      paths: [
        '/api/sales', '/api/accounting', '/api/accounting-net-sales', '/api/full-invoiced', '/api/revenue-cohorts', '/api/courses',
        '/api/agent-course-*', '/api/products', '/api/pricing/*', '/api/prices/*',
      ],
      surfaces: ['accounting', 'courses', 'pricing'],
      tools: [],
    },
    pnl: {
      ar: 'الأرباح والخسائر (P&L)',
      en: 'Profit and loss (P&L)',
      paths: ['/api/profitability', '/api/profitability-ledger'],
      surfaces: ['accounting/profitability'],
      tools: [],
    },
  },
  pulse: {
    analytics: {
      ar: 'التحليلات (كل البوستات، يوتيوب، الحسابات، الموقع)',
      en: 'Analytics (every post, YouTube, accounts, website)',
      paths: ['/api/dashboard', '/api/insights', '/api/social/youtube/*', '/api/social/accounts/*'],
      tools: ['pulse_overview', 'pulse_list_posts', 'pulse_alerts', 'pulse_website'],
    },
    calendar: {
      ar: 'الكالندر والنشر',
      en: 'Calendar and publishing',
      paths: ['/api/calendar-posts', '/api/calendar-posts/*', '/api/google-calendar', '/api/publishing', '/api/publishing/*'],
      tools: ['pulse_calendar', 'pulse_create_draft'],
    },
    content: {
      ar: 'المحتوى والحملات والمنافسين والكورسات والاستوديو',
      en: 'Content, campaigns, competitors, courses and studio',
      paths: [
        '/api/content', '/api/content/*', '/api/campaigns', '/api/campaigns/*', '/api/radar', '/api/course-profiles', '/api/odoo/*',
        '/api/schedule/*', '/api/ai-templates', '/api/svg-templates', '/api/svg-templates/*', '/api/studio/*', '/api/ai/*',
        '/api/reference-design/*', '/api/social/content/*', '/api/social/assets/*', '/api/social/linkedin/*',
      ],
      tools: [],
    },
    team: {
      ar: 'الفريق والإعدادات والاستخدام',
      en: 'Team, settings and usage',
      paths: [
        '/api/users', '/api/permissions', '/api/usage', '/api/storage', '/api/settings/*', '/api/notifications',
        '/api/social/connections', '/api/social/publishing-services/*', '/api/health',
      ],
      tools: [],
    },
  },
};

export const APPS = ['qodo', 'insights', 'pulse'];

/** Which dashboard a tool belongs to. */
export function appOfTool(name) {
  if (name.startsWith('pulse_')) return 'pulse';
  if (name.startsWith('insights_')) return 'insights';
  return 'qodo';
}

/** Tools that read across a whole dashboard, so only an unrestricted key may use them. */
const WHOLE_APP_TOOLS = new Set(['decision_brief']);
const WHOLE_APP_PATHS = { qodo: ['/api/search'], insights: ['/api/search', '/api/agent-insights', '/api/filters', '/api/health'], pulse: [] };
/** Listing tools: allowed whenever the dashboard is, their output is filtered. */
const LIST_TOOLS = new Set(['qodo_list_endpoints', 'insights_list_endpoints', 'insights_list_surfaces', 'pulse_list_endpoints']);
const GET_TOOLS = new Set(['qodo_get', 'insights_get', 'pulse_get']);

export const FULL_ACCESS = Object.freeze({ qodo: null, insights: null, pulse: null, actions: true });

/** Normalizes a stored or submitted scope, dropping unknown apps and sections. */
export function cleanScopes(input) {
  const out = { actions: input?.actions === true };
  for (const app of APPS) {
    const value = input?.[app];
    if (value === null) out[app] = null;
    else if (Array.isArray(value)) {
      const known = [...new Set(value.filter((section) => typeof section === 'string' && SECTIONS[app][section]))];
      if (known.length) out[app] = known;
    }
  }
  return out;
}

export const appAllowed = (scopes, app) => scopes[app] === null || Array.isArray(scopes[app]);
const restricted = (scopes, app) => Array.isArray(scopes[app]);
const sectionsOf = (scopes, app) => (scopes[app] || []).map((id) => SECTIONS[app][id]);

export function pathAllowed(scopes, app, path) {
  if (!appAllowed(scopes, app)) return false;
  if (!restricted(scopes, app)) return true;
  if (matches(path, WHOLE_APP_PATHS[app] || [])) return false;
  return sectionsOf(scopes, app).some((section) => matches(path, section.paths));
}

function surfaceAllowed(scopes, surface, view) {
  if (!appAllowed(scopes, 'insights')) return false;
  if (!restricted(scopes, 'insights')) return true;
  const allowed = sectionsOf(scopes, 'insights').flatMap((section) => section.surfaces || []);
  // The P&L is a view of the accounting surface with its own section.
  if (surface === 'accounting' && view === 'profitability') return allowed.includes('accounting/profitability');
  return allowed.includes(surface);
}

/** True when a write tool is involved and the key may not write. */
const isWrite = (tool) => tool.annotations?.readOnlyHint === false;

/** Whether a key may see a tool in tools/list. */
export function toolVisible(scopes, tool) {
  const app = appOfTool(tool.name);
  if (tool.name === 'insights_metrics') {
    if (!pathAllowed(scopes, 'insights', '/api/overview')) return false;
  } else if (!appAllowed(scopes, app)) return false;
  if (isWrite(tool) && !scopes.actions) return false;
  if (!restricted(scopes, app) || tool.name === 'insights_metrics') return true;
  if (WHOLE_APP_TOOLS.has(tool.name)) return false;
  if (LIST_TOOLS.has(tool.name) || GET_TOOLS.has(tool.name) || tool.name === 'insights_read') return true;
  return sectionsOf(scopes, app).some((section) => section.tools.includes(tool.name));
}

/**
 * Null when the call is allowed, otherwise the reason it is not. `endpoint`
 * is the path a get tool will read (already resolved for qodo_get).
 */
export function callRefusal(scopes, tool, args) {
  if (!toolVisible(scopes, tool)) return `This key does not include ${tool.name}.`;
  const app = appOfTool(tool.name);
  if (GET_TOOLS.has(tool.name)) {
    const path = String(args?.endpoint || '').trim().split('?')[0].replace(/\/+$/, '');
    if (!pathAllowed(scopes, app, path)) return `This key does not include ${path || 'that endpoint'}.`;
    if (path === '/api/agent-insights' && restricted(scopes, 'insights')) return 'This key does not include the surface gateway.';
  }
  if (tool.name === 'insights_read') {
    const surface = String(args?.surface || '');
    const view = typeof args?.view === 'string' ? args.view : '';
    if (!surfaceAllowed(scopes, surface, view)) return `This key does not include the ${surface || 'requested'} surface.`;
    // With no view, the accounting surface reads its default views, never the P&L.
  }
  return null;
}

/** Drops endpoints a key may not read from a listing tool's JSON answer. */
export function filterListing(scopes, toolName, data) {
  const app = appOfTool(toolName);
  if (!restricted(scopes, app) || !data || typeof data !== 'object') return data;
  const keep = (path) => pathAllowed(scopes, app, path);
  if (toolName === 'insights_list_surfaces' && Array.isArray(data.surfaces)) {
    return { ...data, surfaces: data.surfaces.filter((surface) => surfaceAllowed(scopes, surface.id, '')) };
  }
  if (Array.isArray(data.endpoints)) {
    const endpoints = data.endpoints.filter((entry) => keep(typeof entry === 'string' ? entry : entry.path));
    return { ...data, endpoints, count: endpoints.length };
  }
  for (const key of ['modules', 'tabs']) {
    if (data[key] && typeof data[key] === 'object') {
      const groups = {};
      let count = 0;
      for (const [name, group] of Object.entries(data[key])) {
        const endpoints = (group.endpoints || []).filter(keep);
        if (endpoints.length) {
          groups[name] = { ...group, endpoints };
          count += endpoints.length;
        }
      }
      return { ...data, [key]: groups, count };
    }
  }
  return data;
}

/** A short human summary of a scope, for lists and the audit log. */
export function describeScopes(scopes, lang = 'ar') {
  const names = { qodo: 'Qodo', insights: 'Insights Hub', pulse: lang === 'ar' ? 'مبدع' : 'Mobde3' };
  return APPS.filter((app) => appAllowed(scopes, app)).map((app) =>
    scopes[app] === null
      ? `${names[app]}: ${lang === 'ar' ? 'كله' : 'all'}`
      : `${names[app]}: ${scopes[app].map((id) => SECTIONS[app][id][lang]).join('، ')}`
  );
}
