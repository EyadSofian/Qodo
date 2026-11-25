/**
 * The audit trail of the MCP endpoint: one activity row per tool call.
 *
 * Every call an outside agent (Nod, Instinct, …) makes through /api/mcp lands
 * in the workspace activity log under `mcp.*`, including the calls forwarded
 * to Insights Hub and Mobde3, so Settings → Activity → MCP answers "what did
 * the agent read, when, and did it work". Refused tokens are logged too, at
 * most once a minute per address so a scanner cannot flood the log.
 *
 * Arguments are kept (trimmed) because they are the question that was asked:
 * the endpoint, the period, the page. The answers are not kept; only their
 * size and status.
 */
import { findOne } from './store.js';
import { logActivity } from './auth.js';
import { organizationOf } from '../shared/organization.js';

const MAX_ARGS_CHARS = 800;
const MAX_ERROR_CHARS = 300;

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** What was asked for, in a few words: the endpoint, or the surface and view. */
export function targetOf(args) {
  if (typeof args?.endpoint === 'string' && args.endpoint) return args.endpoint;
  if (typeof args?.surface === 'string' && args.surface) {
    return [args.surface, args.view, args.operation].filter((part) => typeof part === 'string' && part).join(' / ');
  }
  if (typeof args?.title === 'string' && args.title) return clip(args.title, 80);
  return null;
}

export function actionOf(tool, ok) {
  if (!ok) return 'mcp.failed';
  return tool.annotations?.readOnlyHint === false ? 'mcp.write' : 'mcp.read';
}

/** The httpStatus an answer reports, from a local tool or a forwarded one. */
function statusOf(output) {
  const value = output?.httpStatus ?? output?.structuredContent?.httpStatus;
  return Number.isInteger(value) ? value : null;
}

export async function auditToolCall({ ctx, tool, args, ms, ok, bytes, error, output }) {
  if (!ctx?.user) return;
  const target = targetOf(args);
  await logActivity({
    actorId: ctx.user.id,
    action: actionOf(tool, ok),
    subject: 'mcp',
    subjectId: tool.name,
    meta: {
      name: target ? `${tool.name} · ${target}` : tool.name,
      tool: tool.name,
      target,
      args: clip(JSON.stringify(args ?? {}), MAX_ARGS_CHARS),
      ok,
      ms,
      bytes,
      httpStatus: statusOf(output),
      error: error ? clip(String(error), MAX_ERROR_CHARS) : null,
      ip: ctx.request?.ip ?? null,
      userAgent: ctx.request?.userAgent ?? null,
    },
  });
}

const lastRefusal = new Map(); // ip -> ms

export async function auditUnauthorized(req) {
  const ip = String(req.ip || 'unknown');
  const now = Date.now();
  if (now - (lastRefusal.get(ip) ?? 0) < 60_000) return;
  lastRefusal.set(ip, now);
  if (lastRefusal.size > 1_000) {
    for (const [key, at] of lastRefusal) if (now - at > 60_000) lastRefusal.delete(key);
  }
  // Shown to the organization the MCP account belongs to; nobody signed in made this call.
  const email = String(process.env.NOD_MCP_USER_EMAIL || '').trim().toLowerCase();
  const owner = email ? await findOne('users', (u) => String(u.email || '').toLowerCase() === email) : null;
  await logActivity({
    actorId: null,
    organizationId: owner ? organizationOf(owner) : undefined,
    action: 'mcp.unauthorized',
    subject: 'mcp',
    subjectId: null,
    meta: { ip, userAgent: String(req.headers['user-agent'] || '').slice(0, 200) },
  });
}
