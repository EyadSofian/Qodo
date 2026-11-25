/**
 * A minimal, stateless MCP server over Streamable HTTP (JSON responses only),
 * for outside agents such as Nod.
 *
 * Why hand-rolled: an MCP client only needs `initialize`, `tools/list` and
 * `tools/call` here. Every request is answered on its own, with no session and
 * no SSE stream, so the protocol is a few JSON-RPC methods.
 *
 * Auth: every request needs `Authorization: Bearer <NOD_MCP_TOKEN>`. Without
 * that variable the endpoint is off (503), so deploying changes nothing until
 * the token is set.
 */
import crypto from 'node:crypto';

const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

/** Thrown by a tool for a caller mistake; returned to the model as a tool error. */
export class McpToolError extends Error {}

/**
 * A tool may return `{ [RAW_RESULT]: result }` to hand back an MCP tool result
 * untouched. The gateway uses it for tools that live on another server.
 */
export const RAW_RESULT = Symbol('mcp.rawResult');

/** `spec.listTools(ctx)` lets the tool list depend on the request, e.g. upstream servers. */
const toolsOf = async (spec, ctx) => (typeof spec.listTools === 'function' ? spec.listTools(ctx) : spec.tools);

const digest = (value) => crypto.createHash('sha256').update(value).digest();

export function bearerMatches(header, expected) {
  const supplied = String(header || '').replace(/^Bearer\s+/i, '').trim();
  if (!supplied || !expected) return false;
  return crypto.timingSafeEqual(digest(supplied), digest(expected));
}

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

async function answer(spec, message, ctx) {
  const id = message.id ?? null;
  const params = message.params ?? {};
  switch (message.method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: spec.name, version: spec.version },
          instructions: spec.instructions,
        },
      };
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: (await toolsOf(spec, ctx)).map(({ name, title, description, inputSchema, annotations }) => ({
            name,
            title,
            description,
            inputSchema,
            annotations,
          })),
        },
      };
    case 'tools/call': {
      const tool = (await toolsOf(spec, ctx)).find((candidate) => candidate.name === params.name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${String(params.name)}`);
      const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
      const startedAt = Date.now();
      // Every call is reported once, whatever its outcome; a failing audit hook never fails the call.
      const report = (outcome) => {
        if (typeof spec.onToolCall !== 'function') return;
        Promise.resolve()
          .then(() => spec.onToolCall({ ctx, tool, args, ms: Date.now() - startedAt, ...outcome }))
          .catch((error) => console.error('[mcp] audit failed:', error));
      };
      const refusal = typeof spec.authorize === 'function' ? spec.authorize(ctx, tool, args) : null;
      if (refusal) {
        report({ ok: false, bytes: 0, error: refusal, refused: true });
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: refusal }], isError: true },
        };
      }
      try {
        const output = await tool.run(args, ctx);
        if (output && typeof output === 'object' && output[RAW_RESULT]) {
          const raw = output[RAW_RESULT];
          let parsed = raw?.structuredContent ?? null;
          if (!parsed) {
            try { parsed = JSON.parse(raw?.content?.[0]?.text ?? 'null'); } catch { parsed = null; }
          }
          report({
            ok: !raw?.isError,
            bytes: JSON.stringify(raw ?? null).length,
            error: raw?.isError ? raw?.content?.[0]?.text : null,
            output: parsed,
          });
          return { jsonrpc: '2.0', id, result: raw };
        }
        // Existing assistant tools report failures as { error } instead of throwing.
        const failed = Boolean(output && typeof output === 'object' && !Array.isArray(output) && output.error);
        const text = typeof output === 'string' ? output : JSON.stringify(output, null, 1);
        report({ ok: !failed, bytes: text.length, error: failed ? String(output.error) : null, output });
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text }],
            ...(output && typeof output === 'object' && !Array.isArray(output) ? { structuredContent: output } : {}),
            isError: failed,
          },
        };
      } catch (error) {
        const known = error instanceof McpToolError;
        if (!known) console.error(`[mcp] ${tool.name} failed:`, error);
        report({ ok: false, bytes: 0, error: known ? error.message : 'The tool failed on the server.' });
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: known ? error.message : 'The tool failed on the server.' }],
            isError: true,
          },
        };
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${String(message.method)}`);
  }
}

/**
 * Express handler. `resolveContext(req)` returns the context tools run with,
 * or `{ error, status }` to refuse the request.
 */
export function mcpHandler(spec, resolveContext) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    // `spec.authenticate(req)` (personal keys) replaces the single shared token when present.
    let key = null;
    if (typeof spec.authenticate === 'function') {
      if (typeof spec.enabled === 'function' && !(await spec.enabled())) {
        return res.status(503).json({ error: 'MCP access is not enabled on this deployment.' });
      }
      key = await spec.authenticate(req);
    } else {
      const token = String(process.env[spec.tokenEnv || 'NOD_MCP_TOKEN'] || '').trim();
      if (!token) return res.status(503).json({ error: 'MCP access is not enabled on this deployment.' });
      if (bearerMatches(req.headers.authorization, token)) key = { id: 'master', master: true };
    }
    if (!key) {
      if (typeof spec.onUnauthorized === 'function') {
        Promise.resolve().then(() => spec.onUnauthorized(req)).catch(() => {});
      }
      res.setHeader('WWW-Authenticate', 'Bearer realm="mcp"');
      return res.status(401).json({ error: 'Unauthorized.' });
    }
    // Stateless server: no SSE stream to resume and no session to end.
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed.' });
    }

    const ctx = await resolveContext(req);
    if (ctx && !ctx.error) {
      ctx.request = { ip: req.ip, userAgent: String(req.headers['user-agent'] || '').slice(0, 200) };
      ctx.key = key;
    }
    if (ctx?.error) return res.status(ctx.status || 503).json({ error: ctx.error });

    const body = req.body;
    if (!body || typeof body !== 'object') return res.status(400).json(rpcError(null, -32700, 'Parse error'));
    const messages = Array.isArray(body) ? body : [body];
    const replies = [];
    for (const message of messages) {
      if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') {
        replies.push(rpcError(null, -32600, 'Invalid request'));
        continue;
      }
      // Notifications and client responses carry no id and get no reply.
      if (message.id === undefined || !message.method) continue;
      replies.push(await answer(spec, message, ctx));
    }
    if (replies.length === 0) return res.status(202).end();
    return res.json(Array.isArray(body) ? replies : replies[0]);
  };
}
