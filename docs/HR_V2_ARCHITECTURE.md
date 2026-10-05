# HR V2 — architecture

HR V2 replaces the single 2,360-line `src/pages/HR.tsx` and its flat nine-tab
strip with a routed module, and moves recruitment off the monthly Excel
workbook into Qodo's own database. This file is the contract the code follows;
where it and the code disagree, the code is wrong.

## 1. What production actually looks like (discovery, 2026-09-24)

Read-only discovery against production (Postgres session opened with
`default_transaction_read_only=on`; Odoo read with `fields_get`,
`search_read` and `read_group` only). Nothing was written.

| Fact | Consequence |
| --- | --- |
| Only two Qodo accounts sit in the HR department: *Salah Mohmed* (HR management) and *kareem* (personnel). The recruiters themselves have no Qodo accounts. | The recruitment team cannot be "users in department hr". It is derived from the HR employee database and assignment data, keyed by **employee code**. |
| Active employees titled *Recruitment specialist*: **Shahinda Samir (#257)**, **Yasmin Ashraf (#420)**. | Title rule. |
| The workbook's `Assigned to` column names Shahinda (26 rows), Yasmin (13), Salah (9), Karim (3), Aya (3), Fatima (1). Salah = **#389 HR Manager**, Karim = **#247 Senior HR Admin**. Aya (#522) and Fatima have left. | Assignment rule — only **active** employees become team members. |
| Odoo `hr.employee.registration_number` **is the HR employee code**: 308 records carry one, and none disagrees with the e-mail or name join. Work e-mail joins 262 rows and a unique full English name 339; badge ids are unused. | Join order: registration number → work e-mail → unique English name (§7). 89 of 90 active HR-file employees link. |
| 165 employees are active in Odoo (349 archived); **69 of them have no row in the HR file**. | They still appear — in People, the org chart and time off — as *Odoo-only* people, and Settings → Reconciliation lists them for HR to add. |
| Only **36 of 165** active employees have a real uploaded `image_128`. All four recruiters do. | Photos come from `image_128` / `image_512` only — never `avatar_128`, Odoo's generated placeholder. Everyone else gets coloured initials, and the app never asks for a photo it knows is missing. |
| Odoo time off: 15 leave types, of which five (`time_type = other`: WFH, missed fingerprint, late/early permission, work mission, weekend swap) mean *away from the desk*, not absent. `hr.contract` is not readable with this key; there are no attendance records. | Time off is read from `hr.leave`, `hr.leave.allocation` and `hr.leave.type` beside the leave workbook; away types are shown apart from absence. Contracts and attendance stay out of scope. |
| Odoo `hr.job.user_id` is the recruiter. 175 of 230 active Odoo jobs have none; 11 name Essam Basiony (#342, left) and 11 Fatyma Morsy (left). | Odoo job ownership is stale and cannot be the source of truth for assignment. Qodo owns assignment. |
| Workbook validation column: `Eng.Taha` on 38 rows. Qodo admin account *Taha aref*; Odoo *ENG.Taha Aref*, CEO, no photo. | Final approval and Extend are dedicated permissions granted to him. |
| 66 workbook requests: 8 active, 32 hold, 26 done. **None of the 26 done rows has an actual hiring date.** | Migrated completed jobs have an unknown SLA outcome and never count toward rewards or the hiring-target KPI. |
| `role + activeDate + location` is unique across the workbook. | Legacy migration key (see §6). |
| Odoo stages: New → Initial Screening → HR Evaluation → Shortlisted I → Technical Evaluation → Final Review & Decision → Shortlisted II → Contract negotiation → **Contract Signed (hired stage)** → On boarding; plus Rejected and Next Patch. | Default funnel mapping (§7), configurable in HR Settings. |

## 2. Information architecture

```
/hr                          HR Home
/hr/recruitment              Overview (team carousel first)
/hr/recruitment/requests     Job Requests (+ /new wizard, /:id detail)
/hr/recruitment/hiring       Active Hiring
/hr/recruitment/capacity     Team Capacity
/hr/recruitment/odoo-jobs    Published Odoo Jobs (read-only, live)
/hr/recruitment/kpi          Recruitment KPI
/hr/recruitment/rewards      Rewards
/hr/people[/:employeeCode]   People
/hr/personnel[/requests|/onboarding|/leave|/clearance]
/hr/payroll                  Payroll & Benefits (hr.payroll)
/hr/performance              Performance
/hr/organization             Organization (org chart, vacancies, offices)
/hr/reports                  Reports
/hr/settings                 HR Settings
```

Legacy links keep working: `/hr?tab=…`, `/hr/employees/:code` and `/offices`
redirect to their new homes.

Front end: `src/features/hr/` — `shell/` (layout, sidebar, header, mobile
bottom navigation, the shared sub-navigation), one folder per area
(`home`, `recruitment`, `people`, `personnel`, `payroll`, `performance`,
`organization`, `reports`, `settings`) and `ui/` for the module's own
primitives. Every page is its own lazy chunk, so opening HR loads the shell
and the page in view, nothing else. The public New Employee Form
(`/hr-form/:token`) renders outside the workspace shell, before the session
check, like a booking page.

Back end: `server/hr/` — `recruitment/*` (requests and workflow, team,
context, desk and alerts, Odoo pipeline, KPI, rewards, migration, the clock),
`personnel.js`, `performance.js`, `reports.js`, `workspace.js` (access, HR
Home, People, Payroll, Organization), `admin.js` (settings view, audit,
reconciliation), `settings.js`, `odooPeople.js` (the Odoo employee index,
photos and locations), `odooTimeOff.js` (leaves, allocations and types),
`odooHR.js` (resolves Odoo people to HR codes and shapes time-off views) and
`errors.js`. Routes: `server/routes/hr.js`, `hrRecruitment.js`, `hrForms.js`
(public) and `hrFail.js`. Pure business rules live in `shared/recruitment/*`
and `shared/hrReportFilter.js`, so the browser and the server run the same
arithmetic and the tests exercise it without a server.

## 3. Data model (document store collections)

| Collection | One document per | Mutable? |
| --- | --- | --- |
| `recruitmentRequests` | job request (source of truth) | yes, through the workflow only |
| `recruitmentApprovals` | workflow transition: status, actor, timestamp, comment, decision | **append-only** |
| `recruitmentAssignments` | recruiter assignment incl. capacity snapshot and override reason | **append-only** |
| `recruitmentExtensions` | SLA extension: previous/new due date, added working days, reason, note, actor | **append-only** |
| `recruitmentKpiEvents` | KPI deduction (manual or automatic) | append-only; voiding writes `voidedAt/By/Reason`, never deletes |
| `recruitmentRewardRules` | reward rule **version** | new version = new document |
| `recruitmentRewardBatches` | reward batch of exactly N job ids | status only (ready → approved → paid / rejected) |
| `recruitmentActivity` | timeline entry for a request (audit log) | append-only |
| `recruitmentOdooLinks` | confirmed link request → Odoo `hr.job` | replaced on relink, history in activity |
| `personnelRequests` | personnel case (onboarding, leave, clearance, salary increase, documents, insurance, general) | yes |
| `personnelForms` | one secure New Employee Form link (token stored hashed) | submission once |
| `performanceReviews` | quarterly review of one employee | draft → final |
| `hrSettings` | one revisioned settings document per organization | revision-checked |

Workbook snapshots (`hrDatasets`) stay as they were — they now feed People,
Payroll, Organization and Leave, and serve as the historical import for
recruitment.

## 4. Recruitment workflow

```
draft ──submit──▶ pending_review ──review:approve──▶ pending_approval ──approve──▶ hiring
                     │  └─review:return──▶ draft          │  └─return──▶ draft      │   ▲
                     └─review:reject──▶ rejected           └─reject──▶ rejected      hold resume
                                                                                     ▼   │
                                                                                  on_hold
hiring ──accepted ≥ headcount──▶ completed        any non-terminal ──cancel──▶ cancelled
```

* Every transition is validated server-side against this table
  (`shared/recruitment/workflow.js`) and writes one `recruitmentApprovals`
  row. Invalid transitions answer `409 recruitment_transition_invalid`.
* A requester who is themselves a reviewer for the department skips no step:
  submitting records the department review as theirs, with that comment.
* **The SLA clock starts only at `pending_approval → hiring`.**

## 5. SLA

`shared/recruitment/sla.js`. Friday and Saturday are weekend (configurable),
plus an optional holiday list. `T + N` convention: the approval day itself is
not counted, the due date is the N-th working day after it.

| Priority | Target band (working days) | Default |
| --- | --- | --- |
| Critical | ≤ 15 | 15 |
| Required | 15 – 30 | 30 |
| Planned | 45 – 60 | 60 |

Stored on the request: `sla.startDate`, `originalTargetWorkingDays`,
`originalDueDate`, `currentDueDate`, `extendedWorkingDays`,
`pausedWorkingDays`, `pausedSince`, and on completion `completedAt`,
`actualWorkingDays`, `slaMet`. Remaining/elapsed/overdue are derived on read.
Extensions never overwrite the original due date; each is an immutable
`recruitmentExtensions` row. A hold pauses the clock (paused working days are
recorded separately from extensions).

## 6. Legacy migration

`server/hr/recruitment/migration.js`, run at boot and after every recruitment
workbook upload. Key: `sha256(org | normalised role | activeDate | location |
sequence-if-no-date)` → id `rrq-legacy-<hash>`, written with
`createIfAbsent`, so a restart or a re-upload never duplicates a job, and an
imported job is **never overwritten** from Excel again — differences surface
in Settings → Reconciliation instead.

Mapping: `active → hiring`, `hold → on_hold`, `done → completed` (no completion
date is invented). Priority comes from the declared hiring period
(≤15 critical, ≤30 required, ≤60 planned; blank → unclassified). Classification
is derived from the title only when unambiguous. Assignees resolve to employee
codes only by a unique first-name match inside the HR department. No approval
history is invented: the workbook's own "Validation" value is shown as
*legacy validation*, not as a Qodo approval.

## 7. Odoo

Qodo owns request, approval, assignment, SLA, extensions, capacity, KPI,
rewards and audit. Odoo owns candidates, the recruitment job, stages and the
pipeline. The conservative matcher in `server/hrRecruitmentOdoo.js` is kept
unchanged; a confident automatic match is a *suggestion* until HR confirms it,
and only a confirmed link feeds hires, the funnel and automatic KPI checks.
Pipeline counts are scoped to applicants created on/after the request's SLA
start. Funnel stages map by name (Settings → Odoo Integration).

### People, the org chart and time off

All Odoo access is read-only (`search_read`, `read_group`, `fields_get`) with
the key Railway injects; nothing in HR writes to Odoo.

* **Employee index** (`odooPeople.js`): every employee with code, e-mail,
  department, job, manager (`parent_id`), coach, leave approver, work phone
  and type, plus the department tree with each department's manager. Cached;
  pages wait at most ~2.5 s for it and otherwise render without Odoo.
* **Join** to the HR file: `registration_number` (normalised by
  `comparableCode`) first, then work e-mail, then a unique full English name.
  A code shared by two Odoo records prefers the unique active one (rehires).
* **Odoo-only people** are addressed by their registration number, or
  `o<odoo id>` when they have none. `GET /hr/employees/:code` falls back to an
  Odoo-only profile (needs `hr.view`, or the person being in the caller's
  team — see §11); HR-file sections stay hidden on it.
* **Photos**: after the index loads, active employees' `image_128` is fetched
  in the background in batches of 40, so `knownPhoto(id)` answers
  has / has not / not yet known. A photo URL is only handed out when the photo
  is not known to be missing. `?size=512` serves `image_512` (≤ 1 MB) for a
  profile hero. Anyone may load their own photo; staff keys load anyone's.
* **Org chart**: `GET /hr/organization` adds `odoo.people` (every active
  employee with `parentId`) and `odoo.departments`; the page opens on this
  live chart and keeps the structure workbook as a tab.
* **Time off** (`odooTimeOff.js`, 5-minute cache): leaves overlapping the
  year, validated/confirmed allocations still in force, and types with Odoo's
  colour. `awayOn(day)` splits people out today into *absent* and *away*.
  HR and Personnel viewers see everyone; anyone else only themselves. Leave
  descriptions (`name`, `private_name`) are never read.

### Published jobs and the recruiter cards

`recruitment/odooJobs.js` reads the active, published `hr.job` rows of
Egypt - Engoaad (company 2) with their owner (`user_id`), and the employee
behind each owner for the HR code. It only reads Odoo; `desk.js` joins it to
Qodo's own picture, and neither replaces the other:

* A recruiter card always shows Qodo's side — flags (overdue, over or at a
  limit, pending approval), the capacity bars, month, SLA, KPI and reward
  progress — and adds one violet line for what Odoo publishes under that
  person. The card opens a drawer with their jobs, where priority, deadline
  and assignment can be changed in place (the request page's own dialogs),
  then their published Odoo jobs.
* Owning a published job puts an active HR-file employee on the desk (team
  reason `odoo_jobs`); the team manager (code 389) is included with no job.
  Settings → Recruitment team can still exclude anyone.
* Each Odoo job carries the Qodo request confirmed against it (`odoo-link`).
  The request is where the deadline and every edit live; a job without one
  is not timed yet. `ownerCode` is null when the Odoo owner is not on the
  desk here.
* Pages never wait on this read after the first one: `publishedJobsSnapshot`
  serves the last copy and refreshes behind it (90 s). `?refresh=1` on
  `GET /hr/recruitment/odoo/jobs` re-reads now and reports a failure.

The Overview, Active Hiring and Team Capacity pages are Qodo's desk and must
not be replaced by the Odoo list — it has its own tab.

### The desk follows Odoo, and requests are approved in Qodo (owner, 2026-10-05)

Two decisions, taken the same day and in this order:

1. The recruitment workbook is over. The desk shows what Odoo publishes for
   Egypt - Engoaad; workbook rows are archived (`not_from_odoo`), never
   deleted.
2. The request flow of the original brief stays as written: a manager asks
   for a hire → the department manager reviews → the final approver approves
   → work starts and the clock is counted **from the approval day**.

`recruitment/odooSync.js` reconciles the two. A published job has exactly one
request on the desk:

* **The approved Qodo request HR confirmed against it** (`odoo-link`), when
  there is one. It is Qodo's in full — recruiter (with the capacity check),
  priority, the clock from approval — and the sync changes none of it. It
  speaks for the job while `hiring`, `on_hold` or `completed`, so a filled job
  that stays published does not come back as new work.
* **Failing that, a request the sync keeps for it** (`source: 'odoo'`,
  reference `ODOO-<job id>`, status `hiring`): somebody published a job
  without going through the request flow. It still has to be worked and
  timed, so it takes Odoo's owner (when that person is an active HR-file
  employee), title, department, seats and salary figures, and Odoo's
  schedule — HR keeps `active_date` and `hiring_period` (15 / 30 / 45 / 60)
  on `hr.job`. The clock starts on the Active Date and runs that many
  *working* days (the classification table counts neither Friday nor
  Saturday); the period names the priority (15 Critical, 30 Required, 45 and
  60 Planned). Reassigning and linking are off for it: Odoo decides. The
  screens mark it "no approved request".

Moving between the two: when an approved request is linked to a job, the
kept request is archived (`replaced_by_approved_request`); if the link is
removed it comes back. A kept request whose job is unpublished is archived
(`odoo_unpublished`) and restored, clock and history intact, when the job is
published again; one completed in Qodo stays as history.

Requests made in Qodo are never archived by the sync, at any stage. One
approved and not yet published is on its recruiter's desk with its clock
running, marked "not published in Odoo" (the existing `odoo_unlinked` alert
and KPI check cover it).

Details that bit once:

* The schedule fields are Engosoft's, not stock Odoo — read through
  `existingFields`. Always run `fields_get` on a customised model before
  deciding a field does not exist.
* Last writer wins for a kept request: `request.odoo` remembers the Active
  Date and period Qodo last saw, and the schedule is re-applied only when
  Odoo's own values move, so a priority or deadline changed in Qodo stands
  until then. Extensions and holds are kept on top of Odoo's dates.
  `odoo.scheduleRule` names how a period becomes a due date (it was calendar
  days for one deploy); a rule change re-dates once, unless the priority was
  set by hand.
* A job with no Hiring Period arrives with no priority and no clock; its
  first priority set in Qodo needs no reason and dates the clock from
  `odoo.firstSeen`.
* `request.odoo` and `salaryRange` are compared canonically (sorted keys): a
  jsonb column returns keys in its own order, and a plain `JSON.stringify`
  comparison would rewrite every job on every tick.
* The sync runs at boot (not awaited), on every recruitment clock tick (10
  min), on "Refresh from Odoo", and right after a link change or an approval
  of a linked request. It never acts on a failed or empty read.
* `recruitmentSourceIsOdoo()` is Odoo configured and `HR_RECRUITMENT_SOURCE`
  not `manual`. While on, the workbook import creates nothing, the workbook
  snapshot cannot be applied, and restoring a workbook row or an unpublished
  Odoo job answers `409 recruitment_source_is_odoo`.

## 8. Capacity

Per recruiter, counting `hiring` + `on_hold` jobs (configurable): Critical ≤ 2,
Required ≤ 5, Planned unlimited. Checked server-side on assignment, priority
change, final approval and resume. Exceeding answers
`409 recruitment_capacity_exceeded` with the full capacity picture; an override
needs `hr.recruitment.override_capacity` and a reason, and is audited.

## 9. KPI (100 = 30 / 30 / 20 / 20)

HR Review Quality 30 · Hiring Target/SLA 30 · Commitment & Discipline 20 ·
System & Process Quality 20. Deduction categories start at their weight and
lose the configured points per violation, floored at 0. Hiring Target is
computed: `30 × on-time ÷ evaluated`, where a job is evaluated in the month its
SLA outcome is decided (closed, or fell due). Unmeasured categories are
excluded rather than read as zero. Automatic System-Quality checks are
de-duplicated by `(rule, request, applicant)`. Nothing about appearance or a
protected attribute is automated; the optional presentation rule is manual,
job-defined and needs written reasoning.

The automatic checks read Odoo for requests approved in Qodo and — the
owner's decision, 2026-10-05 — for jobs kept from Odoo's board, from the day
their clock started (`automaticChecksApply`); a kept job with no clock is
skipped, and workbook rows are never checked. The team was told once, on a
day the checks had already run, so the rule arrived before the first
deduction; each day's findings are sent to the recruiter concerned and to the
desk and KPI reviewers, who can void a wrong one.

## 10. Rewards

Versioned rules: `jobsPerBatch` (3), grouping (per category by default),
eligibility toggles (completed, within SLA, no quality deductions), and
categories matched by classification and location with a min–max amount. A
job counts once: batches store their exact job ids and a job already in a
non-cancelled batch is never eligible again.

The table names five kinds of job. Any other kind (no classification, or one
with no line — a Video Editor, an Instructional Designer) is paid on the
Agent line, `fallbackCategoryId` (owner, 2026-10-05). A kind the table prices
only per location — an instructor with no country — is not: it stays without
a line until the location is set, rather than being quietly underpaid.

## 11. Permissions

New keys: `hr.recruitment.view|request|review|approve|assign|extend|
override_capacity|kpi.review|rewards.manage`, `hr.personnel.view|manage`,
`hr.performance.review`, `hr.settings.manage`. Frozen permission arrays that
predate them keep working: `hr.view` implies the view keys and `hr.manage` the
operational ones. The approve, extend, override, review, rewards and settings
keys are never derived — they are granted one person at a time (and held by
administrators, who hold every key). UI hiding is never the check: every
endpoint re-checks.

`hr.people.team` opens People for a manager's own team only: everyone below
them in Odoo's manager tree (`parent_id`, every level, active employees only;
`server/hr/teamReach.js`). The manager is found through their account's HR
link, else the one active Odoo employee whose work e-mail is their login; no
match means no team, never everyone. The directory, the profile (in full, pay
included, by the owner's decision), its Odoo panel and the photo all re-check
the tree. `hr.view` reads everyone and makes the key moot. Granted one person
at a time.

## 12. Personnel

A case (`personnelRequests`) is one piece of personnel work about one person:
onboarding, leave, clearance, salary increase, documents, insurance or a
general request. Onboarding and clearance copy their checklist from Settings
when opened; every item names its owner — Personnel, the manager or IT — and
only that owner (or `hr.personnel.manage`) can tick it. Salary increases and
insurance operations are payroll data: creating, reading and counting them
needs `hr.payroll`.

* **Handoff.** Completing a recruitment request opens one onboarding case per
  accepted hire, with deterministic ids (`stableId('prq-onb', org, request,
  index)`), so completing, reopening and completing again never opens a hire
  twice. Personnel, the requesting manager and IT are notified.
* **New Employee Form.** A 256-bit token, stored only as a SHA-256 hash, shown
  once, valid 14 days, one submission. Creating a new link revokes the
  previous unsubmitted one. The single submission is enforced by inserting a
  receipt with a fixed id (`createIfAbsent`), so of two racing submissions
  exactly one lands. Unknown, expired, revoked and used links answer the same
  404. The public route is throttled per address and `Cache-Control:
  no-store`; the bank account is masked for readers without `hr.payroll`.
* **Leave.** `GET /api/hr/personnel/leave` returns the leave workbook's
  balances — everyone for HR and Personnel viewers, only their own row for
  anyone else — beside leave cases, and `odoo`: live Odoo time off with the
  same visibility (who is out today, pending approvals, requests and
  allocations). The Leave page leads with the Odoo view.

## 13. Performance

One view joined on the employee code: the latest approved KPI scorecard
(`kpiScorecards`), the recruitment KPI for team members, the month's task
scores, and the quarterly review. A review stores the criteria it was
started with, so editing the criteria in Settings never rescores a past
quarter; finalising needs every criterion scored, and nobody reviews
themselves. The KPI scorecard desk is embedded as a tab. Anyone linked to an
HR record sees their own row and their own scorecards.

## 14. Reports

Every report answers `{ headline, columns, rows }`. Each headline carries the
filter that produces its rows (`shared/hrReportFilter.js`: `eq`, `in`, `gte`,
`lt`, `prefix`, `present`); the server counts headlines with that function
and the page filters rows with it, so "7 missed" always opens seven rows. The
shared filters — date range, employee, department, job, recruiter — narrow
every report; views export to CSV (UTF-8 with BOM, raw numbers and ISO
dates).

## 15. Alerts and notifications

Alerts are derived on read (`shared/recruitment/alerts.js`) from requests,
capacity and reward batches — never stored — so they cannot go stale. The
recruitment clock (every 10 minutes) syncs reward batches, notifies new
alerts once through a ledger (critical ones repeat every two working days)
and runs the automatic KPI checks once a day. The first run for an
organization records the alerts already open as a silent baseline, so going
live does not push a burst of known problems — they stay in the in-app alert
centre — and automatic KPI checks judge only requests created in Qodo, never
migrated workbook jobs. In the browser, HR polls alerts
every 90 seconds, pops at most two new critical/warning alerts as toasts and
keeps the rest in the alert drawer; the workspace notification centre shows
the same events as "Recruitment" and "Personnel" families.

## 16. Settings and audit

One revisioned settings document per organization; a save carries the
revision it started from and a stale one answers `409`. The resolved result
is validated whole, so a patch can never leave another section invalid.
Reward rules are versioned documents with fixed ids — concurrent saves
conflict instead of overwriting. Settings changes, reward-rule versions and
manual migration runs are written to the activity log and appear in Settings
→ Audit beside approvals, assignments (and capacity overrides), extensions
and KPI deductions. Reading Settings needs `hr.manage` or
`hr.settings.manage`; changing it needs `hr.settings.manage`.

## 17. API (all under `/api`)

| Area | Endpoints |
| --- | --- |
| Shell | `GET /hr/access` · `GET /hr/overview` |
| People | `GET /hr/people` · `GET /hr/people/:code/photo[?size=512]` · `GET /hr/employees/:code` (falls back to Odoo-only) · `GET /hr/employees/:code/odoo` (manager, reports, time off) · `PATCH /hr/employees/:code/:section` · `PUT /hr/employees/:code/link` |
| Recruitment | `GET /hr/recruitment/overview · team · summary · alerts · capacity · capacity/check` · `GET·POST /hr/recruitment/requests` · `GET·PATCH /hr/recruitment/requests/:id` · `POST …/:id/submit · review · approve · assign · priority · extend · hold · resume · cancel · accepted` · `GET …/:id/odoo` · `PUT …/:id/odoo-link` · `GET /hr/recruitment/odoo · odoo/jobs · odoo/pipelines` · `GET /hr/recruitment/kpi[/:code]` · `POST /hr/recruitment/kpi/events` · `POST …/kpi/events/:id/void` · `GET /hr/recruitment/rewards` · `POST …/rewards/batches/:id/decision` |
| Personnel | `GET·POST /hr/personnel` · `GET /hr/personnel/leave` · `GET·PATCH /hr/personnel/:id` · `POST /hr/personnel/:id/checklist/:itemId` · `POST /hr/personnel/:id/form` |
| Public form | `GET·POST /hr-forms/:token` |
| Payroll | `GET /hr/payroll` (`hr.payroll`) |
| Performance | `GET /hr/performance` · `GET·PUT /hr/performance/reviews/:code/:quarter` |
| Organization | `GET /hr/organization` |
| Reports | `GET /hr/reports` · `GET /hr/reports/:id` |
| Settings | `GET·PATCH /hr/settings` · `POST /hr/settings/reward-rules` · `POST /hr/settings/migration` · `GET /hr/settings/reconciliation` · `GET /hr/settings/audit` |
| Imports | `GET /hr/imports` · `POST /hr/imports/:source` · `POST /hr/telegram` |

## 18. Interface conventions

* **Glass on colour.** HR sits on a soft aurora background under
  `body.hr-theme`; sheets are frosted glass (`.hr-glass`). Each area has its
  own two-stop gradient (`ui/theme.ts` `AREA_THEME`: home indigo, recruitment
  violet, people sky, personnel emerald, payroll amber, performance rose,
  organization blue, reports purple, settings slate) set as `--hr-a1` /
  `--hr-a2` RGB triplets on `<body>`, so portaled dialogs inherit it. The
  sidebar chip, the page hero, primary buttons, the active tab and neutral
  metric icons all take it. Status colours stay semantic on top — red
  critical/overdue, amber required/warning, blue planned/info, green success.
* Every page opens on a hero (`PageHeader`) in its area gradient, with real
  faces (`faces`) and frosted figures (`stats`) where they help. Controls on
  a hero must set their own text colour; the hero's text is white.
* In-page tabs are `PillTabs`: a glass rail with a gradient marker that glides
  between tabs (`layoutId`), optional counts, and `wrap` for long sets.
* Metrics carry a gradient icon chip (`Metric icon={…}`); labels wrap to two
  lines rather than truncate.
* Real photos (Odoo `image_128`/`image_512`), then initials in a colour picked
  from the name; never a generated face.
* Names, job titles and department names from the data carry `hr-bidi`, so a
  Latin name in the Arabic layout truncates at its own end ("Hassan Omar F…").
  Never put it on an Arabic UI label that opens with a Latin word ("KPI
  التوظيف"), which must keep the page's direction.
* Motion stays in the 180–320 ms band and collapses under reduced motion.
  Page changes animate on enter only: an exit phase (`AnimatePresence
  mode="wait"`) can leave the old page parked at opacity 0 when a second
  navigation lands mid-exit.
* Every responsive grid has a `grid-cols-1` base (`minmax(0, 1fr)`), so a wide
  table inside a single-column grid scrolls in its card instead of widening
  the page. Tables become stacked cards below `md`.
* Arabic keeps Latin digits (`-u-nu-latn`); amounts in a Latin currency are
  isolated as one left-to-right run so "US$ 5,351" never reorders.
