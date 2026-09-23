/**
 * The Events schedule layout — how Qodo *arranges* Odoo's courses.
 *
 * Odoo owns every course: its name, dates, instructor, status, trainees and
 * lectures. This module owns only the presentation around them:
 *
 *   Department → Package → optional Group (a level / cohort) → Course
 *
 * where a course is nothing but a reference — `{ eventId }` plus optional
 * display overrides. Nothing operational is copied in, so the layout can never
 * disagree with Odoo about a date or a head count. Removing a course from a
 * package only un-places it; hiding it is a flag; neither touches Odoo.
 *
 * Hiding is *Schedule presentation only* (`hiddenInSchedule`, on a course or a
 * package). It never removes a real course from This month, Today or
 * Analytics: those reflect what is happening in Odoo, and a layout manager
 * tidying the Schedule is not a statement that a course stopped existing.
 *
 * Identity never depends on a label. Two "Basic Level" groups in one package
 * (two cohorts) are two groups with two ids. An Odoo event appears at most once
 * in the whole layout.
 *
 * Every function here is pure and returns a new layout, so the editor can keep
 * an undo stack of plain snapshots and the server can validate the same shape
 * the browser builds. Shared by the server, the page and the tests.
 */

import { DEPARTMENT_PRESETS } from './eventsSchedule.js';

/**
 * Departments in business order — the workbook's own sheet order.
 * @type {string[]}
 */
export const LAYOUT_DEPARTMENTS = DEPARTMENT_PRESETS.flatMap((preset) => (preset.department ? [preset.department] : []));

/** Package accents: the Events semantic palette (src/components/events/tones.ts). */
export const LAYOUT_ACCENTS = ['blue', 'violet', 'green', 'amber', 'sky', 'indigo', 'pink', 'orange', 'coral', 'slate'];

export const LAYOUT_LIMITS = {
  label: 80,
  description: 240,
  customLabel: 120,
  badge: 40,
  note: 300,
  code: 20,
  id: 64,
  packagesPerDepartment: 80,
  groupsPerPackage: 60,
  coursesPerContainer: 400,
  hiddenInSchedule: 3000,
  totalCourses: 5000,
};

/**
 * The digits of a course code, without leading zeros. The workbook writes
 * "5592"; Odoo stores "E05592". Both become "5592".
 */
export function normaliseCourseCode(value) {
  const digits = String(value ?? '').replace(/\D/g, '').replace(/^0+/, '');
  return digits || null;
}

export function emptyLayout() {
  return { departments: LAYOUT_DEPARTMENTS.map((department) => ({ department, packages: [] })), hiddenInSchedule: [] };
}

/* ── the default, from the workbook seed ─────────────────────────── */

/**
 * The seed (shared/eventsLayoutSeed.js, generated from the workbook) turned
 * into a layout by resolving each course code to an Odoo event id.
 *
 * `candidates(code)` returns the Odoo events carrying that code as
 * `{ id, dateBegin }`. A code Odoo does not have is left out and reported; a
 * code carried by several events goes to the one starting nearest the date the
 * workbook gives, which is how the sheet itself tells repeated runs apart.
 */
export function buildDefaultLayout(seed, candidates) {
  const layout = emptyLayout();
  const unresolved = [];
  const used = new Set();

  const resolve = (course, sheet) => {
    const code = normaliseCourseCode(course.code);
    const options = (code ? candidates(code) : []).filter((option) => !used.has(option.id));
    if (options.length === 0) {
      unresolved.push({ sheet, code: course.code ?? null, name: course.name ?? null });
      return null;
    }
    const target = course.start ? Date.parse(`${course.start}T00:00:00Z`) : null;
    const distance = (option) => {
      const at = option.dateBegin ? Date.parse(String(option.dateBegin).replace(' ', 'T') + 'Z') : NaN;
      return target === null || Number.isNaN(at) ? Number.MAX_SAFE_INTEGER : Math.abs(at - target);
    };
    const [best] = [...options].sort((a, b) => distance(a) - distance(b) || a.id - b.id);
    used.add(best.id);
    return {
      eventId: best.id,
      code,
      customLabel: null,
      badge: course.badge ? String(course.badge).slice(0, LAYOUT_LIMITS.badge) : null,
      note: null,
    };
  };

  for (const seeded of seed.departments ?? []) {
    const department = layout.departments.find((entry) => entry.department === seeded.department);
    if (!department) continue;
    for (const pkg of seeded.packages ?? []) {
      department.packages.push({
        id: pkg.id,
        label: pkg.label,
        accent: LAYOUT_ACCENTS.includes(pkg.accent) ? pkg.accent : null,
        description: null,
        hiddenInSchedule: false,
        courses: (pkg.courses ?? []).map((course) => resolve(course, seeded.sheet)).filter(Boolean),
        groups: (pkg.groups ?? []).map((group) => ({
          id: group.id,
          label: group.label,
          courses: (group.courses ?? []).map((course) => resolve(course, seeded.sheet)).filter(Boolean),
        })),
      });
    }
  }
  return { layout, unresolved };
}

/* ── reading a layout ────────────────────────────────────────────── */

function* containers(layout) {
  for (const department of layout.departments) {
    for (const pkg of department.packages) {
      yield { department, pkg, group: null, courses: pkg.courses };
      for (const group of pkg.groups) yield { department, pkg, group, courses: group.courses };
    }
  }
}

/**
 * eventId → where it sits. The one lookup everything else is built on: the
 * card's package line, the drawer's hierarchy, the month table's Package
 * column, and "is this course unassigned?".
 */
export function placementIndex(layout) {
  const index = new Map();
  if (!layout) return index;
  for (const { department, pkg, group, courses } of containers(layout)) {
    courses.forEach((course, position) => {
      index.set(course.eventId, {
        department: department.department,
        packageId: pkg.id,
        packageLabel: pkg.label,
        packageAccent: pkg.accent ?? null,
        packageHiddenInSchedule: Boolean(pkg.hiddenInSchedule),
        groupId: group?.id ?? null,
        groupLabel: group?.label ?? null,
        position,
        customLabel: course.customLabel ?? null,
        badge: course.badge ?? null,
        note: course.note ?? null,
        code: course.code ?? null,
      });
    });
  }
  return index;
}

export const placedEventIds = (layout) => [...placementIndex(layout).keys()];

/**
 * Whether a course is left out of the *Schedule* view: hidden there by itself,
 * or sitting in a package hidden there. Nothing else reads this — This month,
 * Today and Analytics show every real Odoo course. Removing a course from its
 * package is not hiding it either: it becomes unassigned and stays visible.
 */
export function isHiddenInSchedule(layout, eventId, placement = placementIndex(layout).get(eventId)) {
  if (!layout) return false;
  if ((layout.hiddenInSchedule ?? []).includes(eventId)) return true;
  return Boolean(placement?.packageHiddenInSchedule);
}

/**
 * Rows as the page shows them: each Odoo row carries its placement, the
 * layout's department wins over the one derived from Odoo (a company course
 * filed under Mechanical is a Mechanical course here), and a display override
 * becomes the name shown — the Odoo name stays on `odooName`.
 */
export function decorateRows(rows, layout) {
  const index = placementIndex(layout);
  const hidden = new Set(layout?.hiddenInSchedule ?? []);
  return rows.map((row) => {
    const placement = index.get(row.id) ?? null;
    return {
      ...row,
      department: placement?.department ?? row.department,
      courseName: placement?.customLabel || row.courseName,
      odooName: row.courseName,
      placement,
      // Schedule presentation only; operational views ignore it.
      hiddenInSchedule: hidden.has(row.id) || Boolean(placement?.packageHiddenInSchedule),
    };
  });
}

/**
 * The schedule, arranged: for each department, its packages in order, each
 * with its direct courses and its groups — holding only the rows passed in
 * (already filtered), in layout order. Rows the layout does not place come
 * back as `unassigned`, in the order given; placed events with no row here
 * (outside the date range, filtered out, or gone from Odoo) are counted per
 * package as `elsewhere` so the editor can say so.
 *
 * `departments` limits which departments are returned (null = all).
 * `keepEmpty` keeps packages and groups with no rows — the editor wants the
 * whole structure, the reader only what has something to show.
 * `includeHidden` keeps what is hidden from the Schedule (packages and courses)
 * — the editor shows it so it can be restored; the reader never sees it. A
 * hidden course is still *placed*: it never falls into `unassigned`.
 */
/**
 * @param {any[]} rows @param {any} layout
 * @param {{ departments?: string[] | null, keepEmpty?: boolean, includeHidden?: boolean }} [options]
 */
export function arrangeSchedule(rows, layout, { departments = null, keepEmpty = false, includeHidden = false } = {}) {
  const hiddenCourses = new Set(includeHidden ? [] : layout?.hiddenInSchedule ?? []);
  const byId = new Map(rows.filter((row) => !hiddenCourses.has(row.id)).map((row) => [row.id, row]));
  const placed = new Set();
  const result = [];
  for (const department of layout?.departments ?? []) {
    if (departments && !departments.includes(department.department)) continue;
    const packages = [];
    for (const pkg of department.packages) {
      if (pkg.hiddenInSchedule && !includeHidden) continue;
      let elsewhere = 0;
      const pick = (courses) =>
        courses
          .map((course) => {
            placed.add(course.eventId);
            const row = byId.get(course.eventId);
            if (!row) elsewhere += 1;
            return row ?? null;
          })
          .filter(Boolean);
      const direct = pick(pkg.courses);
      const groups = pkg.groups
        .map((group) => ({ group, rows: pick(group.courses) }))
        .filter((entry) => keepEmpty || entry.rows.length > 0);
      const total = direct.length + groups.reduce((sum, entry) => sum + entry.rows.length, 0);
      if (!keepEmpty && total === 0) continue;
      packages.push({ package: pkg, direct, groups, total, elsewhere });
    }
    if (keepEmpty || packages.length) result.push({ department: department.department, packages });
  }
  // A row placed in a department outside `departments` is still placed.
  for (const id of placementIndex(layout).keys()) placed.add(id);
  const unassigned = rows.filter((row) => !placed.has(row.id) && !hiddenCourses.has(row.id));
  return { departments: result, unassigned };
}

/* ── editing (pure; every function returns a new layout) ─────────── */

const clone = (layout) => structuredClone(layout);

function findPackage(layout, packageId) {
  for (const department of layout.departments) {
    const index = department.packages.findIndex((pkg) => pkg.id === packageId);
    if (index !== -1) return { department, pkg: department.packages[index], index };
  }
  return null;
}

function findGroup(layout, groupId) {
  for (const department of layout.departments) {
    for (const pkg of department.packages) {
      const index = pkg.groups.findIndex((group) => group.id === groupId);
      if (index !== -1) return { department, pkg, group: pkg.groups[index], index };
    }
  }
  return null;
}

function containerFor(layout, { packageId, groupId = null }) {
  const found = findPackage(layout, packageId);
  if (!found) return null;
  if (!groupId) return found.pkg.courses;
  return found.pkg.groups.find((group) => group.id === groupId)?.courses ?? null;
}

/** Take a course out of wherever it is; returns its entry (or null). */
function detach(layout, eventId) {
  for (const { courses } of containers(layout)) {
    const index = courses.findIndex((course) => course.eventId === eventId);
    if (index !== -1) return courses.splice(index, 1)[0];
  }
  return null;
}

const insertBefore = (list, item, beforeIndex) => {
  if (beforeIndex === -1 || beforeIndex === undefined || beforeIndex === null) list.push(item);
  else list.splice(beforeIndex, 0, item);
};

/** Short, unguessable-enough ids for things a person creates. */
export function newLayoutId(prefix) {
  const random =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${random}`;
}

/** Packages: drag one before another (null = to the end), in any department. */
/** @param {any} layout @param {string} packageId @param {{ department?: string, beforePackageId?: string | null }} [target] */
export function movePackage(layout, packageId, { department, beforePackageId = null } = {}) {
  const next = clone(layout);
  const found = findPackage(next, packageId);
  if (!found || packageId === beforePackageId) return layout;
  const target = next.departments.find((entry) => entry.department === (department ?? found.department.department));
  if (!target) return layout;
  const [pkg] = found.department.packages.splice(found.index, 1);
  insertBefore(target.packages, pkg, beforePackageId ? target.packages.findIndex((entry) => entry.id === beforePackageId) : -1);
  return next;
}

export function movePackageStep(layout, packageId, delta) {
  const found = findPackage(layout, packageId);
  if (!found) return layout;
  const to = found.index + delta;
  if (to < 0 || to >= found.department.packages.length) return layout;
  const next = clone(layout);
  const list = findPackage(next, packageId).department.packages;
  const [pkg] = list.splice(found.index, 1);
  list.splice(to, 0, pkg);
  return next;
}

/** @param {any} layout @param {string} department @param {{ label: string, accent?: string | null, description?: string | null }} value @param {string} [id] */
export function addPackage(layout, department, { label, accent = null, description = null }, id = newLayoutId('pkg')) {
  const next = clone(layout);
  const target = next.departments.find((entry) => entry.department === department);
  if (!target) return layout;
  target.packages.push({
    id,
    label: String(label).trim().slice(0, LAYOUT_LIMITS.label),
    accent: LAYOUT_ACCENTS.includes(accent) ? accent : null,
    description: description ? String(description).trim().slice(0, LAYOUT_LIMITS.description) : null,
    hiddenInSchedule: false,
    courses: [],
    groups: [],
  });
  return next;
}

/** @param {any} layout @param {string} packageId @param {{ label?: string, accent?: string | null, description?: string | null, hiddenInSchedule?: boolean }} patch */
export function updatePackage(layout, packageId, patch) {
  const next = clone(layout);
  const found = findPackage(next, packageId);
  if (!found) return layout;
  if (patch.label !== undefined) found.pkg.label = String(patch.label).trim().slice(0, LAYOUT_LIMITS.label) || found.pkg.label;
  if (patch.accent !== undefined) found.pkg.accent = LAYOUT_ACCENTS.includes(patch.accent) ? patch.accent : null;
  if (patch.description !== undefined) {
    found.pkg.description = patch.description ? String(patch.description).trim().slice(0, LAYOUT_LIMITS.description) : null;
  }
  if (patch.hiddenInSchedule !== undefined) found.pkg.hiddenInSchedule = Boolean(patch.hiddenInSchedule);
  return next;
}

/**
 * Remove a package from the layout. Its courses go to `moveTo` (another
 * package, appended in their order) or, with no target, back to unassigned —
 * never anywhere near Odoo.
 */
/** @param {any} layout @param {string} packageId @param {{ moveTo?: string | null }} [options] */
export function deletePackage(layout, packageId, { moveTo = null } = {}) {
  const next = clone(layout);
  const found = findPackage(next, packageId);
  if (!found) return layout;
  const courses = [...found.pkg.courses, ...found.pkg.groups.flatMap((group) => group.courses)];
  found.department.packages.splice(found.index, 1);
  if (moveTo) {
    const target = findPackage(next, moveTo);
    if (target) target.pkg.courses.push(...courses);
  }
  return next;
}

export function addGroup(layout, packageId, label, id = newLayoutId('grp')) {
  const next = clone(layout);
  const found = findPackage(next, packageId);
  if (!found) return layout;
  found.pkg.groups.push({ id, label: String(label).trim().slice(0, LAYOUT_LIMITS.label), courses: [] });
  return next;
}

export function renameGroup(layout, groupId, label) {
  const next = clone(layout);
  const found = findGroup(next, groupId);
  const value = String(label ?? '').trim().slice(0, LAYOUT_LIMITS.label);
  if (!found || !value) return layout;
  found.group.label = value;
  return next;
}

/** A group removed keeps its courses: they move up into the package itself. */
export function deleteGroup(layout, groupId) {
  const next = clone(layout);
  const found = findGroup(next, groupId);
  if (!found) return layout;
  found.pkg.groups.splice(found.index, 1);
  found.pkg.courses.push(...found.group.courses);
  return next;
}

/** Groups: drag within a package, or into another one (before a group, or to the end). */
/** @param {any} layout @param {string} groupId @param {{ packageId?: string, beforeGroupId?: string | null }} target */
export function moveGroup(layout, groupId, { packageId, beforeGroupId = null }) {
  const next = clone(layout);
  const found = findGroup(next, groupId);
  const target = findPackage(next, packageId ?? found?.pkg.id);
  if (!found || !target || groupId === beforeGroupId) return layout;
  const [group] = found.pkg.groups.splice(found.index, 1);
  insertBefore(target.pkg.groups, group, beforeGroupId ? target.pkg.groups.findIndex((entry) => entry.id === beforeGroupId) : -1);
  return next;
}

export function moveGroupStep(layout, groupId, delta) {
  const found = findGroup(layout, groupId);
  if (!found) return layout;
  const to = found.index + delta;
  if (to < 0 || to >= found.pkg.groups.length) return layout;
  const next = clone(layout);
  const list = findGroup(next, groupId).pkg.groups;
  const [group] = list.splice(found.index, 1);
  list.splice(to, 0, group);
  return next;
}

/**
 * Put a course somewhere: into a package (`groupId` null) or one of its groups,
 * before another course or at the end. Works the same whether the course was
 * placed elsewhere (a move) or unassigned (an add) — and because it detaches
 * first, one event can never end up in two places.
 */
/**
 * @param {any} layout @param {number} eventId
 * @param {{ packageId: string, groupId?: string | null, beforeEventId?: number | null }} target
 * @param {{ code?: string | null }} [extra]
 */
export function placeCourse(layout, eventId, { packageId, groupId = null, beforeEventId = null }, { code = null } = {}) {
  if (!Number.isInteger(eventId) || eventId === beforeEventId) return layout;
  const next = clone(layout);
  if (!containerFor(next, { packageId, groupId })) return layout;
  const entry = detach(next, eventId) ?? { eventId, code: normaliseCourseCode(code), customLabel: null, badge: null, note: null };
  const target = containerFor(next, { packageId, groupId });
  insertBefore(target, entry, beforeEventId ? target.findIndex((course) => course.eventId === beforeEventId) : -1);
  return next;
}

/** Keyboard / touch reordering: one step up or down inside the same list. */
export function moveCourseStep(layout, eventId, delta) {
  const next = clone(layout);
  for (const { courses } of containers(next)) {
    const index = courses.findIndex((course) => course.eventId === eventId);
    if (index === -1) continue;
    const to = index + delta;
    if (to < 0 || to >= courses.length) return layout;
    const [entry] = courses.splice(index, 1);
    courses.splice(to, 0, entry);
    return next;
  }
  return layout;
}

/** "Remove from package": the course becomes unassigned. Not hidden, not deleted. */
export function unplaceCourse(layout, eventId) {
  const next = clone(layout);
  return detach(next, eventId) ? next : layout;
}

/** "Hide from Schedule": the course stays placed and stays in every operational view. */
export function setCourseHiddenInSchedule(layout, eventId, hidden) {
  const next = clone(layout);
  const set = new Set(next.hiddenInSchedule ?? []);
  if (hidden) set.add(eventId);
  else set.delete(eventId);
  next.hiddenInSchedule = [...set];
  return next;
}

/** Display-only overrides. An empty string resets to Odoo's own name. */
/** @param {any} layout @param {number} eventId @param {{ customLabel?: string | null, badge?: string | null, note?: string | null }} patch */
export function setCourseDisplay(layout, eventId, patch) {
  const next = clone(layout);
  for (const { courses } of containers(next)) {
    const entry = courses.find((course) => course.eventId === eventId);
    if (!entry) continue;
    if (patch.customLabel !== undefined) entry.customLabel = String(patch.customLabel ?? '').trim().slice(0, LAYOUT_LIMITS.customLabel) || null;
    if (patch.badge !== undefined) entry.badge = String(patch.badge ?? '').trim().slice(0, LAYOUT_LIMITS.badge) || null;
    if (patch.note !== undefined) entry.note = String(patch.note ?? '').trim().slice(0, LAYOUT_LIMITS.note) || null;
    return next;
  }
  return layout;
}

/** Drop references to events Odoo no longer has. */
export function removeReferences(layout, eventIds) {
  const drop = new Set(eventIds);
  const next = clone(layout);
  for (const { courses } of containers(next)) {
    for (let i = courses.length - 1; i >= 0; i -= 1) if (drop.has(courses[i].eventId)) courses.splice(i, 1);
  }
  next.hiddenInSchedule = (next.hiddenInSchedule ?? []).filter((id) => !drop.has(id));
  return next;
}

/** Whether two layouts say the same thing — for "unsaved changes". */
export function sameLayout(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/* ── validation (the server's gate; never trust the browser's JSON) ─ */

export class LayoutValidationError extends Error {
  constructor(code, detail = null) {
    super(code);
    this.status = 400;
    this.detail = detail;
  }
}

const ID_PATTERN = /^[A-Za-z0-9_:.-]+$/;

function text(value, max, { required = false, field }) {
  if (value === null || value === undefined || value === '') {
    if (required) throw new LayoutValidationError('layout_invalid', `${field} is required`);
    return null;
  }
  if (typeof value !== 'string') throw new LayoutValidationError('layout_invalid', `${field} must be text`);
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) {
    if (required) throw new LayoutValidationError('layout_invalid', `${field} is required`);
    return null;
  }
  if (trimmed.length > max) throw new LayoutValidationError('layout_invalid', `${field} is longer than ${max}`);
  return trimmed;
}

function list(value, max, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new LayoutValidationError('layout_invalid', `${field} must be a list`);
  if (value.length > max) throw new LayoutValidationError('layout_invalid', `${field} has more than ${max} entries`);
  return value;
}

/**
 * Rebuild a layout from untrusted input, keeping only known fields. Throws
 * `LayoutValidationError` for anything malformed: unknown or repeated
 * departments, duplicate package/group ids, over-long strings, a non-integer
 * event id, or one event placed twice. Order is the array order, so it is
 * valid by construction. The shape is fixed-depth, so nothing can nest into a
 * cycle.
 */
export function validateLayout(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new LayoutValidationError('layout_invalid', 'layout must be an object');
  const ids = new Set();
  const events = new Set();
  let total = 0;

  const id = (value, field) => {
    if (typeof value !== 'string' || !value || value.length > LAYOUT_LIMITS.id || !ID_PATTERN.test(value)) {
      throw new LayoutValidationError('layout_invalid', `${field} id is malformed`);
    }
    if (ids.has(value)) throw new LayoutValidationError('layout_duplicate_id', value);
    ids.add(value);
    return value;
  };
  const course = (value) => {
    if (!value || typeof value !== 'object') throw new LayoutValidationError('layout_invalid', 'course must be an object');
    const eventId = value.eventId;
    if (!Number.isInteger(eventId) || eventId <= 0) throw new LayoutValidationError('layout_invalid', 'eventId must be a positive integer');
    if (events.has(eventId)) throw new LayoutValidationError('layout_duplicate_placement', String(eventId));
    events.add(eventId);
    total += 1;
    if (total > LAYOUT_LIMITS.totalCourses) throw new LayoutValidationError('layout_invalid', 'too many courses');
    const code = value.code === null || value.code === undefined ? null : normaliseCourseCode(value.code);
    if (code && code.length > LAYOUT_LIMITS.code) throw new LayoutValidationError('layout_invalid', 'code is too long');
    return {
      eventId,
      code,
      customLabel: text(value.customLabel, LAYOUT_LIMITS.customLabel, { field: 'customLabel' }),
      badge: text(value.badge, LAYOUT_LIMITS.badge, { field: 'badge' }),
      note: text(value.note, LAYOUT_LIMITS.note, { field: 'note' }),
    };
  };

  const seen = new Set();
  const departments = list(input.departments, LAYOUT_DEPARTMENTS.length, 'departments').map((department) => {
    if (!department || !LAYOUT_DEPARTMENTS.includes(department.department)) {
      throw new LayoutValidationError('layout_invalid', `unknown department ${department?.department}`);
    }
    if (seen.has(department.department)) throw new LayoutValidationError('layout_invalid', `department ${department.department} repeated`);
    seen.add(department.department);
    return {
      department: department.department,
      packages: list(department.packages, LAYOUT_LIMITS.packagesPerDepartment, 'packages').map((pkg) => ({
        id: id(pkg?.id, 'package'),
        label: text(pkg.label, LAYOUT_LIMITS.label, { required: true, field: 'package label' }),
        accent: pkg.accent === null || pkg.accent === undefined ? null : LAYOUT_ACCENTS.includes(pkg.accent) ? pkg.accent : (() => {
          throw new LayoutValidationError('layout_invalid', 'unknown accent');
        })(),
        description: text(pkg.description, LAYOUT_LIMITS.description, { field: 'description' }),
        hiddenInSchedule: pkg.hiddenInSchedule === true,
        courses: list(pkg.courses, LAYOUT_LIMITS.coursesPerContainer, 'courses').map(course),
        groups: list(pkg.groups, LAYOUT_LIMITS.groupsPerPackage, 'groups').map((group) => ({
          id: id(group?.id, 'group'),
          label: text(group.label, LAYOUT_LIMITS.label, { required: true, field: 'group label' }),
          courses: list(group.courses, LAYOUT_LIMITS.coursesPerContainer, 'courses').map(course),
        })),
      })),
    };
  });
  // Every department is always present, in business order, even if the input left one out.
  const ordered = LAYOUT_DEPARTMENTS.map(
    (name) => departments.find((entry) => entry.department === name) ?? { department: name, packages: [] }
  );

  const hidden = list(input.hiddenInSchedule, LAYOUT_LIMITS.hiddenInSchedule, 'hiddenInSchedule');
  for (const value of hidden) {
    if (!Number.isInteger(value) || value <= 0) throw new LayoutValidationError('layout_invalid', 'hidden ids must be positive integers');
  }
  return { departments: ordered, hiddenInSchedule: [...new Set(hidden)] };
}

/** Every event id a layout mentions — placed or hidden. */
export function referencedEventIds(layout) {
  return [...new Set([...placementIndex(layout).keys(), ...(layout?.hiddenInSchedule ?? [])])];
}
