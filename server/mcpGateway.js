/**
 * One MCP endpoint for the whole workspace.
 *
 * Qodo's /api/mcp also offers the tools of the other Engosoft dashboards that
 * run their own MCP server (Insights Hub, Mobde3 / Social Pulse), so an
 * outside agent connects once, with one token. Each upstream keeps its own
 * token and its own permission checks: this only forwards `tools/call`, and
 * only for tool names that upstream listed itself.
 *
 * Configure each upstream with <NAME>_MCP_URL and <NAME>_MCP_TOKEN. An
 * upstream that is not configured, or not answering, simply contributes no
 * tools; the workspace's own tools keep working.
 */
import { McpToolError, RAW_RESULT } from './mcp.js';

const LIST_TTL_MS = 5 * 60 * 1000;
const LIST_TIMEOUT_MS = 8_000;
const CALL_TIMEOUT_MS = 120_000;

function upstreams() {
  const insightsBase = String(process.env.INSIGHTS_HUB_URL || '').trim().replace(/\/+$/, '');
  return [
    {
      id: 'insights',
      label: 'Insights Hub',
      url: String(process.env.INSIGHTS_MCP_URL || (insightsBase ? `${insightsBase}/api/mcp` : '')).trim(),
      token: String(process.env.INSIGHTS_MCP_TOKEN || '').trim(),
    },
    {
      id: 'pulse',
      label: 'Mobde3 (Social Pulse)',
      url: String(process.env.PULSE_MCP_URL || '').trim(),
      token: String(process.env.PULSE_MCP_TOKEN || '').trim(),
    },
  ].filter((upstream) => allowedUrl(upstream.url) && upstream.token);
}

/** Upstreams get the bearer token, so only https — plain http only for local tests outside production. */
function allowedUrl(url) {
  if (/^https:\/\//.test(url)) return true;
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.MCP_GATEWAY_ALLOW_HTTP === '1' &&
    /^http:\/\/127\.0\.0\.1:\d+\//.test(url)
  );
}

let rpcId = 0;

async function rpc(upstream, method, params, timeoutMs) {
  const response = await fetch(upstream.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${upstream.token}`,
      'mcp-protocol-version': '2025-06-18',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${upstream.label} answered HTTP ${response.status}.`);
  // Streamable HTTP servers may answer as a one-event SSE stream.
  const json = text.startsWith('event:') || text.startsWith('data:')
    ? text.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).pop()
    : text;
  const message = JSON.parse(json || '{}');
  if (message.error) throw new Error(`${upstream.label}: ${message.error.message || 'error'}`);
  return message.result;
}

const cache = new Map(); // upstream id -> { at, tools }

async function toolsFrom(upstream) {
  const hit = cache.get(upstream.id);
  if (hit && Date.now() - hit.at < LIST_TTL_MS) return hit.tools;
  try {
    const result = await rpc(upstream, 'tools/list', {}, LIST_TIMEOUT_MS);
    const tools = Array.isArray(result?.tools) ? result.tools : [];
    cache.set(upstream.id, { at: Date.now(), tools });
    return tools;
  } catch (error) {
    console.warn(`[mcp-gateway] ${upstream.label} tools/list failed: ${error.message}`);
    // Serve the last good list for a while rather than dropping a dashboard on one blip.
    if (hit) return hit.tools;
    return [];
  }
}

/** Upstream tools as local tool objects, skipping any name the workspace already uses. */
export async function gatewayTools(localNames) {
  const taken = new Set(localNames);
  const lists = await Promise.all(upstreams().map(async (upstream) => ({ upstream, tools: await toolsFrom(upstream) })));
  const out = [];
  for (const { upstream, tools } of lists) {
    for (const tool of tools) {
      if (!tool?.name || taken.has(tool.name)) continue;
      taken.add(tool.name);
      out.push({
        name: tool.name,
        title: tool.title ? `${tool.title} · ${upstream.label}` : tool.name,
        description: `[${upstream.label}] ${tool.description || ''}`.trim(),
        inputSchema: tool.inputSchema || { type: 'object', properties: {} },
        annotations: tool.annotations || {},
        run: async (args) => {
          try {
            const result = await rpc(upstream, 'tools/call', { name: tool.name, arguments: args }, CALL_TIMEOUT_MS);
            return { [RAW_RESULT]: result };
          } catch (error) {
            throw new McpToolError(`${upstream.label} could not answer: ${error.message}`);
          }
        },
      });
    }
  }
  return out;
}

/** Which upstreams are configured, for the instructions and a health check. */
export function gatewayStatus() {
  return upstreams().map(({ id, label, url }) => ({ id, label, url }));
}
