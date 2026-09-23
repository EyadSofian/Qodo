/**
 * The schedule layout's rules, without a server: the workbook default, every
 * editing operation, validation, and "This month".
 *
 * The integration half (permissions, conflicts, persistence over HTTP) is in
 * eventsLayout.integration.test.js.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { EVENTS_LAYOUT_SEED } from '../shared/eventsLayoutSeed.js';
import {
  LAYOUT_DEPARTMENTS,
  LayoutValidationError,
  addGroup,
  addPackage,
  arrangeSchedule,
  buildDefaultLayout,
  decorateRows,
  deleteGroup,
  deletePackage,
  emptyLayout,
  isHiddenInSchedule,
  moveCourseStep,
  moveGroup,
  movePackage,
  normaliseCourseCode,
  placeCourse,
  placementIndex,
  removeReferences,
  setCourseDisplay,
  setCourseHiddenInSchedule,
  unplaceCourse,
  updatePackage,
  validateLayout,
} from '../shared/eventsLayout.js';
import { applyFilters, EMPTY_FILTERS } from '../shared/eventsSchedule.js';
import { monthBounds, monthBucket, monthOf, monthRows, monthSummary, overlapsMonth, shiftMonth, startedBefore } from '../shared/eventsMonth.js';
import { resolveDefaultLayout } from './events/layout.js';

/* ── fixtures ────────────────────────────────────────────────────── */

/** Every seeded code exists once in Odoo, as "E0" + digits, id = 10000 + code. */
const allSeedCodes = () =>
  EVENTS_LAYOUT_SEED.departments.flatMap((d) => d.packages.flatMap((p) => [...p.courses, ...p.groups.flatMap((g) => g.courses)])).map((c) => c.code);
const idFor = (code) => 10000 + Number(code);
const fullOdoo = (code) => [{ id: idFor(code), dateBegin: null }];

const defaultLayout = () => buildDefaultLayout(EVENTS_LAYOUT_SEED, fullOdoo).layout;
const dept = (layout, name) => layout.departments.find((d) => d.department === name);
const pkgNamed = (layout, department, label) => dept(layout, department).packages.find((p) => p.label === label);
const ids = (courses) => courses.map((c) => c.eventId);

function row(id, overrides = {}) {
  return {
    id,
    courseName: `Course ${id}`,
    courseCode: `E0${id}`,
    department: null,
    instructor: 'Micheal Adel',
    trainingType: 'Group Online',
    statusCanonical: 'planned',
    startsAt: '2026-09-10T16:00:00.000Z',
    endsAt: '2026-09-30T19:00:00.000Z',
    sessions: [],
    nextSession: null,
    traineeCount: 10,
    capacity: 20,
    workDays: [],
    qualityFlags: [],
    registrations: { confirmed: 10, interested: 0, attended: 0, cancelled: 0 },
    ...overrides,
  };
}

/* ── A. the workbook-derived hierarchy ───────────────────────────── */

test('A. the default follows the workbook: departments, packages, levels and course order', () => {
  const layout = defaultLayout();
  assert.deepEqual(
    layout.departments.map((d) => d.department),
    ['Arch & Decor', 'Mechanical', 'Electrical', 'Civil', 'Development', 'English', 'Webinar']
  );
  assert.deepEqual(
    dept(layout, 'Mechanical').packages.map((p) => p.label),
    ['Mechanical Package', 'BIM MEP Package', 'Automotive Package Offline', 'Companies Courses']
  );
  // HVAC, Fire Fighting, Plumbing, Shop Drawing Mec — in the sheet's order.
  assert.deepEqual(ids(pkgNamed(layout, 'Mechanical', 'Mechanical Package').courses).slice(0, 4), [5592, 5593, 5594, 5595].map(idFor));

  // A package can hold levels instead of courses, and the two cohorts of
  // "Basic Level" stay two groups with two ids.
  const bim = pkgNamed(layout, 'Mechanical', 'BIM MEP Package');
  assert.equal(bim.courses.length, 0);
  assert.deepEqual(bim.groups.map((g) => g.label), [
    'BIM Modeler Basic Level',
    'BIM Coordinator Advanced Level',
    'BIM Modeler Basic Level',
    'BIM Coordinator Advanced Level',
  ]);
  assert.equal(new Set(bim.groups.map((g) => g.id)).size, 4);
  assert.deepEqual(ids(bim.groups[0].courses), [5679, 5680].map(idFor));
  assert.deepEqual(ids(bim.groups[1].courses), [5681, 5682, 5683].map(idFor));

  // A package can also hold courses directly *and* levels.
  const interior = pkgNamed(layout, 'Arch & Decor', 'Interior Design Package Online');
  assert.equal(interior.courses.length, 8);
  assert.equal(interior.groups[0].label, 'Interior Design Basic Level');

  // A company course filed under another package's name keeps it as a badge.
  const companies = pkgNamed(layout, 'Mechanical', 'Companies Courses');
  assert.deepEqual(companies.courses.map((c) => c.badge), ['Mechanical Package', 'BIM MEP']);

  // No coded rows on the English and Webinar sheets: nothing to seed.
  assert.equal(dept(layout, 'English').packages.length, 0);
  assert.equal(allSeedCodes().length, 135);
});

test('A. codes are matched as digits; a repeated code goes to the run nearest the workbook date', () => {
  assert.equal(normaliseCourseCode('E05592'), '5592');
  assert.equal(normaliseCourseCode(' 5592 '), '5592');
  assert.equal(normaliseCourseCode(''), null);

  const seed = {
    departments: [
      { department: 'Mechanical', sheet: 'Mechanical', packages: [{ id: 'seed:m:p1', label: 'P', accent: 'blue', courses: [{ code: '1', start: '2026-09-01' }, { code: '2' }], groups: [] }] },
    ],
  };
  const { layout, unresolved } = buildDefaultLayout(seed, (code) =>
    code === '1'
      ? [
          { id: 7, dateBegin: '2025-09-01 16:00:00' },
          { id: 9, dateBegin: '2026-09-02 16:00:00' },
        ]
      : []
  );
  assert.deepEqual(ids(dept(layout, 'Mechanical').packages[0].courses), [9]);
  assert.deepEqual(unresolved.map((u) => u.code), ['2']);
});

test('A. resolving the default asks Odoo once, in its own code spelling', async () => {
  const calls = [];
  const client = {
    async searchRead(model, domain, fields) {
      calls.push({ model, domain, fields });
      const wanted = new Set(domain[0][2]);
      return allSeedCodes()
        .map((code) => ({ id: idFor(code), code: `E0${code}`, date_begin: null }))
        .filter((event) => wanted.has(event.code));
    },
  };
  const { layout, unresolved } = await resolveDefaultLayout({ client });
  assert.equal(calls.length, 1);
  assert.equal(unresolved.length, 0);
  assert.equal(placementIndex(layout).size, 135);
});

/* ── B–D. ordering ───────────────────────────────────────────────── */

test('B. packages reorder: Companies Courses dragged above Automotive', () => {
  const layout = defaultLayout();
  const companies = pkgNamed(layout, 'Mechanical', 'Companies Courses');
  const automotive = pkgNamed(layout, 'Mechanical', 'Automotive Package Offline');
  const next = movePackage(layout, companies.id, { beforePackageId: automotive.id });
  assert.deepEqual(
    dept(next, 'Mechanical').packages.map((p) => p.label),
    ['Mechanical Package', 'BIM MEP Package', 'Companies Courses', 'Automotive Package Offline']
  );
  // Pure: the original is untouched (it is an undo snapshot).
  assert.equal(dept(layout, 'Mechanical').packages[2].label, 'Automotive Package Offline');
});

test('C. groups reorder inside a package, and can move to another', () => {
  const layout = defaultLayout();
  const bim = pkgNamed(layout, 'Mechanical', 'BIM MEP Package');
  const [basic, advanced] = bim.groups;
  const next = moveGroup(layout, advanced.id, { packageId: bim.id, beforeGroupId: basic.id });
  assert.deepEqual(pkgNamed(next, 'Mechanical', 'BIM MEP Package').groups.slice(0, 2).map((g) => g.id), [advanced.id, basic.id]);
});

test('D. courses reorder inside their package, by drag or by step', () => {
  const layout = defaultLayout();
  const mech = pkgNamed(layout, 'Mechanical', 'Mechanical Package');
  const [hvac, fire, plumbing, shop] = ids(mech.courses);
  const dragged = placeCourse(layout, plumbing, { packageId: mech.id, beforeEventId: fire });
  assert.deepEqual(ids(pkgNamed(dragged, 'Mechanical', 'Mechanical Package').courses).slice(0, 4), [hvac, plumbing, fire, shop]);
  const stepped = moveCourseStep(layout, fire, +1);
  assert.deepEqual(ids(pkgNamed(stepped, 'Mechanical', 'Mechanical Package').courses).slice(0, 4), [hvac, plumbing, fire, shop]);
  assert.equal(moveCourseStep(layout, hvac, -1), layout, 'the first course cannot move up');
});

/* ── E–I. moving, removing, adding, hiding, duplicates ──────────── */

test('E. a course moves between packages and appears exactly once', () => {
  const layout = defaultLayout();
  const hvac = idFor(5592);
  const companies = pkgNamed(layout, 'Mechanical', 'Companies Courses');
  const next = placeCourse(layout, hvac, { packageId: companies.id });
  const place = placementIndex(next).get(hvac);
  assert.equal(place.packageLabel, 'Companies Courses');
  assert.equal(place.position, companies.courses.length);
  assert.ok(!ids(pkgNamed(next, 'Mechanical', 'Mechanical Package').courses).includes(hvac));
});

test('F. removing a course from its package makes it unassigned, still visible', () => {
  const layout = defaultLayout();
  const hvac = idFor(5592);
  const next = unplaceCourse(layout, hvac);
  assert.equal(placementIndex(next).has(hvac), false);
  assert.equal(isHiddenInSchedule(next, hvac), false);
  const { unassigned } = arrangeSchedule([row(hvac)], next);
  assert.deepEqual(unassigned.map((r) => r.id), [hvac]);
});

test('G. adding an Odoo course places it; placing it again only moves it', () => {
  let layout = defaultLayout();
  const mech = pkgNamed(layout, 'Mechanical', 'Mechanical Package');
  layout = placeCourse(layout, 999, { packageId: mech.id }, { code: 'E05999' });
  assert.equal(placementIndex(layout).get(999).code, '5999');
  layout = placeCourse(layout, 999, { packageId: mech.id, groupId: null, beforeEventId: idFor(5592) });
  const all = [...placementIndex(layout).keys()].filter((id) => id === 999);
  assert.equal(all.length, 1);
  assert.equal(pkgNamed(layout, 'Mechanical', 'Mechanical Package').courses[0].eventId, 999);
});

test('H. a course hidden from the Schedule keeps its place and comes back when shown', () => {
  let layout = defaultLayout();
  const hvac = idFor(5593);
  layout = setCourseHiddenInSchedule(layout, hvac, true);
  assert.equal(isHiddenInSchedule(layout, hvac), true);
  assert.equal(placementIndex(layout).get(hvac).packageLabel, 'Mechanical Package');
  const rows = decorateRows([row(hvac), row(idFor(5594))], layout);
  assert.equal(rows[0].hiddenInSchedule, true);
  const { departments, unassigned } = arrangeSchedule(rows, layout, { departments: ['Mechanical'] });
  assert.deepEqual(departments[0].packages[0].direct.map((r) => r.id), [idFor(5594)], 'skipped by the Schedule');
  assert.equal(unassigned.length, 0, 'hidden is not unassigned');
  layout = setCourseHiddenInSchedule(layout, hvac, false);
  assert.equal(isHiddenInSchedule(layout, hvac), false);
});

/* ── hiding is Schedule presentation, never operational visibility ── */

const hideAutomotive = (layout) => updatePackage(layout, pkgNamed(layout, 'Mechanical', 'Automotive Package Offline').id, { hiddenInSchedule: true });
const automotiveRow = () => row(idFor(5748), { statusCanonical: 'in_progress', startsAt: '2026-09-08T16:00:00Z', endsAt: '2026-09-30T19:00:00Z' });

test('1. a hidden package disappears from the Schedule — and its course is not unassigned', () => {
  const layout = hideAutomotive(defaultLayout());
  const rows = decorateRows([automotiveRow(), row(idFor(5593))], layout);
  const { departments, unassigned } = arrangeSchedule(rows, layout, { departments: ['Mechanical'] });
  const labels = departments[0].packages.map((p) => p.package.label);
  assert.ok(!labels.includes('Automotive Package Offline'), labels.join(' | '));
  assert.equal(unassigned.length, 0);
  // The editor still sees it, so it can be restored.
  const editing = arrangeSchedule(rows, layout, { departments: ['Mechanical'], keepEmpty: true, includeHidden: true });
  assert.ok(editing.departments[0].packages.some((p) => p.package.label === 'Automotive Package Offline'));
});

test('2. a course in a hidden package stays in This month, with its package name', () => {
  const layout = hideAutomotive(defaultLayout());
  const month = monthRows(decorateRows([automotiveRow()], layout), '2026-09', NOW);
  assert.deepEqual(month.map((r) => r.id), [idFor(5748)]);
  assert.equal(month[0].placement.packageLabel, 'Automotive Package Offline');
  assert.equal(month[0].placement.packageHiddenInSchedule, true);
  // So does a course hidden from the Schedule on its own.
  const alone = setCourseHiddenInSchedule(defaultLayout(), idFor(5748), true);
  assert.equal(monthRows(decorateRows([automotiveRow()], alone), '2026-09', NOW).length, 1);
});

test('5. showing the package again restores it to the Schedule', () => {
  let layout = hideAutomotive(defaultLayout());
  layout = updatePackage(layout, pkgNamed(layout, 'Mechanical', 'Automotive Package Offline').id, { hiddenInSchedule: false });
  const rows = decorateRows([automotiveRow()], layout);
  assert.equal(rows[0].hiddenInSchedule, false);
  const { departments } = arrangeSchedule(rows, layout, { departments: ['Mechanical'] });
  assert.deepEqual(departments[0].packages.map((p) => p.package.label), ['Automotive Package Offline']);
});

test('6. a course removed from its package is Unassigned and still in This month', () => {
  const layout = unplaceCourse(defaultLayout(), idFor(5748));
  const rows = decorateRows([automotiveRow()], layout);
  assert.deepEqual(arrangeSchedule(rows, layout).unassigned.map((r) => r.id), [idFor(5748)]);
  const month = monthRows(rows, '2026-09', NOW);
  assert.equal(month.length, 1);
  assert.equal(month[0].placement, null, 'shown as Unassigned');
});

test('legacy "hidden" keys are not read as hiding anything', () => {
  const layout = validateLayout({ departments: [{ department: 'Civil', packages: [{ id: 'x', label: 'X', hidden: true, courses: [], groups: [] }] }], hiddenEventIds: [5] });
  assert.equal(layout.departments.find((d) => d.department === 'Civil').packages[0].hiddenInSchedule, false);
  assert.deepEqual(layout.hiddenInSchedule, []);
});

test('I. the server refuses one event in two places, repeated ids and junk', () => {
  const layout = defaultLayout();
  const twice = structuredClone(layout);
  pkgNamed(twice, 'Mechanical', 'Companies Courses').courses.push({ eventId: idFor(5592) });
  assert.throws(() => validateLayout(twice), (error) => error instanceof LayoutValidationError && error.message === 'layout_duplicate_placement');

  const repeatedId = structuredClone(layout);
  dept(repeatedId, 'Civil').packages[1].id = dept(repeatedId, 'Civil').packages[0].id;
  assert.throws(() => validateLayout(repeatedId), { message: 'layout_duplicate_id' });

  const sameLabel = structuredClone(layout);
  assert.doesNotThrow(() => validateLayout(sameLabel), 'two groups named "Basic Level" are fine — ids differ');

  for (const broken of [
    null,
    { departments: [{ department: 'Marketing', packages: [] }] },
    { departments: [{ department: 'Civil', packages: [{ id: 'x', label: '', courses: [], groups: [] }] }] },
    { departments: [{ department: 'Civil', packages: [{ id: 'x', label: 'a'.repeat(81), courses: [], groups: [] }] }] },
    { departments: [{ department: 'Civil', packages: [{ id: 'bad id!', label: 'x', courses: [], groups: [] }] }] },
    { departments: [{ department: 'Civil', packages: [{ id: 'x', label: 'x', courses: [{ eventId: '12' }], groups: [] }] }] },
    { departments: [{ department: 'Civil', packages: [{ id: 'x', label: 'x', accent: 'teal', courses: [], groups: [] }] }] },
  ]) {
    assert.throws(() => validateLayout(broken), LayoutValidationError);
  }

  // Unknown fields are dropped, missing departments restored in business order.
  const clean = validateLayout({ departments: [{ department: 'Civil', packages: [{ id: 'x', label: ' X ', evil: 1, courses: [], groups: [] }] }], extra: true });
  assert.deepEqual(clean.departments.map((d) => d.department), LAYOUT_DEPARTMENTS);
  assert.deepEqual(Object.keys(dept(clean, 'Civil').packages[0]).sort(), ['accent', 'courses', 'description', 'groups', 'hiddenInSchedule', 'id', 'label']);
  assert.equal(dept(clean, 'Civil').packages[0].label, 'X');
  assert.equal('extra' in clean, false);
});

/* ── packages and groups created by hand ─────────────────────────── */

test('packages are added at the end, renamed, and deleted without losing their courses', () => {
  let layout = defaultLayout();
  layout = addPackage(layout, 'Mechanical', { label: 'Summer Intake', accent: 'pink' }, 'pkg_summer');
  assert.equal(dept(layout, 'Mechanical').packages.at(-1).id, 'pkg_summer');
  layout = updatePackage(layout, 'pkg_summer', { label: 'Summer Intake 2026', accent: 'orange' });
  assert.equal(pkgNamed(layout, 'Mechanical', 'Summer Intake 2026').accent, 'orange');

  layout = placeCourse(layout, idFor(5592), { packageId: 'pkg_summer' });
  // Delete with courses → move them to another package…
  const moved = deletePackage(layout, 'pkg_summer', { moveTo: pkgNamed(layout, 'Mechanical', 'Companies Courses').id });
  assert.equal(placementIndex(moved).get(idFor(5592)).packageLabel, 'Companies Courses');
  // …or back to unassigned.
  const unassigned = deletePackage(layout, 'pkg_summer');
  assert.equal(placementIndex(unassigned).has(idFor(5592)), false);
});

test('groups are added, and deleting one keeps its courses in the package', () => {
  let layout = defaultLayout();
  const mech = pkgNamed(layout, 'Mechanical', 'Mechanical Package');
  layout = addGroup(layout, mech.id, 'Evening cohort', 'grp_evening');
  layout = placeCourse(layout, idFor(5592), { packageId: mech.id, groupId: 'grp_evening' });
  assert.equal(placementIndex(layout).get(idFor(5592)).groupLabel, 'Evening cohort');
  layout = deleteGroup(layout, 'grp_evening');
  const place = placementIndex(layout).get(idFor(5592));
  assert.equal(place.packageLabel, 'Mechanical Package');
  assert.equal(place.groupId, null);
});

test('a display name overrides only the label shown; clearing it resets to Odoo', () => {
  let layout = defaultLayout();
  const bimFundamentals = idFor(5679);
  layout = setCourseDisplay(layout, bimFundamentals, { customLabel: 'BIM Fundamentals MEP' });
  const [shown] = decorateRows([row(bimFundamentals, { courseName: 'BIM Fundmentals - MEP - 5679' })], layout);
  assert.equal(shown.courseName, 'BIM Fundamentals MEP');
  assert.equal(shown.odooName, 'BIM Fundmentals - MEP - 5679');
  layout = setCourseDisplay(layout, bimFundamentals, { customLabel: '' });
  assert.equal(placementIndex(layout).get(bimFundamentals).customLabel, null);
});

/* ── J. stale references ─────────────────────────────────────────── */

test('J. an event gone from Odoo does not break the arrangement and can be removed', () => {
  const layout = defaultLayout();
  const gone = idFor(5593);
  const rows = [row(idFor(5592)), row(idFor(5594))];
  const { departments } = arrangeSchedule(rows, layout, { departments: ['Mechanical'] });
  const mech = departments[0].packages.find((p) => p.package.label === 'Mechanical Package');
  assert.deepEqual(mech.direct.map((r) => r.id), [idFor(5592), idFor(5594)]);
  assert.equal(mech.elsewhere, 6, 'the other six are counted, not drawn as broken cards');
  const cleaned = removeReferences(layout, [gone]);
  assert.equal(placementIndex(cleaned).has(gone), false);
});

/* ── N. a new Odoo course ────────────────────────────────────────── */

test('N. a course Odoo created after the workbook is unassigned, never lost', () => {
  const layout = defaultLayout();
  const fresh = row(4242, { department: 'Mechanical' });
  const { unassigned } = arrangeSchedule([row(idFor(5592)), fresh], layout);
  assert.deepEqual(unassigned.map((r) => r.id), [4242]);
  // It still reaches the Mechanical chip by its Odoo department.
  const decorated = decorateRows([fresh], layout);
  assert.equal(applyFilters(decorated, { ...EMPTY_FILTERS, department: 'mechanical' }).length, 1);
});

test('placed courses take the layout department and arrange in layout order', () => {
  const layout = defaultLayout();
  // Odoo would call this one Arch & Decor; the layout files it under Mechanical.
  const rows = decorateRows([row(idFor(5595), { department: 'Arch & Decor' }), row(idFor(5592))], layout);
  assert.deepEqual(rows.map((r) => r.department), ['Mechanical', 'Mechanical']);
  const { departments } = arrangeSchedule(rows, layout);
  assert.deepEqual(departments[0].packages[0].direct.map((r) => r.id), [idFor(5592), idFor(5595)]);
  // Search reaches package and group labels.
  const bim = decorateRows([row(idFor(5681))], layout);
  assert.equal(applyFilters(bim, { ...EMPTY_FILTERS, search: 'coordinator advanced' }).length, 1);
});

test('an empty layout (Odoo unreachable for the default) leaves every course visible', () => {
  const { departments, unassigned } = arrangeSchedule([row(1), row(2)], emptyLayout());
  assert.equal(departments.length, 0);
  assert.equal(unassigned.length, 2);
});

/* ── O–W. This month ─────────────────────────────────────────────── */

const NOW = new Date('2026-09-23T09:00:00Z'); // 12:00 KSA, Wednesday 23 Sep

test('O–R. a course belongs to the month when its dates overlap it', () => {
  const month = '2026-09';
  const starting = row(1, { startsAt: '2026-09-15T16:00:00Z', endsAt: '2026-10-20T19:00:00Z' });
  const running = row(2, { startsAt: '2026-08-20T16:00:00Z', endsAt: '2026-10-12T19:00:00Z' });
  const ending = row(3, { startsAt: '2026-08-01T16:00:00Z', endsAt: '2026-09-03T19:00:00Z' });
  const before = row(4, { startsAt: '2026-07-01T16:00:00Z', endsAt: '2026-08-30T19:00:00Z' });
  const after = row(5, { startsAt: '2026-10-02T16:00:00Z', endsAt: '2026-10-30T19:00:00Z' });
  assert.equal(overlapsMonth(starting, month), true, 'O. starts this month');
  assert.equal(overlapsMonth(running, month), true, 'P. started last month, still running');
  assert.equal(overlapsMonth(ending, month), true, 'Q. ends this month');
  assert.equal(overlapsMonth(before, month), false, 'R. entirely before');
  assert.equal(overlapsMonth(after, month), false, 'R. entirely after');
  assert.equal(startedBefore(running, month), true);
  assert.equal(startedBefore(starting, month), false);
});

test('S. month edges are Riyadh days, not UTC ones', () => {
  // 30 Sep 22:30 UTC is 1 Oct 01:30 in Riyadh: an October course.
  const lateUtc = row(1, { startsAt: '2026-09-30T22:30:00Z', endsAt: '2026-10-10T19:00:00Z' });
  assert.equal(overlapsMonth(lateUtc, '2026-09'), false);
  assert.equal(overlapsMonth(lateUtc, '2026-10'), true);
  // 31 Aug 21:30 UTC is 1 Sep 00:30 KSA: it ends inside September.
  const endsOnFirst = row(2, { startsAt: '2026-08-10T16:00:00Z', endsAt: '2026-08-31T21:30:00Z' });
  assert.equal(overlapsMonth(endsOnFirst, '2026-09'), true);
  assert.deepEqual(monthBounds('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
  // The month itself turns over on Riyadh's clock.
  assert.equal(monthOf(new Date('2026-09-30T21:30:00Z')), '2026-10');
});

test('T–U. unassigned courses stay in the month, and Schedule hiding never removes one', () => {
  const layout = defaultLayout();
  const unplaced = row(4242);
  const placed = row(idFor(5593));
  let decorated = decorateRows([unplaced, placed], layout);
  assert.equal(monthRows(decorated, '2026-09', NOW).length, 2);
  assert.equal(decorated.find((r) => r.id === 4242).placement, null, 'T. shown as Unassigned');

  const hidden = setCourseHiddenInSchedule(layout, idFor(5593), true);
  decorated = decorateRows([unplaced, placed], hidden);
  assert.equal(monthRows(decorated, '2026-09', NOW).length, 2, 'U. a Schedule hide is not a month hide');
});

test('V–W. the default month is this Riyadh month, and months navigate across years', () => {
  assert.equal(monthOf(NOW), '2026-09');
  assert.equal(shiftMonth('2026-09', 1), '2026-10');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.deepEqual(monthBounds(shiftMonth('2026-09', 1)), { from: '2026-10-01', to: '2026-10-31' });
});

test('the month table lists lecture-today, running, upcoming, then finished', () => {
  const later = { endsAt: '2026-10-20T19:00:00Z' };
  const today = row(1, {
    ...later,
    statusCanonical: 'in_progress',
    startsAt: '2026-09-01T16:00:00Z',
    sessions: [{ id: 1, startsAt: '2026-09-23T16:00:00Z' }],
  });
  const running = row(2, { ...later, statusCanonical: 'in_progress', startsAt: '2026-09-01T16:00:00Z', nextSession: { number: 3, startsAt: '2026-09-24T16:00:00Z' } });
  const upcomingLate = row(3, { ...later, startsAt: '2026-09-28T16:00:00Z' });
  const upcomingSoon = row(4, { ...later, startsAt: '2026-09-25T16:00:00Z' });
  const finished = row(5, { statusCanonical: 'finished', startsAt: '2026-09-01T16:00:00Z', endsAt: '2026-09-10T19:00:00Z' });
  const cancelled = row(6, { statusCanonical: 'canceled' });
  const ordered = monthRows([cancelled, finished, upcomingLate, running, upcomingSoon, today], '2026-09', NOW);
  assert.deepEqual(ordered.map((r) => r.id), [1, 2, 4, 3, 5, 6]);
  assert.deepEqual(ordered.map((r) => r.monthBucket), ['today', 'running', 'upcoming', 'upcoming', 'finished', 'canceled']);
  assert.equal(monthBucket(running, NOW), 'running');

  const summary = monthSummary(ordered, '2026-09', NOW);
  assert.equal(summary.courses, 6);
  assert.equal(summary.running, 2);
  assert.equal(summary.finishing, 2, 'the finished one and the cancelled one both end in September');
  assert.equal(summary.trainees, 50, 'cancelled registrations are not counted');
});
