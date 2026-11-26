/**
 * MCP endpoint for outside agents such as Nod: POST /api/mcp.
 *
 * It offers the workspace assistant's own tools (./assistant/tools.js), so an
 * outside agent reads and acts with exactly the same permission checks as the
 * in-app assistant. Calls run as one real workspace user, named by
 * NOD_MCP_USER_EMAIL: give that account only the departments and apps Nod
 * should see. create_task is the only write; the outside agent's own approval
 * step stands in for the in-app Confirm button.
 *
 * It also reads every module in full (qodo_list_endpoints / qodo_get) and,
 * through mcpGateway.js, offers the Insights Hub and Mobde3 tools, so one URL
 * and one token reach every Engosoft dashboard.
 *
 * Off until both NOD_MCP_TOKEN and NOD_MCP_USER_EMAIL are set.
 */
import { Router } from 'express';
import { findOne } from '../store.js';
import { hrWorkspaceOnly, isActiveUser } from '../../shared/permissions.js';
import { TOOL_DEFINITIONS, runTool } from '../assistant/tools.js';
import { McpToolError, mcpHandler } from '../mcp.js';
import { matchReadable, readableRoutes, EXCLUDED_ROUTES } from '../mcpCatalog.js';
import { sliceJson, SLICE_INPUT_PROPERTIES } from '../mcpJsonSlice.js';
import { internalHeaders, selfOrigin } from '../internalCaller.js';
import { gatewayTools } from '../mcpGateway.js';
import { auditToolCall, auditUnauthorized } from '../mcpAudit.js';
import { anyKeyConfigured, authenticateKey } from '../mcpKeys.js';
import { callRefusal, filterListing, toolVisible } from '../mcpScopes.js';

const WRITE_TOOLS = new Set(['create_task']);

const TITLES = {
  list_projects: 'List projects',
  project_health: 'Project health',
  project_overdue_work: 'Overdue project work',
  project_workload: 'Project workload',
  list_apps: 'List workspace apps',
  list_departments: 'List departments',
  search_tasks: 'Search tasks',
  task_summary: 'Task summary',
  decision_brief: 'Decision brief',
  list_team: 'List team',
  create_task: 'Create a task',
  recent_activity: 'Recent activity',
  insights_metrics: 'Marketing & sales figures',
  support_metrics: 'Customer-service figures',
};

const lang = () => (process.env.NOD_MCP_LANG === 'en' ? 'en' : 'ar');

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };

/**
 * Every module's screens, read in full: HR (employees, Odoo records, payroll,
 * performance, personnel, leave, recruitment, offers), KPI, projects, learning
 * production, events and e-learning, calendar, management, booking and more.
 * Each call is an ordinary GET to this server as the MCP account, so the
 * route's own permission checks decide what comes back.
 */
const listEndpoints = {
  name: 'qodo_list_endpoints',
  title: 'List every workspace data endpoint',
  description:
    'Lists every data endpoint of every Qodo module: HR (employees and their Odoo records, people, payroll, organization, ' +
    'performance reviews, reports, personnel files, leave, recruitment requests, Odoo jobs and pipelines, recruiter KPIs, ' +
    'rewards, offers), KPI scorecards, tasks, projects (phases, tasks, schedule, issues, time, budget, documents, reports), ' +
    'learning production, events and e-learning analytics, calendar, management, booking, offices, prices, users and activity. ' +
    'Read any of them in full with qodo_get. Paths with :name segments need a real id in their place.',
  inputSchema: {
    type: 'object',
    properties: { module: { type: 'string', description: 'Optional module to narrow the list, e.g. HR, Recruitment, KPI, Projects.' } },
    additionalProperties: false,
  },
  annotations: READ_ONLY,
  run: async (args, ctx) => {
    const filter = String(args.module || '').trim().toLowerCase();
    const routes = readableRoutes(ctx.app).filter((route) => !filter || route.module.toLowerCase().includes(filter));
    const modules = {};
    for (const route of routes) {
      modules[route.module] ??= { about: route.about, endpoints: [] };
      modules[route.module].endpoints.push(route.path);
    }
    // A key limited to some sections only sees those sections' endpoints.
    const visible = filterListing(ctx.key?.scopes ?? {}, 'qodo_list_endpoints', { modules, count: routes.length });
    return {
      count: visible.count,
      modules: visible.modules,
      leftOut: EXCLUDED_ROUTES.map(([pattern, reason]) => ({ pattern: String(pattern), reason })),
      paging:
        'qodo_get returns small answers whole. A large one comes back as an outline; then pass path and page lists with offset/limit until nextOffset is gone.',
    };
  },
};

const getEndpoint = {
  name: 'qodo_get',
  title: 'Read any workspace endpoint in full',
  description:
    'Reads one endpoint from qodo_list_endpoints and returns everything that screen shows, e.g. /api/hr/people, ' +
    '/api/hr/employees/EMP001/odoo, /api/hr/personnel/leave, /api/hr/recruitment/requests, /api/kpi/overview. ' +
    'Replace :name segments with real ids taken from list endpoints. Large answers come back as an outline first; ' +
    'then read parts with path and page lists with offset and limit.',
  inputSchema: {
    type: 'object',
    properties: {
      endpoint: { type: 'string', description: 'Concrete path, e.g. /api/hr/people or /api/projects/<id>/tasks.' },
      params: {
        type: 'object',
        description: 'Query parameters the screen uses, e.g. {"from":"2026-11-01","department":"sales"}.',
        additionalProperties: { type: ['string', 'number', 'boolean'] },
      },
      ...SLICE_INPUT_PROPERTIES,
    },
    required: ['endpoint'],
    additionalProperties: false,
  },
  annotations: READ_ONLY,
  run: async (args, ctx) => {
    const match = matchReadable(ctx.app, args.endpoint);
    if (!match) throw new McpToolError('Unknown or excluded endpoint. Call qodo_list_endpoints for the readable paths.');
    const raw = args.params;
    if (raw !== undefined && (typeof raw !== 'object' || raw === null || Array.isArray(raw))) {
      throw new McpToolError('"params" must be an object.');
    }
    const url = new URL(match.concrete, selfOrigin());
    // The URL parser normalises dot segments; what is fetched must be what was checked.
    if (url.pathname !== match.concrete) throw new McpToolError('That endpoint path is not allowed.');
    for (const [key, value] of Object.entries(raw || {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    const response = await fetch(url, {
      headers: { accept: 'application/json', ...internalHeaders(ctx.user) },
      redirect: 'manual',
      signal: AbortSignal.timeout(120_000),
    });
    const type = response.headers.get('content-type') || '';
    if (!type.includes('json')) {
      throw new McpToolError(`${match.concrete} answered HTTP ${response.status} with ${type || 'no content type'}, not JSON.`);
    }
    const body = await response.json();
    const slice = sliceJson(body, {
      path: typeof args.path === 'string' ? args.path : '',
      offset: typeof args.offset === 'number' ? args.offset : undefined,
      limit: typeof args.limit === 'number' ? args.limit : undefined,
    });
    return { endpoint: match.concrete, route: match.path, module: match.module, httpStatus: response.status, ...slice };
  },
};

/** A GET to this server as the MCP account, so the route's own permission checks decide. */
async function internalGet(ctx, path, params = {}) {
  const url = new URL(path, selfOrigin());
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: { accept: 'application/json', ...internalHeaders(ctx.user) },
    redirect: 'manual',
    signal: AbortSignal.timeout(120_000),
  });
  const type = response.headers.get('content-type') || '';
  const body = type.includes('json') ? await response.json() : null;
  return { status: response.status, body };
}

const DAY_PATTERN = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };

function refusedOrFailed(status, body, what) {
  if (status === 403) throw new McpToolError(`The MCP account may not read ${what}.`);
  if (status === 503) throw new McpToolError(`${what} is not available right now (${body?.error || 'service unavailable'}).`);
  throw new McpToolError(`${what} answered HTTP ${status}${body?.error ? ` (${body.error})` : ''}.`);
}

/**
 * "Tell me about Ahmed" in one call: finds the person by code or name, then
 * returns their profile summary — job, manager, today at the fingerprint
 * device, the period's attendance with Odoo leave laid over it, and leave
 * balances and requests.
 */
const employeeProfile = {
  name: 'hr_employee_profile',
  title: 'Employee profile with attendance and leave',
  description:
    'One employee\'s full profile: HR code, Arabic and English name, job, department, manager, hiring date, status, ' +
    'today\'s fingerprint punches (first in, last out, in the office now), the period\'s attendance (present, absent, ' +
    'unexcused absences, late days and minutes, early leave, missing punches, average arrival and hours, overtime, ' +
    'attendance rate with and without leave) and Odoo time off (balances left per type, approved, upcoming and pending ' +
    'requests). Pass an HR employee code or a name in Arabic or English. If several people match, the matches come back ' +
    'to choose from. Defaults to the last 30 days; pass from/to (YYYY-MM-DD) for another period.',
  inputSchema: {
    type: 'object',
    properties: {
      employee: { type: 'string', description: 'HR employee code (e.g. 216) or a name, Arabic or English.' },
      from: { ...DAY_PATTERN, description: 'First day, YYYY-MM-DD. Default: 29 days before "to".' },
      to: { ...DAY_PATTERN, description: 'Last day, YYYY-MM-DD. Default: today.' },
    },
    required: ['employee'],
    additionalProperties: false,
  },
  annotations: READ_ONLY,
  run: async (args, ctx) => {
    const wanted = String(args.employee || '').trim();
    if (!wanted) throw new McpToolError('Name an employee by code or name.');
    const range = { from: args.from, to: args.to };
    const summaryOf = async (code) => internalGet(ctx, `/api/hr/employees/${encodeURIComponent(code)}/summary`, range);
    if (/^(\d{1,8}|o\d+)$/i.test(wanted)) {
      const direct = await summaryOf(wanted);
      if (direct.status === 200) return direct.body;
      if (direct.status !== 404) refusedOrFailed(direct.status, direct.body, 'This employee');
    }
    const search = await internalGet(ctx, '/api/hr/people/search', { q: wanted, limit: 8 });
    if (search.status !== 200) refusedOrFailed(search.status, search.body, 'The employee directory');
    const matches = search.body?.matches ?? [];
    if (!matches.length) throw new McpToolError(`No employee matches "${wanted}".`);
    const best = matches[0];
    const clear = matches.length === 1 || best.score >= 90 && (matches[1]?.score ?? 0) < best.score;
    if (!clear) {
      return { ambiguous: true, note: 'Several employees match; call again with one employeeCode.', matches };
    }
    const found = await summaryOf(best.employeeCode);
    if (found.status !== 200) refusedOrFailed(found.status, found.body, 'This employee');
    return found.body;
  },
};

const minuteText = (value) => (typeof value === 'string' ? value.slice(0, 5) : null);

/** Who is in, late, absent, on leave or not yet in on one day, from the fingerprint devices. */
const attendanceToday = {
  name: 'hr_attendance_today',
  title: 'Attendance today (fingerprint)',
  description:
    'Who is in the office, on time, late, absent, on approved Odoo leave or away (WFH, mission), or not in yet, on one day, ' +
    'from the ZKTeco fingerprint devices, with first and last punch per person. Defaults to today (the last synced day). ' +
    'Optionally narrow to one department.',
  inputSchema: {
    type: 'object',
    properties: {
      date: { ...DAY_PATTERN, description: 'The day, YYYY-MM-DD. Default: today.' },
      department: { type: 'string', description: 'Optional department name (or part of it) to narrow to.' },
    },
    additionalProperties: false,
  },
  annotations: READ_ONLY,
  run: async (args, ctx) => {
    const params = args.date ? { from: args.date, to: args.date } : {};
    const { status, body } = await internalGet(ctx, '/api/hr/attendance', params);
    if (status !== 200) refusedOrFailed(status, body, 'Attendance');
    if (!body?.connected) throw new McpToolError('The fingerprint attendance service is not connected to Qodo.');
    const department = String(args.department || '').trim().toLowerCase();
    const groups = {};
    for (const [key, rows] of Object.entries(body.snapshot?.people ?? {})) {
      const kept = (rows ?? []).filter((row) => !department || String(row.department || '').toLowerCase().includes(department));
      if (!kept.length) continue;
      groups[key] = kept.map((row) => ({
        code: row.hr?.hrCode ?? row.code,
        name: row.hr?.nameArabic || row.name || row.hr?.nameEnglish || '',
        department: row.department || '',
        firstIn: minuteText(row.first),
        lastOut: minuteText(row.last),
        lateMinutes: row.late ? Math.round(row.late) : 0,
        inOfficeNow: Boolean(row.in_office),
        timeOff: row.timeOff?.type ?? undefined,
      }));
    }
    return {
      day: body.range?.snapshot,
      dataUntil: body.range?.data_until,
      dayType: body.snapshot?.type,
      inOfficeNow: body.snapshot?.in_office,
      counts: Object.fromEntries(Object.entries(groups).map(([key, rows]) => [key, rows.length])),
      people: groups,
      legend: {
        ontime: 'arrived on time', late: 'arrived after shift start + grace', in: 'in, one punch so far', present: 'present (flexible shift)',
        incomplete: 'one punch only on a past day', absent: 'no punch, no approved leave', pending: 'not in yet, shift still running',
        leave: 'on approved Odoo leave', away: 'away on an Odoo away type (WFH, mission, permission)', extra: 'worked on a day off',
      },
    };
  },
};

const ASSISTANT_TOOLS = TOOL_DEFINITIONS.map((definition) => ({
    name: definition.name,
    title: TITLES[definition.name] ?? definition.name,
    description: definition.description,
    inputSchema: definition.input_schema,
    annotations: WRITE_TOOLS.has(definition.name)
      ? { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
      : { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    run: (args, ctx) => runTool(definition.name, args, ctx.user, lang()),
}));

const LOCAL_TOOLS = [...ASSISTANT_TOOLS, employeeProfile, attendanceToday, listEndpoints, getEndpoint];

export const QODO_MCP = {
  name: 'engosoft-workspace',
  version: '2.0.0',
  instructions:
    'Engosoft workspace: one MCP for every Engosoft dashboard. ' +
    'Qodo (company workspace): quick answers with list_projects, task_summary, decision_brief, list_team, recent_activity; ' +
    'one employee\'s profile, attendance and leave with hr_employee_profile; who is in, late or absent today with hr_attendance_today; ' +
    'full data of every module, HR first, with qodo_list_endpoints then qodo_get. ' +
    'Insights Hub (marketing, ads, CRM, sales, accounting, P&L, courses from Odoo): insights_list_surfaces/insights_read for ' +
    'headline figures, insights_list_endpoints/insights_get for every ad set, ad, creative, lead and row. ' +
    'Mobde3 / Social Pulse (organic social, content calendar, website): pulse_* tools. ' +
    'Large answers come back as an outline; read them in parts with path, offset and limit. ' +
    'Every call carries user_message: the person\'s own message that led to it, word for word in its original language; ' +
    'these messages are recorded in the workspace audit log. ' +
    'Report each figure with its period and any caveat the answer carries, in the owner\'s language. ' +
    'Write only when the owner asks: create_task, pulse_create_draft and insights_refresh_data are the only actions.',
  tools: LOCAL_TOOLS,
  // Each key sees only the tools its scope includes (see mcpScopes.js); the master key sees all.
  listTools: async (ctx) => {
    const all = [...LOCAL_TOOLS, ...(await gatewayTools(LOCAL_TOOLS.map((tool) => tool.name)))];
    const scopes = ctx?.key?.scopes;
    return scopes ? all.filter((tool) => toolVisible(scopes, tool)) : all;
  },
  authorize: (ctx, tool, args) => {
    const endpoint = typeof args?.endpoint === 'string' ? args.endpoint : '';
    if (/[%\\]/.test(endpoint)) return 'Encoded or backslashed endpoint paths are not allowed.';
    return ctx?.key?.scopes ? callRefusal(ctx.key.scopes, tool, args) : null;
  },
  // Personal keys from Settings → MCP keys, plus NOD_MCP_TOKEN as the master key.
  enabled: anyKeyConfigured,
  authenticate: authenticateKey,
  // Every call carries the person's message (see mcp.js). Personal keys must send
  // it; the master key may leave it out, so the connection already running keeps working.
  captureMessage: true,
  requireMessage: (ctx) => ctx?.key?.master !== true,
  // Settings → Activity → MCP: every call, and refused tokens (see mcpAudit.js).
  onToolCall: auditToolCall,
  onUnauthorized: auditUnauthorized,
};

/** The workspace account Nod acts as. Re-read each request, so disabling it takes effect at once. */
async function resolveContext(req) {
  const email = String(process.env.NOD_MCP_USER_EMAIL || '').trim().toLowerCase();
  if (!email) return { status: 503, error: 'Set NOD_MCP_USER_EMAIL to the workspace account Nod acts as.' };
  const user = await findOne('users', (u) => String(u.email || '').toLowerCase() === email);
  if (!isActiveUser(user)) return { status: 403, error: 'The MCP account is missing, disabled or not approved.' };
  if (hrWorkspaceOnly(user)) return { status: 403, error: 'The MCP account is limited to HR and cannot use these tools.' };
  return { user, app: req.app };
}

const router = Router();
router.all('/', mcpHandler(QODO_MCP, resolveContext));

export default router;
