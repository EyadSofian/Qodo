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
 * Off until both NOD_MCP_TOKEN and NOD_MCP_USER_EMAIL are set.
 */
import { Router } from 'express';
import { findOne } from '../store.js';
import { hrWorkspaceOnly, isActiveUser } from '../../shared/permissions.js';
import { TOOL_DEFINITIONS, runTool } from '../assistant/tools.js';
import { mcpHandler } from '../mcp.js';

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

export const QODO_MCP = {
  name: 'engosoft-qodo-workspace',
  version: '1.0.0',
  instructions:
    'Engosoft Workspace (Qodo): the company task board per department, projects, team, apps and the audit log, ' +
    'plus headline marketing and customer-service figures. Every answer comes from live data under the ' +
    'connected account\'s permissions. Use list_team before assigning a task, and list_departments before ' +
    'creating one in a specific department. Create tasks only when the owner asks.',
  tools: TOOL_DEFINITIONS.map((definition) => ({
    name: definition.name,
    title: TITLES[definition.name] ?? definition.name,
    description: definition.description,
    inputSchema: definition.input_schema,
    annotations: WRITE_TOOLS.has(definition.name)
      ? { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
      : { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    run: (args, ctx) => runTool(definition.name, args, ctx.user, lang()),
  })),
};

/** The workspace account Nod acts as. Re-read each request, so disabling it takes effect at once. */
async function resolveContext() {
  const email = String(process.env.NOD_MCP_USER_EMAIL || '').trim().toLowerCase();
  if (!email) return { status: 503, error: 'Set NOD_MCP_USER_EMAIL to the workspace account Nod acts as.' };
  const user = await findOne('users', (u) => String(u.email || '').toLowerCase() === email);
  if (!isActiveUser(user)) return { status: 403, error: 'The MCP account is missing, disabled or not approved.' };
  if (hrWorkspaceOnly(user)) return { status: 403, error: 'The MCP account is limited to HR and cannot use these tools.' };
  return { user };
}

const router = Router();
router.all('/', mcpHandler(QODO_MCP, resolveContext));

export default router;
