/**
 * The workspace assistant — OpenAI.
 *
 * There is no trained or fine-tuned "Engosoft model" here, and there doesn't
 * need to be. What makes a general model understand this workspace is (a) a
 * system prompt describing what each app is for, rebuilt from the live app
 * registry on every request, and (b) the functions in ./assistant/tools.js that
 * read the real data. Fine-tuning would freeze last week's tasks into weights;
 * function calling reads them at question time. See docs/ASSISTANT.md.
 *
 * The model id is an environment variable on purpose — OpenAI renames and
 * retires models faster than this file gets redeployed, so switching is a
 * Railway variable change rather than a code change.
 */

import { Router } from 'express';
import { find } from '../store.js';
import { requireAuth } from '../auth.js';
import { permissionsFor } from '../../shared/permissions.js';
import { DEPARTMENTS } from '../../shared/departments.js';
import { TOOL_DEFINITIONS, TOOL_LABELS, runTool } from '../assistant/tools.js';

const router = Router();
router.use(requireAuth);

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_TOOL_ROUNDS = 6;
const MAX_HISTORY = 20;

let client = null;
async function openai() {
  if (client) return client;
  const { default: OpenAI } = await import('openai');
  client = new OpenAI(); // reads OPENAI_API_KEY from the environment
  return client;
}

/** Anthropic-shaped definitions in tools.js → OpenAI's function schema. */
const OPENAI_TOOLS = TOOL_DEFINITIONS.map((tool) => ({
  type: 'function',
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
  },
}));

router.get('/status', (_req, res) => {
  res.json({ available: Boolean(process.env.OPENAI_API_KEY), model: MODEL });
});

router.post('/chat', async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'assistant_not_configured' });
  }

  const lang = req.body?.lang === 'en' ? 'en' : 'ar';
  const history = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const messages = history
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));

  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'no_user_message' });
  }

  // SSE: the answer arrives token by token, and each function call is announced
  // as it happens so the user sees progress instead of a spinner.
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  let closed = false;
  req.on('close', () => {
    closed = true;
  });

  try {
    const api = await openai();
    const conversation = [
      { role: 'system', content: await buildSystemPrompt(req.user, lang) },
      ...messages,
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      if (closed) return;

      const { text, toolCalls } = await streamRound(api, conversation, (delta) => {
        if (!closed) send({ type: 'text', delta });
      });

      // The assistant turn goes back verbatim, including tool_calls — OpenAI
      // rejects a tool result whose call isn't in the preceding turn.
      conversation.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });

      if (toolCalls.length === 0) break;

      for (const call of toolCalls) {
        send({ type: 'tool', label: TOOL_LABELS[call.function.name]?.[lang] ?? call.function.name });

        let args = {};
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          // A malformed argument blob is the model's mistake to recover from,
          // so it goes back as a tool result rather than killing the request.
          args = { __parseError: true };
        }

        const output = args.__parseError
          ? { error: 'Arguments were not valid JSON. Call the function again with valid JSON.' }
          : await runTool(call.function.name, args, req.user, lang);

        conversation.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(output),
        });
      }

      if (round === MAX_TOOL_ROUNDS - 1) {
        send({
          type: 'error',
          message:
            lang === 'en'
              ? 'That question needs too many steps. Try narrowing it down.'
              : 'هذا السؤال يحتاج خطوات كثيرة. حاول تبسيطه.',
        });
      }
    }

    if (!closed) send({ type: 'done' });
  } catch (err) {
    console.error('[assistant]', err);
    if (!closed) {
      const status = err?.status ?? err?.response?.status;
      send({
        type: 'error',
        message:
          status === 401
            ? lang === 'en'
              ? 'The OpenAI key is not valid. Check OPENAI_API_KEY.'
              : 'مفتاح OpenAI غير صالح. راجع OPENAI_API_KEY.'
            : status === 429
              ? lang === 'en'
                ? 'Rate limited or out of quota on the OpenAI account.'
                : 'تم تجاوز الحد المسموح أو نفد رصيد حساب OpenAI.'
              : lang === 'en'
                ? 'The assistant failed. Try again shortly.'
                : 'تعذّر تشغيل المساعد. حاول مرة أخرى بعد قليل.',
      });
    }
  } finally {
    if (!closed) res.end();
  }
});

/**
 * One streamed completion.
 *
 * Tool calls arrive in fragments across chunks — the name lands in one delta
 * and the JSON arguments dribble in across many more — so they are reassembled
 * by index before anything can be executed.
 */
async function streamRound(api, messages, onText) {
  const stream = await api.chat.completions.create({
    model: MODEL,
    messages,
    tools: OPENAI_TOOLS,
    tool_choice: 'auto',
    stream: true,
  });

  let text = '';
  const byIndex = new Map();

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;

    if (delta.content) {
      text += delta.content;
      onText(delta.content);
    }

    for (const part of delta.tool_calls ?? []) {
      const index = part.index ?? 0;
      if (!byIndex.has(index)) {
        byIndex.set(index, { id: '', type: 'function', function: { name: '', arguments: '' } });
      }
      const call = byIndex.get(index);
      if (part.id) call.id = part.id;
      if (part.function?.name) call.function.name += part.function.name;
      if (part.function?.arguments) call.function.arguments += part.function.arguments;
    }
  }

  const toolCalls = [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, call]) => call)
    .filter((call) => call.function.name);

  return { text, toolCalls };
}

/**
 * Rebuilt per request from the live registry, so an app added in Settings this
 * morning is something the assistant knows about this afternoon.
 */
async function buildSystemPrompt(user, lang) {
  const apps = await find('apps', (a) => a.enabled !== false);
  const catalogue = apps
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    .map((a) => `- ${a.nameAr}${a.nameEn ? ` / ${a.nameEn}` : ''} — ${a.descAr || '—'}`)
    .join('\n');

  const departments = DEPARTMENTS.map(
    (d) => `- ${d.id} (${d.ar} / ${d.en}): ${d.stages.map((s) => s.ar).join(' → ')}`
  ).join('\n');

  const today = new Date().toISOString().slice(0, 10);

  return `You are the assistant inside "Engosoft Workspace", the internal platform that brings every Engosoft app together in one place.

## The person you are talking to
- Name: ${user.name}
- Role: ${user.role}
- Department: ${user.department ?? 'general'}
- Permissions: ${permissionsFor(user).join(', ')}
- Today's date: ${today}

## Apps in the workspace
${catalogue}

## Departments and their board stages
Each department has its own workflow stages, the way Odoo projects do:
${departments}

## What you can do
You have functions that read live workspace data — tasks, people, apps, activity — and one that creates a task. **Always call a function before answering any question about numbers, names, dates or status.** Never guess and never rely on earlier turns for data; it changes.

## Hard limits on what you know
You can see the workspace itself (tasks, users, apps). **You cannot see the data inside the four dashboards** — no conversation counts, no ad spend, no HR sheet rows, no SLA figures.

If asked about any of those: say plainly that the figure lives in that specific app, name the right app from the list above so the person can open it, and **never invent a number.**

## Permissions
The functions enforce the user's permissions automatically. If one returns a permission error, tell the person it is above their access level and to contact an administrator — do not try to work around it.

## Style
- **Reply in ${lang === 'en' ? 'English' : 'Arabic'}.** ${lang === 'en' ? '' : 'Use clear Modern Standard Arabic — natural and readable, not dialect and not stiff officialese.'} If the person writes in the other language, follow them.
- Short and direct. The answer first, supporting detail after.
- When listing tasks, give the title, the assignee and the due date — not every field.
- Numbers come from the functions, stated exactly.
- If the question is ambiguous, ask one short clarifying question instead of guessing.
- Confirm with the person before creating a task from anything less than an explicit request.`;
}

export default router;
