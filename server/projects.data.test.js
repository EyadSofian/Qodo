/**
 * Qodo Projects — import parsing, export safety and credential handling.
 *
 * All pure, all runnable anywhere. These are the functions where a quiet bug is
 * a security problem rather than a wrong number: a CSV cell that Excel executes,
 * a credential that survives encryption in plaintext, a parser that loses every
 * row containing a comma.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { columnsFor, safeCell, toCsv } from './projects/exportService.js';
import { MAX_IMPORT_ROWS, importableFields, parseCsv, preview, validateRows } from './projects/importService.js';
import { CREDENTIAL_MASK, PROVIDERS, decrypt, encrypt } from './projects/integrationService.js';

/* ── CSV formula injection ────────────────────────────────────────── */

test('a cell a spreadsheet would execute is neutralised', () => {
  // Excel and LibreOffice both evaluate a cell starting with these. A task
  // titled `=cmd|'/c calc'!A1` is remote code execution against whoever opens
  // the export, and it looks harmless inside the product.
  for (const payload of ["=cmd|'/c calc'!A1", '+1+1', '-2+3', '@SUM(A1)', '=HYPERLINK("http://evil")']) {
    const cell = safeCell(payload);
    assert.equal(cell[0], "'", `${payload} was not neutralised`);
    assert.ok(cell.endsWith(payload), 'the original text was altered rather than escaped');
  }
});

test('an ordinary cell is left alone', () => {
  assert.equal(safeCell('Pour the slab'), 'Pour the slab');
  assert.equal(safeCell('2026-09-06'), '2026-09-06');
  assert.equal(safeCell(42), '42');
  assert.equal(safeCell(null), '');
  assert.equal(safeCell(undefined), '');
});

test('a CSV quotes what needs quoting and doubles inner quotes', () => {
  const csv = toCsv(
    [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B' },
    ],
    [{ a: 'has, comma', b: 'has "quotes"' }]
  );
  assert.ok(csv.includes('"has, comma"'));
  assert.ok(csv.includes('"has ""quotes"""'));
});

test('a CSV starts with a BOM so Excel reads Arabic correctly', () => {
  // Without it Excel on Windows opens a UTF-8 file as Latin-1, and every Arabic
  // column becomes mojibake — which in an Arabic-first workspace means every
  // export is unreadable.
  const csv = toCsv([{ key: 'a', label: 'العنوان' }], [{ a: 'صب الخرسانة' }]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(csv.includes('صب الخرسانة'));
});

/* ── export columns ───────────────────────────────────────────────── */

test('a rate column is dropped for anybody without rate.view', () => {
  const withRates = { permissionSet: { id: 'admin' }, membership: { role: 'owner' } };
  const without = { permissionSet: { id: 'employee' }, membership: { role: 'member' } };

  assert.ok(columnsFor(withRates, 'time_log').some((column) => column.key === 'costRate'));
  assert.ok(!columnsFor(without, 'time_log').some((column) => column.key === 'costRate'));
  assert.ok(!columnsFor(without, 'time_log').some((column) => column.key === 'billRate'));

  // And the rest of the columns are still there — the filter narrowed, it did
  // not empty.
  assert.ok(columnsFor(without, 'time_log').length > 0);
});

/* ── CSV parsing ──────────────────────────────────────────────────── */

test('a quoted field may contain a comma', () => {
  // "Smith, John" is in every real export, and the parsers that fit in one line
  // are exactly the ones that lose it.
  const parsed = parseCsv('Name,Role\r\n"Smith, John",Engineer\r\n');
  assert.deepEqual(parsed[1], ['Smith, John', 'Engineer']);
});

test('a quoted field may contain a newline and a doubled quote', () => {
  const parsed = parseCsv('A\r\n"line\nbreak"\r\n"say ""hi"""\r\n');
  assert.equal(parsed[1][0], 'line\nbreak');
  assert.equal(parsed[2][0], 'say "hi"');
});

test('the BOM Excel writes does not become part of the first header', () => {
  const parsed = parseCsv('﻿Title,Due\r\nWork,2026-09-06\r\n');
  assert.equal(parsed[0][0], 'Title', 'the BOM stayed in the header and no mapping would match it');
});

test('blank lines are not imported as empty rows', () => {
  const parsed = parseCsv('Title\r\nWork\r\n\r\n\r\n');
  assert.equal(parsed.length, 2);
});

/* ── mapping and validation ───────────────────────────────────────── */

test('a preview suggests a mapping without applying it', () => {
  const result = preview('Task,Due date,Estimate\r\nWork,2026-09-06,8\r\n', 'task');
  assert.deepEqual(result.suggested, { Task: 'title', 'Due date': 'endDate', Estimate: 'estimatedHours' });
  assert.equal(result.totalRows, 1);
  assert.equal(result.rows.length, 1);
});

test('a preview says when a file is over the row limit rather than truncating quietly', () => {
  const many = ['Title', ...Array.from({ length: MAX_IMPORT_ROWS + 5 }, (_, i) => `Row ${i}`)].join('\n');
  const result = preview(many, 'task');
  assert.equal(result.exceedsLimit, true);
  assert.equal(result.limit, MAX_IMPORT_ROWS);
});

test('a mapping to a field that does not exist is refused', () => {
  // Otherwise a crafted mapping reaches a column the importer was never meant
  // to touch.
  assert.throws(
    () => validateRows('A\r\nx\r\n', 'task', { A: 'organization_id' }),
    (error) => error.body?.error === 'mapping_invalid'
  );
});

test('validation reports the row number a person can find in the file', () => {
  const csv = 'Title,Due\r\nGood,2026-09-06\r\nBad,not-a-date\r\n';
  const result = validateRows(csv, 'task', { Title: 'title', Due: 'endDate' });

  assert.equal(result.valid.length, 1);
  assert.equal(result.errors.length, 1);
  // Row 3 is the third line of the file, counting the header — not "data row 2",
  // which nobody can find.
  assert.equal(result.errors[0].row, 3);
  assert.equal(result.errors[0].error, 'not_a_date');
});

test('a missing required field fails the row rather than importing a blank', () => {
  const result = validateRows('Due\r\n2026-09-06\r\n', 'task', { Due: 'endDate' });
  assert.equal(result.valid.length, 0);
  assert.equal(result.errors[0].error, 'required');
  assert.equal(result.errors[0].field, 'title');
});

test('every importable field is documented with its aliases', () => {
  const fields = importableFields('task');
  assert.ok(fields.some((field) => field.key === 'title' && field.required));
  assert.ok(fields.every((field) => Array.isArray(field.aliases)));
  assert.deepEqual(importableFields('nonexistent'), []);
});

/* ── credentials ──────────────────────────────────────────────────── */

test('a credential does not survive encryption in readable form', () => {
  process.env.SESSION_SECRET ||= 'test-secret-of-sufficient-length-1234';
  const secret = 'ghp_a_real_looking_token_value';
  const stored = encrypt(secret);

  assert.ok(!stored.includes(secret), 'the ciphertext contains the plaintext');
  assert.equal(decrypt(stored), secret);
});

test('a tampered credential fails to decrypt rather than decrypting into something else', () => {
  process.env.SESSION_SECRET ||= 'test-secret-of-sufficient-length-1234';
  const stored = encrypt('original');
  assert.equal(decrypt(`${stored.slice(0, -3)}xyz`), null);
  assert.equal(decrypt('not-a-ciphertext'), null);
  assert.equal(decrypt(''), null);
});

test('the provider catalogue distinguishes what is inside the workspace from what needs a credential', () => {
  const firstParty = Object.values(PROVIDERS).filter((provider) => provider.kind === 'first_party');
  const adapters = Object.values(PROVIDERS).filter((provider) => provider.kind === 'adapter');

  assert.ok(firstParty.length >= 4, 'the workspace’s own modules are not represented');
  assert.ok(adapters.length >= 8);
  // §68: every adapter is inert until somebody configures it, and says so.
  assert.ok(adapters.every((provider) => provider.needsCredentials));
});

test('the credential mask is not a credential', () => {
  assert.ok(!/[a-zA-Z0-9]/.test(CREDENTIAL_MASK));
});
