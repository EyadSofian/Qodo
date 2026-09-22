# Events — Training Schedule workspace

The Events app (الإيفينتات) is the operations team's training schedule, read
live from Odoo. It replaces day-to-day use of the `SCHEDULE REPORT` workbook
while keeping its vocabulary: the same column names, the same department tabs,
the same S1…Sn session columns.

**Odoo is the only source of truth.** The workbook defined what operations
people expect to *see*; Odoo supplies every value. Nothing here writes to Odoo,
nothing reads the workbook at runtime, and every course links back to its Odoo
record.

```
Events
├── Schedule   all courses overlapping a date range (≤ 186 days), online + offline
│   ├── All · Arch & Decor · Mechanical · Electrical · Civil · Development · English · Webinar
│   └── views: Excel Full · Operations · Sessions · Compact (+ English / Webinar layouts)
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
                 └─ shared/eventsSchedule.js presets, columns, filters, sorting (tested)
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
| Department | discovered field → else category label → else course name | discovered / derived |
| Package | discovered (name/label "package", or relation `training.package`) | discovered |
| Section | discovered (name/label "section") | discovered |
| Coordinator | discovered (name/label "coordinator") | discovered |
| Comments | discovered ("comment"/"remark"); Odoo 17's stored `note` qualifies | discovered |
| Minimum capacity | discovered ("min seats/capacity/attendees") | discovered |
| Configured work days | discovered (field or seven weekday booleans), compared only | discovered |
| Zoom link | `active_join_live_url` → `zoom_join_link` → `meeting_url` → `zoom_link` (http/https only) | confirmed |

Standard Odoo 17 `event_type_id` (template) and `tag_ids` are used only as
category labels for the department tabs, when present.

### What the live database answered

Field discovery could **not** be run while this was built: the development
machine has no Odoo credentials. The discovered rows above are therefore
unverified until somebody with access checks them:

```
GET /api/events/diagnostics      (administrators — settings.manage)
```

returns, for `event.event` and `event.track`: core fields present/missing, the
field chosen for each concept and every candidate with its score, label, type
and `store` flag, the selection values of `event_type` / `attendance_method`,
and each stage with its canonical status. No records, credentials or URLs.

If discovery picks the wrong field, or a concept lives under an unexpected
name, pin it:

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

- Custom-field discovery is unverified against the live database (see above).
  Until it is, Department comes from category labels / course names, and
  Package, Section, Coordinator and Comments may be empty.
- Webinars appear only if they exist in Odoo as `event.event`; the workbook's
  webinar list is not imported.
- Archive search (`q`) reaches Odoo by name and code only; instructor and
  coordinator search applies to loaded pages.
- The schedule range is capped at 186 days per request; a wider plan needs two
  ranges.
