# Qodo Projects — Architecture

Companion to `QODO_PROJECTS_PARITY_MATRIX.md` (what to build) and
`QODO_PROJECTS_DATABASE.md` (where it is stored). This file is *why*.

Written after auditing the repository at `0e0a426` and the current shipping
Zoho Projects ("Infinity", April 2026). It records the decisions that are
expensive to reverse, and the reasoning that would otherwise be lost.

---

## 1. The shape of the problem

Qodo already has a task system, and it is not a weak one. `shared/workflow.js`
encodes a real contract — assign, accept or decline, work, submit evidence,
review, send back, approve, score — and `server/taskAccess.js` enforces it
against a four-level visibility model. Roughly 61k lines of the workspace
already work this way.

What Qodo does not have is *project* management: no schedule, no dependency, no
budget, no phase, no client boundary, no metadata-driven customization. The
temptation is to bolt those onto `tasks`. The reason not to is arithmetic:
Zoho's task record carries ~40 fields plus an unbounded custom-field set, and
`server/routes/tasks.js` is already 2051 lines serving a 25-field task.

So the governing decision is **extend, don't replace, and don't merge**.

---

## 2. Architecture decision records

### ADR-1 — Keep the stack

**Decision.** React 18 + TypeScript + Vite + Tailwind + React Router on the
front; Express 4 ESM on Node 20 at the back; Postgres in production.

**Why.** The brief says so, and the audit agrees: nothing in the parity matrix
needs a different runtime. Gantt, Kanban and virtualized tables are component
problems, not framework problems. A rewrite would put the 22 "Foundation
Exists" rows back to zero.

**Consequence.** New libraries are justified per-use (§6), not adopted wholesale.

---

### ADR-2 — Projects entities go in real relational tables; the document store stays for everything else

**Decision.** Add first-class Postgres tables for Projects. Do **not** add
Projects collections to `COLLECTIONS` in `server/store.js`.

**Why.** `store.js` is honest about its own limits — its header says filtering in
JavaScript is "right call at workspace scale… If tasks ever grow past ~100k,
move the hot queries into SQL". Projects is that moment, and three parity
requirements force it:

- **§73** asks for thousands of projects and hundreds of thousands of tasks.
  `find('tasks', predicate)` is `SELECT * FROM documents WHERE collection='tasks'`
  followed by a JS filter — a full-collection scan and full deserialization per
  request. One Kanban board would pull every task in the company.
- **§64** requires an append-only audit. `store.update()` is the only write path
  and it mutates in place.
- **§60** requires field-level permissions. Projecting fields out of a `jsonb`
  blob after loading it is a leak waiting to happen; a column list is not.

**Why not migrate the whole app.** Because backward compatibility (§78) is a
hard requirement and the existing modules work. Two storage shapes is a real
cost, paid deliberately and confined to one seam (§3).

**Consequence.** `server/projects/db.js` owns a pooled `pg` client and a
migration runner. Dev without `DATABASE_URL` needs a database for Projects —
documented in the README, with `docker run postgres` as the one-liner. The rest
of the workspace still runs with zero setup.

**Rejected alternative.** Keeping Projects in `documents` and adding GIN indexes.
It cannot express foreign keys, cannot do a transactional multi-row schedule
update, and cannot project fields. It would work until the first real project.

---

### ADR-3 — Project tasks extend Qodo tasks; they do not replace them

**Decision.** A Qodo task stays a Qodo task. A task that belongs to a project
gains a row in `project_task_extensions` keyed by the existing task id.

**Why.** §78 forbids destructive migration and §13 forbids discarding the
lifecycle. This is the seam that satisfies both:

- Standalone department tasks keep working, unchanged, in `documents`.
- `/tasks` (My Work) keeps its existing queries and additionally surfaces
  project tasks — one union, at one place.
- The review/rework/score lifecycle is inherited rather than reimplemented,
  which is what stops Qodo Projects from being a second, competing task product
  inside the same app.

**Consequence.** `taskService` reads a task through one function that joins the
document and the extension. Any code path that forgets the join sees a
project-less task — so the join lives in exactly one module and is not exported
piecemeal.

**Migration.** Additive only. No existing task row is rewritten. Rollback is
dropping the Projects schema; the workspace is unaffected.

---

### ADR-4 — Metadata-driven modules from day one

**Decision.** Fields, layouts, statuses, views and layout rules are **data**, not
React forms and not `switch` statements. One engine serves projects, phases,
task lists, tasks, issues, users, time logs and custom modules.

**Why.** This is the decision the live audit changed. Zoho Projects Infinity is
*built around* custom modules — they are the headline of the April 2026 release,
they carry their own layouts, rules, reports, dashboards and automation, and as
of June 2026 they can be generated by AI. The brief sequenced custom modules
into Phase 7. Following that order would mean writing eight hardcoded modules
and then retrofitting a metadata engine underneath them — the single most
expensive available mistake.

**Consequence.** The metadata tables ship in Phase 1 with the schema, even
though the layout *editor* ships in Phase 7. Concretely: every module's read
path resolves its field set from `custom_fields` + `layouts` before rendering,
from the first commit, so there is never a "hardcoded era" to unwind.

**Guard rail.** Metadata engines rot into `eval`. Field types are a closed
enum; layout rules are a closed set of conditions and effects; nothing in
metadata is executable. Executable extension is ADR-10, and it is sandboxed.

---

### ADR-5 — Documents get private storage with signed access

**Decision.** Project documents keep metadata in Postgres and bytes behind a
storage abstraction with signed, expiring URLs. The existing `blobs` bytea table
is the default implementation; S3-compatible object storage is a drop-in.

**Why.** §44 says not to rely permanently on bytea, and §71 requires signed
private access before any client user exists. Versioning (§44) means one logical
document is N blobs, so bytea growth is not linear in documents but in edits.

**Consequence.** No document is ever served from a guessable URL. Access is
`authorize → mint short-lived token → stream`. MIME is validated on the way in,
filenames are never used as paths (the existing `store.js` blob code already
gets this right and is the model), size is capped, and there is a scan hook
that no-ops today.

---

### ADR-6 — Build the Gantt; buy the table and the drag

**Decision.** Write the Gantt renderer in-house. Adopt libraries for
virtualization, drag-and-drop and date math.

**Why.** §18 wants draggable bars, resize-to-reschedule, dependency connectors,
zoom levels, critical path, baseline overlay, slippage, collapse/expand,
fullscreen, print — with every drag persisted through an authorized API and
revalidated. Gantt libraries that do all of this are commercially licensed;
the free ones own their own data model and fight a server that can reject a
drag. The renderer is an SVG timeline over a scheduling service we must write
anyway. The bundle cost of a general table library, by contrast, buys nothing
we would write differently.

**Consequence.** `schedulingService` (CPM, working days, cascade, cycle
detection) is server-side and testable without a browser. The Gantt component
is a view over it. Mobile gets a simplified read-mostly timeline (§75), which is
a documented UI difference.

---

### ADR-7 — Projects strings live in their own i18n namespace

**Decision.** `src/lib/i18n.tsx` keeps its flat `STRINGS` map and its API.
Projects strings live in `src/lib/i18n/projects.ts` and are merged in.

**Why.** `i18n.tsx` is 1288 lines for the current workspace. Projects will add
more strings than the rest of the app has. One file would become unreviewable,
and every Projects PR would conflict in it.

**Consequence.** `t()` is unchanged for every caller. §76's "no key without a
value" is enforced by a type: the map is `Record<Key, {ar: string; en: string}>`,
so a missing Arabic value fails `npm run typecheck`.

---

### ADR-8 — Reuse Qodo Mail and Qodo Calendar; do not build a second chat or a second calendar

**Decision.** Project discussion is a Qodo Mail conversation scoped to the
project. Project dates are Qodo Calendar events.

**Why.** §41 and §52 say so, and the audit says they are ready: `mailConversations`
already separates membership from conversation, and `calendarEvents` already
separates the per-person invite from the event. Building parallel systems would
mean two unread counts, two notification paths, two search sources.

**Consequence.** Forums (§42) and Pages (§43) *are* new — they are documents,
not messages, and Mail models neither.

---

### ADR-9 — Sandbox is versioned draft/publish, not a duplicate environment

**Decision.** Configuration (layouts, fields, statuses, blueprints, rules) is
versioned with an explicit draft → publish transition and a rollback, rather
than a cloned tenant.

**Why.** §38 permits exactly this and asks for equivalent safety semantics. A
duplicate environment means duplicating storage, users and integrations for a
single-tenant deployment on Railway — cost with no matching safety gain, since
the risk being managed is "a bad layout reaches production", not "a test writes
to real data".

**Consequence.** Records remember the configuration version they were created
under (§25), so publishing a new blueprint cannot retroactively invalidate
history.

---

### ADR-10 — Custom automation is a sandboxed, quota'd script runner

**Decision.** No `eval`, no `vm` with host globals, no arbitrary `require`.
Scripts are versioned, declare typed inputs and outputs, run in an isolated
worker with a hard timeout and a memory cap, reach the outside world only
through an allowlisted SDK, and every run is audited and metered.

**Why.** §29 says exactly this, and the live product agrees — Zoho replaced
Deluge custom functions with **CodeX Scripts**: JavaScript, a published SDK, and
a *credit* model. The credit model is not incidental; it is how a hosted vendor
survives customer code. We copy the shape.

**Consequence.** Ships late (Phase 8) and behind a permission no role carries by
default, following the precedent `shared/permissions.js` already sets for
`management.view` and `calendar.booking`.

---

### ADR-11 — Integrations are connectors, and an unconfigured connector says so

**Decision.** One `integrationConnections` table, one adapter interface, one
Integrations page. An adapter with no credentials reports **Not connected** and
its endpoints return `409 integration_not_configured`.

**Why.** §68: "Do not claim an integration is operational without a real
configured credential/API connection." §82 forbids fake features. The failure
mode this prevents is a settings page full of logos that do nothing.

**Consequence.** Every external integration row in the parity matrix can reach
**Implemented** as *a working adapter awaiting credentials* — and the matrix
says which, rather than pretending.

---

## 3. Module layout

```text
server/projects/
  db.js                 pooled pg client, transactions, migration runner
  migrations/           NNN-name.sql, forward-only, checksummed
  projectService.js     projects, groups, customers, templates, lifecycle
  projectAccess.js      membership + role + client resolution — the auth core
  phaseService.js
  taskListService.js
  taskService.js        the ADR-3 join lives here and nowhere else
  issueService.js
  schedulingService.js  dependencies, CPM, baselines, working days, cascade
  timeService.js        timers, logs, timesheets, approvals
  budgetService.js      budgets, rates, costing, EVM
  reportService.js
  dashboardService.js
  metadataService.js    fields, layouts, statuses, views, rules, custom modules
  automationService.js  blueprint, workflow rules, business rules, webhooks
  documentService.js
  collaborationService.js  feed, comments, forums, pages
  auditService.js       append-only
  importService.js / exportService.js
  aiService.js          grounded capabilities over the AI provider layer

server/routes/projects/    one router per domain, mounted under /api/projects
src/pages/projects/        one page per module, lazy-loaded
src/components/projects/   Gantt, Kanban, board, table, layout renderer
src/lib/projects/          typed API client, types, hooks
shared/projects/           permissions, statuses, field types, validation
```

**The rule that keeps this from becoming another 2051-line file:** routes parse
and authorize, services decide, `db.js` persists. A route never writes SQL; a
service never reads `req`.

---

## 4. Request path

```text
React (hides what you cannot do — UX only)
  → /api/projects/...
  → attachUser              existing session cookie
  → requirePermission       organization-level key
  → projectAccess           membership + project role + client boundary
  → blueprint / workflow    transition legality, re-checked server-side
  → service                 business rule, inside a transaction
  → db                      parameterised SQL, indexed, scoped
  → auditService            append-only, before/after
  → notifications           deduped
  → field projection        strips what this user may not see
  → response
```

Two rules, both from §60 and §82:

1. **Deny by default.** A permission absent from the catalogue denies.
2. **A drag is a request.** Kanban and Gantt gestures re-run the same guard as a
   typed API call. The client is never trusted about legality.

---

## 5. Multi-tenancy

Every Projects table carries `organization_id`. Every query filters on it from
the session, never from the request body. An id belonging to another tenant is
indistinguishable from one that does not exist — `404`, never `403`, because
`403` confirms existence.

Negative authorization tests are part of the definition of done for each phase,
not a final sweep (§70).

---

## 6. Dependencies

Evaluated against "does the repo already solve this?" first.

| Need | Decision | Why |
| --- | --- | --- |
| Drag & drop (Kanban, Gantt, dashboard) | `@dnd-kit` | Accessible (keyboard drag, §74), small, unopinionated about data. |
| Large-table virtualization | `@tanstack/react-virtual` | Renderer-agnostic; we keep our own markup and Tailwind. |
| Date & working-day math | `date-fns` | Tree-shakeable. The repo currently hand-rolls dates; scheduling needs more. |
| Charts | Extend `src/components/Charts.tsx` | It already exists. Revisit only if the custom report builder outgrows it. |
| Rich text (pages, comments) | `tiptap` | Schema-controlled, which matters because the output is stored and re-rendered. |
| Spreadsheet import/export | `exceljs` | **Already a dependency** — the HR workbook importer uses it. |
| MPP import | `mpxj` via a parse step | The only real option; §66 forbids faking it. If it will not run in-process, the row says "documented limitation" rather than pretending. |
| E2E | `@playwright/test` | §77. Dev-only. |
| Gantt | **None** | ADR-6. |
| State management | **None** | Existing context + hooks. §3 forbids replacing the state architecture. |

---

## 7. Performance

- Every list endpoint is paginated with a bounded maximum; cursor pagination
  where ordering is stable.
- Filtering, sorting and grouping happen in SQL. Never load a collection to
  filter it in JavaScript — the thing ADR-2 exists to stop.
- Every foreign key and every filtered column is indexed; see the database doc.
- Rollups (phase progress, budget consumption) are computed in SQL, and cached
  only where a stale read is provably harmless.
- Project modules are `React.lazy` route-split. The Gantt in particular never
  enters the main bundle.
- N+1 is a review-blocking defect, not a performance note.

---

## 8. Security posture before client users exist

§71 gates the client portal behind: project membership authorization, tenant
isolation with negative tests, internal/external visibility enforced server-side,
signed private file access, append-only audit, CSRF-appropriate protection for
the cookie session, server-side field permissions, rate limiting on client-
reachable routes, MIME validation, and encrypted integration secrets.

**The client portal does not ship until every one of those is Verified in the
parity matrix.** A half-secured client surface is worse than no client surface.

---

## 9. Delivery order and what "done" means

The phase order follows the brief (§81) with one correction: **metadata moves
into Phase 1** (ADR-4). Phases 2–12 are unchanged.

Progress is tracked only in `QODO_PROJECTS_PARITY_MATRIX.md`, edited in place.
A row reaching **Verified** requires working UI, server-enforced authorization,
real persistence, Arabic and English, RTL and LTR, and an automated test that
would fail if the feature regressed.

A navigation item, an opening dialog, a static chart or a `200` from a stub is
not a feature (§82). Where an external dependency genuinely blocks a row, the
matrix says so in the row rather than the row quietly claiming success.
