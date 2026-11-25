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
    return {
      count: routes.length,
      modules,
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

const LOCAL_TOOLS = [...ASSISTANT_TOOLS, listEndpoints, getEndpoint];

export const QODO_MCP = {
  name: 'engosoft-workspace',
  version: '2.0.0',
  instructions:
    'Engosoft workspace: one MCP for every Engosoft dashboard. ' +
    'Qodo (company workspace): quick answers with list_projects, task_summary, decision_brief, list_team, recent_activity; ' +
    'full data of every module, HR first, with qodo_list_endpoints then qodo_get. ' +
    'Insights Hub (marketing, ads, CRM, sales, accounting, P&L, courses from Odoo): insights_list_surfaces/insights_read for ' +
    'headline figures, insights_list_endpoints/insights_get for every ad set, ad, creative, lead and row. ' +
    'Mobde3 / Social Pulse (organic social, content calendar, website): pulse_* tools. ' +
    'Large answers come back as an outline; read them in parts with path, offset and limit. ' +
    'Report each figure with its period and any caveat the answer carries, in the owner\'s language. ' +
    'Write only when the owner asks: create_task, pulse_create_draft and insights_refresh_data are the only actions.',
  tools: LOCAL_TOOLS,
  listTools: async () => [...LOCAL_TOOLS, ...(await gatewayTools(LOCAL_TOOLS.map((tool) => tool.name)))],
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
