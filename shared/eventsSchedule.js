/**
 * The training schedule's presentation rules — presets, columns, filters and
 * ordering — shared by the page and its tests.
 *
 * None of this changes what a course *is*; that is decided on the server from
 * Odoo. This decides which of the operations sheet's columns to draw for which
 * tab, which rows a quick filter keeps, and in what order. The department tabs
 * are presets over one list of rows: they never fetch anything of their own.
 */

/* ── searching ───────────────────────────────────────────────────── */

/**
 * Arabic is normalised on both sides — أ إ آ all become ا, ة becomes ه, and the
 * tatweel and diacritics are dropped — because somebody hunting for "التصميم"
 * should not miss "التصميــم", and nobody types hamzas consistently.
 */
export function normaliseArabic(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every word has to appear, in any order: "revit احمد" finds Ahmed's Revit course. */
export function matches(query, ...fields) {
  const needle = normaliseArabic(query);
  if (!needle) return true;
  const haystack = normaliseArabic(fields.filter(Boolean).join(' '));
  return needle.split(' ').every((word) => haystack.includes(word));
}

/** Everything somebody might remember about a course. */
export function rowMatches(row, query) {
  return matches(
    query,
    row.courseName,
    row.courseCode,
    row.instructor,
    row.package,
    row.section,
    row.department,
    row.coordinator,
    row.location?.venue,
    row.trainingType
  );
}

/* ── status ──────────────────────────────────────────────────────── */

export const STATUS_ORDER = ['in_progress', 'planned', 'hold', 'finished', 'canceled', 'refused'];
export const STATUS_LABELS = {
  in_progress: 'In Progress',
  planned: 'Planned',
  hold: 'Hold',
  finished: 'Finished',
  canceled: 'Canceled',
  refused: 'Refused',
};
/** Out of the day-to-day schedule unless asked for; the Archive is their home. */
export const CLOSED_STATUSES = ['finished', 'canceled', 'refused'];

/* ── department presets ──────────────────────────────────────────── */

/**
 * The workbook's live tabs. `department` is matched against the row's
 * normalised department; `groupLabel` is what that sheet called its first
 * column, because Mechanical said "Package" and Arch & Decor said "Section".
 */
export const DEPARTMENT_PRESETS = [
  { key: 'all', label: 'All', department: null, groupLabel: 'Department / Package', view: null },
  { key: 'arch', label: 'Arch & Decor', department: 'Arch & Decor', groupLabel: 'Section', view: null },
  { key: 'mechanical', label: 'Mechanical', department: 'Mechanical', groupLabel: 'Package', view: null },
  { key: 'electrical', label: 'Electrical', department: 'Electrical', groupLabel: 'Package', view: null },
  { key: 'civil', label: 'Civil', department: 'Civil', groupLabel: 'Package', view: null },
  { key: 'development', label: 'Development', department: 'Development', groupLabel: 'Section', view: null },
  { key: 'english', label: 'English', department: 'English', groupLabel: 'Section', view: 'english' },
  { key: 'webinar', label: 'Webinar', department: 'Webinar', groupLabel: 'Section', view: 'webinar' },
];

export function departmentPreset(key) {
  return DEPARTMENT_PRESETS.find((preset) => preset.key === key) ?? DEPARTMENT_PRESETS[0];
}

/* ── columns ─────────────────────────────────────────────────────── */

/**
 * Header groups and their columns. Labels stay in the sheet's own words —
 * including the two Arabic ones — so the people who ran the spreadsheet find
 * everything where they expect it.
 */
export const COLUMN_GROUPS = {
  course: 'Course Info',
  capacity: 'Capacity',
  schedule: 'Schedule',
  operations: 'Operations',
  sessions: 'Sessions',
};

/** @type {Record<string, { group: string, label: string, sticky?: boolean, sortKey?: string, numeric?: boolean }>} */
export const COLUMNS = {
  group: { group: 'course', label: 'Package / Section', sticky: true, sortKey: 'group' },
  courseName: { group: 'course', label: 'Course Name', sticky: true, sortKey: 'courseName' },
  course: { group: 'course', label: 'Course', sticky: true, sortKey: 'courseName' },
  courseNameCode: { group: 'course', label: 'Course Name & Code', sticky: true, sortKey: 'courseName' },
  webinarName: { group: 'course', label: 'Webinar Name', sticky: true, sortKey: 'courseName' },
  instructor: { group: 'course', label: 'Inst. Name', sortKey: 'instructor' },
  type: { group: 'course', label: 'Type', sortKey: 'type' },
  code: { group: 'course', label: 'Course Code', sortKey: 'code' },
  lectures: { group: 'capacity', label: 'عدد المحاضرات', sortKey: 'lectures', numeric: true },
  trainees: { group: 'capacity', label: 'عدد المتدربين', sortKey: 'trainees', numeric: true },
  attCapacity: { group: 'capacity', label: 'No. of Att / Capacity', sortKey: 'trainees', numeric: true },
  capacity: { group: 'capacity', label: 'Capacity', sortKey: 'capacity', numeric: true },
  registrations: { group: 'capacity', label: 'Registrations', sortKey: 'trainees', numeric: true },
  month: { group: 'schedule', label: 'Month', sortKey: 'start' },
  startDate: { group: 'schedule', label: 'Start Date', sortKey: 'start' },
  endDate: { group: 'schedule', label: 'End Date', sortKey: 'end' },
  date: { group: 'schedule', label: 'Date', sortKey: 'start' },
  startTime: { group: 'schedule', label: 'Start Time KSA', sortKey: 'time' },
  endTime: { group: 'schedule', label: 'End Time KSA', sortKey: 'time' },
  timeKsa: { group: 'schedule', label: 'Time KSA', sortKey: 'time' },
  dayPart: { group: 'schedule', label: 'Day / Night', sortKey: 'time' },
  workDays: { group: 'schedule', label: 'Work Days', sortKey: 'workDays' },
  nextSession: { group: 'schedule', label: 'Next Session', sortKey: 'next' },
  status: { group: 'operations', label: 'Status', sortKey: 'status' },
  coordinator: { group: 'operations', label: 'Coordinator', sortKey: 'coordinator' },
  comments: { group: 'operations', label: 'Comments' },
};

/**
 * View modes. `sessions: true` appends S1…Sn after the listed columns;
 * `grouped` draws the Course Info / Capacity / Schedule header band, which only
 * reads well where each group's columns sit together. `english` and `webinar`
 * are the two tabs whose sheets had their own layout; they are chosen by the
 * department preset rather than offered for every tab.
 */
export const VIEW_PRESETS = {
  excel: {
    label: 'Excel Full',
    columns: ['group', 'courseName', 'instructor', 'type', 'code', 'lectures', 'trainees', 'startDate', 'endDate', 'startTime', 'endTime', 'dayPart', 'workDays', 'status', 'coordinator', 'comments'],
    sessions: true,
    grouped: true,
    labels: {},
  },
  operations: {
    label: 'Operations',
    columns: ['course', 'instructor', 'type', 'trainees', 'capacity', 'startDate', 'endDate', 'workDays', 'status', 'coordinator', 'comments'],
    sessions: false,
    grouped: true,
    labels: {},
  },
  sessions: {
    label: 'Sessions',
    columns: ['courseName', 'code', 'instructor', 'status'],
    sessions: true,
    grouped: true,
    labels: {},
  },
  compact: {
    label: 'Compact',
    columns: ['course', 'status', 'instructor', 'startDate', 'trainees', 'capacity', 'nextSession', 'workDays'],
    sessions: false,
    grouped: false,
    labels: {},
  },
  english: {
    label: 'English',
    columns: ['workDays', 'type', 'timeKsa', 'courseNameCode', 'attCapacity', 'instructor', 'startDate', 'endDate', 'status', 'coordinator', 'comments'],
    sessions: false,
    grouped: false,
    labels: { instructor: 'Instructor' },
  },
  webinar: {
    label: 'Webinar',
    columns: ['month', 'webinarName', 'instructor', 'date', 'timeKsa', 'status', 'registrations'],
    sessions: false,
    grouped: false,
    labels: { instructor: 'Inst. Name' },
  },
};

export const GENERAL_VIEWS = ['excel', 'operations', 'sessions', 'compact'];

/** The view actually drawn: a department with its own sheet layout gets it by default. */
export function resolveView(view, departmentKey) {
  const preset = departmentPreset(departmentKey);
  if (view === 'auto' || !VIEW_PRESETS[view]) return preset.view ?? 'excel';
  return view;
}

/**
 * The longest course among the rows on screen decides how many S-columns are
 * drawn — sixteen for a package of sixteen-lecture courses, forty for Civil —
 * rather than forty empty columns for everybody.
 */
export function maxSessionCount(rows) {
  let max = 0;
  for (const row of rows) max = Math.max(max, row.sessions?.length ?? 0);
  return max;
}

/**
 * Column ids for a view, minus the ones the person hid, plus `s1…sN`. Session
 * columns are ids here only — the data stays one `sessions` array per course.
 *
 * @param {string} view
 * @param {{ hidden?: string[], sessionCount?: number }} [options]
 * @returns {string[]}
 */
export function visibleColumns(view, { hidden = [], sessionCount = 0 } = {}) {
  const preset = VIEW_PRESETS[view] ?? VIEW_PRESETS.excel;
  const base = preset.columns.filter((id) => !hidden.includes(id) || COLUMNS[id]?.sticky);
  const sessions = preset.sessions ? Array.from({ length: sessionCount }, (_, i) => `s${i + 1}`) : [];
  return [...base, ...sessions];
}

/** Header groups as spans over the visible columns, in order. */
export function headerGroups(columnIds) {
  const groups = [];
  for (const id of columnIds) {
    const group = id.startsWith('s') && /^s\d+$/.test(id) ? 'sessions' : COLUMNS[id]?.group ?? 'course';
    const last = groups.at(-1);
    if (last && last.group === group) last.span += 1;
    else groups.push({ group, label: COLUMN_GROUPS[group], span: 1 });
  }
  return groups;
}

/* ── time on Riyadh's calendar ───────────────────────────────────── */

const KSA_OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` on Riyadh's calendar (fixed UTC+3, no daylight saving). */
export function ksaDay(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return null;
  return new Date(ms + KSA_OFFSET_MS).toISOString().slice(0, 10);
}

/** The operations week, Saturday to Friday, that contains `now`. */
export function ksaWeek(now = new Date(), offsetWeeks = 0) {
  const local = new Date(now.getTime() + KSA_OFFSET_MS);
  const sinceSaturday = (local.getUTCDay() + 1) % 7;
  const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - sinceSaturday * DAY_MS + offsetWeeks * 7 * DAY_MS;
  return {
    from: new Date(start).toISOString().slice(0, 10),
    to: new Date(start + 6 * DAY_MS).toISOString().slice(0, 10),
  };
}

/**
 * One lecture's state for its S-cell: done, today, still to come, or a gap in
 * the schedule. Shown with a glyph *and* words — colour is never the only cue.
 */
export function sessionState(session, now = new Date()) {
  if (!session || !session.startsAt) return 'missing';
  const day = ksaDay(session.startsAt);
  const today = ksaDay(now);
  if (day === today) return 'today';
  return new Date(session.startsAt).getTime() < now.getTime() ? 'past' : 'upcoming';
}

export const SESSION_GLYPHS = { past: '✓', today: '●', upcoming: '○', missing: '—' };

/* ── filters ─────────────────────────────────────────────────────── */

const inRange = (day, range) => Boolean(day) && day >= range.from && day <= range.to;

/**
 * Operational shortcuts. Each one is a question somebody used to answer by
 * scrolling the sheet. Ones that need data this Odoo may not have (a
 * coordinator field, a minimum-capacity rule) are offered only when it does.
 */
export const QUICK_FILTERS = {
  running: {
    label: 'Running now',
    test: (row) => row.statusCanonical === 'in_progress',
  },
  startsThisWeek: {
    label: 'Starting this week',
    test: (row, now) => inRange(ksaDay(row.startsAt), ksaWeek(now)),
  },
  startsNextWeek: {
    label: 'Starting next week',
    test: (row, now) => inRange(ksaDay(row.startsAt), ksaWeek(now, 1)),
  },
  endsThisWeek: {
    label: 'Ending this week',
    test: (row, now) => inRange(ksaDay(row.endsAt), ksaWeek(now)),
  },
  noRegistrations: {
    label: 'No registrations',
    test: (row) => row.traineeCount === 0 && row.registrations?.interested === 0,
  },
  nearCapacity: {
    label: 'Near capacity',
    test: (row) => row.capacity !== null && row.traineeCount >= row.capacity * 0.8,
  },
  belowMinimum: {
    label: 'Below minimum',
    requires: 'minimumCapacity',
    test: (row) => row.minimumCapacity !== null && row.traineeCount < row.minimumCapacity,
  },
  missingInstructor: {
    label: 'Missing instructor',
    test: (row) => !row.instructor,
  },
  missingCoordinator: {
    label: 'Missing coordinator',
    requires: 'coordinator',
    test: (row) => row.qualityFlags.includes('missing_coordinator'),
  },
  missingSessions: {
    label: 'Missing sessions',
    test: (row) => row.qualityFlags.includes('no_sessions') || row.qualityFlags.includes('lecture_count_mismatch'),
  },
  scheduleMismatch: {
    label: 'Schedule mismatch',
    test: (row) =>
      ['session_outside_range', 'work_days_mismatch', 'inconsistent_session_times', 'end_before_start'].some((flag) =>
        row.qualityFlags.includes(flag)
      ),
  },
};

/** Quick filters this Odoo can actually answer, given what discovery found. */
export function availableQuickFilters(discoveredFields = {}) {
  return Object.entries(QUICK_FILTERS)
    .filter(([, filter]) => !filter.requires || discoveredFields[filter.requires])
    .map(([key, filter]) => ({ key, label: filter.label }));
}

/**
 * @type {{ search: string, department: string, status: string[], type: string, delivery: string,
 *   group: string, instructor: string, coordinator: string, workDays: string[], quick: string, showClosed: boolean }}
 */
export const EMPTY_FILTERS = {
  search: '',
  department: 'all',
  status: [],
  type: '',
  delivery: '',
  group: '',
  instructor: '',
  coordinator: '',
  workDays: [],
  quick: '',
  showClosed: false,
};

/** How many filters are narrowing the list, for the "Filters (3)" badge. */
export function activeFilterCount(filters) {
  let count = 0;
  if (filters.status?.length) count += 1;
  for (const key of ['type', 'delivery', 'group', 'instructor', 'coordinator', 'quick']) if (filters[key]) count += 1;
  if (filters.workDays?.length) count += 1;
  if (filters.showClosed) count += 1;
  return count;
}

/** Package or section, whichever this course has — the sheet's first column. */
export const groupOf = (row) => row.package ?? row.section ?? null;

/**
 * Rows that pass every active filter. `showClosed` off hides finished,
 * cancelled and refused courses unless the status filter asks for them by name
 * — somebody who picks "Finished" from the menu wants to see finished courses.
 */
export function applyFilters(rows, filters, now = new Date()) {
  const preset = departmentPreset(filters.department);
  const quick = filters.quick ? QUICK_FILTERS[filters.quick] : null;
  return rows.filter((row) => {
    if (preset.department && row.department !== preset.department) return false;
    if (filters.status?.length) {
      if (!filters.status.includes(row.statusCanonical ?? 'other')) return false;
    } else if (!filters.showClosed && CLOSED_STATUSES.includes(row.statusCanonical)) {
      return false;
    }
    if (filters.type && row.trainingType !== filters.type) return false;
    if (filters.delivery && row.deliveryMode !== filters.delivery) return false;
    if (filters.group && groupOf(row) !== filters.group) return false;
    if (filters.instructor && row.instructor !== filters.instructor) return false;
    if (filters.coordinator && row.coordinator !== filters.coordinator) return false;
    if (filters.workDays?.length && !filters.workDays.every((day) => row.workDays.includes(day))) return false;
    if (quick && !quick.test(row, now)) return false;
    if (filters.search && !rowMatches(row, filters.search)) return false;
    return true;
  });
}

/** Per-tab row counts, for the numbers on the department chips. */
/** @returns {Record<string, number>} */
export function departmentCounts(rows, filters, now = new Date()) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const preset of DEPARTMENT_PRESETS) {
    counts[preset.key] = applyFilters(rows, { ...filters, department: preset.key }, now).length;
  }
  return counts;
}

/* ── sorting ─────────────────────────────────────────────────────── */

const statusRank = (row) => {
  const index = STATUS_ORDER.indexOf(row.statusCanonical);
  return index === -1 ? STATUS_ORDER.length : index;
};
const compareText = (a, b) => {
  if (a === b) return 0;
  if (a === null || a === undefined || a === '') return 1;
  if (b === null || b === undefined || b === '') return -1;
  return String(a).localeCompare(String(b));
};
const compareNumber = (a, b) => {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return a - b;
};

const SORTERS = {
  group: (a, b) => compareText(groupOf(a) ?? a.department, groupOf(b) ?? b.department),
  courseName: (a, b) => compareText(a.courseName, b.courseName),
  instructor: (a, b) => compareText(a.instructor, b.instructor),
  type: (a, b) => compareText(a.trainingType, b.trainingType),
  code: (a, b) => compareText(a.courseCode, b.courseCode),
  lectures: (a, b) => compareNumber(a.lectureCount, b.lectureCount),
  trainees: (a, b) => compareNumber(a.traineeCount, b.traineeCount),
  capacity: (a, b) => compareNumber(a.capacity, b.capacity),
  start: (a, b) => compareText(a.startsAt, b.startsAt),
  end: (a, b) => compareText(a.endsAt, b.endsAt),
  time: (a, b) => compareText(a.startTimeKsa, b.startTimeKsa),
  workDays: (a, b) => compareText(a.workDays.join(','), b.workDays.join(',')),
  next: (a, b) => compareText(a.nextSession?.startsAt, b.nextSession?.startsAt),
  status: (a, b) => statusRank(a) - statusRank(b),
  coordinator: (a, b) => compareText(a.coordinator, b.coordinator),
};

/**
 * The default order puts what needs attention first: running courses, then
 * planned, then on hold, then history — and inside each, by start date and
 * the usual start time. An explicit column sort replaces it, with the default
 * as the tie-breaker so equal rows never shuffle between renders.
 */
export function defaultCompare(a, b) {
  return (
    statusRank(a) - statusRank(b) ||
    compareText(a.startsAt, b.startsAt) ||
    compareText(a.startTimeKsa, b.startTimeKsa) ||
    compareText(a.courseName, b.courseName) ||
    a.id - b.id
  );
}

export function sortRows(rows, sort) {
  const sorter = sort?.key ? SORTERS[sort.key] : null;
  const direction = sort?.dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => (sorter ? sorter(a, b) * direction : 0) || defaultCompare(a, b));
}
