/**
 * Every GET route of the workspace API an outside agent may read over MCP.
 *
 * Read from the live Express router rather than a hand-kept list, so a new
 * HR, KPI or project screen is reachable the day it ships. What stays out is
 * named below with its reason: sign-in and invitations, Qodo Mail and chat
 * (the owner kept message content out on 2026-11-25), live event streams, and
 * file downloads, which are not JSON.
 */

const MODULES = [
  ['/api/hr/recruitment/offers', 'HR · Offers', 'Job offers, their sources and catalogue.'],
  ['/api/hr/recruitment', 'HR · Recruitment', 'Hiring requests, team capacity, alerts, Odoo jobs and pipelines, recruiter KPIs and rewards.'],
  ['/api/hr-operations', 'HR · Operations', 'HR operations queue.'],
  ['/api/hr', 'HR', 'Employees and their Odoo records, people directory, payroll, organization, performance reviews, reports, personnel files, leave and HR settings.'],
  ['/api/kpi', 'KPI', 'KPI catalogue, company overview and each scorecard.'],
  ['/api/tasks', 'Tasks', 'The task board: tasks, counts, overview, assignments and comments.'],
  ['/api/projects', 'Projects', 'Projects with phases, task lists, tasks, schedule, issues, time, budget, documents, reports, dashboards and data.'],
  ['/api/learning-production', 'Learning production', 'Course production: courses, lessons, assets, versions, reviews, work queues, reports and portfolio.'],
  ['/api/events', 'Events & e-learning', 'Events, schedule, today, layout and e-learning analytics.'],
  ['/api/calendar', 'Calendar', 'Calendar events and busy times.'],
  ['/api/management', 'Management', 'Management agenda, items and inbox.'],
  ['/api/booking', 'Booking', 'Booking pages and bookings.'],
  ['/api/book', 'Public booking', 'Public booking pages and free slots.'],
  ['/api/offices', 'Offices', 'Offices and who is in which.'],
  ['/api/prices', 'Prices', 'Price list, price advice and price service status.'],
  ['/api/apps', 'Apps', 'Workspace apps.'],
  ['/api/users', 'Users', 'Workspace accounts, roles and permissions.'],
  ['/api/notifications', 'Notifications', 'Notifications and the activity log.'],
  ['/api/search', 'Search', 'Search across the workspace (q=…).'],
  ['/api/assistant', 'Assistant', 'In-app assistant status.'],
  ['/api/health', 'System', 'Server health.'],
];

/** [pattern, reason]. Checked against the full route pattern, e.g. /api/hr/people/:employeeCode/photo. */
export const EXCLUDED_ROUTES = [
  [/^\/api\/mcp(\/|$)/, 'The MCP endpoint itself.'],
  [/^\/api\/auth(\/|$)/, 'Sign-in, sessions and the account directory of the signed-in browser.'],
  [/^\/api\/invites(\/|$)/, 'Invitation tokens.'],
  [/^\/api\/push(\/|$)/, 'Browser push keys.'],
  [/^\/api\/mail(\/|$)/, 'Qodo Mail and chat content, kept out by the owner.'],
  [/^\/api\/hr-forms\//, 'One-time form tokens.'],
  [/^\/api\/book\/manage\//, 'A guest\'s private booking link.'],
  [/\/stream$/, 'Live event stream, not a JSON answer.'],
  [/\/(files|attachments)(\/|$)/, 'File download.'],
  [/\/photo$/, 'Image.'],
  [/\.csv$/, 'CSV download; the same data is available as JSON.'],
  [/\/(download|file|cover|export)$/, 'File download.'],
  [/\/candidate-files\//, 'File download.'],
];

export function excludedReason(path) {
  const hit = EXCLUDED_ROUTES.find(([pattern]) => pattern.test(path));
  return hit ? hit[1] : null;
}

export function moduleOf(path) {
  const hit = MODULES.find(([prefix]) => path === prefix || path.startsWith(prefix + '/'));
  return hit ? { module: hit[1], about: hit[2] } : { module: 'Other', about: '' };
}

/**
 * The mount path of a router layer, rebuilt from its regexp (Express 4 keeps
 * no string). `/api/projects/:projectId/tasks` comes back with its `:param`.
 */
function mountPath(layer) {
  if (layer.regexp?.fast_slash) return '';
  const keys = layer.keys || [];
  let index = 0;
  const source = layer.regexp.source
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
    .replace(/\(\?=\\\/\|\$\)$/, '');
  return source
    .replace(/\(\?:(\\\/)?\(\[\^\\?\/]\+\?\)\)/g, (_m, slash) => `${slash ? '/' : ''}:${keys[index++]?.name ?? 'param'}`)
    .replace(/\\\//g, '/')
    .replace(/\\\./g, '.')
    .replace(/\\-/g, '-');
}

function walk(stack, prefix, out) {
  for (const layer of stack || []) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      if (!layer.route.methods?.get) continue;
      for (const path of paths) {
        if (typeof path !== 'string') continue;
        const full = (prefix + (path === '/' ? '' : path)).replace(/\/+/g, '/') || '/';
        out.add(full);
      }
    } else if (layer.name === 'router' && layer.handle?.stack) {
      walk(layer.handle.stack, prefix + mountPath(layer), out);
    }
  }
}

/** Every readable GET route of `app`, grouped by module. */
export function readableRoutes(app) {
  const all = new Set();
  walk(app?._router?.stack, '', all);
  const routes = [...all].filter((path) => path.startsWith('/api/') && !excludedReason(path)).sort();
  return routes.map((path) => ({ path, ...moduleOf(path) }));
}

/** Compiles a route pattern such as /api/hr/employees/:employeeCode into a matcher. */
function patternRegex(pattern) {
  const escaped = pattern
    .split('/')
    .map((part) => (part.startsWith(':') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${escaped}$`);
}

/**
 * Resolves a concrete path the agent asks for to a readable route, or null.
 * The path must be a plain absolute API path; no scheme, host, `..` or query.
 */
export function matchReadable(app, requested) {
  const path = String(requested || '').trim().split('?')[0].replace(/\/+$/, '');
  if (!/^\/api\/[A-Za-z0-9/_.:%@-]+$/.test(path) || path.includes('..') || path.includes('//')) return null;
  if (excludedReason(path)) return null;
  const routes = readableRoutes(app);
  const exact = routes.find((route) => route.path === path && !path.includes(':'));
  if (exact) return { ...exact, concrete: path };
  if (path.includes(':')) return null;
  const hit = routes.find((route) => route.path.includes(':') && patternRegex(route.path).test(path));
  return hit ? { ...hit, concrete: path } : null;
}
