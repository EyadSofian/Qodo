# Events — Training Schedule workspace

The Events app (الإيفينتات) is the operations team's training schedule, read
live from Odoo. It replaces day-to-day use of the `SCHEDULE REPORT` workbook.

**The workbook defines the fields, not the interface.** Everything the sheet
records is here; none of how it looked is. There is no wall of columns, no
S1…S40 band, no sideways scrolling and no frozen header — a course is a card,
its lectures are a timeline, and the long tail of the sheet lives in a detail
drawer. What an operations person needs on *every* pass through the list is on
the card; everything else is one click away.

**Odoo is the only source of truth.** The workbook defined what operations
people expect to *see*; Odoo supplies every value. Nothing here writes to Odoo,
nothing reads the workbook at runtime, and every course links back to its Odoo
record. The one thing Qodo stores is the **schedule layout** — how courses are
arranged into packages and levels (see the last section).

```
Events
├── Courses    the dashboard: five counts, department chips, filters, course cards,
│              and a details panel docked beside them — every course overlapping a
│              date range (≤ 186 days), online + offline
│   ├── departments: All · Arch & Decor · Mechanical · Electrical · Civil · Development · English · Webinar
│   └── views: Cards · List
├── This month a concise table of every course overlapping one KSA calendar month
├── Today      every lecture on today's Cairo calendar, with Zoom links
├── Analytics  unchanged: in-person demand, capacity, Insights Hub paid revenue
└── Archive    finished / cancelled / refused / hold / ended, one year per request, paged
```

## Architecture

```
Odoo (JSON-RPC)
 └─ server/odoo.js            auth, one retry on timeout, fields_get with `store`
     └─ server/events/schema.js     live field discovery → which fields to read
     └─ server/events/reader.js     the bulk query plan (no N+1)
     └─ server/events/normalize.js  pure: Odoo rows → TrainingScheduleRow
     └─ server/events/schedule.js   ranges, caches, schedule/archive/today/detail
         └─ server/routes/events.js  HTTP, app-tile gate, error translation
             └─ src/lib/eventsSchedule.ts   types, fetchers, KSA/Cairo formatting
                 └─ shared/eventsSchedule.js filters, search, sorting, overview counts (tested)
                     └─ src/components/events/*  the UI
```

`server/events.js` is now the Analytics tab only; its definitions did not change.

## Field mapping

**Confirmed** fields have been read in production by this reader before this
redesign. **Discovered** concepts are found at runtime from `fields_get` — by
technical name *and* label, stored fields only — and are `null` when this Odoo
has no such field. Nothing is guessed.

| Sheet column | Source | Status |
|---|---|---|
| Course Name | `event.event.name` | confirmed |
| Course Code | `event.event.code` | confirmed |
| Inst. Name | `event.event.instructor_id` | confirmed |
| Type | `event_type` × `attendance_method` (see below) | confirmed |
| عدد المحاضرات | `event.event.total_lectures_number` | confirmed |
| عدد المتدربين | `event.registration` `read_group` by (event, state): `open`+`done` | confirmed |
| Capacity | `event.event.seats_max` (0 / empty → unknown, never 0) | confirmed |
| Start / End Date | `date_begin` / `date_end` (naive UTC → instant) | confirmed |
| Start / End Time KSA | most common lecture start/end, on `Asia/Riyadh` | derived |
| Day / Night | from the usual KSA start time (below) | derived |
| Work Days | weekdays of the actual lectures, on the KSA calendar | derived |
| Status | `event.event.stage_id` → `event.stage` flags + name | confirmed |
| S1 … Sn | `event.track` rows, ordered by `date` | confirmed |
| Venue / branch | `address_id`, `headquarter`, `if_offline` | confirmed |
| Department | derived from the package name (below) | derived |
| Package | `related_group_id` → `training.package.group.package_id` | confirmed |
| Group / intake | `related_group_id` → `training.package.group.name` | confirmed |
| Section | no such field on this database | absent |
| Coordinator | `user_id` ("Responsible") — see below | confirmed, renamed |
| Comments | `note`; present but empty on every course read | confirmed, unused |
| Minimum capacity | no such field on this database | absent |
| Configured work days | `week_day_ids` → `week.day` | confirmed |
| Zoom link | `active_join_live_url` → `zoom_join_link` → `meeting_url` → `zoom_link` (http/https only) | confirmed |

Standard Odoo 17 `event_type_id` (template) and `tag_ids` are used only as
category labels for the department tabs, when present.

### What the live database answered

Discovery was run against production on **2026-09-22** (`fields_get` on
`event.event`: 165 fields). Three things it first got wrong, and the fix:

| Concept | First guess | What it actually is |
|---|---|---|
| Package | `package_training_style` | A *delivery mode* (`onsite`/`online`) that merely contains the word "Package". Selections no longer qualify as a package; the real one is reached through the cohort group. |
| Work days | nothing found | `week_day_ids` → `week.day`. The pattern required "days"; Odoo spells it **day**. |
| Coordinator | nothing found | No coordinator field exists. `user_id` ("Responsible") is the operational owner and fills the column, labelled as such. |

There is no `department`, `section` or minimum-seats field. Department is
derived from the package, which is a clean 12-value list
("Mechanical Engineering Professional Track", "BIM Structure Professional
Track", …) that maps onto the workbook's tabs.

Over 1 Sep – 31 Dec 2026 (124 courses): department **94 %**, package **73 %**,
work days **98 %**, coordinator **100 %**, comments **1 %**.

`note` exists and is stored, but is empty on every course — the workbook's
Comments column has no home in Odoo today, and the drawer says so rather than
inventing one.

A re-check is always available at:

```
GET /api/events/diagnostics      (administrators — settings.manage)
```

returns, for `event.event` and `event.track`: core fields present/missing, the
field chosen for each concept and every candidate with its score, label, type
and `store` flag, the selection values of `event_type` / `attendance_method`,
and each stage with its canonical status. No records, credentials or URLs.

Discovery is still by name and label, so a renamed custom field changes the
answer. If it picks the wrong one, pin it:

```
ODOO_EVENT_FIELD_MAP={"coordinator":"x_coordinator_id","package":"x_package_id"}
```

Pins are validated against `fields_get` (must exist and be stored); a bad pin
is ignored and shown as a warning on the page.

### Type

| `event_type` | `attendance_method` | Shown as |
|---|---|---|
| `individual` | `online` / `offline` | Group Online / Group Offline |
| `private` | … | Private Online / Private Offline |
| `company` | … | Company Online / Company Offline |
| any other value | … | Odoo's own selection label + mode |

`individual` → "Group" follows the workbook, whose 2026 sheets write "Group
Online" for what the 2023–25 archives called "Inv." (individual). "Public" (an
English-sheet word) has no Odoo value today and is not invented.

### Status

Odoo's stage is authoritative. It is filed under one canonical word, and the
Odoo stage name stays available (hover on the chip, drawer):
cancel/refus/hold-delay-postpone by name first → `inprogress` flag → `pipe_end`
flag or finished/done → planned/new/booked/… → otherwise `null` (the Odoo name
is shown as is).

### Department

1. A discovered department field — authoritative.
2. Otherwise a category label (package, section, template, tag) containing a
   discipline's own name ("Mechanical Package" → Mechanical).
3. Otherwise the course name, only for names that belong to exactly one
   discipline (HVAC → Mechanical, PMP → Development, Pre-intermediate → English,
   "… Webinar" → Webinar). Revit, BIM, AutoCAD, Photoshop and anything taught
   in several departments stay unclassified and appear under **All** only.

Each row carries `departmentSource` (`odoo` / `category` / `course_name`) and
the drawer says which one it was.

## Derivation rules

- **Time.** Odoo's naive UTC is stamped with `Z` once (`asInstant`). Everything
  travels as instants. KSA (`Asia/Riyadh`, fixed UTC+3) is applied only where a
  column says KSA, and "today"/"last synced" use Cairo, the reader's clock.
  They are separate helpers (`ksa*` vs `cairo*` in `eventsSchedule.ts`).
- **Session order.** By lecture date, then the number in the track name, then
  id; undated tracks last. S*n* is the *n*-th lecture that happens. A track
  name whose "Session N" disagrees with that order raises
  `session_numbering_mismatch` rather than reordering.
- **Work days.** Distinct KSA weekdays of the lectures, Saturday-first. A
  configured work-days field, if discovered, is used only when there are no
  lectures, and otherwise compared (`work_days_mismatch`).
- **Day / Night.** From the most common KSA lecture start: morning 05:00–11:59,
  afternoon 12:00–16:59, evening 17:00–20:59, night 21:00–04:59.
- **Progress.** Past lectures ÷ scheduled lectures. No lectures → `null`, and
  the drawer says "Schedule incomplete" when lectures are planned.
- **Trainees.** Confirmed registrations (`open`+`done`). The drawer adds
  interested (`draft`), attended (`done`) and cancelled (`cancel`).

### Data-quality flags

`missing_code`, `missing_instructor`, `missing_start`, `missing_end`,
`invalid_date`, `end_before_start`, `no_sessions`, `lecture_count_mismatch`,
`session_outside_range`, `capacity_missing`, `inconsistent_session_times`,
`session_numbering_mismatch`, `work_days_mismatch`, `missing_coordinator`
(only when a coordinator field exists), `zoom_missing` (detail only: online
course, lecture within 48h, no link). A small ⚠ in the grid; the drawer lists
them in words.

## API

All under `/api/events`, behind the **Events** app tile (`canOpenApp`).

| Endpoint | Parameters | Returns |
|---|---|---|
| `GET /schedule` | `from`, `to` (YYYY-MM-DD, KSA days, ≤ 186 days; default next 90) | `{ rows, meta, fetchedAt, stale? }` |
| `GET /archive` | `year` **or** `from`/`to` (≤ 366 days), `page`, `q` | same, `meta.hasMore` |
| `GET /today` | — | `{ date, sessions[], fetchedAt, stale? }` |
| `GET /:id` | numeric id | `{ course, odooUrl, fetchedAt, stale? }` |
| `POST /refresh` | `from`, `to` | `{ schedule, insightsSync }` |
| `GET /diagnostics` | — (settings.manage) | discovered schema |
| `GET /analytics` | `from`, `to` | unchanged |

`meta` carries the facet lists (`availableDepartments`, `…Types`,
`…Instructors`, `…Coordinators`, `…Packages`, `…Sections`, `…Statuses`),
`discoveredFields` (concept → field or null), `missingFields`, `warnings`
(`events_truncated`, `sessions_truncated`, pin problems) and
`capacityRuleSource`.

Filtering, department presets, search and sorting run in the browser over the
returned rows; only the date range (and the archive's year/page/search) goes
to Odoo.

### Errors

Odoo's own error text is logged, never forwarded. The browser receives one of
`odoo_not_configured` (503), `odoo_auth_failed` (502 — deliberately not 401,
which would sign the person out of Qodo), `odoo_timeout` (504),
`odoo_unreachable`, `odoo_bad_response`, `odoo_schema_changed`,
`odoo_access_denied`, `odoo_error` (502), `invalid_course` /
`invalid_schedule_range` / `schedule_range_too_long` / `invalid_archive_year`
(400), `course_not_found` (404) — each with its own message.

## Performance

A schedule load is **three** Odoo requests however many courses it covers,
plus cached reference reads:

1. `event.event` `search_read` — bounded by the date range, capped at 1,500.
2. `event.track` `search_read` for all of those ids at once — stored fields
   only, capped at 15,000. ┐ parallel
3. `event.registration` `read_group` by (event, state).  ┘
4. Only if a discovered concept is a many2many: one name read per relation.

`event.stage` (60 s) and `fields_get` (6 h) are cached separately. Zoom fields
are computed in Odoo and are read only for Today and the detail drawer.
`seats_taken` is never read. `stage_id.inprogress`-style dotted domains are not
used.

Caches: schedule/today/detail 60 s, archive 10 min. **Sync** *expires* them
rather than clearing them, so a sync during an Odoo outage still falls back to
the last good answer (`stale: true`, original `fetchedAt`) instead of an error.
The page shows a non-blocking warning and flips the header badge from "Live
from Odoo" to "Stale Odoo data". Only a cold cache surfaces an error.

## Capacity rules

The workbook's `الحد الأدنى والأقصى للدورات` sheet is **not** imported.
`seats_max` is shown as capacity; whether it matches the sheet's maximum has
not been verified. If Odoo has a minimum-seats field, discovery maps it to
`minimumCapacity` and the "Below minimum" quick filter appears; otherwise the
value is `null` and the filter is not offered.

## Known limitations

- **Coordinator is Odoo's "Responsible"** (`user_id`), not a field the
  operations team fills as a coordinator. The drawer marks it. If the two
  are meant to be different people, this column needs a real Odoo field.
- **Comments are always empty.** `note` is the only candidate and no course
  uses it, so the workbook's Comments do not survive the move.
- **Section and minimum capacity do not exist** in this Odoo, and are `null`.
- 27 % of courses sit outside any package, so they have no department from
  that route and fall back to the course name — or stay unclassified when the
  name is taught in more than one department (Revit, BIM, AutoCAD).
- LMS-style courses carry all seven `week_day_ids`; the lectures' own days
  win whenever a course has lectures.
- Webinars appear only if they exist in Odoo as `event.event`; the workbook's
  webinar list is not imported.
- Archive search (`q`) reaches Odoo by name and code only; instructor and
  coordinator search applies to loaded pages.
- The schedule range is capped at 186 days per request; a wider plan needs two
  ranges.

## The interface

The workbook defined the fields; the approved dashboard mock defined the page.
Everything is Arabic and right-to-left; only what Odoo holds (course, package
and people names, codes) stays in Latin.

**Visual system.** The module has its own semantic palette, defined once in
`src/components/events/tones.ts` from Tailwind's palettes (no bespoke hexes):
blue = action and planned, green = running and healthy, amber = attention and
on hold, violet = upcoming and secondary highlight, coral = alert, cancelled,
full, slate = finished and neutral. Departments get identity tints used only
on their chip. Colour is never the only carrier: every status also has a dot
or icon and a word. Depth comes in layers — a cool backdrop with soft colour,
frosted glass panels (`GLASS`) for the toolbar, the Today summary and empty
states, solid cards with a status stripe, and two dark navy anchors (the page
header and the details-panel header) so the page is never pale from top to
bottom. Text is slate-900 / 600 / 500; nothing readable uses a lighter grey.
The shared `StatTile` and `ChartCard` take an optional `accent`; eLearning
and Profile pass none and render exactly as before.

**Header** — title, the Odoo freshness badge (or the last good sync when Odoo is
down), the sync button, and the module's four sections as one underline row:
الكورسات (the dashboard, default) · النهاردة · التحليل · الأرشيف.

**Five counts** open the dashboard — running courses, lectures today, starting
within a week, active trainees, near capacity. They are counted from the rows
already loaded (no extra Odoo request), closed courses are left out of all of
them, and "near capacity" is the same test as the smart filter of that name
(80 % of a capacity Odoo knows), so the count always equals the cards that
filter shows. A course with no `seats_max` is never "near" anything.

**Filters** — department chips; then search, status, type, instructor and the
date range inline; everything else (delivery, coordinator, package, work days,
the less common alerts, closed courses) behind one "فلاتر" button whose badge
counts what it holds. Six smart filters sit under them: running now, starting
this week, a lecture today, no registrations, near capacity, no instructor.

**A course is a card**: department chip and status, then the name, code and
package, the instructor (initials avatar — no invented photos), type and
delivery beside trainees over capacity with a thin bar, dates, work days and
KSA hours, a tinted "next lecture" box (or "live now" while one is running),
and the coordinator. **List** is the same, one 96 px row per course.

Card columns follow the width the grid actually has, not the window: at most
three, none narrower than 440 px — and with the details panel docked, at most
two, none narrower than 340 px.

**Details panel** — at 1280 px and wider it docks on the right at about 35 % of
the width and the cards reflow beside it; the selected card keeps a blue
border and choosing another swaps the panel. Below that it is a sheet over the
page, the whole screen on a phone, with a focus trap. Four underline tabs:

- نظرة عامة — department / package / type, instructor and coordinator, a
  five-number strip (trainees, total, done, upcoming, today), the schedule with
  a next-lecture panel and a Zoom button when a lecture is today, five session
  tiles around today, and the comments.
- المحاضرات — every lecture as a vertical timeline: forty read as easily as four.
- المتدربين — registrations: confirmed over capacity, interested, attended,
  cancelled, and the minimum when Odoo has one. Trainee names are not listed;
  they are in Odoo.
- التفاصيل — every remaining field, where each derived value came from, and
  the data-quality notes in words.

Sessions are never columns, anywhere. Nothing in the module scrolls the page
sideways: chip rows scroll inside themselves, and cards, grids and truncating
names carry `min-w-0` — a long English name keeps its beginning and loses
its end, even inside an Arabic card.

Effects that call `scrollTo` use a block body: Chromium's `scrollTo()` now
returns a Promise, and an arrow that returned it hands React a Promise as the
effect's cleanup — which crashed the page on the first tab switch.

## Schedule layout (packages, levels, order)

The Courses tab is drawn as **Department → Package → optional Level → Course**,
in the business order of the workbook. The layout is Qodo configuration, not
Odoo data: it stores references (`eventId`) and display metadata only — never
a date, instructor, status or head count.

```
shared/eventsLayoutSeed.js   GENERATED from the workbook (scripts/generate-events-layout-seed.mjs)
shared/eventsLayout.js       pure model: default build, placement index, editing ops, validation
shared/eventsMonth.js        This month: overlap rule, buckets, ordering, summary
server/events/layout.js      persistence (collection `eventLayouts`), default resolution, save/reset
src/components/events/ScheduleBoard.tsx, LayoutDialogs.tsx, useLayoutEditor.ts   board + editor
src/components/events/ThisMonth.tsx                                              month table
```

### How the default was derived from the workbook

`node scripts/generate-events-layout-seed.mjs "SCHEDULE REPORT - 2026.xlsx"`
reads the Arch & Decor, Mechanical, Electrical, Civil and Development sheets in
sheet order:

- A merged orange band (the course-name cell repeats the first cell) opens a
  **package**.
- A course row whose first cell contains "Level" goes into a **level group**. A
  run of rows with the same label is one group; the same label again after a
  different one is a *new* group (the next cohort). Two "Basic Level" groups
  keep two ids and are never merged.
- Any other first-cell label puts the course directly in the package. When that
  label names something other than the package ("Mechanical Package" under
  Companies Courses) it is kept as the course's badge.
- A blank first cell continues the previous label.
- Rows without a course code are skipped and listed in `skipped` (five Arch &
  Decor rows — the fourth online Advanced Level cohort).

English and Webinar carry no codes and seed nothing; their courses start
unassigned. Result: 135 coded courses in 16 packages.

At runtime the seed's codes are resolved to Odoo ids with **one**
`search_read` (`code in […]`). Odoo writes "E05592" for the workbook's "5592";
both are compared as digits. A code on several events goes to the run starting
nearest the workbook date. Checked read-only against production on 2026-09-23:
135 of 135 codes found, none ambiguous. The workbook is never read at runtime.

### Storage, API, permission

One document per organization in `eventLayouts` (the JSON/Postgres document
store): `{ layout, revision, updatedAt, updatedBy }`. Until the first save the
layout *is* the resolved default (cached 6 h); if Odoo cannot be reached for it,
every course simply shows as unassigned.

| Endpoint | Who | |
|---|---|---|
| `GET /api/events/layout` | Events tile | layout, revision, updatedAt, updatedBy, isDefault, canManage |
| `PUT /api/events/layout` | `events.manage_layout` | body `{ layout, expectedRevision }` |
| `POST /api/events/layout/reset` | `events.manage_layout` | body `{ expectedRevision }`; the workbook default as a new revision |
| `GET /api/events/layout/references` | `events.manage_layout` | layout ids Odoo no longer has |
| `GET /api/events/layout/search?q=` | `events.manage_layout` | course picker beyond the loaded range (name/code) |
| `GET /api/events/layout/unassigned?from&to` | `events.manage_layout` | loaded courses the layout does not place |

`events.manage_layout` is granted per person (admins hold it); no role carries
it. The server rebuilds every saved layout through `validateLayout`: known
departments only, unique package/group ids, length-limited strings, integer
event ids, **one placement per event across the whole layout**, fixed depth (no
cycles). Ids a save *introduces* must exist in Odoo; ids already there that
Odoo has lost are kept and shown as "Unavailable in Odoo" for a manager to
remove.

Saves carry `expectedRevision`; a mismatch is **409 `layout_conflict`** naming
who saved in between, and saves are serialised in the process so the check and
the write cannot interleave. Every save or reset writes an
`events.layout_updated` activity row with the revision, the changed departments
and whether it was a reset — never the layout itself. Layout writes do not
touch any Odoo cache, and Sync never touches the layout: new Odoo events are
simply unassigned.

### Editing

"تخصيص الترتيب" (managers only) enters an explicit edit mode with a banner
(Undo, + Package, Reset to default, Cancel, Save). Everything edits a local
draft; nothing is saved per drag.

- Packages, levels and courses reorder by drag handle (never the whole card)
  and by menu (up/down, move to package / level) for keyboards and touch.
- Courses can be added from Odoo (searchable picker), moved, removed from their
  package (→ **unassigned**, still visible), hidden from the Schedule, and
  given a display name, badge or note. Odoo's
  name is untouched; "رجّع اسم أودو" clears the override.
- Packages can be added, renamed, recoloured, hidden from the Schedule and
  removed; a removed package's courses go to another package or back to
  unassigned.
- **Hiding is Schedule presentation only** (`hiddenInSchedule` on a package, and
  the `hiddenInSchedule` list of course ids). A hidden package does not render
  as a Schedule section and a hidden course is skipped there, but both stay in
  This month, Today and Analytics — those show real Odoo activity, and the
  layout never decides whether a course exists. Edit mode shows hidden items
  (dimmed, labelled) so they can be restored. There is deliberately no
  "hide everywhere" setting.
- Ctrl/⌘+Z undoes. Leaving with unsaved changes asks first.
- Package collapse state is per browser (localStorage), not configuration.

### This month

A course is in a month when `start ≤ monthEnd AND end ≥ monthStart` on the KSA
calendar, so courses running over from last month and ones finishing early in
the month are included. Rows come from `GET /schedule` for that month.
Unassigned courses show "مش في باقة"; courses hidden from the Schedule (by
themselves or with their package) are listed as usual.

Order: a lecture today, running, upcoming, finished this month (then hold,
cancelled), each by its next relevant moment. Columns: Course (name + code),
Package (+ level), Instructor, Type, Schedule, Days, Time (KSA), Status,
Trainees, Next lecture. There are no session columns and no comments. Phones
get the same rows as stacked cards.
