import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyMention, mentionQueryAt, mentionSegments, mentionedIds } from '../shared/mentions.js';

const PEOPLE = [
  { id: 'ahmed', name: 'Ahmed' },
  { id: 'ahmed-ali', name: 'Ahmed Ali' },
  { id: 'mohamed', name: 'محمد سمير' },
];

test('the longer name wins, so a colleague is not mentioned by the first half of another', () => {
  assert.deepEqual(mentionedIds('راجع مع @Ahmed Ali', PEOPLE), ['ahmed-ali']);
  assert.deepEqual(mentionedIds('راجع مع @Ahmed لوحده', PEOPLE), ['ahmed']);
});

test('Arabic joins "and" to the next word, and a mention survives it', () => {
  const people = [{ id: 'mona', name: 'منى خالد' }, ...PEOPLE];
  assert.deepEqual(mentionedIds('كلّم @محمد سمير و@منى خالد', people), ['mohamed', 'mona']);
  assert.deepEqual(mentionedIds('ب@منى خالد', people), ['mona']);
  // Two letters is a word of its own, not a prefix stuck to a name.
  assert.deepEqual(mentionedIds('ول@منى خالد', people), []);
  assert.deepEqual(mentionQueryAt('و@من', 4)?.query, 'من');
});

test('an address in a sentence is an address', () => {
  assert.deepEqual(mentionedIds('اكتب على billing@Ahmed.com', PEOPLE), []);
  assert.deepEqual(mentionedIds('sales@Ahmed Ali', PEOPLE), []);
  assert.deepEqual(mentionedIds('اكتب لـ finance@Ahmed', PEOPLE), []);
});

test('a name is mentioned once however often it is written', () => {
  assert.deepEqual(mentionedIds('@Ahmed Ali و @Ahmed Ali تاني', PEOPLE), ['ahmed-ali']);
});

test('Arabic names carry their spaces', () => {
  assert.deepEqual(mentionedIds('اسأل @محمد سمير من فضلك', PEOPLE), ['mohamed']);
});

test('the text survives the round trip through the segments', () => {
  const body = 'صباح الخير @محمد سمير، كلّم @Ahmed Ali النهاردة.';
  assert.equal(mentionSegments(body, PEOPLE).map((segment) => segment.text).join(''), body);
});

test('the half-typed query opens at @ and closes at a newline', () => {
  const draft = 'راجع مع @محمد س';
  assert.deepEqual(mentionQueryAt(draft, draft.length), { start: 8, end: 15, query: 'محمد س' });
  assert.equal(mentionQueryAt('@Ahmed\nسطر تاني', 13), null);
  assert.equal(mentionQueryAt('من غير منشن', 6), null);
});

test('picking a name completes the word and leaves room for the next one', () => {
  const draft = 'راجع مع @محمد س';
  const range = mentionQueryAt(draft, draft.length);
  const next = applyMention(draft, range, { id: 'mohamed', name: 'محمد سمير' });
  assert.equal(next.value, 'راجع مع @محمد سمير ');
  assert.equal(next.caret, next.value.length);
  assert.deepEqual(mentionedIds(next.value, PEOPLE), ['mohamed']);
});
