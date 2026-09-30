# E-Learning Production

The E-Learning Production module runs a training program from research to a
published release. It is a separate domain from Qodo Projects and Tasks: it
shares workspace authentication, organization identity, people, the
notification bell and the blob storage abstraction, and owns its own
PostgreSQL schema (`qodo_elearning_production`), services, permissions, API
routes and UI.

The workflow is built from the business's *Content Development Checklists*
workbook. Every row of it — visible and hidden — is traced in
[ELEARNING_PRODUCTION_TRACEABILITY.md](ELEARNING_PRODUCTION_TRACEABILITY.md),
which is generated and checked by the test suite.

## The model

```
Course (catalogue identity, long-lived)
 └─ Production run (one pinned template version; one open run per course)
     ├─ Stage instances  ─ Task instances ─ checklist items, evidence,
     │                                       submissions, comments, dependencies
     ├─ Issues (dry run / UAT), change-impact items (revamp), expert candidates
     └─ Release (immutable snapshot) → the course's current release
 └─ Modules → Lessons → lesson assets (Outline, PPT, Script, Voice-over, Video)
```

Two levels of work run side by side:

- **Program work** — stages and tasks copied from a template version when the
  run starts: research, curriculum, experts, instructional design, deployment,
  dry runs, UAT, release. Tasks carry a role, a checklist, evidence rules and,
  where the workbook or a proposal says so, an approver role.
- **Lesson work** — the original asset pipeline (Outline → PPT → Script →
  Voice-over → Video) with its versions, review tools and approvals, unchanged.
  An asset can be marked *not applicable* with a reason. Stages such as Media
  Production are *automatic gates* over the lesson assets (for example "every
  applicable asset approved"), evaluated only once the stage is unblocked.

### Scenarios

| Scenario | Stages |
| --- | --- |
| `EXPERT_NEW` — new program, expert-led | Research → First draft → Experts & coaches (parallel with the draft, skippable only with a recorded reason when an expert is already contracted) → Final curriculum → Instructional design ∥ Media production → Platform deployment → Dry run 1 → Dry-run fixes → Redeployment → UAT → Release |
| `AI_NEW` — new program, AI-assisted | Content input → Outlines → Outline review → Final curriculum → Scripts → Script review → Slides (Docki) → Voice-over & video (Think) → Video review → Implement comments → Check comments → *Platform deployment → UAT → Release (proposed, option `aiReleaseGates`)* |
| `REVAMP` — revamp of a released program | Change impact → Instructional design → Media production → Platform deployment → Dry run 1 → Apply changes → Apply dry-run comments → Dry run 2 → UAT → Release |
| `LEGACY` | Courses that existed before runs: history kept, no stages inferred. A legacy run can adopt a workflow later. |

AI output is always labelled (`ai_assisted`, `ai_tool` on the version) and is
reviewed and approved by someone other than the sender. Docki and Think are
**manual handoffs**: there is no integration, so their tasks ask for a link or
file as evidence.

A revamp starts from a published release (or, for a legacy course, a recorded
`LEGACY_BASELINE` of the current content — marked as recorded, not as a
verified publication). The change impact says, per lesson or asset, KEEP
(the old approval is referenced, never copied), CHANGE (the asset reopens and
needs a new approval) or REMOVE (the lesson is archived when applied).

### Rules the server enforces

All of these live in pure modules under `shared/learningProduction/` — the
server enforces them, the browser renders the same verdicts:

- `runs.js` — task transitions (`evaluateTask`), stage status and automatic
  gates (`computeRun`), the four progress measures (`runProgress`: workflow,
  lesson content, release readiness, published), health and its reasons.
- `workflowTemplates.js` — the three templates, built from `workbookSource.js`
  (generated from the workbook; never hand-edited), with options for every
  decision the workbook leaves open.
- `workflow.js` — the lesson asset pipeline, unchanged in behaviour.

Guarantees:

- A decision binds to exactly one submission and the evidence submitted with
  it; after changes are requested, resubmitting needs new evidence.
- Nobody approves their own work. An administrator may, with a reason that is
  stored with the decision and shown as an override.
- Required tasks are waived and non-skippable stages skipped only by an
  administrator, with a reason; conditional work may be waived by a manager with
  a reason. Waived and skipped work leaves the progress count, visibly.
- High and critical open issues block release readiness. A fixed issue is
  verified by someone other than the fixer.
- A release is prepared, signed off by a different person, and published with
  the platform link as evidence. Its snapshot is frozen; a candidate goes stale
  if approved content changes after it was prepared.
- Every screen can say *why* something is blocked: the stage, the task, the
  asset approval, and who holds it.

The database repeats what must never be rewritten: frozen template versions,
immutable releases, evidence that can be withdrawn but not deleted, submissions
that are final once decided, and an append-only activity log.

### People and unowned work

- The **New run** team step has three groups: who co-runs the program
  (course manager), who works the stage tasks the template names, and who
  makes and reviews each lesson file. A role held by one person gets that
  role's tasks; the lesson roles become the course's default maker and
  reviewer per file (`defaultsFromTeam` in `runService.js`), so every lesson
  added later is already assigned. Existing defaults are never overwritten,
  and nobody is made the reviewer of their own file.
- Ready work with nobody on it (a non-optional task whose stage is open, or a
  lesson file whose turn has come) is listed in the **run manager's My Work**
  with an *Assign* action — lesson files grouped per course and file type.
- A lesson file whose turn has not come says what it waits for ("Waits for
  the outline"), in grey; it is the normal order, not an error.

The in-app guide (`/learning-production/guide`, "How it works") explains all
of this to users; its prose is `src/lib/learningProduction/guideContent.ts`
and its stage lists are read from the published templates.

## Roles and permissions

Organization permissions (`elearning_production.*`) are granted in the
workspace's role editor. Course roles are granted per course (and per run for
run-only people, such as a UAT cycle's testers). Holding a task's named role
also lets a person work on or review that one task.

| Role | Program work | Lesson assets | Release | Candidate records |
| --- | --- | --- | --- | --- |
| Production manager | manage run; work, assign, review, approve, waive, reopen any task | everything | sign off, publish | yes |
| Course manager | manage run; assign, review, approve, waive, reopen | assign, review, approve, reopen, lock | sign off, publish | **no** |
| Expert coordinator | work and assign in Experts & coaches | — | — | yes (that stage) |
| Researcher, Technical PM, Delivery PM, Learning operations, Marketing | tasks that name their role | — | — | no |
| Technical consultant | tasks that name the role | review outline, PPT, script | — | no |
| Instructional designer | tasks that name the role | edit/submit outline, script; review outline, PPT, script | — | no |
| Subject-matter expert | tasks that name the role | review outline, PPT, script, video; approve outline, script | — | no |
| Quality reviewer | tasks that name the role | review and approve every asset | — | no |
| UAT coordinator | assign and review UAT tasks | — | — | no |
| UAT tester | work UAT tasks, log issues | — | — | no |
| Outline/script writer, PPT designer, voice-over artist, video editor | tasks that name the role | edit and submit their asset | — | no |
| Viewer | read only | read only | — | no |

Candidate CVs, assessments and contracts answer **404** to everyone without
`experts.sensitive` in that stage; task evidence on sensitive tasks is shown
redacted, and the activity log never names a candidate.

## Notifications

Alerts go to the existing workspace bell through a transactional outbox
(`learning_notification_outbox`): written in the same transaction as the
change, delivered after commit, retried with backoff by the scheduler if
delivery fails. Every alert has a de-duplication key and window; the person
who caused a change is never told about it; each person can mute ten groups
(assigned, review requested, changes requested, approved, comments, mentions,
handoffs, deadlines, issues, releases) and set deadline reminders from My Work.

## Screens

The module bar has three places — **My tasks**, **Courses**, **Reports**
(managers) — plus *New production run* and a small *More* menu (guide,
templates, notification settings, the workspace-bar toggle). No page has tabs
inside it: secondary tools open in drawers named in the URL.

| Route | What it answers |
| --- | --- |
| `/learning-production` | My tasks: one list — waiting for my decision, then mine to do — with *Waiting on others* (with reasons), *Done recently* and, for managers, the team's reviews folded underneath; managers also see the courses that need them |
| `/learning-production/courses` | A card per course: where it is now, content approved, due date, on time or not |
| `/learning-production/runs/new` | Start a run: way → basics → team → review of the exact stages and tasks before anything is written |
| `/learning-production/reports` | Production reports (kept from the previous module) |
| `/learning-production/templates` | Template versions and options, the row-by-row workbook trace, open decisions |
| `/learning-production/courses/:id` | One page: the current stage and what it needs (all stages one fold away), the lessons with their five files, and side cards for progress, QA & release, team, files. `?task=` opens a task; `?panel=lessons\|matrix\|qa\|team\|files` opens that tool in a drawer; `?stage=` opens a stage in the list |
| `…/courses/:id/settings` | Course settings, under the course header |
| `…/courses/:id/lessons/:lessonId/:stage` | The asset review workspace; its side panel is one column (open notes, then versions and history folded) |

Old links redirect and keep their query: `my-work` and `reviews` → My tasks;
the course tabs `plan`, `curriculum`, `lessons` → the course page (`plan?task=`
becomes `?task=`); `production`/`assets` → `?panel=matrix`; `qa` → `?panel=qa`
(with `issue`/`release`); `team` → `?panel=team`; `files`/`activity` →
`?panel=files`; `courses/new` → `runs/new`. Server notification links still use
the old paths and rely on these redirects.

The UI uses a scoped `.lps` design layer (`src/index.css`): neutral canvas,
ink and navy text, one blue accent, amber for attention, red only for late or
blocking. Motion is 150–250 ms and off under `prefers-reduced-motion`. Every
screen is Arabic-first with full RTL and works at 375 px without sideways
scrolling.

### Copy and translation

Screen copy lives in `src/lib/learningProduction/studioStrings.ts` (enum
families and history sentences) and `studioScreens.ts` (screen text), ahead of
the older `strings.ts`. `server/learningProduction.i18n.test.js` fails when a
key used in `src/` has no entry, when any value of a server enum family (stage
keys, roles, statuses, error codes, activity events, preference groups, …) has
none, when an Arabic entry is not Arabic, or when the two languages use
different placeholders. A missing key still renders a readable label and warns
in development.

## Migration and backfill

`server/learningProduction/migrations/002_production_runs.sql` is additive and
forward-only (checksummed, like 001):

- widens the role and activity-event vocabularies;
- adds the run, stage, task, evidence, submission, issue, impact, candidate,
  release, outbox and preference tables, and nullable columns on assets,
  versions, activity and notifications;
- **backfills one `LEGACY` run per existing course** (deterministic, only for
  courses with no run) plus a `RUN_CREATED` activity entry marked
  `backfill: true`. No stage, curriculum, UAT or publication state is inferred
  from approved assets; nothing existing is updated or deleted.

`server/learningProduction.migration.test.js` builds a database at 001 with
legacy data (courses, lessons, versions, approvals, comments), applies 002, and
checks that every row survives unchanged and every course has exactly one
legacy run. Rollback: the new tables can be dropped; the widened checks only
admit more values; the added columns are nullable or defaulted.

## What changed from the previous module

- **Preserved:** courses, modules, lessons, the five-asset pipeline and its
  rules, versions, approvals, comments, annotations, audio/video markers,
  transcripts, video QA checklists, the asset review workspace, reports, course
  settings, all existing API endpoints (including the lesson asset board), and
  all existing data.
- **Replaced (2026-09-30, simple screens):** the dashboard, My Work and Reviews became *My tasks*; the seven course tabs became one course page with drawers. Removed files: `Dashboard.tsx`, `MyWork.tsx`, `Reviews.tsx`, `course/RunOverview.tsx`, `course/RunPlan.tsx`, `course/Curriculum.tsx`, `course/LegacyPlan.tsx`.
- **Replaced (first rebuild):** the dashboard, course list, course creation (now *New run*),
  course overview, course lessons and assets tabs, and My Work / Reviews
  screens. Removed files: `CourseCreate.tsx`, `course/CourseOverview.tsx`,
  `course/CourseAssets.tsx`, `components/learning-production/charts.tsx`,
  `CourseProgress.tsx`.
- **Added:** production runs, workflow templates and versions, program stages
  and tasks, checklists, evidence, submissions, dry-run/UAT issues, change
  impact, expert candidates, releases, not-applicable assets, AI provenance,
  the notification outbox and preferences, new roles and permissions, the
  Templates screen, and the traceability document.

## Demo data

`npm run seed:learning-demo` fills a **development** database. It refuses when
`NODE_ENV=production`, marks every course with `is_demo` and every account with
`isDemo`, and removes exactly those with `--remove` / `--reset`. Demo accounts
have no password and `.invalid` addresses, so none can sign in.

It writes thirteen courses of lesson history with direct SQL (each gets a
legacy run, as the backfill would give it), then walks production runs through
the real services as the people named on each task
(`scripts/learning-demo/runs.js`): an expert-led program released as r1.0.0 and
its revamp with change impact waiting for approval; a program in its first
weeks with a resubmitted draft, four expert candidates and late tasks; an
AI-assisted program with labelled outlines waiting for your review; a program
in dry-run fixes with open, fixed and verified issues; a program on hold; and a
legacy course that adopted a workflow. Alerts are muted while it loads.

```sh
npm run seed:learning-demo             # build it
npm run seed:learning-demo -- --reset  # remove it and build it again
npm run seed:learning-demo -- --remove
npm run seed:learning-demo -- --for=someone@example.com   # whose My Work it fills
```

## Local configuration

The module uses `DATABASE_URL`. Without a database the rest of the workspace
still starts and the module shows a clear unavailable state. Optional limits
and media settings are documented in `.env.example`. Set
`LEARNING_PRODUCTION_DEMO=enabled` only when demo data should be available
outside development.

## Verification

```sh
npm run typecheck
npm run build
npm test
node scripts/generate-production-traceability-doc.mjs --check
```

The suites cover the three scenarios end to end against a real PostgreSQL
(`learningProduction.runs.test.js`), template construction and workbook
traceability (`learningProduction.templates.test.js`), the migration and
backfill (`learningProduction.migration.test.js`), translation completeness
(`learningProduction.i18n.test.js`), and — unchanged — workflow rules,
permissions, tenant boundaries, HTTP error contracts, uploads and byte ranges,
and the PPT, voice and video review flows.
