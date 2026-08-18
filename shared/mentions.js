/**
 * Who a message points at, read out of the message itself.
 *
 * A mention could have been a list of ids travelling beside the text, but then
 * two things claim to know who was mentioned and they drift the moment somebody
 * edits the sentence, replays an old draft, or posts through the API by hand.
 * So the text is the record: `@Full Name` written in the body *is* the mention,
 * and this module is the only thing that reads it. The composer's picker is a
 * convenience for typing that string, not a second source of truth — a name
 * typed out by hand mentions exactly as well.
 *
 * Names are matched whole and longest-first, because "Ahmed" and "Ahmed Ali"
 * both sitting in the workspace must not turn a message for the second into a
 * ping for the first. Two people with the identical display name are mentioned
 * together; the text genuinely does not say which, and guessing would be worse
 * than telling both.
 */

/**
 * The one-letter words Arabic writes joined to the word after them.
 *
 * "و" is "and", and a sentence naming two colleagues is written "@سارة و@منى"
 * with nothing between the conjunction and the name. Latin text puts a space
 * there and Arabic does not, so a rule that only accepts a space before the `@`
 * quietly drops every second mention in an Arabic message — which is most of
 * them, in an Arabic-first workspace.
 */
const JOINED_PREFIXES = ['و', 'ف', 'ب', 'ل', 'ك'];

/**
 * The character before an `@` decides whether it opens a mention at all.
 *
 * Without this, `finance@engosoft.com` mentions anybody called "engosoft" — an
 * address pasted into a sentence is the one place `@` appears constantly and
 * means nothing. A mention starts a word: the `@` follows whitespace,
 * punctuation, or the start of the message.
 *
 * The exception above is narrow on purpose. A joined prefix counts only when it
 * is a single Arabic letter that is itself standing at the start of a word, so
 * "و@منى" opens a mention and "billing@Mona.com" still does not: the local part
 * of an address is never one Arabic letter.
 */
function opensMention(text, index) {
  if (index === 0) return true;
  const previous = text[index - 1];
  if (!/[\p{L}\p{N}_.@-]/u.test(previous)) return true;
  if (!JOINED_PREFIXES.includes(previous)) return false;
  return index === 1 || !/[\p{L}\p{N}_.@-]/u.test(text[index - 2]);
}

function byLongestName(people) {
  return [...people]
    .filter((person) => person && typeof person.name === 'string' && person.name.trim())
    .sort((left, right) => right.name.length - left.name.length);
}

/**
 * The message split into plain runs and mention runs, in order.
 *
 * One pass serves both jobs: the client walks the segments to draw a chip per
 * mention, and `mentionedIds` walks the same segments so what lights up in the
 * thread and who gets told can never disagree.
 */
export function mentionSegments(body, people) {
  const text = String(body ?? '');
  const candidates = byLongestName(Array.isArray(people) ? people : []);
  const segments = [];
  let plain = '';

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '@' && opensMention(text, index)) {
      const person = candidates.find((candidate) => text.startsWith(candidate.name, index + 1));
      if (person) {
        if (plain) segments.push({ text: plain, person: null });
        segments.push({ text: `@${person.name}`, person });
        plain = '';
        index += person.name.length;
        continue;
      }
    }
    plain += text[index];
  }
  if (plain) segments.push({ text: plain, person: null });
  return segments;
}

/** Everybody the body names, once each, in the order they were written. */
export function mentionedIds(body, people) {
  const seen = [];
  for (const segment of mentionSegments(body, people)) {
    if (segment.person && !seen.includes(segment.person.id)) seen.push(segment.person.id);
  }
  return seen;
}

/**
 * The half-typed `@…` under the cursor, or null when there is none.
 *
 * The composer asks this on every keystroke to decide whether to offer the
 * picker. A mention name may contain spaces, so the query cannot stop at the
 * first one — it runs to the cursor and the list narrows as the second word
 * arrives. It gives up after a few words rather than treating the rest of a
 * paragraph as a search term, and at a newline, which no name crosses.
 */
export function mentionQueryAt(value, caret) {
  const text = String(value ?? '');
  const position = Math.max(0, Math.min(caret ?? text.length, text.length));
  for (let index = position - 1; index >= 0; index -= 1) {
    const character = text[index];
    if (character === '\n') return null;
    if (character === '@') {
      if (!opensMention(text, index)) return null;
      const query = text.slice(index + 1, position);
      if (query.split(/\s+/).length > 4) return null;
      return { start: index, end: position, query };
    }
    if (position - index > 60) return null;
  }
  return null;
}

/**
 * Replaces the half-typed `@…` with a whole name, and says where the cursor
 * lands. The trailing space is deliberate: without it the next word typed grows
 * the name and quietly un-mentions the person.
 */
export function applyMention(value, range, person) {
  const text = String(value ?? '');
  const inserted = `@${person.name} `;
  return {
    value: text.slice(0, range.start) + inserted + text.slice(range.end),
    caret: range.start + inserted.length,
  };
}
