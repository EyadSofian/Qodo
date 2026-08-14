/**
 * The workspace assistant behind an OpenAI-compatible provider.
 *
 * The Qodo model is fine-tuned for Arabic behaviour and tool selection, never
 * for live company facts. A system prompt is rebuilt from the app registry on
 * every request, and ./assistant/tools.js reads current data under the signed-in
 * user's permissions. See docs/ASSISTANT.md and ai/qodo-model/MODEL_CARD.md.
 *
 * The endpoint and model id are environment variables so the local Qodo model,
 * a hosted compatible endpoint, or OpenAI can be selected without a code edit.
 */

import nodeCrypto from 'node:crypto';
import { Router } from 'express';
import { find } from '../store.js';
import { requireAuth } from '../auth.js';
import { can, canOpenApp, permissionsFor } from '../../shared/permissions.js';
import { DEPARTMENTS } from '../../shared/departments.js';
import { organizationOf } from '../../shared/organization.js';
import { TOOL_DEFINITIONS, TOOL_LABELS, runTool, toolSources } from '../assistant/tools.js';
import { aiConfigured, aiModel, aiProviderName, getAiClient } from '../ai/provider.js';

const router = Router();
router.use(requireAuth);

const MAX_TOOL_ROUNDS = 6;
const MAX_HISTORY = 20;
const CONFIRM_TTL_MS = 10 * 60 * 1000;
const pendingActions = new Map();

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
  res.json({ available: aiConfigured(), model: aiModel(), provider: aiProviderName() });
});

router.post('/chat', async (req, res) => {
  if (!aiConfigured()) {
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
    const api = await getAiClient();
    const conversation = [
      { role: 'system', content: await buildSystemPrompt(req.user, lang, req.body?.context) },
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

        // A model is an untrusted planner. Reads may run after the tool's own
        // permission check; writes pause here until the signed-in person clicks
        // Confirm. The model never gets a direct path to the store.
        if (call.function.name === 'create_task' && !args.__parseError) {
          const pending = queueWriteConfirmation(req.user, args, lang);
          send({
            type: 'confirmation',
            actionId: pending.id,
            tool: 'create_task',
            message: pending.message,
            arguments: pending.arguments,
          });
          send({ type: 'done' });
          return;
        }

        const output = args.__parseError
          ? { error: 'Arguments were not valid JSON. Call the function again with valid JSON.' }
          : await runTool(call.function.name, args, req.user, lang);

        for (const source of toolSources(call.function.name, output, lang)) {
          send({ type: 'source', source });
        }

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
              ? 'The configured AI provider rejected its credentials.'
              : 'مزود الذكاء الاصطناعي رفض بيانات الدخول المهيأة.'
            : status === 429
              ? lang === 'en'
                ? 'The configured AI provider is rate limited or out of capacity.'
                : 'تجاوز مزود الذكاء الاصطناعي الحد المسموح أو نفدت سعته.'
              : lang === 'en'
                ? 'The assistant failed. Try again shortly.'
                : 'تعذّر تشغيل المساعد. حاول مرة أخرى بعد قليل.',
      });
    }
  } finally {
    if (!closed) res.end();
  }
});

router.post('/confirm', async (req, res) => {
  prunePendingActions();
  const actionId = String(req.body?.actionId || '');
  const pending = pendingActions.get(actionId);
  if (!pending || pending.expiresAt <= Date.now()) {
    pendingActions.delete(actionId);
    return res.status(410).json({ error: 'confirmation_expired' });
  }
  if (
    pending.userId !== req.user.id ||
    pending.organizationId !== organizationOf(req.user)
  ) {
    return res.status(404).json({ error: 'confirmation_not_found' });
  }

  // Consume before execution so a retry cannot create the task twice.
  pendingActions.delete(actionId);
  const lang = req.body?.lang === 'en' ? 'en' : 'ar';
  const result = await runTool('create_task', pending.arguments, req.user, lang);
  if (result?.error) {
    return res.status(400).json({ error: 'tool_rejected', message: result.error });
  }
  return res.status(201).json({ result });
});

router.post('/cancel', (req, res) => {
  const actionId = String(req.body?.actionId || '');
  const pending = pendingActions.get(actionId);
  if (
    pending &&
    pending.userId === req.user.id &&
    pending.organizationId === organizationOf(req.user)
  ) {
    pendingActions.delete(actionId);
  }
  res.status(204).end();
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
    model: aiModel(),
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

function queueWriteConfirmation(user, input, lang) {
  prunePendingActions();
  const arguments2 = normaliseTaskDraft(input);
  const id = nodeCrypto.randomUUID();
  const title = arguments2.title || (lang === 'en' ? 'Untitled task' : 'مهمة بلا عنوان');
  const message =
    lang === 'en'
      ? `Create the task “${title}”? Nothing will be written until you confirm.`
      : `إنشاء المهمة «${title}»؟ لن يتم تسجيل أي شيء قبل تأكيدك.`;
  const pending = {
    id,
    userId: user.id,
    organizationId: organizationOf(user),
    arguments: arguments2,
    message,
    expiresAt: Date.now() + CONFIRM_TTL_MS,
  };
  pendingActions.set(id, pending);
  return pending;
}

function normaliseTaskDraft(input) {
  const output = {};
  for (const key of [
    'title',
    'description',
    'department',
    'assigneeName',
    'dueDate',
    'priority',
    'appId',
  ]) {
    if (typeof input?.[key] === 'string' && input[key].trim()) {
      output[key] = input[key].trim().slice(0, key === 'description' ? 2_000 : 200);
    }
  }
  return output;
}

function prunePendingActions() {
  const now = Date.now();
  for (const [id, pending] of pendingActions) {
    if (pending.expiresAt <= now) pendingActions.delete(id);
  }
}

/**
 * Rebuilt per request from the live registry, so an app added in Settings this
 * morning is something the assistant knows about this afternoon.
 */
async function buildSystemPrompt(user, lang, context) {
  const apps = await find('apps', (a) => a.enabled !== false);
  const catalogue = apps
    .filter((a) => canOpenApp(user, a.id))
    .filter((a) => !a.requires || can(user, a.requires))
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    .map((a) => `- ${a.nameAr}${a.nameEn ? ` / ${a.nameEn}` : ''} — ${a.descAr || '—'}`)
    .join('\n');

  const departments = DEPARTMENTS.map(
    (d) => `- ${d.id} (${d.ar} / ${d.en}): ${d.stages.map((s) => s.ar).join(' → ')}`
  ).join('\n');

  const today = new Date().toISOString().slice(0, 10);
  const page = pageContext(context?.path, lang);

  return `You are the assistant inside "Engosoft Workspace", the internal platform that brings every Engosoft app together in one place.

## The person you are talking to
- Name: ${user.name}
- Role: ${user.role}
- Department: ${user.department ?? 'general'}
- Permissions: ${permissionsFor(user).join(', ')}
- Today's date: ${today}

## Current page
The user opened **${page}**. Use this only to prioritise helpful suggestions; it does not grant any extra data access.

## Apps in the workspace
${catalogue}

## Departments and their board stages
Each department has its own workflow stages, the way Odoo projects do:
${departments}

## What you can do
You have functions that read live data and one that creates a task:

- **Workspace data** — tasks, people, apps, activity log.
- **Marketing and sales** — \`insights_metrics\` returns live figures from the Insights Hub: ad spend, leads, won and lost deals, conversion rate, revenue.
- **Customer service** — \`support_metrics\` returns live figures from Support Analytics: conversation volume, response and resolution times, SLA breaches.
- **Decision intelligence** — \`decision_brief\` joins permitted live signals across the workspace. Use it for executive summaries, risks, priorities, "what should we do", and cross-dashboard analysis.

**Always call a function before answering any question about numbers, names, dates or status.** Never guess and never rely on earlier turns for data; it changes.

## What you still cannot see
Two dashboards have no read endpoint yet: **الموارد البشرية (HR)** and **أداء الأقسام (SLA)**. For questions about employee records, recruitment or department service levels, say plainly that the figure lives in that app, name it so the person can open it, and **never invent a number.**

The same rule applies when a function returns an \`error\`: relay it. A missing figure is a fine answer; a made-up one is not.

## Reading the figures you get back
- Quote numbers as returned. Round for readability, but never adjust a value.
- \`lastSyncedAt\` tells you how fresh the marketing data is. If the person asks about today and the sync is older, say so.
- Currency is unlabelled in the source data — do not attach a currency symbol you were not given.

## Permissions
The functions enforce the user's permissions automatically. If one returns a permission error, tell the person it is above their access level and to contact an administrator — do not try to work around it.

## Language — this rule comes first
**Reply in the same language the person just wrote in.** If their message is in Arabic, answer in Arabic even when the rest of the interface is in English. If it is in English, answer in English. Their most recent message decides, every turn.

Only when that is genuinely ambiguous (a bare number, a link) fall back to the interface language, which is currently **${lang === 'en' ? 'English' : 'Arabic'}**.

When writing Arabic, use clear Modern Standard Arabic — natural and readable, neither dialect nor stiff officialese.

## Style
- Short and direct. The answer first, supporting detail after.
- When listing tasks, give the title, the assignee and the due date — not every field.
- If the question is ambiguous, ask one short clarifying question instead of guessing.
- Confirm with the person before creating a task from anything less than an explicit request.
- For analysis or decision requests, use these short headings in the user's language: Summary, Signals, Risks, Recommendation, Next step. Separate observed facts from your inference and name the data source.
- A recommendation is advisory. Never say it happened, create a task, send a message, or change data unless the user explicitly asks and the confirmation gate succeeds.`;
}

function pageContext(path, lang) {
  const value = String(path || '').slice(0, 120);
  const pages = [
    ['/tasks', { ar: 'لوحة المهام', en: 'Task board' }],
    ['/management', { ar: 'مكتب الإدارة', en: 'Management desk' }],
    ['/mail', { ar: 'Qodo Mail والتواصل', en: 'Qodo Mail and communication' }],
    ['/users', { ar: 'دليل الفريق', en: 'Team directory' }],
    ['/events', { ar: 'الكورسات والفعاليات', en: 'Courses and events' }],
    ['/elearning', { ar: 'التعلم الإلكتروني', en: 'eLearning' }],
    ['/', { ar: 'الصفحة الرئيسية', en: 'Workspace home' }],
  ];
  return pages.find(([prefix]) => prefix === '/' || value.startsWith(prefix))?.[1]?.[lang] ?? pages.at(-1)[1][lang];
}

export default router;
