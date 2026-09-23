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
    row.odooName,
    row.courseCode,
    row.instructor,
    row.package,
    row.section,
    row.department,
    row.coordinator,
    row.location?.venue,
    row.trainingType,
    row.placement?.packageLabel,
    row.placement?.groupLabel,
    row.placement?.badge
  );
}

/* ── status ──────────────────────────────────────────────────────── */

export const STATUS_ORDER = ['in_progress', 'planned', 'hold', 'finished', 'canceled', 'refused'];
/**
 * What the chips say. The app is Arabic, so these are Arabic; Odoo's own stage
 * name travels beside them on the row and shows on hover, for anybody
 * reconciling a course against the ERP.
 */
export const STATUS_LABELS = {
  in_progress: 'شغّالة',
  planned: 'مخطّطة',
  hold: 'متأجّلة',
  finished: 'خلصت',
  canceled: 'ملغية',
  refused: 'مرفوضة',
};
/** Out of the day-to-day schedule unless asked for; the Archive is their home. */
export const CLOSED_STATUSES = ['finished', 'canceled', 'refused'];

/* ── department presets ──────────────────────────────────────────── */

/**
 * The departments courses are filtered by. These are filter chips, not the
 * workbook's tabs: one list of courses, narrowed — never a separate page.
 */
export const DEPARTMENT_PRESETS = [
  { key: 'all', label: 'الكل', department: null },
  { key: 'arch', label: 'عمارة وديكور', department: 'Arch & Decor' },
  { key: 'mechanical', label: 'ميكانيكا', department: 'Mechanical' },
  { key: 'electrical', label: 'كهرباء', department: 'Electrical' },
  { key: 'civil', label: 'مدني', department: 'Civil' },
  { key: 'development', label: 'تطوير', department: 'Development' },
  { key: 'english', label: 'إنجليزي', department: 'English' },
  { key: 'webinar', label: 'ويبينار', department: 'Webinar' },
];

/** Canonical department value → the Arabic word shown for it. */
export function departmentLabel(department) {
  if (!department) return null;
  return DEPARTMENT_PRESETS.find((preset) => preset.department === department)?.label ?? department;
}

export function departmentPreset(key) {
  return DEPARTMENT_PRESETS.find((preset) => preset.key === key) ?? DEPARTMENT_PRESETS[0];
}

/* ── view mode ───────────────────────────────────────────────────── */

/**
 * How the course list is drawn. Two modes, no spreadsheet: cards to scan, a
 * compact list for a denser day. The columns, grouped headers and S1…Sn bands
 * that used to live here are gone — sessions belong on a timeline, and the
 * long tail of Excel fields belongs in the detail drawer.
 */
export const VIEW_MODES = ['cards', 'list'];

export const VIEW_LABELS = { cards: 'كروت', list: 'لستة' };

export function resolveViewMode(mode) {
  return VIEW_MODES.includes(mode) ? mode : 'cards';
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

/* ── filters ─────────────────────────────────────────────────────── */

const inRange = (day, range) => Boolean(day) && day >= range.from && day <= range.to;

/** A course at 80% of its known capacity or more. Unknown capacity is never "near". */
export const NEAR_CAPACITY_RATIO = 0.8;
export const isNearCapacity = (row) => row.capacity !== null && row.capacity > 0 && row.traineeCount >= row.capacity * NEAR_CAPACITY_RATIO;

const hasSessionOn = (row, day) => (row.sessions ?? []).some((session) => session.startsAt && ksaDay(session.startsAt) === day);

/**
 * Operational shortcuts. Each one is a question somebody used to answer by
 * scrolling the sheet. Ones that need data this Odoo may not have (a
 * coordinator field, a minimum-capacity rule) are offered only when it does.
 */
export const QUICK_FILTERS = {
  running: {
    label: 'شغّالة دلوقتي',
    primary: true,
    test: (row) => row.statusCanonical === 'in_progress',
  },
  startsThisWeek: {
    label: 'بتبدأ الأسبوع ده',
    primary: true,
    test: (row, now) => inRange(ksaDay(row.startsAt), ksaWeek(now)),
  },
  today: {
    label: 'عندها محاضرة النهاردة',
    primary: true,
    test: (row, now) => hasSessionOn(row, ksaDay(now.toISOString())),
  },
  startsNextWeek: {
    label: 'بتبدأ الأسبوع الجاي',
    test: (row, now) => inRange(ksaDay(row.startsAt), ksaWeek(now, 1)),
  },
  endsThisWeek: {
    label: 'بتخلص الأسبوع ده',
    test: (row, now) => inRange(ksaDay(row.endsAt), ksaWeek(now)),
  },
  noRegistrations: {
    label: 'من غير حجوزات',
    primary: true,
    test: (row) => row.traineeCount === 0 && row.registrations?.interested === 0,
  },
  nearCapacity: {
    label: 'قرّبت تكمل',
    primary: true,
    test: isNearCapacity,
  },
  belowMinimum: {
    label: 'تحت الحد الأدنى',
    requires: 'minimumCapacity',
    test: (row) => row.minimumCapacity !== null && row.traineeCount < row.minimumCapacity,
  },
  missingInstructor: {
    label: 'من غير مدرّب',
    primary: true,
    test: (row) => !row.instructor,
  },
  missingCoordinator: {
    label: 'من غير كوردينيتور',
    requires: 'coordinator',
    test: (row) => row.qualityFlags.includes('missing_coordinator'),
  },
  missingSessions: {
    label: 'من غير محاضرات',
    test: (row) => row.qualityFlags.includes('no_sessions') || row.qualityFlags.includes('lecture_count_mismatch'),
  },
  scheduleMismatch: {
    label: 'الجدول مش مظبوط',
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
    .map(([key, filter]) => ({ key, label: filter.label, primary: Boolean(filter.primary) }));
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

/** Package or section, whichever this course has. */
const groupOf = (row) => row.package ?? row.section ?? null;

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

/* ── overview ────────────────────────────────────────────────────── */

/**
 * The numbers the Overview tab leads with, from the rows already loaded.
 *
 * Every one of them is a count of real rows, never a percentage of a guess:
 * `trainees` sums confirmed registrations, and `nearCapacity` only counts
 * courses whose capacity Odoo actually knows — a course with no `seats_max`
 * is not "0% full", it is unknown, and it is left out.
 */
export function overviewStats(rows, now = new Date()) {
  const today = ksaDay(now.toISOString());
  const weekEnd = new Date(now.getTime() + 7 * DAY_MS).toISOString();

  let active = 0;
  let startingSoon = 0;
  let todaySessions = 0;
  let trainees = 0;
  let nearCapacity = 0;
  let needsAttention = 0;

  for (const row of rows) {
    if (row.statusCanonical === 'in_progress') active += 1;
    if (row.statusCanonical === 'planned' && row.startsAt && row.startsAt <= weekEnd && row.startsAt >= now.toISOString()) {
      startingSoon += 1;
    }
    for (const session of row.sessions ?? []) {
      if (session.startsAt && ksaDay(session.startsAt) === today) todaySessions += 1;
    }

    // A finished course is history: its load, its fill and its gaps are not
    // work anybody can still do, so none of them count here.
    if (CLOSED_STATUSES.includes(row.statusCanonical)) continue;
    trainees += row.traineeCount ?? 0;
    if (isNearCapacity(row)) nearCapacity += 1;
    if ((row.qualityFlags?.length ?? 0) > 0) needsAttention += 1;
  }

  return { active, startingSoon, todaySessions, trainees, nearCapacity, needsAttention, total: rows.length };
}
