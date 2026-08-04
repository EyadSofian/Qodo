/**
 * The management desk — the executive's own tasks, meetings, appointments,
 * reminders and decisions.
 *
 * Deliberately not the task board. A task on the board is a contract handed to
 * somebody and measured against a due date; these are the diary of the people
 * doing the handing. They have no assignee to accept them, no deliverable, no
 * score — an item is either open, being done, done, or cancelled.
 *
 * Two ways in. Somebody fills the form, or somebody writes a sentence of
 * ordinary Egyptian Arabic to a Telegram bot and a model turns it into rows.
 * The second is the reason this exists at all: the people whose diary this is
 * do not stop to open a dashboard, but they will type «اجتماع مع صديق بكرة
 * الساعة ٢» into a chat they are already in.
 *
 * The split between the model's job and this file's job is the design:
 *   the model  → «بكرة الساعة ٢» into a date and a clock time
 *   this file  → that date and clock time into a real instant in Cairo
 * An LLM is reliable at the first and quietly wrong at the second, because the
 * UTC offset flips twice a year and it will happily write +02:00 in July.
 *
 * Ported from the SLA dashboard, where it stored into Supabase behind a shared
 * passcode. Here it stores into the workspace's own document store and is gated
 * by `management.view` / `management.manage` like everything else, so an item
 * belongs to an organization and an owner is a real user rather than a string
 * that happens to look like somebody's name.
 */

import Anthropic from '@anthropic-ai/sdk';
import { create, find, findOne, getStore } from './store.js';
import { DEPARTMENT_IDS } from '../shared/departments.js';
import { organizationOf } from '../shared/organization.js';

/* ── configuration ───────────────────────────────────────────────── */

const WEBHOOK_SECRET = process.env.MANAGEMENT_WEBHOOK_SECRET ?? '';
const TELEGRAM_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || WEBHOOK_SECRET;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';

/**
 * First-contact activation code. Nobody types a chat id anywhere: a new chat
 * sends this code once, the server records the id it already sees on the
 * request, and that chat is trusted from then on. Revoking is deleting a row.
 */
const JOIN_CODE = process.env.MANAGEMENT_JOIN_CODE ?? '';

/** Roster fed to the model so it maps «أحمد» onto the canonical spelling. */
const TEAM = splitList(process.env.MANAGEMENT_TEAM);

/**
 * Extraction is a short, structured, high-volume job on messages that are a
 * sentence long, so it runs on Sonnet rather than Opus — same understanding of
 * Egyptian Arabic, a fraction of the latency the person in the chat waits for.
 */
const MODEL = process.env.MANAGEMENT_MODEL || 'claude-sonnet-5';
const TIMEZONE = process.env.MANAGEMENT_TIMEZONE || 'Africa/Cairo';

const MAX_TEXT_CHARS = 4000;
const MAX_ITEMS_PER_MESSAGE = 12;
const MAX_LIST_ROWS = 500;

export const KINDS = ['task', 'meeting', 'appointment', 'reminder', 'decision'];
export const PRIORITIES = ['urgent', 'high', 'normal', 'low'];
export const STATUSES = ['todo', 'doing', 'done', 'cancelled'];

const KIND_LABEL = {
  task: 'مهمة',
  meeting: 'اجتماع',
  appointment: 'موعد',
  reminder: 'تذكير',
  decision: 'قرار',
};

function splitList(value) {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export class ManagementError extends Error {
  constructor(message, status = 400, hint = '') {
    super(message);
    this.status = status;
    this.hint = hint;
  }
}

/* ── time ────────────────────────────────────────────────────────── */

/** Minutes east of UTC for `timeZone` at `date` — DST-aware, never hardcoded. */
function offsetMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .formatToParts(date)
    .reduce((acc, part) => (part.type === 'literal' ? acc : { ...acc, [part.type]: part.value }), {});

  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === '24' ? '00' : parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return Math.round((asUTC - date.getTime()) / 60000);
}

function offsetLabel(date = new Date()) {
  const minutes = offsetMinutes(date, TIMEZONE);
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** `2026-08-04T15:40:00+03:00` — what the model is told "now" is. */
function nowLocalISO(date = new Date()) {
  const shifted = new Date(date.getTime() + offsetMinutes(date, TIMEZONE) * 60000);
  return `${shifted.toISOString().slice(0, 19)}${offsetLabel(date)}`;
}

function weekdayLabel(date = new Date()) {
  return new Intl.DateTimeFormat('ar-EG', { timeZone: TIMEZONE, weekday: 'long' }).format(date);
}

/** Local calendar day as `YYYY-MM-DD`. */
function localDayKey(date = new Date()) {
  return new Date(date.getTime() + offsetMinutes(date, TIMEZONE) * 60000).toISOString().slice(0, 10);
}

/** UTC bounds of the local day `dayOffset` days from today. */
function dayBounds(dayOffset = 0) {
  const anchor = new Date(Date.now() + dayOffset * 86400000);
  const day = localDayKey(anchor);
  const start = new Date(`${day}T00:00:00${offsetLabel(anchor)}`);
  return { start, end: new Date(start.getTime() + 86400000) };
}

const timeFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
  timeZone: TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

const dateFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
  timeZone: TIMEZONE,
  day: 'numeric',
  month: 'short',
});

/* ── normalisation ───────────────────────────────────────────────── */
/* Nothing is stored without passing through here, whether it came from the
 * model or from the form. The model's output is treated as untrusted input in
 * exactly the same way a browser's would be. */

const str = (value, max) => {
  const out = typeof value === 'string' ? value.trim() : '';
  return out ? out.slice(0, max) : null;
};

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

function toList(value, max, itemMax) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => str(entry, itemMax)).filter(Boolean).slice(0, max);
}

function toInt(value, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.round(n), max);
}

function toTimestamp(value) {
  if (!value || typeof value !== 'string') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  // A date more than five years out is a parsing accident, not a plan.
  const years = Math.abs(date.getTime() - Date.now()) / (365 * 86400000);
  return years > 5 ? null : date.toISOString();
}

/**
 * `2026-08-05` + `17:00` → a real instant in the configured timezone.
 *
 * This is the half of the job the model does not do. It sends the two plain
 * fields it is good at and this composes the timestamp with the offset that
 * actually applies on that date, read at roughly the right instant so a DST
 * boundary lands on the correct side of the switch.
 */
function composeLocal(dateValue, timeValue) {
  const day = typeof dateValue === 'string' ? dateValue.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;

  const raw = typeof timeValue === 'string' ? timeValue.trim() : '';
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
  // A day with no clock time means "some time that morning".
  const time = match ? `${match[1].padStart(2, '0')}:${match[2]}` : '09:00';

  const approx = new Date(`${day}T${time}:00Z`);
  if (Number.isNaN(approx.getTime())) return null;

  return toTimestamp(`${day}T${time}:00${offsetLabel(approx)}`);
}

/**
 * Whatever the caller put in `items`: an array, a JSON string, a fenced code
 * block, or a single object. A bot hands over a string more often than not, and
 * losing the whole message to a stray ``` is not a reasonable failure.
 */
function parseItemsPayload(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return [value];
  if (typeof value !== 'string') return [];

  const start = value.search(/[[{]/);
  const end = Math.max(value.lastIndexOf(']'), value.lastIndexOf('}'));
  if (start === -1 || end <= start) return [];

  try {
    const parsed = JSON.parse(value.slice(start, end + 1));
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.items)) return parsed.items;
    return [parsed];
  } catch {
    console.error('[management] items payload was not valid JSON');
    return [];
  }
}

/**
 * An owner arrives as a name — the model wrote «أحمد», or somebody typed it.
 * Resolving it to a real user is what makes the item belong to a person rather
 * than to a spelling, but the written name is kept either way: if nobody
 * matches, "أحمد" is still the honest record of who was meant.
 */
async function resolveOwner(name, organizationId) {
  const written = str(name, 120);
  if (!written) return { ownerId: null, ownerName: null };

  const needle = written.toLowerCase();
  const people = await find(
    'users',
    (user) =>
      organizationOf(user) === organizationOf({ organizationId }) &&
      user.status === 'active' &&
      typeof user.name === 'string'
  );

  const exact = people.find((user) => user.name.toLowerCase() === needle);
  const partial = exact
    ? null
    : people.filter((user) => user.name.toLowerCase().includes(needle));

  // One partial match is a person; several is a guess, and guessing which
  // colleague was meant is how an item ends up on the wrong desk.
  const match = exact ?? (partial?.length === 1 ? partial[0] : null);
  return { ownerId: match?.id ?? null, ownerName: written };
}

/** Model or API item → a stored document. Returns null if unusable. */
async function normalizeItem(input, defaults = {}) {
  const title = str(input?.title, 200);
  if (!title) return null;

  const kind = pick(input?.kind, KINDS, 'task');
  // Either an absolute timestamp, or the date/time pair the model is good at.
  const dueAt = toTimestamp(input?.due_at ?? input?.dueAt) ?? composeLocal(input?.due_date ?? input?.dueDate, input?.due_time ?? input?.dueTime);
  const { ownerId, ownerName } = await resolveOwner(
    input?.owner_name ?? input?.ownerName,
    defaults.organizationId
  );

  const confidence = Number(input?.confidence ?? input?.ai_confidence);
  const needsReview =
    input?.needs_review === true ||
    input?.needsReview === true ||
    (Number.isFinite(confidence) && confidence < 0.5) ||
    // A meeting nobody owns, or one with no time, is not a diary entry yet.
    (defaults.source === 'telegram' && (!ownerName || (kind === 'meeting' && !dueAt)));

  const department = str(input?.department, 120);

  return {
    kind,
    title,
    details: str(input?.details, 2000),
    ownerId,
    ownerName,
    // A department that matches the workspace's own tree is stored as its id so
    // it filters; anything else is kept as written rather than dropped.
    department: DEPARTMENT_IDS.includes(department) ? department : null,
    departmentLabel: DEPARTMENT_IDS.includes(department) ? null : department,
    priority: pick(input?.priority, PRIORITIES, 'normal'),
    status: pick(input?.status, STATUSES, 'todo'),
    dueAt,
    durationMin: toInt(input?.duration_min ?? input?.durationMin, 60 * 24),
    location: str(input?.location, 200),
    attendees: toList(input?.attendees, 20, 80),
    tags: toList(input?.tags, 3, 40),
    aiConfidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
    needsReview: Boolean(needsReview),
    doneAt: null,
    ...defaults,
  };
}

/** Whitelist for edits — a client can never set provenance, ids or timestamps. */
async function normalizePatch(input, current) {
  const patch = {};
  if (input?.kind !== undefined) patch.kind = pick(input.kind, KINDS, 'task');
  if (input?.priority !== undefined) patch.priority = pick(input.priority, PRIORITIES, 'normal');
  if (input?.title !== undefined) {
    const title = str(input.title, 200);
    if (!title) throw new ManagementError('العنوان مطلوب.', 400);
    patch.title = title;
  }
  if (input?.details !== undefined) patch.details = str(input.details, 2000);
  if (input?.ownerName !== undefined) {
    const owner = await resolveOwner(input.ownerName, current.organizationId);
    patch.ownerId = owner.ownerId;
    patch.ownerName = owner.ownerName;
  }
  if (input?.department !== undefined) {
    const department = str(input.department, 120);
    patch.department = DEPARTMENT_IDS.includes(department) ? department : null;
    patch.departmentLabel = DEPARTMENT_IDS.includes(department) ? null : department;
  }
  if (input?.location !== undefined) patch.location = str(input.location, 200);
  if (input?.dueAt !== undefined) patch.dueAt = toTimestamp(input.dueAt);
  if (input?.durationMin !== undefined) patch.durationMin = toInt(input.durationMin, 60 * 24);
  if (input?.attendees !== undefined) patch.attendees = toList(input.attendees, 20, 80);
  if (input?.tags !== undefined) patch.tags = toList(input.tags, 3, 40);
  if (input?.needsReview !== undefined) patch.needsReview = Boolean(input.needsReview);

  if (input?.status !== undefined) {
    patch.status = pick(input.status, STATUSES, 'todo');
    // Closing stamps the time; reopening clears it, so "finished today" counts
    // stay honest when somebody flips an item back.
    patch.doneAt = patch.status === 'done' ? new Date().toISOString() : null;
  }

  if (Object.keys(patch).length === 0) throw new ManagementError('مفيش حاجة تتعدّل.', 400);
  return patch;
}

/* ── the model ───────────────────────────────────────────────────── */

export const EXTRACTION_PROMPT = `أنت مساعد تشغيلي لإدارة شركة Engosoft. شغلتك الوحيدة: تاخد رسالة مكتوبة بالعربي المصري من مسؤول، وتطلّع منها المهام والاجتماعات والمواعيد كبيانات منظّمة.

قواعد:
- كل بند مستقل يبقى عنصر لوحده. الرسالة الواحدة ممكن تطلّع أكتر من عنصر.
- النوع: task مهمة تتعمل، meeting قعدة بأكتر من شخص، appointment زيارة أو موعد خارجي، reminder حاجة متتنسيش، decision قرار اتاخد ولازم يتسجّل.
- التاريخ والوقت: رجّعهم منفصلين — due_date بصيغة YYYY-MM-DD و due_time بصيغة HH:MM بنظام ٢٤ ساعة. متحطّش أي offset أو منطقة زمنية، السيرفر بيتولّى ده.
- «بكرة» و«بعد بكرة» و«الأسبوع الجاي» تتحسب من التاريخ اللي هيتقالك دلوقتي.
- المسؤول: لو الاسم مذكور حطّه زي ما هو. لو مش مذكور سيبه فاضي ومتخترعش حد.
- الثقة: confidence من ٠ لـ ١. قلّلها لما الوقت مبهم أو المسؤول مش واضح.
- متزوّدش معلومات من عندك. اللي مش مكتوب في الرسالة مايتكتبش.`;

const ITEM_PROPERTIES = {
  kind: { type: 'string', enum: KINDS },
  title: { type: 'string' },
  details: { type: 'string' },
  owner_name: { type: 'string' },
  department: { type: 'string' },
  priority: { type: 'string', enum: PRIORITIES },
  due_date: { type: 'string', description: 'YYYY-MM-DD' },
  due_time: { type: 'string', description: 'HH:MM (24h)' },
  duration_min: { type: 'number' },
  location: { type: 'string' },
  attendees: { type: 'array', items: { type: 'string' } },
  confidence: { type: 'number' },
};

const EXTRACTION_SCHEMA = {
  name: 'record_items',
  description: 'سجّل البنود اللي في الرسالة.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: { type: 'object', properties: ITEM_PROPERTIES, required: ['title'] },
      },
      summary: { type: 'string' },
      reply: { type: 'string', description: 'رد قصير بالعربي المصري للشخص اللي بعت.' },
    },
    required: ['items'],
  },
};

let client = null;
function aiClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

export const isAiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);
export const isTelegramEnabled = () => Boolean(TELEGRAM_TOKEN);

async function extract(text, sender) {
  const api = aiClient();
  if (!api) return null;

  const context = [
    `دلوقتي: ${nowLocalISO()} (${weekdayLabel()}) بتوقيت ${TIMEZONE}.`,
    TEAM.length ? `فريق الشركة: ${TEAM.join('، ')}.` : '',
    sender ? `الرسالة من: ${sender}.` : '',
    '',
    text,
  ]
    .filter(Boolean)
    .join('\n');

  const response = await api.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: EXTRACTION_PROMPT,
    tools: [EXTRACTION_SCHEMA],
    tool_choice: { type: 'tool', name: 'record_items' },
    messages: [{ role: 'user', content: context }],
  });

  const call = response.content?.find((block) => block.type === 'tool_use');
  if (!call) return null;

  return {
    items: Array.isArray(call.input?.items) ? call.input.items : [],
    summary: typeof call.input?.summary === 'string' ? call.input.summary : '',
    reply: typeof call.input?.reply === 'string' ? call.input.reply : '',
    model: MODEL,
  };
}

function fallbackItems(text) {
  // No Anthropic key: keep the message rather than lose it. One item, flagged
  // for review, titled with the first line — a human finishes the job.
  const firstLine = text.split('\n').map((line) => line.trim()).find(Boolean) ?? text;
  return {
    items: [{ kind: 'task', title: firstLine.slice(0, 120), details: text, needs_review: true }],
    summary: 'اتسجّل من غير تحليل — المساعد الذكي مش مفعّل.',
    reply: 'استلمت الرسالة وسجّلتها كمهمة محتاجة مراجعة. (المساعد الذكي مش مفعّل على السيرفر.)',
    model: null,
  };
}

/* ── membership ──────────────────────────────────────────────────── */

const ENROLLED_TEXT =
  'تمام، الشات ده اتفعّل. من دلوقتي اكتب اللي مطلوب في اليوم بالعربي العادي وأنا هسجّله في لوحة الإدارة.';

const NEEDS_CODE_TEXT =
  'الشات ده لسه مش مفعّل. ابعت كود الانضمام في رسالة لوحده عشان أقدر أسجّل لك.';

/** Constant-time compare that tolerates length mismatch. */
function safeEqual(a, b) {
  const left = String(a ?? '');
  const right = String(b ?? '');
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

/**
 * `x-engosoft-secret` is first because it is the header the Botpress bot has
 * been sending all along. Renaming it here would have been a silent 401 on the
 * first message somebody typed after the move — the bot lives outside both
 * repositories, so nothing in a deploy would have told us.
 */
export function checkWebhookSecret(headers, expected = WEBHOOK_SECRET) {
  if (!expected) {
    throw new ManagementError(
      'الاستقبال الآلي مش مفعّل.',
      503,
      'ضيف MANAGEMENT_WEBHOOK_SECRET في متغيّرات البيئة على السيرفر.'
    );
  }
  const sent =
    headers['x-engosoft-secret'] ??
    headers['x-telegram-bot-api-secret-token'] ??
    headers['x-webhook-secret'] ??
    String(headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (!safeEqual(sent, expected)) throw new ManagementError('غير مصرّح.', 401);
}

/** True when the caller carries a valid shared secret — a bot, not a person. */
export function hasWebhookSecret(headers) {
  try {
    checkWebhookSecret(headers);
    return true;
  } catch {
    return false;
  }
}

async function findMember(chatId) {
  return findOne('managementMembers', (member) => member.chatId === chatId);
}

/* ── ingest ──────────────────────────────────────────────────────── */

/**
 * One inbound message in, N stored items out.
 *
 * Every message is logged whether or not the extraction worked. Without that a
 * failed parse is invisible: the manager types a sentence, nothing appears on
 * the board, and nobody can say why.
 */
export async function ingest({
  text,
  sender,
  chatId,
  messageId,
  source = 'telegram',
  items,
  organizationId = null,
}) {
  const message = str(text, MAX_TEXT_CHARS);
  const provided = parseItemsPayload(items);
  const hasItems = provided.length > 0;
  if (!message && !hasItems) throw new ManagementError('الرسالة فاضية.', 400);

  // Enrollment gate. A new chat's first message must be the join code; the id is
  // read off the request, never typed by anyone. An unenrolled attempt writes
  // nothing at all — not even a log row, so a stranger cannot fill the log.
  let reporter = str(sender, 120);
  if (JOIN_CODE && chatId) {
    const member = await findMember(chatId);
    if (!member) {
      const attempt = (message ?? '').replace(/^\/join\s+/i, '').trim();
      if (attempt && safeEqual(attempt, JOIN_CODE)) {
        await create('managementMembers', {
          organizationId,
          chatId,
          displayName: reporter,
          source,
        });
        return { ok: true, enrolled: true, count: 0, items: [], reply: ENROLLED_TEXT };
      }
      return { ok: false, blocked: true, count: 0, items: [], reply: NEEDS_CODE_TEXT };
    }
    reporter ??= str(member.displayName, 120);
  }

  // Replay guard: Telegram re-delivers anything it thinks failed, and a bot can
  // fire twice on a flaky turn. Same chat + same message = one ingest, ever.
  if (chatId && messageId) {
    const seen = await findOne(
      'managementIngest',
      (row) => row.chatId === chatId && row.messageId === messageId
    );
    if (seen) return { ok: true, duplicate: true, count: seen.itemCount, items: [], reply: '' };
  }

  let parsed;
  let error = null;

  if (hasItems) {
    // The caller already extracted — no model call happens here at all. Trust
    // the shape, not the values: everything still goes through normalizeItem.
    parsed = { items: provided, summary: '', reply: '', model: 'client' };
  } else {
    try {
      parsed = (await extract(message, reporter)) ?? fallbackItems(message);
    } catch (err) {
      // This string is what the board prints on the row, so it leads with the
      // fix in Arabic and keeps the raw API text behind it for the details.
      const hint =
        err instanceof Anthropic.AuthenticationError
          ? 'مفتاح Anthropic غلط أو ناقص على السيرفر — '
          : err instanceof Anthropic.NotFoundError
            ? 'الموديل مش متاح للمفتاح ده — '
            : err instanceof Anthropic.RateLimitError
              ? 'ضغط على المساعد، جرّب بعد شوية — '
              : '';
      error = `${hint}${String(err?.message ?? err)}`.slice(0, 500);
      console.error('[management] extraction failed:', error);
      parsed = {
        items: [],
        summary: '',
        reply: 'حصلت مشكلة أثناء تحليل الرسالة. جرّب تبعتها تاني.',
        model: null,
      };
    }
  }

  const candidates = (Array.isArray(parsed.items) ? parsed.items : []).slice(0, MAX_ITEMS_PER_MESSAGE);
  const rows = [];
  for (const candidate of candidates) {
    const row = await normalizeItem(candidate, {
      organizationId,
      source,
      reporter,
      chatId: str(chatId, 64),
      messageId: str(messageId, 64),
      rawText: message,
      aiModel: parsed.model ?? null,
      createdBy: null,
    });
    if (row) rows.push(row);
  }

  const log = await create('managementIngest', {
    organizationId,
    source,
    chatId: str(chatId, 64),
    messageId: str(messageId, 64),
    sender: reporter,
    rawText: message ?? '',
    itemCount: rows.length,
    status: error ? 'failed' : rows.length ? 'ok' : 'ignored',
    error,
    model: parsed.model ?? null,
  });

  const saved = [];
  for (const row of rows) saved.push(await create('managementItems', { ...row, ingestId: log.id }));

  return {
    ok: !error,
    count: saved.length,
    items: saved,
    summary: parsed.summary ?? '',
    reply: str(parsed.reply, 1000) ?? buildReply(saved),
  };
}

/** Arabic counted-noun agreement — «بندين» reads native, «2 بند» reads machine. */
function arItems(count) {
  if (count === 1) return 'بند واحد';
  if (count === 2) return 'بندين';
  return `${count} ${count >= 3 && count <= 10 ? 'بنود' : 'بند'}`;
}

/** Used when the caller sent items itself, or on the no-model fallback. */
function buildReply(rows) {
  if (!rows.length) return 'مفيش بنود اتسجّلت من الرسالة دي.';
  const lines = rows.slice(0, 5).map((row) => {
    const when = row.dueAt
      ? ` — ${dateFmt.format(new Date(row.dueAt))} ${timeFmt.format(new Date(row.dueAt))}`
      : '';
    return `• ${KIND_LABEL[row.kind] ?? 'بند'}: ${row.title}${when}`;
  });
  const review = rows.filter((row) => row.needsReview).length;
  return [
    `اتسجّل ${arItems(rows.length)}:`,
    ...lines,
    review ? `\n${arItems(review)} محتاج مراجعة في اللوحة.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/* ── reads ───────────────────────────────────────────────────────── */

/**
 * Tenancy goes through `organizationOf` on both sides rather than comparing the
 * stored field directly. A document written before the field existed — or one
 * filed by a bot that has no idea what a tenant is — resolves to the default
 * organization, which is the same thing every signed-in user resolves to on a
 * single-company deployment. Comparing raw values instead means messages arrive
 * from Telegram, get stored, and are never seen by anybody.
 */
const inOrganization = (organizationId) => (row) =>
  organizationOf(row) === organizationOf({ organizationId });

export async function listItems(organizationId, query = {}) {
  const matches = inOrganization(organizationId);
  let rows = await find('managementItems', matches);

  const status = String(query.status ?? '');
  if (STATUSES.includes(status)) rows = rows.filter((row) => row.status === status);
  else if (status === 'open') rows = rows.filter((row) => row.status === 'todo' || row.status === 'doing');

  const kind = String(query.kind ?? '');
  if (KINDS.includes(kind)) rows = rows.filter((row) => row.kind === kind);

  if (query.needsReview === 'true') rows = rows.filter((row) => row.needsReview);

  const days = Number(query.days);
  if (Number.isFinite(days) && days > 0) {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    rows = rows.filter((row) => (row.createdAt ?? '') >= since);
  }

  rows.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  const limit = Math.min(Number(query.limit) || MAX_LIST_ROWS, MAX_LIST_ROWS);
  return rows.slice(0, limit);
}

/**
 * What is due on a given day, and — for today only — what is already late.
 * Overdue work belongs on today's agenda because that is precisely the list
 * somebody opens the board to see.
 */
export async function agenda(organizationId, dayOffset = 0) {
  const { start, end } = dayBounds(dayOffset);
  const open = (row) => row.status === 'todo' || row.status === 'doing';
  const rows = await find('managementItems', inOrganization(organizationId));

  const due = rows
    .filter((row) => open(row) && row.dueAt && row.dueAt >= start.toISOString() && row.dueAt < end.toISOString())
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));

  const overdue =
    dayOffset === 0
      ? rows
          .filter((row) => open(row) && row.dueAt && row.dueAt < start.toISOString())
          .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
          .slice(0, 100)
      : [];

  return { day: localDayKey(new Date(Date.now() + dayOffset * 86400000)), due, overdue };
}

export async function listInbox(organizationId, query = {}) {
  const limit = Math.min(Number(query.limit) || 30, 100);
  const rows = await find('managementIngest', inOrganization(organizationId));
  rows.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  return rows.slice(0, limit);
}

/* ── writes ──────────────────────────────────────────────────────── */

export async function createItem(body, { organizationId, actorId, reporter }) {
  const row = await normalizeItem(body, {
    organizationId,
    source: 'dashboard',
    reporter: str(reporter, 120),
    chatId: null,
    messageId: null,
    rawText: null,
    aiModel: null,
    aiConfidence: null,
    needsReview: false,
    createdBy: actorId,
  });
  if (!row) throw new ManagementError('العنوان مطلوب.', 400);
  return create('managementItems', row);
}

async function loadItem(id, organizationId) {
  const item = await findOne('managementItems', (row) => row.id === id);
  if (!item || organizationOf(item) !== organizationOf({ organizationId })) {
    throw new ManagementError('العنصر مش موجود.', 404);
  }
  return item;
}

export async function updateItem(id, body, organizationId) {
  const store = await getStore();
  const item = await loadItem(id, organizationId);
  return store.update('managementItems', item.id, await normalizePatch(body, item));
}

export async function deleteItem(id, organizationId) {
  const store = await getStore();
  const item = await loadItem(id, organizationId);
  await store.remove('managementItems', item.id);
  return { ok: true };
}

/* ── Telegram ────────────────────────────────────────────────────── */

async function sendTelegram(chatId, text) {
  if (!TELEGRAM_TOKEN || !chatId || !text) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_notification: true }),
    });
  } catch (err) {
    // The item is already stored; failing to acknowledge it in the chat is not
    // a reason to fail the webhook and have Telegram redeliver the message.
    console.error('[management] telegram reply failed:', err?.message ?? err);
  }
}

/**
 * The agenda as one Arabic message.
 *
 * The bot has no screen — it answers «/اجندة» by printing this straight into
 * the chat, and reads it off `text` in the response. Rendering it here rather
 * than in the caller is what keeps the phrasing the same whether it came from
 * Telegram, from n8n, or from the board.
 */
export function agendaText({ due, overdue }) {
  if (!due.length && !overdue.length) return 'مفيش حاجة على أجندة النهاردة.';
  const line = (row) =>
    `• ${row.dueAt ? timeFmt.format(new Date(row.dueAt)) : '—'} ${row.title}${row.ownerName ? ` (${row.ownerName})` : ''}`;
  return [
    due.length ? `أجندة النهاردة — ${arItems(due.length)}:` : '',
    ...due.map(line),
    overdue.length ? `\nمتأخر — ${arItems(overdue.length)}:` : '',
    ...overdue.slice(0, 10).map(line),
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * A Telegram `update` object → our reply. Always resolves so the webhook can
 * answer 200 and Telegram stops retrying: a message we could not parse is a
 * message to log, not a delivery to repeat forever.
 */
export async function handleTelegramUpdate(update, { organizationId = null } = {}) {
  const message = update?.message ?? update?.edited_message;
  const chatId = message?.chat?.id ? String(message.chat.id) : '';
  const text = String(message?.text ?? '').trim();
  if (!chatId || !text) return { ok: true, ignored: true };

  const sender = [message?.from?.first_name, message?.from?.last_name].filter(Boolean).join(' ');

  if (/^\/(today|اجندة|أجندة)\b/i.test(text)) {
    const reply = agendaText(await agenda(organizationId, 0));
    await sendTelegram(chatId, reply);
    return { ok: true, command: 'today' };
  }

  const result = await ingest({
    text: text.replace(/^\/(new|add)\s+/i, ''),
    sender,
    chatId,
    messageId: message?.message_id ? String(message.message_id) : '',
    source: 'telegram',
    organizationId,
  });

  if (result.reply) await sendTelegram(chatId, result.reply);
  return { ok: true, count: result.count ?? 0 };
}
