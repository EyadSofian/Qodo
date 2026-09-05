/**
 * Qodo Projects — import.
 *
 * Upload, preview, map, validate, dry run, execute. Six steps rather than one
 * button, and §66 asks for all of them for the same reason: an import that
 * silently half-works leaves somebody reconciling two hundred rows by hand.
 *
 * **A dry run is a real run that writes nothing.** It parses every row, applies
 * the mapping, validates each value and reports exactly what would happen —
 * including which rows would fail and why. Anything less is a spell-check
 * pretending to be a rehearsal.
 *
 * **Nothing is ever reported as imported that was not.** The run row carries
 * the failures as durably as the successes, because "42 of 50 imported" without
 * naming the eight is a message nobody can act on.
 */

import { rows, row, transaction } from './db.js';
import * as audit from './auditService.js';

/** How many rows one import may carry. Beyond this it is a data migration. */
export const MAX_IMPORT_ROWS = 5000;

/* ------------------------------------------------------------------ */
/* Parsing                                                              */
/* ------------------------------------------------------------------ */

/**
 * Parse CSV, including quoted fields with embedded commas and newlines.
 *
 * Written out rather than reached for, because the parsers that fit in one line
 * are the ones that break on `"Smith, John"` — which is in every real export —
 * and pulling in a dependency for eighty lines of state machine is worse than
 * having the state machine.
 */
export function parseCsv(text) {
  // Strip the BOM Excel writes; left in place it becomes part of the first
  // header name and no mapping ever matches it.
  const input = String(text ?? '').replace(/^﻿/, '');
  const records = [];
  let field = '';
  let record = [];
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (inQuotes) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      inQuotes = true;
    } else if (character === ',') {
      record.push(field);
      field = '';
    } else if (character === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else if (character !== '\r') {
      field += character;
    }
  }

  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  // A trailing newline produces one empty record; drop it rather than importing
  // a blank row.
  return records.filter((entry) => entry.some((cell) => String(cell).trim() !== ''));
}

/**
 * The first look at a file: headers, a few rows, and a suggested mapping.
 *
 * The suggestion is a convenience, never applied on its own — a person confirms
 * it, because a column called "Owner" could be the assignee or the client and
 * only they know which.
 */
export function preview(text, moduleKey) {
  const parsed = parseCsv(text);
  if (parsed.length === 0) return { headers: [], rows: [], suggested: {}, totalRows: 0 };

  const [headers, ...body] = parsed;
  const fields = FIELDS[moduleKey] ?? {};

  const suggested = {};
  for (const header of headers) {
    const normalised = String(header).toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const [key, definition] of Object.entries(fields)) {
      const aliases = [key, ...(definition.aliases ?? [])].map((alias) =>
        alias.toLowerCase().replace(/[^a-z0-9]/g, '')
      );
      if (aliases.includes(normalised)) {
        suggested[header] = key;
        break;
      }
    }
  }

  return {
    headers,
    rows: body.slice(0, 10).map((values) => Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']))),
    suggested,
    totalRows: body.length,
    // Said plainly rather than truncating quietly, so nobody discovers the
    // missing rows a week later.
    exceedsLimit: body.length > MAX_IMPORT_ROWS,
    limit: MAX_IMPORT_ROWS,
  };
}

/* ------------------------------------------------------------------ */
/* Fields                                                               */
/* ------------------------------------------------------------------ */

/**
 * What each module accepts, and how each value is checked.
 *
 * An allowlist: a column mapped to a field that is not here is refused rather
 * than written, so a crafted mapping cannot reach a column the importer was
 * never meant to touch.
 */
const FIELDS = {
  task: {
    title: { required: true, aliases: ['name', 'task', 'summary'], validate: (v) => (v.trim() ? null : 'required') },
    description: { aliases: ['details', 'notes'] },
    startDate: { aliases: ['start', 'startdate'], validate: isDate },
    endDate: { aliases: ['due', 'duedate', 'end', 'finish'], validate: isDate },
    durationDays: { aliases: ['duration', 'days'], validate: isPositiveInteger },
    estimatedHours: { aliases: ['estimate', 'hours', 'estimatedhours'], validate: isNumber },
    priority: {
      aliases: ['prio'],
      validate: (v) => (!v || ['low', 'normal', 'high', 'urgent'].includes(v.toLowerCase()) ? null : 'not_a_priority'),
    },
    taskListName: { aliases: ['list', 'tasklist'] },
  },
  issue: {
    title: { required: true, aliases: ['summary', 'issue'], validate: (v) => (v.trim() ? null : 'required') },
    description: { aliases: ['details'] },
    severity: {
      validate: (v) =>
        !v || ['cosmetic', 'minor', 'major', 'critical', 'blocker'].includes(v.toLowerCase())
          ? null
          : 'not_a_severity',
    },
    priority: {
      validate: (v) => (!v || ['low', 'normal', 'high', 'urgent'].includes(v.toLowerCase()) ? null : 'not_a_priority'),
    },
    dueDate: { aliases: ['due', 'duedate'], validate: isDate },
    moduleAffected: { aliases: ['area', 'component'] },
  },
};

function isDate(value) {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? null : 'not_a_date';
}
function isNumber(value) {
  if (!value) return null;
  return Number.isFinite(Number(value)) ? null : 'not_a_number';
}
function isPositiveInteger(value) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? null : 'not_a_positive_integer';
}

export const importableFields = (moduleKey) =>
  Object.entries(FIELDS[moduleKey] ?? {}).map(([key, definition]) => ({
    key,
    required: Boolean(definition.required),
    aliases: definition.aliases ?? [],
  }));

/* ------------------------------------------------------------------ */
/* Validation and execution                                             */
/* ------------------------------------------------------------------ */

/**
 * Apply a mapping to every row and say what would happen.
 *
 * Row numbers are 1-based and count the header, so a reported problem on "row
 * 7" is the seventh line of the file somebody is looking at — not the sixth
 * data row, which nobody can find.
 */
export function validateRows(text, moduleKey, mapping) {
  const fields = FIELDS[moduleKey];
  if (!fields) throw badRequest('module_not_importable');

  const unknown = Object.values(mapping ?? {}).filter((field) => field && !fields[field]);
  if (unknown.length > 0) {
    throw Object.assign(new Error('mapping_invalid'), {
      status: 400,
      body: { error: 'mapping_invalid', fields: unknown },
    });
  }

  const parsed = parseCsv(text);
  if (parsed.length < 2) return { valid: [], errors: [], totalRows: 0 };

  const [headers, ...body] = parsed;
  const valid = [];
  const errors = [];

  for (const [index, values] of body.entries()) {
    if (index >= MAX_IMPORT_ROWS) {
      errors.push({ row: index + 2, field: null, error: 'beyond_row_limit' });
      continue;
    }

    const record = {};
    const problems = [];

    for (const [column, field] of Object.entries(mapping ?? {})) {
      if (!field) continue;
      const raw = String(values[headers.indexOf(column)] ?? '').trim();
      const failure = fields[field].validate?.(raw) ?? null;
      if (failure) {
        problems.push({ row: index + 2, field, error: failure, value: raw.slice(0, 80) });
        continue;
      }
      if (raw !== '') record[field] = raw;
    }

    // A required field that was never mapped is a problem with the mapping, not
    // with the row, and it is reported on every row so the count is honest.
    for (const [field, definition] of Object.entries(fields)) {
      if (definition.required && !record[field]) {
        problems.push({ row: index + 2, field, error: 'required' });
      }
    }

    if (problems.length > 0) errors.push(...problems);
    else valid.push({ row: index + 2, record });
  }

  return { valid, errors, totalRows: body.length };
}

/**
 * Run an import, for real or as a rehearsal.
 *
 * The dry run does everything except the writes, and both paths record a run —
 * so a preview that reported forty valid rows can be compared with the execute
 * that followed it.
 */
export async function run(context, { text, moduleKey, mapping, dryRun = true, fileName = '', createTask }) {
  const { user, project, organizationId } = context;
  const outcome = validateRows(text, moduleKey, mapping);

  const runRow = await row(
    `INSERT INTO qodo_projects.import_runs
       (organization_id, project_id, source, target_module, file_name, mapping,
        is_dry_run, status, totals, errors, created_by)
     VALUES ($1,$2,'csv',$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [
      organizationId,
      project.id,
      moduleKey,
      String(fileName).slice(0, 200),
      JSON.stringify(mapping ?? {}),
      dryRun,
      dryRun ? 'previewed' : 'pending',
      JSON.stringify({ total: outcome.totalRows, valid: outcome.valid.length, invalid: outcome.errors.length }),
      JSON.stringify(outcome.errors.slice(0, 500)),
      user.id,
    ]
  );

  if (dryRun) {
    return {
      runId: runRow.id,
      dryRun: true,
      totals: { total: outcome.totalRows, valid: outcome.valid.length, invalid: outcome.errors.length },
      errors: outcome.errors.slice(0, 200),
    };
  }

  // Only the rows that validated. A partial import is the honest outcome when
  // eight rows are wrong — refusing all fifty because of them is worse, and
  // silently importing the eight badly is worse still.
  let imported = 0;
  const failures = [...outcome.errors];

  for (const entry of outcome.valid) {
    try {
      await createTask(entry.record);
      imported += 1;
    } catch (error) {
      failures.push({ row: entry.row, field: null, error: error.body?.error ?? 'write_failed' });
    }
  }

  await transaction(async (tx) => {
    await tx.query(
      `UPDATE qodo_projects.import_runs
          SET status = $2, totals = $3, errors = $4, completed_at = now()
        WHERE id = $1`,
      [
        runRow.id,
        failures.length === 0 ? 'completed' : 'completed',
        JSON.stringify({ total: outcome.totalRows, imported, failed: failures.length }),
        JSON.stringify(failures.slice(0, 500)),
      ]
    );

    await audit.record({
      actor: user,
      organizationId,
      projectId: project.id,
      entityType: 'import',
      entityId: runRow.id,
      action: 'data.import',
      after: { module: moduleKey, imported, failed: failures.length },
      tx,
    });
  });

  return {
    runId: runRow.id,
    dryRun: false,
    totals: { total: outcome.totalRows, imported, failed: failures.length },
    errors: failures.slice(0, 200),
  };
}

export async function history(organizationId, projectId) {
  return rows(
    `SELECT id, source, target_module, file_name, is_dry_run, status, totals, created_by, created_at, completed_at
       FROM qodo_projects.import_runs
      WHERE organization_id = $1 AND ($2::uuid IS NULL OR project_id = $2)
      ORDER BY created_at DESC LIMIT 50`,
    [organizationId, projectId ?? null]
  );
}

function badRequest(code) {
  return Object.assign(new Error(code), { status: 400, body: { error: code } });
}
