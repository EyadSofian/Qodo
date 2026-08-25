/**
 * Every permission must have a label.
 *
 * The Users screen renders one checkbox per entry in `ALL_PERMISSIONS` and asks
 * for its label with `t(\`perm.${permission}\`)`. That template key is cast to
 * `StringKey`, so TypeScript cannot see whether the string exists — and `t`
 * falls back to returning the key itself. A permission added without a label
 * therefore ships as a checkbox reading `perm.offices.manage`, which is exactly
 * what happened to `offices.manage` and is exactly what nothing else catches.
 *
 * Reading the string table as text is crude, but it is the only thing that can
 * see across the cast, and it costs a millisecond.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ALL_PERMISSIONS } from '../shared/permissions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('every permission carries a bilingual label the Users screen can show', async () => {
  const strings = await fs.readFile(path.join(__dirname, '..', 'src', 'lib', 'i18n.tsx'), 'utf8');

  const missing = ALL_PERMISSIONS.filter(
    (permission) => !strings.includes(`'perm.${permission}':`)
  );
  assert.deepEqual(
    missing,
    [],
    `these permissions would render as their own raw key: ${missing.join(', ')}`
  );

  // A label present but empty on one side is the same failure, one step later.
  for (const permission of ALL_PERMISSIONS) {
    const entry = strings.slice(strings.indexOf(`'perm.${permission}':`));
    const block = entry.slice(0, entry.indexOf('},') + 2);
    assert.match(block, /ar:\s*'[^']+'/, `${permission} has no Arabic label`);
    assert.match(block, /en:\s*'[^']+'/, `${permission} has no English label`);
  }
});
