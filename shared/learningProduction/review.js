/**
 * E-Learning Production — the review helpers.
 *
 * Content shapes, narration timing, comment anchors, annotation geometry and
 * the text diff. Shared because the server validates what the browser draws:
 * an annotation with a coordinate of 1.4 is refused by the same function that
 * clamps the pointer on the page.
 */

import { ANNOTATION_TYPES, OUTLINE_SECTIONS } from './constants.js';

/* ------------------------------------------------------------------ */
/* Content                                                              */
/* ------------------------------------------------------------------ */

const MAX_SECTION = 20_000;
const MAX_FIELD = 12_000;
const MAX_BLOCKS = 400;
const BLOCK_ID = /^[A-Za-z0-9_-]{6,64}$/;

export const SCRIPT_BLOCK_FIELDS = /** @type {const} */ ([
  'title',
  'narration',
  'visual',
  'pronunciation',
  'pauses',
  'emphasis',
  'notes',
]);

function clip(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function newBlockId() {
  return globalThis.crypto?.randomUUID?.() ?? `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The only shapes an outline or a script may take.
 *
 * Unknown keys are dropped rather than refused, so an older browser tab saving
 * over a newer shape loses nothing it did not know about — and the server never
 * stores a field it cannot explain.
 */
export function normalizeContent(assetType, content) {
  const source = content && typeof content === 'object' ? content : {};

  if (assetType === 'OUTLINE') {
    const sections = {};
    const input = source.sections && typeof source.sections === 'object' ? source.sections : {};
    for (const key of OUTLINE_SECTIONS) sections[key] = clip(input[key], MAX_SECTION);
    return { sections };
  }

  if (assetType === 'SCRIPT') {
    const mode = source.mode === 'SCENE' ? 'SCENE' : 'SLIDE';
    const seen = new Set();
    const blocks = (Array.isArray(source.blocks) ? source.blocks : []).slice(0, MAX_BLOCKS).map((block) => {
      const input = block && typeof block === 'object' ? block : {};
      let id = typeof input.id === 'string' && BLOCK_ID.test(input.id) ? input.id : newBlockId();
      if (seen.has(id)) id = newBlockId();
      seen.add(id);
      const normalized = { id };
      for (const field of SCRIPT_BLOCK_FIELDS) normalized[field] = clip(input[field], MAX_FIELD);
      const manual = Number(input.manualDurationSeconds);
      normalized.manualDurationSeconds = Number.isFinite(manual) && manual > 0 ? Math.min(3600, Math.round(manual)) : null;
      return normalized;
    });
    return { mode, blocks };
  }

  return {};
}

export function emptyContent(assetType) {
  return normalizeContent(assetType, assetType === 'SCRIPT' ? { blocks: [] } : {});
}

/** Whether a draft has anything in it worth submitting. */
export function contentHasText(assetType, content) {
  const normalized = normalizeContent(assetType, content);
  if (assetType === 'OUTLINE') return Object.values(normalized.sections).some((value) => value.trim().length > 0);
  if (assetType === 'SCRIPT') {
    return normalized.blocks.some((block) => SCRIPT_BLOCK_FIELDS.some((field) => block[field].trim().length > 0));
  }
  return false;
}

export function sameContent(assetType, left, right) {
  return JSON.stringify(normalizeContent(assetType, left)) === JSON.stringify(normalizeContent(assetType, right));
}

/* ------------------------------------------------------------------ */
/* Narration                                                            */
/* ------------------------------------------------------------------ */

const PAUSE = /\[(?:pause|وقفة)\s*(\d+(?:\.\d+)?)\s*(?:s|sec|ث|ثانية)?\s*\]/giu;

/** Spoken words. Pause markers are directions for the narrator, not words. */
export function countWords(text) {
  const clean = String(text ?? '').replace(PAUSE, ' ');
  // Marks (\p{M}) continue a word: Arabic diacritics are combining characters,
  // and without them «كَتَبَ» would count as four words.
  return (clean.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}'’\-]*/gu) ?? []).length;
}

/** Seconds of written pauses: `[pause 2s]`, `[pause 1.5]`, `[وقفة 2]`. */
export function pauseSeconds(text) {
  let total = 0;
  for (const match of String(text ?? '').matchAll(PAUSE)) total += Number(match[1]) || 0;
  return total;
}

/** Narration length at a given reading speed, pauses included. */
export function estimateNarrationSeconds(text, wordsPerMinute = 130) {
  const wpm = Number(wordsPerMinute) > 0 ? Number(wordsPerMinute) : 130;
  return Math.round((countWords(text) / wpm) * 60 + pauseSeconds(text));
}

export function scriptBlockSeconds(block, wordsPerMinute) {
  if (block?.manualDurationSeconds) return block.manualDurationSeconds;
  return estimateNarrationSeconds(`${block?.narration ?? ''} ${block?.pauses ?? ''}`, wordsPerMinute);
}

export function scriptTotals(content, wordsPerMinute) {
  const blocks = normalizeContent('SCRIPT', content).blocks;
  let words = 0;
  let seconds = 0;
  for (const block of blocks) {
    words += countWords(block.narration);
    seconds += scriptBlockSeconds(block, wordsPerMinute);
  }
  return { blocks: blocks.length, words, seconds };
}

export function outlineWords(content) {
  const sections = normalizeContent('OUTLINE', content).sections;
  return Object.values(sections).reduce((sum, value) => sum + countWords(value), 0);
}

/** `m:ss`, or `h:mm:ss` past the hour. Latin digits — a timecode is not prose. */
export function formatTimecode(totalSeconds) {
  const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/* ------------------------------------------------------------------ */
/* Text anchors                                                         */
/* ------------------------------------------------------------------ */

/**
 * Where a quoted passage is now.
 *
 * A comment remembers the text it was left on, not only the offsets: the
 * maker keeps writing, and offsets from yesterday point at the wrong words
 * today. The stored offsets are tried first, then the occurrence of the quote
 * nearest to them. `null` means the passage has been rewritten away, and the
 * comment shows its quote instead of a highlight.
 */
export function locateQuote(text, anchor) {
  const source = String(text ?? '');
  const quote = String(anchor?.quote ?? '');
  if (!quote) return null;
  const start = Number(anchor?.start);
  if (Number.isInteger(start) && source.slice(start, start + quote.length) === quote) {
    return { start, end: start + quote.length };
  }
  let best = -1;
  let from = source.indexOf(quote);
  while (from !== -1) {
    if (best === -1 || Math.abs(from - start) < Math.abs(best - start)) best = from;
    from = source.indexOf(quote, from + 1);
  }
  return best === -1 ? null : { start: best, end: best + quote.length };
}

/* ------------------------------------------------------------------ */
/* Annotation geometry                                                  */
/* ------------------------------------------------------------------ */

const EPSILON = 1e-6;

export function isUnit(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= -EPSILON && value <= 1 + EPSILON;
}

export function clampUnit(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

/**
 * Validates a shape drawn over a slide or a paused frame.
 *
 * Every coordinate is a fraction of the page — 0 at one edge, 1 at the other —
 * so a pin placed on a laptop lands on the same word on a projector. Returns
 * an error code, or `null` when the shape is sound.
 */
export function annotationGeometryError(type, geometry) {
  if (!ANNOTATION_TYPES.includes(type)) return 'ANNOTATION_TYPE_INVALID';
  const g = geometry && typeof geometry === 'object' ? geometry : {};
  if (!isUnit(g.x) || !isUnit(g.y)) return 'ANNOTATION_POSITION_INVALID';

  if (type === 'RECTANGLE' || type === 'CIRCLE' || type === 'HIGHLIGHT') {
    if (!isUnit(g.width) || !isUnit(g.height) || g.width <= 0 || g.height <= 0) return 'ANNOTATION_SIZE_INVALID';
    if (g.x + g.width > 1 + EPSILON || g.y + g.height > 1 + EPSILON) return 'ANNOTATION_SIZE_INVALID';
  }

  if (type === 'ARROW' || type === 'FREEHAND') {
    const points = g.points;
    const max = type === 'ARROW' ? 2 : 2000;
    if (!Array.isArray(points) || points.length < 2 || points.length > max) return 'ANNOTATION_POINTS_INVALID';
    if (!points.every((point) => Array.isArray(point) && point.length === 2 && isUnit(point[0]) && isUnit(point[1]))) {
      return 'ANNOTATION_POINTS_INVALID';
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Diff                                                                 */
/* ------------------------------------------------------------------ */

/** Past this many table cells the diff gives a coarse answer instead of freezing a tab. */
const MAX_CELLS = 1_500_000;

function lcsOps(a, b) {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) return b.map((token) => ['insert', token]);
  if (m === 0) return a.map((token) => ['delete', token]);
  if ((n + 1) * (m + 1) > MAX_CELLS) {
    return [...a.map((token) => ['delete', token]), ...b.map((token) => ['insert', token])];
  }

  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push(['equal', a[i]]);
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      ops.push(['delete', a[i]]);
      i += 1;
    } else {
      ops.push(['insert', b[j]]);
      j += 1;
    }
  }
  while (i < n) ops.push(['delete', a[i++]]);
  while (j < m) ops.push(['insert', b[j++]]);
  return ops;
}

function merge(ops) {
  const segments = [];
  for (const [type, text] of ops) {
    const last = segments[segments.length - 1];
    if (last && last.type === type) last.text += text;
    else segments.push({ type, text });
  }
  return segments;
}

const words = (text) => text.match(/\s+|[^\s]+/g) ?? [];
const lines = (text) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

/**
 * A readable diff between two texts, as `{ type, text }` segments where type
 * is `equal`, `insert` or `delete`.
 *
 * Lines first, then words inside the lines that changed — a sentence edited in
 * the middle of a long outline shows as that sentence, not as the whole page
 * struck through and rewritten.
 */
export function diffText(before, after) {
  const a = String(before ?? '');
  const b = String(after ?? '');
  if (a === b) return a ? [{ type: 'equal', text: a }] : [];

  const lineOps = lcsOps(lines(a), lines(b));
  const ops = [];
  let pendingDelete = [];
  let pendingInsert = [];

  const flush = () => {
    if (pendingDelete.length && pendingInsert.length) {
      ops.push(...lcsOps(words(pendingDelete.join('')), words(pendingInsert.join(''))));
    } else {
      for (const text of pendingDelete) ops.push(['delete', text]);
      for (const text of pendingInsert) ops.push(['insert', text]);
    }
    pendingDelete = [];
    pendingInsert = [];
  };

  for (const [type, text] of lineOps) {
    if (type === 'delete') pendingDelete.push(text);
    else if (type === 'insert') pendingInsert.push(text);
    else {
      flush();
      ops.push(['equal', text]);
    }
  }
  flush();
  return merge(ops);
}

/**
 * Script blocks compared by their stable id: which were added, which removed,
 * and — for the ones on both sides — which fields changed.
 */
export function diffScriptBlocks(beforeContent, afterContent) {
  const before = normalizeContent('SCRIPT', beforeContent).blocks;
  const after = normalizeContent('SCRIPT', afterContent).blocks;
  const beforeById = new Map(before.map((block) => [block.id, block]));
  const afterIds = new Set(after.map((block) => block.id));
  const result = [];

  for (const block of after) {
    const previous = beforeById.get(block.id);
    if (!previous) {
      result.push({ id: block.id, status: 'added', before: null, after: block, changedFields: [] });
      continue;
    }
    const changedFields = SCRIPT_BLOCK_FIELDS.filter((field) => previous[field] !== block[field]);
    result.push({ id: block.id, status: changedFields.length ? 'changed' : 'same', before: previous, after: block, changedFields });
  }
  for (const block of before) {
    if (!afterIds.has(block.id)) result.push({ id: block.id, status: 'removed', before: block, after: null, changedFields: [] });
  }
  return result;
}
