/**
 * Turning pasted text into lessons.
 *
 * Two inputs are accepted and told apart without asking the user which one
 * they meant:
 *
 *   • a plain list — one lesson per line, as it comes out of a syllabus
 *     document. Leading numbering and bullets ("01 -", "3.", "•") are stripped.
 *   • a CSV or a spreadsheet paste — a header row containing a lesson column,
 *     and optionally a module column. Tabs work as well as commas, because a
 *     paste from Excel or Google Sheets arrives tab-separated.
 */

export const MAX_IMPORT_LESSONS = 500;
const MAX_NAME = 200;

const LESSON_HEADERS = ['lesson', 'lesson name', 'title', 'name', 'الدرس', 'اسم الدرس'];
const MODULE_HEADERS = ['module', 'section', 'module name', 'الوحدة', 'القسم'];

/** Split one CSV line, honouring quotes. */
function splitCsvLine(line, delimiter) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells.map((value) => value.trim());
}

function cleanName(value) {
  return String(value ?? '')
    .replace(/^\s*(?:[-*•·▪◦]|\(?\d{1,3}[.)\-:]|\d{1,3}\s+[-–—:])\s*/u, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME);
}

/**
 * `[{ name, moduleName }]` — `moduleName` is `null` when the input had no
 * module column. Empty lines and duplicate header rows are skipped.
 */
export function parseLessonList(text) {
  const rawLines = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => line.trim().length > 0);
  if (rawLines.length === 0) return [];

  const first = rawLines[0];
  const delimiter = first.includes('\t') ? '\t' : first.includes(',') ? ',' : null;

  if (delimiter) {
    const header = splitCsvLine(first, delimiter).map((cell) => cell.toLowerCase());
    const lessonIndex = header.findIndex((cell) => LESSON_HEADERS.includes(cell));
    const moduleIndex = header.findIndex((cell) => MODULE_HEADERS.includes(cell));
    if (lessonIndex !== -1) {
      return rawLines
        .slice(1)
        .map((line) => splitCsvLine(line, delimiter))
        .map((cells) => ({
          name: cleanName(cells[lessonIndex]),
          moduleName: moduleIndex !== -1 ? cleanName(cells[moduleIndex]) || null : null,
        }))
        .filter((row) => row.name)
        .slice(0, MAX_IMPORT_LESSONS);
    }
  }

  return rawLines
    .map((line) => ({ name: cleanName(line), moduleName: null }))
    .filter((row) => row.name)
    .slice(0, MAX_IMPORT_LESSONS);
}
