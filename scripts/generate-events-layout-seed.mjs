/**
 * Generates shared/eventsLayoutSeed.js — the Events schedule's default
 * package structure — from the operations workbook.
 *
 *   node scripts/generate-events-layout-seed.mjs "/path/to/SCHEDULE REPORT - 2026.xlsx"
 *
 * The workbook is read here, once, by a person; never at runtime. What comes
 * out is plain data committed to the repo: departments in sheet order, the
 * packages each sheet declares, optional levels inside them, and each course
 * as its workbook code. Odoo event ids are resolved from those codes by the
 * server (`server/events/layout.js`), because a code is what the sheet and
 * Odoo share ("5592" here is "E05592" there).
 *
 * How a sheet's rows are read — the first column does not mean one thing:
 *
 *   • a merged row whose course-name cell repeats the first cell (the orange
 *     band) opens a PACKAGE;
 *   • a row with a course name is a COURSE. Its first cell is:
 *       – a label containing "Level" → the course sits in a LEVEL group. A run
 *         of rows with the same label is one group; the same label again after
 *         a different one is a new group (the next cohort), never merged;
 *       – any other label → the course sits directly in the package. When
 *         that label names something other than the package itself (a
 *         company course filed as "Mechanical Package"), it is kept as the
 *         course's badge;
 *       – empty → it continues the previous label;
 *   • a course row without a code cannot be matched to Odoo and is skipped
 *     (listed in `skipped` so nobody wonders where it went), and a level left
 *     with no courses is dropped.
 *
 * English and Webinar sheets carry no course codes, so they seed no packages;
 * their courses arrive as unassigned and are placed from the editor.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'shared', 'eventsLayoutSeed.js');

/** Sheet → canonical department, in the order the business reads them. */
const SHEETS = [
  ['Arch & Decor', 'Arch & Decor'],
  ['Mechanical', 'Mechanical'],
  ['Electrical', 'Electrical'],
  ['Civil', 'Civil'],
  ['Development', 'Development'],
  ['English Current Round', 'English'],
  ['Webinar', 'Webinar'],
];
const DEPARTMENT_KEY = {
  'Arch & Decor': 'arch',
  Mechanical: 'mechanical',
  Electrical: 'electrical',
  Civil: 'civil',
  Development: 'development',
  English: 'english',
  Webinar: 'webinar',
};
/** Package accents, rotated per department so neighbours never match. */
const ACCENTS = ['blue', 'violet', 'green', 'amber', 'sky', 'indigo', 'pink', 'orange'];

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

function text(cell) {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (value.richText) return clean(value.richText.map((part) => part.text).join(''));
    if ('result' in value) return clean(value.result);
    if ('text' in value) return clean(value.text);
  }
  return clean(value);
}

function dateOf(cell) {
  const value = cell.value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value && typeof value === 'object' && value.result instanceof Date) return value.result.toISOString().slice(0, 10);
  return null;
}

const isLevel = (label) => /\blevel\b/i.test(label);
/** "Interior Design Package Offline" and "Interior Design Offline" are the same thing. */
const stem = (label) =>
  clean(label.toLowerCase().replace(/\b(package|packages|online|offline|courses?)\b/g, ' '));

function findColumns(ws) {
  for (let r = 1; r <= Math.min(ws.rowCount, 8); r += 1) {
    const row = ws.getRow(r);
    const columns = {};
    for (let c = 1; c <= Math.min(ws.columnCount, 40); c += 1) {
      const label = text(row.getCell(c)).toLowerCase();
      if (label === 'course name') columns.name = c;
      else if (label === 'course code') columns.code = c;
      else if (label === 'start date') columns.start = c;
    }
    if (columns.name && columns.code) return { ...columns, headerRow: r };
  }
  return null;
}

function readSheet(ws, department) {
  const columns = findColumns(ws);
  const key = DEPARTMENT_KEY[department];
  const result = { department, sheet: ws.name, packages: [], skipped: [] };
  if (!columns) return result;

  let pkg = null;
  let group = null;
  let lastLabel = '';
  const seenGroupLabels = new Map();

  ws.eachRow({ includeEmpty: false }, (row, r) => {
    if (r === columns.headerRow) return;
    const first = text(row.getCell(1));
    const name = text(row.getCell(columns.name));
    if (first.toLowerCase() === 'package' || first.toLowerCase() === 'section') return;

    // A package band: merged across, so the course-name cell repeats the label.
    if (first && name === first && row.getCell(1).isMerged) {
      pkg = {
        id: `seed:${key}:p${result.packages.length + 1}`,
        label: first,
        accent: ACCENTS[result.packages.length % ACCENTS.length],
        courses: [],
        groups: [],
      };
      result.packages.push(pkg);
      group = null;
      lastLabel = '';
      seenGroupLabels.clear();
      return;
    }
    if (!name || !pkg) return;

    const label = first || lastLabel;
    const code = clean(text(row.getCell(columns.code))).replace(/\D/g, '').replace(/^0+/, '');
    const course = {
      code,
      name,
      row: r,
      ...(columns.start ? { start: dateOf(row.getCell(columns.start)) } : {}),
    };

    if (isLevel(label)) {
      if (!group || label !== lastLabel) {
        const count = (seenGroupLabels.get(label) ?? 0) + 1;
        seenGroupLabels.set(label, count);
        group = { id: `${pkg.id}:g${pkg.groups.length + 1}`, label, courses: [] };
        pkg.groups.push(group);
      }
    } else {
      group = null;
      if (stem(label) && stem(label) !== stem(pkg.label)) course.badge = label;
    }
    lastLabel = label;

    if (!code) {
      result.skipped.push({ row: r, name, reason: 'no course code' });
      return;
    }
    (group ? group.courses : pkg.courses).push(course);
  });

  for (const p of result.packages) {
    const empty = p.groups.filter((g) => g.courses.length === 0);
    for (const g of empty) result.skipped.push({ group: g.label, package: p.label, reason: 'level with no coded courses' });
    p.groups = p.groups.filter((g) => g.courses.length > 0);
  }
  return result;
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node scripts/generate-events-layout-seed.mjs <workbook.xlsx>');
    process.exit(1);
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);

  const departments = SHEETS.map(([sheet, department]) => {
    const ws = wb.getWorksheet(sheet);
    return ws ? readSheet(ws, department) : { department, sheet, packages: [], skipped: [{ reason: 'sheet missing' }] };
  });

  const courses = departments.flatMap((d) => d.packages.flatMap((p) => [...p.courses, ...p.groups.flatMap((g) => g.courses)]));
  const body = {
    source: path.basename(file),
    departments: departments.map(({ department, sheet, packages }) => ({
      department,
      sheet,
      packages: packages.map(({ id, label, accent, courses: direct, groups }) => ({
        id,
        label,
        accent,
        courses: direct,
        groups,
      })),
    })),
    skipped: departments.flatMap((d) => d.skipped.map((s) => ({ sheet: d.sheet, ...s }))),
  };

  const header = `/**
 * GENERATED by scripts/generate-events-layout-seed.mjs from "${body.source}".
 * Do not edit by hand — regenerate from the workbook.
 *
 * The Events schedule's default structure: departments in sheet order, their
 * packages, optional levels, and each course by its workbook code. The server
 * resolves codes to Odoo event ids; nothing here is read from the workbook at
 * runtime. ${courses.length} coded courses, ${body.skipped.length} rows or levels skipped (see \`skipped\`).
 */

`;
  await fs.writeFile(OUT, `${header}export const EVENTS_LAYOUT_SEED = ${JSON.stringify(body, null, 2)};\n`, 'utf8');
  console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${courses.length} courses`);
  for (const d of body.departments) {
    console.log(`  ${d.department}: ${d.packages.map((p) => `${p.label} (${p.courses.length}${p.groups.length ? ` + ${p.groups.length} levels` : ''})`).join(' · ') || '—'}`);
  }
  if (body.skipped.length) console.log(`  skipped: ${body.skipped.length}`);
}

main();
