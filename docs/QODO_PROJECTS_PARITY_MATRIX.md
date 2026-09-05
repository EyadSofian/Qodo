# Qodo Projects — Zoho Projects Parity Matrix

Live audit date: **2026-09-05**
Reference product: **Zoho Projects "Infinity"** (the April 2026 release; the current
shipping generation, not the pre-Infinity product most third-party write-ups describe).

This file is the contract for the Qodo Projects build. It is the answer to
"is this done?", and it is deliberately not a wish list: a row moves to
**Verified** only when the feature persists real data, enforces authorization on
the server, renders in Arabic and English, survives a refresh, and is covered by
an automated test. See §Status vocabulary.

---

## 1. How this audit was performed

| Source | What it gave us | Limits |
| --- | --- | --- |
| `zoho.com/projects` feature catalogue (full list, ar + en) | The complete shipping feature inventory across 11 categories | Marketing copy — names features, not field-level behaviour |
| `help.zoho.com` Zoho Projects Knowledge Base | The real information architecture: 19 top-level sections, and the Settings tree (12 sections / 132 articles) that is the customization surface | Article bodies are behavioural, screenshots are version-dated |
| Zoho Projects "What's New" changelog | Dated release history 2023 → July 2026 — this is what caught **Infinity**, **CodeX Scripts**, **Timesheets v2**, **Permission Sets**, **Summary Field**, **Layout Rules** and **AI Hub** | Changelog entries are one line each |
| Zoho blog: *Zoho Projects Infinity* | Custom modules, custom reports, custom dashboards, AI Hub, MCP | Vendor framing |

**Not used: a live authenticated Zoho tenant.** Creating an account on a
third-party service is outside what this workstation may do on the user's
behalf, so no Zoho session was opened. Every row below is grounded in the
vendor's own current documentation rather than in a screen recording of the app.
Where that leaves a behavioural gap — exact spacing, exact hover affordance —
the row says so, and `QODO_PROJECTS_UI_DIFFERENCES.md` carries the deliberate
divergences.

### 1.1 What the audit changed versus the original brief

The brief was written against an earlier generation of Zoho Projects. Six things
have moved, and the plan follows the live product, not the brief:

1. **Zoho Projects Infinity (Apr 2026)** reorganised the product around
   *custom modules, custom reports, custom dashboards*. Custom modules are no
   longer a niche add-on — they are the headline. Our metadata-driven module
   framework therefore moves **earlier**, into Phase 1's data model, instead of
   sitting in Phase 7 as the brief sequenced it. Retrofitting a metadata engine
   onto eight hardcoded modules is the single most expensive mistake available
   here.
2. **"Custom Functions" is now "CodeX Scripts"** — JavaScript, not Deluge, with
   a published JS SDK and a metered credit model. The brief's "do not introduce
   unsafe arbitrary server-side code execution" instinct is right and matches
   where Zoho landed; §29's Qodo equivalent is a sandboxed, versioned, quota'd
   script runner.
3. **"Profiles" is now "Permission Sets"** (May 2025 UI revamp).
4. **Timesheets were rebuilt (Nov 2025)** as a *collection of time logs grouped
   for review*, which is exactly the draft → submit → approve object the brief
   describes. Good — the brief and the product agree.
5. **AI is an "AI Hub" with pluggable providers** (Zia, ChatGPT, Gemini), plus a
   real **MCP** server. This validates the brief's provider-abstraction rule and
   raises MCP from "where useful" to table stakes.
6. **"Client Company" is now "Customers"**, and can be an individual or a
   business.

New since the brief was written, and therefore added to this matrix as rows the
brief never mentioned: Layout Rules, Summary Field, Connect Module Field, User
Custom Fields, Task Groups, Comment Reactions, Report Folders, Time Log Grid
View, User Automation, Macro Rules, WhatsApp notification actions, Automation
Credits, Colour Coding, User-Based Calendars, Scheduled Exports, Voice Notes.

---

## 2. Status vocabulary

| Status | Means |
| --- | --- |
| **Not Started** | No code. |
| **Foundation Exists** | Qodo already has something real to build on (named in the row), but nothing Projects-specific. |
| **In Progress** | Being built now; not yet end-to-end. |
| **Implemented** | Persists, authorizes server-side, renders ar/en + RTL/LTR, survives refresh. |
| **Verified** | Implemented **and** covered by an automated test that would fail if it regressed. |

Parity status uses the same scale but answers a different question:
*implementation status* is "does our code work", *parity status* is "does it do
what Zoho does". A feature can be **Implemented** with parity **In Progress**
when we ship a deliberately narrower version — those are cross-referenced to
`QODO_PROJECTS_UI_DIFFERENCES.md`.

---

## 3. What Qodo already has (the honest starting line)

Audited from the repository at commit `0e0a426`, ~61k LOC.

| Existing Qodo asset | Location | What Projects inherits |
| --- | --- | --- |
| Session auth, bcrypt, HttpOnly cookie | `server/auth.js` | Identity. No new auth. |
| Permission catalogue + roles + visibility scopes | `shared/permissions.js` | The enforcement *pattern*; Projects adds ~50 keys. |
| Resource-policy layer | `server/taskAccess.js` | The `canViewX / canEditX / livePredicate` idiom to copy per entity. |
| Task lifecycle state machine | `shared/workflow.js` (480 ln) | assign → accept/decline → work → submit → review → rework → approve → score. **Kept**, mapped onto project tasks. |
| Document store, two backends | `server/store.js` | JSON file (dev) / Postgres `documents` jsonb + `blobs` bytea (prod). **Insufficient for Projects at scale — see §4.** |
| Blob half | `store.js` `putBlob/getBlob` | Document storage foundation; needs private signed access. |
| Organization scoping | `shared/organization.js` | Multi-tenant boundary already threaded through. |
| Notifications + push + SSE stream | `server/notificationStream.js`, `push.js` | Projects events plug in. |
| Global search `Ctrl/Cmd+K` | `server/routes/search.js`, `SearchPalette.tsx` | Add project entity sources. |
| Qodo Assistant + tool layer | `server/assistant/tools.js` (8 tools) | Add project tools. Already provider-abstracted (`@anthropic-ai/sdk` + `openai`). |
| Qodo Mail (conversations/messages/memberships) | `server/routes/mail.js` | **Reuse for project discussion** rather than build a second chat. |
| Qodo Calendar (events + per-person invites) | `server/routes/calendar.js` | **Reuse for project calendar.** |
| Qodo HR (leave, working data, KPI) | `server/hrModule.js`, `shared/kpi.js` | Resource capacity inputs. |
| i18n ar/en with RTL | `src/lib/i18n.tsx` (1288 ln, flat `STRINGS`) | Every Projects string goes through it. **Needs splitting — see ADR-7.** |
| Brand tokens | `tailwind.config.js` | navy `#0B2545`, brand `#1D6FB8`, accent `#F5821F`. |
| Activity log | `activity` collection via `logActivity()` | **Mutable and thin — replaced for Projects by an append-only audit, §64.** |
| Scheduler | `server/scheduler.js` | Recurrence, reminders, SLA clocks. |
| Integration adapters | `server/odoo.js` | The connector pattern to generalise. |

Three findings that shape the whole plan:

- **`server/routes/tasks.js` is 2051 lines.** It is the thing §72 and §83 warn
  against. Projects must not add to it; it gets domain services under
  `server/projects/`.
- **Every store read is `SELECT * FROM documents WHERE collection = $1`,
  filtered in JavaScript** (`store.js` `find()`). At workspace scale that was
  the right call and the file says so. At *projects* scale — §73 asks for
  hundreds of thousands of tasks — it is a full-collection scan per request.
  This is the reason ADR-2 exists.
- **The `activity` collection is written through `store.update`**, so history is
  mutable. §64 requires append-only. Projects gets its own `auditEvents`.

---

## 4. The matrix

Legend for the two rightmost columns: **Impl** = implementation status,
**Parity** = behavioural parity with Zoho.

### 4.1 Portal / global experience

| Zoho feature | Zoho location | Observed behavior | Key fields / actions | Qodo equivalent | Backend | Frontend | Permission | Test | Impl | Parity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Portal | Top-level tenant container | One org owns projects, users, settings | name, domain, business hours, currency | Existing `organizations` + Projects settings doc | reuse `organizations`; add `projectSettings` | Settings → Projects section | `settings.manage` | org isolation | Implemented | In Progress |
| Projects list view | Left nav → Projects | Table w/ inline edit, column add/hide via right-click, filters, sort, export XLSX/CSV | status, tasks done, start/end, planned vs actual cost, budget, hours remaining, cost variance | `/projects` list | `GET /api/projects` paged+filtered in SQL | `pages/projects/ProjectsList.tsx` | `project.view` | pagination, filter, isolation | Verified | In Progress |
| Project views (All / Archived / Trashed) | Projects dropdown | Archived and Trashed are separate scopes; trash recoverable 60 days (raised from 30 in Nov 2025) | restore, permanent delete | Same three scopes + Favorites/Recent/My | `scope` query param; `deletedAt` soft delete | segmented control | `project.view` / `project.delete` | restore/purge tests | Verified | Implemented |
| Project groups | Projects → Groups | Named grouping of projects | name, projects, order | `projectGroups` | CRUD + reorder | group chips + sidebar | `project.manage_groups` | — | Foundation Exists | Not Started |
| Customers (was Client Company) | Portal → Customers | Individual **or** Business; owns client users | type, name, contacts, projects | `projectCustomers` | CRUD | Customers page | `client.manage` | client isolation | Foundation Exists | Not Started |
| Portfolio dashboard | Projects → Dashboard | Cross-project status, ownership, customer, budget health | at-risk, delayed, progress, budget | `/projects/portfolio` | aggregate endpoint | portfolio widgets | `reports.portfolio` | math tests | Verified | Implemented |
| Global Add | Top bar `+` | Quick-create user/task/issue/event/document from anywhere | entity picker → mini form | Qodo Shell `+` | reuse per-entity POST | `GlobalAdd.tsx` in `Shell` | per-entity create keys | permission-filtered menu | Not Started | Not Started |
| Global search | Top bar | Searches across portal entities | — | Existing `Ctrl/Cmd+K` | extend `routes/search.js` | existing `SearchPalette` | permission-filtered | leakage test | Implemented | Implemented |
| Recycle bin | Settings → Data Administration | 60-day retention, restore, purge | entity, deletedBy, deletedAt | `recycleBin` view over `deletedAt` | soft-delete everywhere | Recycle Bin page | `recyclebin.view/purge` | restore cascade | Verified | In Progress |
| Export portal data | Settings → Data Administration | Full-tenant export | format, scope | `/api/projects/export` | streamed, audited | Settings → Export | `data.export` | CSV-injection test | Verified | Implemented |
| Business hours | Settings → Business Hours | Portal calendar + **user-based calendars** (Jul 2025) for regional teams | workdays, hours, holidays, per-user override | `workCalendars` | calendar service | Settings → Calendars | `settings.manage` | working-day math | Implemented | In Progress |
| Sandbox | Settings → Sandbox | Safe environment to test configuration before publishing | draft config, publish | Versioned draft/publish config (ADR-9) | `configVersions` | Sandbox page | `customization.manage` | publish/rollback | Foundation Exists | In Progress |
| Custom domain | Settings → Portal Config | Portal on customer domain | domain | Out of scope — Qodo is single-tenant on Railway | — | — | — | — | Not Started | N/A — documented difference |

### 4.2 Projects

| Zoho feature | Zoho location | Observed behavior | Key fields / actions | Qodo equivalent | Backend | Frontend | Permission | Test | Impl | Parity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Create project | Projects → New | Form incl. template, group, customer, access | name, id/prefix, description, owner, customer, group, template, start/end, status, access, currency, billing, budget, tags, layout, custom fields, calendar, members | `POST /api/projects` | `projectService.create` in a txn | `ProjectCreateDialog` | `project.create` | create+isolation | Verified | In Progress |
| Project operations | Project → ⋮ | clone, move group, favourite, follow, archive, unarchive, trash, restore, delete, template-from-project, copy link, export | — | Same | one endpoint each, all audited | row/detail menus | per-op keys | archive/restore | Verified | In Progress |
| Project dashboard | Project → Dashboard | Budget, task/issue status, overdue, team status widgets | widget set | `/projects/:id/dashboard` | widget data endpoints | widget grid | `project.view` | — | Implemented | In Progress |
| Project layouts & fields | Settings → Customization | Per-layout section/field config for **Project** | sections, fields, required, order | Metadata layouts (ADR-4) | `layouts` + `customFields` | layout editor | `customization.manage` | layout enforcement | Implemented | In Progress |
| Project layout rules | Settings → Customization → Layout Rules | *New 2026* — conditional field behaviour | condition → show/hide/require | Same engine, all modules | rule evaluation server-side | rule builder | `customization.manage` | rule eval | Foundation Exists | Not Started |
| Project templates | Projects → Templates | Template incl. hierarchy + relative dates | phases, task lists, tasks, durations | `projectTemplates` | instantiate w/ relative-date math | Templates page | `template.manage` | relative-date math | Not Started | Not Started |
| Project automation | Settings → Automation | Workflow rules on the project module | trigger/criteria/action | Shared automation engine | `automationService` | rule builder | `automation.manage` | execution + idempotency | Verified | Implemented |
| Project status (custom) | Settings → Customization | Custom project statuses | id, label, colour, category, order, active | `statuses` metadata | status service | status editor | `customization.manage` | retire-without-breaking | Verified | Implemented |
| Colour coding | Project/phase/list/task | *Jul 2025* — user-set colours | colour | `color` field on 4 entities | field | picker | edit key | — | Implemented | Implemented |
| Pages (wiki) | Project → Pages | Rich pages w/ hierarchy + revisions | title, body, parent, version | `projectPages` + `pageRevisions` | CRUD + revisions | editor | `page.*` | revision restore | Verified | Implemented |

### 4.3 Work breakdown — phases, task lists, tasks

| Zoho feature | Zoho location | Observed behavior | Key fields / actions | Qodo equivalent | Backend | Frontend | Permission | Test | Impl | Parity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| WBS hierarchy | Project | Project → Phase → Task List → Task → Subtask → Checklist | — | Same 6 levels | FK chain, depth guard | tree UI | inherited | depth + cycle | Verified | Implemented |
| Phases (milestones) | Project → Phases | internal/external, owner, dates, status, sequence, rollups | + custom fields, layout, tags, comments, files, activity | `phases` | `phaseService` | Phases list + Gantt | `phase.*` | rollup math | Verified | In Progress |
| Phase layout rules | Settings → Customization | *New 2026* | condition → field behaviour | Shared rule engine | — | — | `customization.manage` | — | Foundation Exists | Not Started |
| Phase automation | Settings → Automation | 8 articles — full rule surface on phases | — | Shared engine | — | — | `automation.manage` | — | Implemented | In Progress |
| Task lists | Project → Task Lists | internal/external visibility, billing type, order, clone, move, template | name, phase, description, dates | `taskLists` | `taskListService` | list header | `tasklist.*` | **client cannot see internal** | Verified | Implemented |
| Tasks | Project → Tasks | Full PM task | ~40 fields (see §13 of brief) | Extend existing Qodo task | `projectTaskExtensions` + `tasks` | Task detail | `task.*` | workflow + isolation | Verified | In Progress |
| Qodo review lifecycle | *Qodo-only* | assign → accept/decline/clarify → work → submit evidence → review → rework → approve → score | — | **Kept and mapped onto project tasks** | reuse `shared/workflow.js` | reuse `TaskWorkflow.tsx` | existing keys | existing suite must stay green | Verified | N/A — Qodo addition |
| Subtasks | Task detail | True hierarchy, rollups | parent, depth | `parentTaskId` | cycle prevention | nested rows | inherited | cycle test | Verified | Implemented |
| Checklists | Task detail | Items, required items block completion | text, done, required, order | `taskChecklists` | completion guard | checklist | task edit | **blocks completion** | Verified | Implemented |
| Task groups | Tasks view | *Aug 2025* — group by any field | groupBy | `groupBy` param | server grouping | group headers | `task.view` | — | Not Started | Not Started |
| Task views | Tasks | Classic, Plain, Kanban, Gantt, Calendar, Timeline | — | + My Work, Review Queue, Approval Queue | view-specific endpoints | one page, view switcher | `task.view` | per view | Implemented | In Progress |
| Kanban | Tasks → Kanban | Drag between status columns | card fields configurable | Same | **server revalidates every transition** | dnd board | `task.edit_status` | **drag cannot bypass workflow** | Implemented | In Progress |
| Custom views | Any module | Saved filters/sort/group/columns, sharing, cloning, **relative date ranges** (May 2025) | criteria AND/OR, visibility | `customViews` | criteria → SQL | view builder | `view.manage` | criteria eval | Foundation Exists | Not Started |
| Dependencies | Gantt / task | FS, SS, FF, SF | predecessor, successor, lag | `taskDependencies` | **cycle detection** | Gantt connectors | `task.edit_schedule` | cycle + cascade | Verified | Implemented |
| Gantt | Project → Gantt | Drag bars, resize, connectors, zoom, critical path, baseline, fullscreen, export | — | Same | schedule endpoints, all writes authorized | custom renderer (ADR-6) | `task.view` / `task.edit_schedule` | drag persists | Implemented | In Progress |
| Critical path | Gantt toggle | Highlights critical tasks | float/slack | CPM over dependency graph, working-day aware | `schedulingService` | highlight | `task.view` | CPM math | Verified | Implemented |
| Baselines | Project → Baseline | Capture immutable planned schedule; compare; separate create/edit/delete permissions (2024) | baseline set, variance | `projectBaselines` + `taskBaselines` | immutable rows | Gantt overlay | `baseline.create/edit/delete` | immutability | Verified | Implemented |
| Recurrence | Task | daily/weekly/monthly/yearly/custom | interval, weekdays, end date/count | Reuse `shared/hrRecurrence.js` pattern | scheduler, deterministic ids | recurrence form | `task.create` | **no duplicates on retry** | Foundation Exists | Not Started |
| Reminders | Task | Task/deadline reminders | when, channel | Reuse notifications | scheduler | reminder form | `task.edit` | dedupe | Foundation Exists | Not Started |
| Task templates | Settings → Customization | Reusable task definition | fields, checklist | `taskTemplates` | — | picker | `template.manage` | — | Not Started | Not Started |
| Lookup field | Settings → Special Fields | Task field referencing project module fields | target module, field | `lookup` custom-field type | resolve on read | reference picker | field perms | — | Foundation Exists | Not Started |
| Summary field | Settings → Special Fields | *Apr 2026* — sum/avg/min/max/count/unique over a related module | module, field, function | `summary` custom-field type | computed, not stored | read-only display | field perms | aggregation math | Foundation Exists | Not Started |
| Connect module field | Settings → Special Fields | *Dec 2025* — link records across modules | target module | `connect` custom-field type | join table | record picker | field perms | — | Foundation Exists | Not Started |

### 4.4 Issues

| Zoho feature | Zoho location | Observed behavior | Key fields / actions | Qodo equivalent | Backend | Frontend | Permission | Test | Impl | Parity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Issue tracker | Project → Issues | Separate module, linkable to tasks | id, title, description, reporter, assignee, followers, status, priority, severity, classification, reproducibility, module, affected/target milestone, due, resolution | `issues` | `issueService` | Issues module | `issue.*` | isolation | Verified | Implemented |
| Issue ↔ task links | Issue detail | Bidirectional link | linkType | `issueLinks` | — | link panel | `issue.edit` | — | Verified | Implemented |
| Issue custom statuses/layouts/fields | Settings → Issue Tracker | Full customization | — | Shared metadata engine | — | — | `customization.manage` | — | Implemented | In Progress |
| Issue layout rules | Settings → Customization | *Jul 2025* | — | Shared rule engine | — | — | `customization.manage` | — | Foundation Exists | Not Started |
| SLA | Settings → Issue Tracker | Escalation criteria + alerts, business-hours based | response/resolution targets, levels | `slaPolicies` + `slaClocks` | scheduler, working hours | SLA config | `sla.manage` | **breach + escalation** | Verified | Implemented |
| Business rules | Settings → Issue Tracker | Ordered rules; field updates, assignment, webhook, function, notify; stop-processing | order, criteria, actions | `businessRules` | ordered evaluation | rule builder | `automation.manage` | ordering + stop | Verified | Implemented |
| Issue reports | Reports | Basic + advanced | — | Report engine | — | — | `reports.view` | — | Verified | Implemented |

### 4.5 Time, budget, finance

| Zoho feature | Zoho location | Observed behavior | Key fields / actions | Qodo equivalent | Backend | Frontend | Permission | Test | Impl | Parity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Timers | Task/issue | Start/pause/resume/stop → creates a log | — | Global timer in Shell | **running-timer invariant** | timer chip | `time.log` | **concurrency** | Verified | Implemented |
| Time logs | Timesheet | Manual or timer; billable/non-billable | date, hours, notes, billable, rate | `timeEntries` | `timeService` | log form | `time.log` | validation | Verified | Implemented |
| Time log grid view | Timesheet | *Jul 2026* — unified grid across tasks/issues/members | inline edit | Grid view | bulk endpoint | grid | `time.view` | — | Implemented | In Progress |
| Time log restrictions | Settings | *Feb 2025* — logs must fall in task/issue timeframe | — | Validation rule | server guard | inline error | — | boundary test | Verified | Implemented |
| Time log field permissions | Settings | *May 2026* — field-level access on time logs | — | Field permission layer | server projection | hidden fields | `rate.view` | **rate leakage** | Verified | Implemented |
| Timesheets v2 | Timesheet | *Nov 2025* — logs grouped into a submittable sheet: draft → submit → approve/reject → recall | period, entries, status, approver | `timesheets` + `timesheetEntries` | approval hierarchy | weekly grid | `timesheet.submit/approve` | **approval + lock** | Verified | Implemented |
| Timesheet automation | Settings → Automation | Rules on timesheets | — | Shared engine | — | — | `automation.manage` | — | Implemented | In Progress |
| Time log automation | Settings → Automation | *2026* — 8 articles: workflow, time-based, custom fn, webhook, email, WhatsApp | — | Shared engine | — | — | `automation.manage` | — | Implemented | In Progress |
| Budget | Project → Budget | Types: project hours, staff hours, project amount, fixed cost, task hours, issue hours | budget, planned, actual, remaining, variance, threshold | `budgets` + `budgetAllocations` | `budgetService` | budget page | `budget.view/manage` | **budget math** | Verified | Implemented |
| Cost & billing rates | Settings / user | Per-user and per-project rates | costRate, billRate, currency | `costRates`, `billingRates` | **restricted projection** | rate editor | `rate.view` | **non-leakage** | Verified | Implemented |
| Planned vs actual cost | Reports | Real-time comparison | — | Report | aggregate | chart | `reports.finance` | math | Verified | Implemented |
| Budget forecast | Reports | Forecast total from % complete | — | Report | formula documented | chart | `reports.finance` | math | Verified | Implemented |
| Earned value management | Reports | PV, EV, AC, SV, CV, SPI, CPI | — | EVM service | **documented formulas; never invent inputs** | EVM panel | `reports.finance` | **EVM math** | Verified | Implemented |
| Invoicing | Books/Invoice integration | Invoice from approved billable time | invoice ref, status | Connector: Odoo first-party, others adapter | `financeConnector` | invoice panel | `billing.manage` | adapter contract | Foundation Exists | In Progress |
| Expenses | Project | Recorded against project | amount, category | `expenses` | — | — | `budget.manage` | — | Implemented | Implemented |

### 4.6 Resources & users

| Zoho feature | Zoho location | Observed behavior | Key fields / actions | Qodo equivalent | Backend | Frontend | Permission | Test | Impl | Parity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Permission Sets (was Profiles) | Settings → Profiles and Roles | *Revamped May 2025* — granular per-module, per-action, per-field | module × action grid | `permissionSets` | **deny by default** | permission grid | `permissions.manage` | **negative tests** | Verified | In Progress |
| Roles | Settings → Profiles and Roles | Identity + @mention target + hierarchy | name, parent | `projectRoles` | hierarchy | role editor | `permissions.manage` | hierarchy | Foundation Exists | Not Started |
| User hierarchy | Settings | Drives time-log access (Oct 2025) | reportsTo | Reuse Qodo org tree | — | — | — | access test | Foundation Exists | Not Started |
| Project members | Project → Users | Per-project membership + role | user, role, allocation % | `projectMembers` | **the core authorization join** | members panel | `project.manage_members` | **membership isolation** | Verified | Implemented |
| Client users | Portal → Users | Restricted external access | customer, projects, visibility | `clientUsers` | **server-side external-only filter** | client shell | `client.*` | **leakage suite** | Verified | In Progress |
| User layouts & fields | Settings → Customization | *2026* — custom fields on users, incl. invite form | — | Metadata engine on users | — | — | `customization.manage` | — | Foundation Exists | Not Started |
| Invitation templates | Settings → Customization | Custom invite subject/body | — | Extend existing `invites` | — | — | `users.manage` | — | Foundation Exists | Not Started |
| Resource utilisation / workload | Reports → Workload | Capacity vs assignment; reassign from the report (Jun 2025) | availability, allocation, over/under | `workloadService` using HR leave + calendars | **capacity ≠ task count** | workload timeline | `reports.resource` | **capacity math** | Verified | Implemented |
| User automation | Settings → Automation | *Nov 2025* — rules on portal users | — | Shared engine | — | — | `automation.manage` | — | Foundation Exists | Not Started |
| Import users | Settings → Import | From files / Office 365 | — | CSV + adapter | importer | wizard | `users.manage` | dry-run | Foundation Exists | Not Started |

### 4.7 Collaboration & documents

| Zoho feature | Zoho location | Observed behavior | Key fields / actions | Qodo equivalent | Backend | Frontend | Permission | Test | Impl | Parity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Feeds | Project → Feed | Interactive activity stream, comment + mention + attach inline | actor, entity, action | `activityFeed` projection over audit | feed endpoint | feed | `project.view` | permission-filtered | Implemented | In Progress |
| Comments | Any entity | Threads, edit/delete policy, **reactions** (Aug 2025), internal vs client-visible | body, parent, visibility, reactions | `comments` (polymorphic) | **internal never reaches client** | comment thread | `comment.*` | **internal-leak test** | Verified | Implemented |
| Mentions | Comments/feed/chat | @user, @role, @team | — | Reuse `shared/mentions.js` | notification fan-out | mention autocomplete | visibility-aware | mention perms | Verified | In Progress |
| Chat | Project → Chat | Personal + group rooms | — | **Reuse Qodo Mail conversations** (ADR-8) | project-scoped conversation | existing Mail UI, embedded | mail perms | — | Foundation Exists | Not Started |
| Forums | Project → Forums | Categories, topics, replies, follow, moderation, client visibility | — | `forumCategories`, `forumTopics`, `forumPosts` | CRUD + moderation | forum | `forum.*` | client visibility | Implemented | In Progress |
| Documents | Project → Documents | Folders, list/thumbnail/compact views, preview, **version control + history + restore** | name, folder, version, size, mime, visibility | `documentFiles` + `documentVersions` | **private signed URLs** (ADR-5) | doc browser | `document.*` | **signed-URL + MIME** | Verified | Implemented |
| Email alias | Settings | Create task/issue, comment, attach by email | — | Reuse Qodo Mail ingestion | alias router | settings | `project.edit` | parse + auth | Foundation Exists | Not Started |
| Voice notes | Mobile | *Aug 2025* — audio on tasks/issues | audio blob | Attachment kind `audio` | blob | recorder | attach key | — | Not Started | N/A — documented difference |

### 4.8 Automation

| Zoho feature | Zoho location | Observed behavior | Key fields / actions | Qodo equivalent | Backend | Frontend | Permission | Test | Impl | Parity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Blueprint | Settings → Automation | Visual state machine: who may move a record, required fields/comments, before/after actions | transitions, roles, validations, actions | `blueprints` + `blueprintVersions` | **API cannot bypass** | transition designer | `blueprint.manage` | **bypass-attempt test** | Verified | Implemented |
| Workflow rules | Settings → Automation | Per module (project/task/phase/issue/timesheet/user/time log); trigger + criteria + action | — | One engine, module-parameterised | `automationService` | rule builder | `automation.manage` | execution, retry, idempotency | Verified | Implemented |
| Time-based workflow rules | Settings → Automation | *2026* — date/time triggers | offset from date field | Scheduler-driven | — | — | `automation.manage` | scheduling | Implemented | In Progress |
| Macro rules | Settings → Automation | Manually-invoked batch of actions | actions | `macros` | — | run button | `automation.manage` | — | Foundation Exists | Not Started |
| Email alerts & templates | Settings → Automation | Templated email actions | template, recipients | `emailTemplates` | reuse nodemailer | template editor | `automation.manage` | — | Foundation Exists | Not Started |
| WhatsApp notifications | Settings → Automation | *May 2026* — approved templates to customers | template, recipient | Adapter, credential-gated | `whatsappConnector` | config | `automation.manage` | adapter contract | Foundation Exists | In Progress |
| Webhooks | Settings → Automation | URL, method, headers, secret, params, retries, delivery log | — | `webhookEndpoints` + `webhookDeliveries` | **HMAC signing, secret masked** | webhook page | `automation.manage` | **secret never returned** | Verified | Implemented |
| Automation credits | Settings → Automation | Metered execution | quota, used | `automationQuota` | counter | usage panel | `automation.manage` | quota exhaustion | Verified | Implemented |
| CodeX Scripts (was Custom Functions) | Settings → Developer Space | JavaScript, JS SDK, credits | script, version, inputs, outputs | Sandboxed runner (ADR-10) | **isolated, timeout, quota, audited** | script editor | `developer.manage` | **sandbox escape** | Not Started | Not Started |
| Extensions | Settings → Developer Space | Cloud editor, JS SDK | — | Out of scope this cycle | — | — | — | — | Not Started | N/A — documented difference |

### 4.9 Reports & dashboards

| Zoho feature | Zoho location | Observed behavior | Key fields / actions | Qodo equivalent | Backend | Frontend | Permission | Test | Impl | Parity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Task reports | Reports | Basic + advanced, cross-project | status, %, owner, priority | Report engine | aggregate SQL | report view | `reports.view` | math | Verified | Implemented |
| Issue reports | Reports | Basic + advanced | — | Same | — | — | `reports.view` | math | Verified | Implemented |
| Timesheet reports | Reports | Hours by user/task/billable | — | Same | — | — | `reports.time` | math | Verified | Implemented |
| Planned vs actual | Reports | Hours and cost | — | Same | — | — | `reports.view` | math | Verified | Implemented |
| Workload report | Reports | Capacity; reassign inline | — | See §4.6 | — | — | `reports.resource` | — | Verified | Implemented |
| Portal vs project level reports | Reports | Same report at two scopes | scope | `scope` param | — | scope switch | scope-aware | **cross-project leak** | Verified | Implemented |
| Custom reports | Reports → Custom | *Infinity* — module, axes, aggregation, grouping, filters, chart type; custom units/precision | — | Report builder | metadata-driven | builder UI | `reports.manage` | builder eval | Verified | In Progress |
| Report folders | Reports | *Oct 2025* — folders per module | — | `reportFolders` | — | tree | `reports.manage` | — | Foundation Exists | Not Started |
| Scheduled export | Reports / Tasks | *Apr 2025* — recurring export with view+format | schedule, format | Scheduler + export | — | schedule form | `data.export` | schedule | Foundation Exists | Not Started |
| Custom dashboards | Dashboards | *Infinity* — widget gallery, drag, resize, share, role-specific | widgets, layout, permissions | `dashboards` + `dashboardWidgets` | — | widget grid | `dashboard.*` | share perms | Verified | In Progress |
| Project dashboard | Project → Dashboard | Fixed widget set | — | See §4.2 | — | — | — | — | Implemented | In Progress |

### 4.10 AI

| Zoho feature | Zoho location | Observed behavior | Key fields / actions | Qodo equivalent | Backend | Frontend | Permission | Test | Impl | Parity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AI Hub | Settings → AI | *Infinity* — connect Zia / ChatGPT / Gemini; capabilities across the product | provider, key, enabled caps | Extend Qodo AI provider layer | `server/ai/` | AI settings | `settings.manage` | provider fallback | Implemented | In Progress |
| Task summary | Task detail | Summarise long description + comments | — | Assistant capability | grounded prompt | summary panel | entity read perm | **respects permissions** | Implemented | Implemented |
| AI task creation | Project | Suggest tasks from project details / NL | — | Same | **preview before write** | preview dialog | `task.create` | **no silent bulk write** | Implemented | Implemented |
| Zia insights | Dashboards/reports | Surface bottlenecks, anomalies, deadline risk | — | Insights service | **grounded in real rows; never fabricate** | insight cards | `reports.view` | **citation test** | Implemented | Implemented |
| Natural-language search | Global | Ask questions across project content | — | Extend Assistant | **same permission boundary as UI** | assistant | per-entity | **leakage test** | Verified | Implemented |
| Translation | Content | ar ↔ en | — | AI capability | — | translate action | read perm | — | Implemented | Implemented |
| MCP | Integrations | *Infinity* — bidirectional LLM access to files, work items, discussions | tools, resources | Qodo MCP layer | **acts as the authenticated user** | — | per-entity | **authorization under MCP** | Not Started | Not Started |
| Zia weekly time-log suggestions | Timesheet | *Jul 2026* — suggests time from assigned tasks + work hours | — | Suggestion service | grounded | suggest button | `time.log` | — | Not Started | Not Started |
| AI custom module creation | Settings | *Jun 2026* — build modules with AI | — | Metadata generator | **preview before publish** | — | `customization.manage` | — | Not Started | Not Started |
| Duplicate detection | Task/issue create | Similar-item detection | — | Similarity service | — | warning | create perm | — | Verified | Implemented |
| Voice input | Mobile | Speech to text | — | Browser SpeechRecognition | — | mic button | — | — | Not Started | Not Started |

### 4.11 Integrations & import/export

| Zoho feature | Zoho location | Observed behavior | Key fields / actions | Qodo equivalent | Backend | Frontend | Permission | Test | Impl | Parity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Connector framework | Marketplace | 50+ integrations behind one install/configure surface | connection, credentials, scopes | `integrationConnections` (ADR-11) | **secrets encrypted, never returned** | Integrations page | `integration.manage` | **secret masking** | Verified | Implemented |
| Qodo Mail | *Qodo-only* | — | — | First-party: chat, email-to-work | reuse | reuse | mail perms | — | Foundation Exists | N/A |
| Qodo Calendar | *Qodo-only* | — | — | First-party: project calendar | reuse | reuse | calendar perms | — | Foundation Exists | N/A |
| Qodo HR | *Qodo-only* | — | — | First-party: leave → capacity | reuse | — | hr perms | capacity | Foundation Exists | N/A |
| Odoo | *Qodo-only* | — | — | First-party: finance/invoice | existing `server/odoo.js` | — | — | adapter | Foundation Exists | N/A |
| Google (Calendar, Tasks, Sheets, Drive, Workspace, Gmail) | Marketplace | Sync / file link / SSO | — | Adapters, credential-gated | connector | — | `integration.manage` | contract | In Progress | In Progress |
| Microsoft (Excel, OneDrive, Outlook, 365, Teams) | Marketplace | Same | — | Adapters | connector | — | `integration.manage` | contract | In Progress | In Progress |
| Dev (GitHub, GitLab, Gitea, Bitbucket) | Marketplace | Repos + changesets | — | Adapters | connector | — | `integration.manage` | contract | In Progress | In Progress |
| Slack / Zapier / webhooks | Marketplace | Push updates | — | Webhook engine covers generic | — | — | `automation.manage` | — | Verified | Implemented |
| Import: XLS/CSV/JSON/MPP | Settings → Import | Upload → map → validate → dry run → execute → history | — | Import pipeline | **real parsers; never fake success** | wizard | `data.import` | **dry run + error report** | Verified | In Progress |
| Import: Jira | Settings → Import | Cloud API import | — | Adapter | — | wizard | `data.import` | contract | In Progress | Not Started |
| Import: Basecamp | Settings → Import | — | — | Adapter | — | wizard | `data.import` | contract | In Progress | Not Started |
| Export | Everywhere | XLSX/CSV/PDF | — | Export service | **CSV formula-injection guard, field filtering, audited** | export menu | `data.export` | **injection + field leak** | Verified | Implemented |

### 4.12 Cross-cutting

| Zoho feature | Zoho location | Observed behavior | Key fields / actions | Qodo equivalent | Backend | Frontend | Permission | Test | Impl | Parity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Tags | All modules | Tag work items, posts, statuses | name, colour | `tags` + `entityTags` | — | tag input | `tag.manage` | — | Foundation Exists | Not Started |
| Notifications | Portal | Automated per-event notifications | event, recipients, channel | Reuse Qodo notifications + push | **dedupe + retry** | existing centre | preferences | dedupe | Implemented | In Progress |
| Audit / activity | Entity | Activity stream per record incl. time logs (Apr 2025) | actor, before, after | `auditEvents` — **append-only** | never updated | audit view | `audit.view` | **immutability** | Verified | Implemented |
| Accessibility | Product | *Feb 2025* — inclusive improvements | — | WCAG AA | — | focus, labels, roles | — | a11y checks | Implemented | In Progress |
| RTL | Mobile | *Jun 2025* — Arabic/Hebrew | — | **Qodo is Arabic-first already** | — | existing dir handling | — | RTL render | Foundation Exists | N/A — Qodo ahead |
| Mobile / PWA | Apps | iOS + Android native | — | Responsive PWA (existing service worker) | — | responsive | — | viewport tests | Foundation Exists | Documented difference |

---

## 5. Rollup

Recounted 2026-09-06, after Phases 0–11.

| Area | Rows | Not Started | Foundation Exists | In Progress | Implemented | Verified |
| --- | --- | --- | --- | --- | --- | --- |
| Portal / global | 13 | 2 | 3 | 0 | 3 | 5 |
| Projects | 10 | 1 | 1 | 0 | 3 | 5 |
| WBS / tasks | 23 | 2 | 7 | 0 | 4 | 10 |
| Issues | 7 | 0 | 1 | 0 | 1 | 5 |
| Time / finance | 15 | 0 | 1 | 0 | 4 | 10 |
| Resources / users | 10 | 0 | 6 | 0 | 0 | 4 |
| Collaboration | 8 | 1 | 2 | 0 | 2 | 3 |
| Automation | 10 | 2 | 3 | 0 | 1 | 4 |
| Reports / dashboards | 11 | 0 | 2 | 0 | 1 | 8 |
| AI | 11 | 4 | 0 | 0 | 5 | 2 |
| Integrations / import | 13 | 0 | 4 | 5 | 0 | 4 |
| Cross-cutting | 6 | 0 | 3 | 0 | 2 | 1 |
| **Total** | **137** | **12** | **33** | **5** | **26** | **61** |

**61 of 137 rows are Verified** — implemented *and* covered by a test that
would fail if the feature regressed. The database-backed half of that suite runs
against a real PostgreSQL: `server/projects/testDatabase.js` starts an embedded
one when `PROJECTS_TEST_DATABASE_URL` is unset, so `npm test` verifies tenant
isolation, the client boundary and audit immutability on any machine — and skips
loudly, naming what went unchecked, if neither is available.

**26 rows are Implemented but not Verified.** They persist, authorize and
render; what they lack is a regression test specific to them, usually because
they are a rendering of something the layer beneath already has one for.

**5 are In Progress** — a real, working, deliberately narrower version of
the Zoho feature. **33 have their schema and services but no interface
yet.** **12 have not been built**, and are named individually in §7.

## 6. Progress log

### 2026-09-06 — Phases 0 through 11

**Phase 0 — research.** Live audit of Zoho Projects "Infinity". Six product
changes since the brief was written are in §1.1; the largest — custom modules
moving to the centre of the product — moved the metadata engine from Phase 7
into Phase 1 (ADR-4).

**Phases 1–11 — built.** Nine migrations, twenty services, fourteen routers,
seventeen React pages and components, and 407 tests of which 164 run against a
real PostgreSQL.

| Phase | What landed |
| --- | --- |
| 1 · Foundation | Relational schema, membership authorization, append-only audit enforced by trigger, recycle bin, permission catalogue |
| 2 · Core | Phases, task lists, project tasks over the existing Qodo task (ADR-3), subtasks, checklists, task views |
| 3 · Scheduling | Working-day arithmetic on Engosoft's Sun–Thu week, FS/SS/FF/SF dependencies, cycle detection, critical path, baselines, cascade preview, Gantt |
| 4 · Issues | Issue tracker, links, SLA with working-hours clocks and escalation, business rules |
| 5 · Time & money | Timers with a database-enforced single-running invariant, timesheets with approval, budgets, effective-dated rates, earned value |
| 6 · Collaboration | Comments with the client boundary, reactions, forums, wiki pages with revisions, versioned documents behind signed links |
| 7 · Customization | Metadata engine — modules, statuses, layouts, custom fields with server-side validation — plus the settings interface |
| 8 · Automation | Blueprint with immutable versions and per-record pinning, workflow rules, ordered business rules, webhooks with SSRF protection, idempotent runs |
| 9 · Reporting | Report engine over allowlists, portfolio, workload, dashboards |
| 10 · AI | Grounded capabilities on the existing provider layer, four assistant tools, duplicate detection |
| 11 · Integrations | Connector framework with encrypted credentials, CSV import with dry run, export with formula-injection guard |

**Verified in a browser against a live PostgreSQL**, in Arabic RTL: nine
migrations applied on boot, a project created and persisted through a server
restart, a phase created with its client visibility stated, a task created
carrying a real workspace task reference, the Gantt computing and marking the
critical path, the budget reporting "not measured" rather than zero, earned
value refusing with its missing inputs named, and every adapter honestly
reporting `not_configured`.

### Bugs the tests and the browser found

Recorded because they are the argument for doing both.

| Found by | Bug |
| --- | --- |
| Integration test | `visibleProjectIds` read client-ness only from the permission set, so a customer added to a project by role was listed every `portal` project in the company |
| Integration test | `date` columns arrived as JS `Date` and serialised to JSON in UTC, putting every due date a day early for anyone east of Greenwich — which is where this product runs |
| Unit test | `hourlyRate` was stripped from records but would have been written into the audit log verbatim |
| Integration test | `checklist` meant a summary in a listing and an array on a single read, so the required-item guard read `.requiredOpen` off an array and never fired |
| Integration test | `taskService.create` returned a different shape from `get` |
| Unit test | `deriveKey` deleted punctuation instead of splitting on it, turning "Al-Rehab / Phase 2" into `AP2` — a project key that is wrong permanently |
| Integration test | `layout_sections` had no `organization_id`, so it could not be tenant-filtered |
| Chasing a test warning | The Projects pool had no `error` listener: a database restart or failover would have killed the API process with an uncaught exception |
| Browser | `members()` returned raw snake_case rows, so the member list rendered with an undefined id and no name |
| Browser | A member was shown as a UUID; the service now resolves the name, because seeing who is on your own project should not need `users.view` |

---

## 7. What is not built

Named individually rather than left to be inferred from a count.

### Not started

| Feature | Why it is not here |
| --- | --- |
| **Global Add** (§61) | A workspace-wide `+` belongs in the Shell, which is shared chrome for every module. Worth doing, deliberately not done in the same pass as a new module. |
| **CodeX Scripts / custom functions** (§29) | The sandboxed runner is designed in `QODO_PROJECTS_AUTOMATION.md` §6 and deliberately sequenced last: it runs customer-authored code on our server, and it should ship after everything beneath it has been in production. |
| **MCP** (§57) | The tool layer it would expose exists — the four Qodo Assistant tools — but exposing them over MCP needs an authorization review of its own. |
| **Project and task templates** (§35) | Schema is designed; the relative-date instantiation is not written. |
| **Task groups**, **macro rules**, **report folders**, **scheduled exports** | Small, additive, and none of them blocks anything. |
| **Zia weekly time-log suggestions**, **AI custom-module generation** | Both are Zoho features from mid-2026 that need the capabilities beneath them settled first. |
| **Voice notes and voice input** | Browser speech recognition is available but unevenly; see the UI differences document. |

### Schema and services exist, interface does not

Project groups, customers, custom views, tags, layout rules, lookup/summary/
connect fields, task recurrence, reminders, roles and hierarchy, user custom
fields, email-to-work, macro rules, email templates, report folders, scheduled
exports, user automation, user import.

These have their tables, and in most cases their services and routes; what they
lack is a screen. Each is a contained piece of work rather than a design
question.

### External blockers

| Integration | Blocker |
| --- | --- |
| Google, Microsoft, GitHub/GitLab/Gitea/Bitbucket, Slack, WhatsApp, Jira, Basecamp | The connector framework, the credential store and the settings interface are built and working. Each adapter needs a real API credential before it can be called, and none is configured. They report `not_configured` and answer `409` rather than claiming to work (§68). |
| MS Project (`.mpp`) import | Needs `mpxj` or an equivalent parser. Not attempted rather than faked (§66). |
| Invoicing | The link table and the adapter shape exist; writing invoices needs the Odoo credential. |

### Deliberate differences

Four rows are **N/A — documented difference**: custom domain, the Zoho
extensions marketplace, native mobile apps, and the Qodo-only review lifecycle.
`QODO_PROJECTS_UI_DIFFERENCES.md` carries the reason for each, along with the
Gantt time-axis direction and the PostgreSQL requirement.
