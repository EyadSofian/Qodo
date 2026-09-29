/**
 * E-Learning Production copy: every key the screens use, and every value of
 * an enum family the server can send, has an Arabic and an English entry — and
 * the Arabic is Arabic, not the English copied across.
 *
 * The screens fall back to a label built from the key when an entry is
 * missing, so a gap would never crash; this test is what keeps it from
 * shipping.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACTIVITY_EVENTS,
  CHECKLIST_ITEM_STATUSES,
  COURSE_HEALTH,
  COURSE_ROLES,
  STAGE_KEYS,
} from '../shared/learningProduction/constants.js';
import {
  CANDIDATE_FILE_KINDS,
  CANDIDATE_SOURCES,
  CANDIDATE_STATUSES,
  IMPACT_DECISIONS,
  ISSUE_AREAS,
  ISSUE_SEVERITIES,
  ISSUE_STATUSES,
  ORIGINS,
  RELEASE_KINDS,
  RELEASE_STATUSES,
  RUN_STATUSES,
  STAGE_STATUSES,
  TASK_CLASSIFICATIONS,
  TASK_KINDS,
  TASK_STATUSES,
} from '../shared/learningProduction/runs.js';
import { RUN_SCENARIOS, SCENARIOS } from '../shared/learningProduction/workflowTemplates.js';
import { traceRows } from '../shared/learningProduction/traceability.js';
import { PREFERENCE_EVENTS } from './learningProduction/notifications.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TABLES = [
  'src/lib/learningProduction/strings.ts',
  'src/lib/learningProduction/studioStrings.ts',
  'src/lib/learningProduction/studioScreens.ts',
];

const QUOTED = String.raw`(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")`;
const ENTRY = new RegExp(String.raw`'(lp\.[^']+)':\s*\{\s*ar:\s*${QUOTED},\s*en:\s*${QUOTED}\s*,?\s*\}`, 'g');

function loadTable() {
  /** @type {Map<string, {ar: string, en: string, file: string}>} */
  const table = new Map();
  for (const file of TABLES) {
    const source = readFileSync(join(root, file), 'utf8');
    for (const match of source.matchAll(ENTRY)) {
      const key = match[1];
      // The rebuilt tables win over strings.ts, as they do at runtime.
      table.set(key, { ar: match[2] ?? match[3], en: match[4] ?? match[5], file });
    }
    const declared = [...source.matchAll(/^\s*'(lp\.[^']+)':/gm)].length;
    const parsed = [...source.matchAll(ENTRY)].length;
    assert.equal(parsed, declared, `${file}: ${declared - parsed} entries are not in the { ar, en } shape this test reads`);
  }
  return table;
}

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(dir, entry.name)] : []
  );
}

const table = loadTable();

test('every static lp.* key used in the app has an entry', () => {
  const missing = new Set();
  for (const file of sourceFiles(join(root, 'src'))) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/['"`](lp\.[A-Za-z0-9_.-]+)['"`]/g)) {
      const key = match[1];
      if (key.endsWith('.') || table.has(key)) continue;
      missing.add(`${key}  (${file.slice(root.length + 1)})`);
    }
  }
  assert.deepEqual([...missing].sort(), []);
});

const FAMILIES = {
  'lp.scenario': RUN_SCENARIOS,
  'lp.scenarioShort': RUN_SCENARIOS,
  'lp.scenarioHint': SCENARIOS,
  'lp.scenarioPath': SCENARIOS,
  'lp.runStatus': RUN_STATUSES,
  'lp.stageStatus': STAGE_STATUSES,
  'lp.taskStatus': TASK_STATUSES,
  'lp.taskKind': TASK_KINDS,
  'lp.classification': TASK_CLASSIFICATIONS,
  'lp.origin': ORIGINS,
  'lp.issueSeverity': ISSUE_SEVERITIES,
  'lp.issueArea': ISSUE_AREAS,
  'lp.issueStatus': ISSUE_STATUSES,
  'lp.releaseStatus': RELEASE_STATUSES,
  'lp.releaseKind': RELEASE_KINDS,
  'lp.impact': IMPACT_DECISIONS,
  'lp.candidateStatus': CANDIDATE_STATUSES,
  'lp.candidateSource': CANDIDATE_SOURCES,
  'lp.candidateFile': CANDIDATE_FILE_KINDS,
  'lp.stageKey': STAGE_KEYS,
  'lp.role': COURSE_ROLES,
  'lp.health': COURSE_HEALTH,
  'lp.checkState': CHECKLIST_ITEM_STATUSES,
  'lp.activity': ACTIVITY_EVENTS,
  'lp.healthReason': ['TARGET_PASSED', 'MANY_OVERDUE', 'SOME_OVERDUE', 'BEHIND_SCHEDULE', 'TARGET_CLOSE'],
  'lp.readiness': ['STAGES_COMPLETE', 'CONTENT_APPROVED', 'NO_BLOCKING_ISSUES', 'RELEASE_SIGNED_OFF'],
  'lp.rule': ['met', 'notMet', 'waiting'],
  'lp.trace': [...new Set([...traceRows().detail, ...traceRows().master].map((row) => row.status))],
  'lp.issue.done': ['start', 'fix', 'verify', 'reopen', 'wont-fix'],
  'lp.prefs.event': PREFERENCE_EVENTS,
  'lp.prefs.eventHint': PREFERENCE_EVENTS,
  'lp.work.action': ['START', 'CONTINUE', 'FIX', 'REVIEW', 'VERIFY', 'SIGN_OFF', 'PUBLISH', 'ASSIGN'],
  'lp.roleHint': COURSE_ROLES,
  'lp.work.kind': ['TASK', 'ASSET', 'ISSUE', 'RELEASE'],
  'lp.reviews.group': ['firstSubmissions', 'resubmissions', 'curriculum', 'mediaQa', 'signoff'],
  'lp.reviews.hint': ['firstSubmissions', 'resubmissions', 'curriculum', 'mediaQa', 'signoff'],
  'lp.myWork.empty': ['now', 'review', 'blocked', 'done'],
  'lp.newRun.step': ['way', 'basics', 'team', 'review'],
  'lp.courses.sort': ['recent', 'name', 'target', 'progress'],
};

test('every value of every enum family the server sends has an entry', () => {
  const missing = [];
  for (const [prefix, values] of Object.entries(FAMILIES)) {
    assert.ok(values.length > 0, `${prefix} has no values to check`);
    for (const value of values) if (!table.has(`${prefix}.${value}`)) missing.push(`${prefix}.${value}`);
  }
  assert.deepEqual(missing, []);
});

test('every error code the server can answer with has an entry', () => {
  const source = readFileSync(join(root, 'server/learningProduction/errors.js'), 'utf8');
  const block = source.slice(source.indexOf('const MESSAGES'), source.indexOf('};', source.indexOf('const MESSAGES')));
  const codes = [...block.matchAll(/^\s*([A-Z_]+):/gm)].map((match) => match[1]);
  assert.ok(codes.length > 30);
  const known = readFileSync(join(root, 'src/lib/learningProduction/format.ts'), 'utf8');
  const missing = codes.filter((code) => !table.has(`lp.error.${code}`));
  const unmapped = codes.filter((code) => !known.includes(`'${code}'`));
  assert.deepEqual(missing, [], 'codes without copy');
  assert.deepEqual(unmapped, [], 'codes missing from KNOWN_ERRORS, which would show the generic message');
});

// Brand and tool names stay in Latin script in Arabic copy.
const LATIN_OK = /^[\s\d{}().,:;·/+%#@&"'’“”«»—–\-→←|?!…]*(?:(?:LinkedIn|Apollo\.io|Apollo|Docki|Think|GPT|LMS|UAT|PPT|VO|ID|AI|QA|SME|PDF|URL|https?:\/\/)[\s\d{}().,:;·/+%#@&"'’“”«»—–\-→←|?!…]*)*$/;

test('Arabic entries are written in Arabic', () => {
  const untranslated = [];
  for (const [key, entry] of table) {
    assert.ok(entry.ar.trim().length > 0, `${key}: empty Arabic`);
    assert.ok(entry.en.trim().length > 0, `${key}: empty English`);
    if (/[؀-ۿ]/.test(entry.ar)) continue;
    if (LATIN_OK.test(entry.ar)) continue;
    untranslated.push(`${key}: ${entry.ar}`);
  }
  assert.deepEqual(untranslated, []);
});

test('Arabic and English use the same placeholders', () => {
  const mismatched = [];
  const vars = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(',');
  for (const [key, entry] of table) {
    if (vars(entry.ar) !== vars(entry.en)) mismatched.push(`${key}: ar {${vars(entry.ar)}} en {${vars(entry.en)}}`);
  }
  assert.deepEqual(mismatched, []);
});
