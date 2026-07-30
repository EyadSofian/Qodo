# Task Management Gap Analysis

Last reviewed: 2026-07-30

## Executive summary

The repository is an Arabic-first Engosoft workspace, not yet the enterprise
marketing-operations platform described in the supplied specification. Its
strongest implemented slice is:

`assign → accept → execute → submit evidence → review/rework → approve and score`

The current implementation is appropriate for one small company and a modest
number of tasks. It is not yet appropriate for many independently administered
organizations, complex projects, client portals, capacity planning, or
multi-stage asset approvals.

Status terms used below:

- **Implemented**: backed by stored data, server authorization, UI, and tests.
- **Partial**: a safe foundation exists, but the complete product behavior does
  not.
- **Missing**: no production flow exists.

| Area | Required behavior | Current implementation | Missing or broken behavior | Security risk | Priority | Planned implementation | Verification method |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Tenant boundary | Every protected resource belongs to one organization | **Partial.** `organizationId` now exists on users, tasks, child records, notifications and activity; central task/user policies reject another tenant | Organization provisioning, membership UI, platform-owner scope, per-tenant settings and tenant-aware app registry are missing | High if new tenants are added before every route is tenant-aware | P0 | Finish tenant-aware services before enabling a second production tenant | Negative API tests for every resource; cross-tenant ID must return 404/403 |
| SSO audience | Tokens must be audience scoped | **Implemented.** SSO token includes organization and `/sso/verify` now requires an audience | Token revocation and key rotation are not implemented | Medium | P0 | Add key rotation/versioning and session revocation | Reject missing/wrong audience and expired tokens |
| Authentication | Secure password login and sessions | **Implemented.** bcrypt, HttpOnly/Lax cookies, production Secure flag, generic login errors, throttled failures | No MFA, central revocation, device/session list, or Redis-backed distributed throttling | Medium | P0 | Add session records and optional MFA before external client access | Auth integration tests and rate-limit tests |
| CSRF/browser origin | State changes must not be forgeable cross-site | **Partial.** SameSite=Lax session cookie protects normal browser flows | No explicit CSRF token/origin middleware; requirements change if cookies become SameSite=None | Medium | P0 | Add origin verification before iframe-authenticated mutations | Cross-origin mutation test |
| RBAC | Configurable resource/action roles, deny by default | **Partial.** Static roles plus per-user permission overrides; server checks are authoritative | Roles and permissions are not admin-managed; keys are coarse (`tasks.edit_any` also means reviewer/scorer) | Medium | P0 | Separate `task.assign/review/approve/score/export` and persist custom roles | Permission matrix tests for each action |
| Department access | Employees see their department; managers see their team; admin sees own organization | **Implemented** for the current single-primary-department model | A user cannot belong to multiple departments/teams; delegated team leads are missing | Medium | P1 | Add team memberships with start/end dates and scoped manager grants | Same-team and other-team negative tests |
| Marketing tree | Creative, Marketing, Website, Merchandising and Performance with job roles | **Implemented** as marketing subteams/job roles and connected to user/task forms | Values are code-managed, not admin-managed; no history or inactive values | Low | P1 | Move classifications to persisted configuration without changing IDs | CRUD tests plus legacy-ID migration test |
| Employee classification | Separate title, category, discipline, skills and seniority | **Partial.** Access role, department, subteam and job role are separate | Category, discipline, skills, proficiency, seniority, employment/capacity fields are missing | Low | P1 | Add classification collections and employee profile service | Admin CRUD and filter tests |
| Human task identity | Stable readable reference | **Implemented.** New tasks receive `TSK-...`; legacy tasks are backfilled | Sequence is not an organization-controlled numeric counter | Low | P1 | Add atomic per-tenant sequence when storage is normalized | Concurrency uniqueness test |
| Task brief | Title, description, objective and definition of done | **Implemented** in API and task form | Required-field policies are not configurable per task type | Low | P1 | Add task types with required-field schemas | Validation tests per task type |
| Assignment response | Accept, decline, clarify, propose date, request reassignment | **Implemented.** Assignee actions, required decline/request reason, notifications and immutable assignment event documents | Manager resolution actions and SLA around unanswered assignments are limited | Medium | P1 | Add explicit approve-date/resolve-clarification/reassign actions and reminders | End-to-end assignment decision tests |
| Task responsibilities | Requester, owner, assignee, contributors, reviewers, approvers, watchers | **Partial.** Creator/requester and one assignee; manager role supplies review authority | Accountable owner, contributors, percentages, task-specific reviewers/approvers/watchers are missing | Medium | P1 | Add responsibility records, exactly-one accountable owner and contribution validation | Sum-to-100 and authorization tests |
| Priorities and effort | Priority, estimates, effort points and progress | **Implemented.** Priority, Fibonacci effort, estimated minutes and 0–100 progress | No actual time or remaining estimate; no baseline history | Low | P1 | Add time entries and estimate-change history | Range, aggregation and audit tests |
| Workflow | Configurable states and guarded transitions | **Partial.** Department workflows are centralized in code; submission/review gates cannot be bypassed | No admin workflow editor, transition conditions, per-task-type workflow or workflow version | Medium | P1 | Persist versioned workflows and validate every transition server-side | Allowed/forbidden transition matrix |
| Submission/handoff | Submission separate from completion and backed by evidence | **Implemented.** Deliverable required, submission note, timestamp, actor, review queue | Handoff is not a separate immutable entity; delivery URLs/checklist/version freeze are missing | Medium | P1 | Add versioned handoff record and selected asset version | Verify old handoff remains unchanged after resubmission |
| Review/rework | Reviewer decision with reason and history | **Partial.** Approve or changes requested; reason required for return; return count retained | Review rounds and structured feedback categories are not separate records | Medium | P1 | Persist review rounds and categorized feedback | Multi-round history test |
| Approval | Multiple stages, assigned approvers, asset version binding | **Missing.** Current manager approval is one terminal review decision | Client/internal staged approval and outdated-version warning are missing | High for client-facing work | P2 | Add approval policy, stages and asset-version foreign keys | Outdated-version approval must fail/warn |
| Attachments/assets | Secure upload, access control, versions and previews | **Partial.** Authorized task files, size/count limits, safe names, inline allowlist, CSP and forced download | Malware scanning, object storage, signed URLs, versions, annotations and client visibility are missing | High before external guests | P0/P2 | Move blobs to private object storage and add asset/version model | MIME/XSS/path/IDOR tests and signed-link expiry |
| Comments | Internal/client threads, mentions and audit | **Partial.** Authorized flat task comments with notification and length limit | No edit/delete policy, mentions, threads, reactions, or internal/client separation | High before client portal | P1/P2 | Add visibility and thread parent; never expose internal threads to guests | Guest leakage negative tests |
| Subtasks/checklists | Nested work and definition-of-done checks | **Missing** | No parent task, subtasks, checklist or completion gate | Low | P1 | Add depth-limited hierarchy and checklist templates | Depth, cycle and required-checklist tests |
| Dependencies | Four dependency types, no cycles, schedule warnings | **Missing** | No dependency graph or baseline dates | Medium for schedule reliability | P1 | Add dependency service with cycle detection | Circular graph rejection and date-shift tests |
| Time tracking | Manual entries, timer, billable flag and timesheets | **Missing** | Estimates cannot be compared with actual effort | Low | P3 | Add immutable time entries and running-timer invariant | Timer concurrency and reporting tests |
| Capacity/workload | Hours, leave, estimates, contribution share and forecast | **Missing.** Current dashboard counts tasks and deadlines | Task count is not capacity; no schedules, leave, holidays or allocation timeline | High if used for staffing decisions | P3 | Build only after time/employee schedule models exist | Capacity math and timezone tests |
| Scoring | Weighted, evidence-based rubric with fair exclusions | **Partial.** Manager-only 0–100 score; employee sees own; manager sees team; period average is effort-weighted | Rubric components, contribution share, blocked-time exclusions, adjustment reasons and appeals are missing | High if used for HR decisions | P3 | Add versioned rubrics, evidence, adjustments and appeals before employment decisions | Formula, fairness, privacy and audit tests |
| Performance privacy | Employee self only; manager team; client never | **Implemented** for employee/manager roles and assistant/search paths | No client role exists yet | Medium | P0/P3 | Preserve masking in every future report/export/client endpoint | Coworker/client score-leakage tests |
| Views | My work, table, Kanban, review queue, performance, calendar, timeline, Gantt, workload | **Partial.** Table, Kanban, review queue and performance exist | Inbox/requests/approvals/calendar/timeline/Gantt/workload/saved views are missing | Low | P2/P3 | Add views only when their backing data exists | UI and API filter consistency tests |
| Filtering/export | Search/filter/sort/paginate/import/export | **Partial.** Department/assignee/self filters, global search and safe UTF-8 CSV export; export is audited | No server pagination/sort, saved views or imports | Medium at large data volume | P1/P4 | Add bounded queries and cursor pagination before task volume grows | Boundary and CSV-injection tests |
| Delete/archive | Soft delete, archive, recycle bin, restore | **Missing.** Task delete is currently permanent and also removes comments/files | History can be destroyed; no retention policy | High | P0/P1 | Replace hard delete with archived/deleted timestamps and restricted purge job | Restore test and immutable audit test |
| Audit log | Immutable actor/entity/before/after/correlation history | **Partial.** Activity events record actor/action/entity and selected metadata; exports and assignment actions are logged | Store allows mutation/deletion; before/after, correlation ID and source metadata are missing | High for compliance | P0 | Append-only audit service and restricted retention | Mutation attempt must fail; compare before/after |
| Notifications | In-app, push, digest, preferences and retries | **Partial.** In-app/push assignment, review and digest events | No preferences, email, retry queue, deduplication or per-tenant scheduler settings | Medium | P2 | Add notification outbox and idempotency key | Retry/deduplication tests |
| Projects/campaigns | Project and campaign ownership around tasks | **Missing** | Tasks are standalone; no project/campaign membership or budget | Medium | P2 | Add projects first, then campaigns and membership scopes | Cross-project authorization tests |
| Clients/brands/requests | Client → brand → request → deliverable | **Missing** | No client portal or internal/client field separation | High if guest access is added prematurely | P2 | Implement only after P0 authorization and asset security | Guest isolation test suite |
| Content calendar/paid media | Publishing and metric operations | **Missing** | No content items, publishing, ad accounts or KPI snapshots | Medium | P2 | Separate modules sharing project/campaign authorization | Platform/filter/report tests |
| Automation | Idempotent rules, history and retries | **Missing** | Scheduler is fixed code, not user-configurable automation | Medium | P4 | Add outbox/event model before visual rule builder | Duplicate event must execute once |
| Persistence | Safe transactions, indexes and bounded queries | **Partial.** File store or Postgres JSONB document table; blob table separate | JS full scans, no multi-document transaction, weak relational integrity, race windows | High as product grows | P0 | Normalize security-critical entities or add transactional repository methods | Concurrency and rollback tests |
| Tests | Unit, integration, authorization, E2E and regression | **Partial.** Node integration suite covers team/tenant policy, score privacy, gates, assignment and export | No browser E2E/component tests, database variant suite, capacity/scoring rubric tests | Medium | P0–P4 | Add tests with each implemented phase | CI must run typecheck, tests and production build |

## Recommended release boundary

Do not market the current build as the complete platform in the supplied
specification. A safe next production release can be described as:

> Department-scoped task management with a marketing team tree, explicit
> assignment response, evidence-based submission, manager review/rework,
> private scoring, team performance and CSV export.

Before enabling multiple customer organizations or external clients, complete:

1. soft deletion and immutable audit;
2. explicit resource permissions;
3. tenant-aware coverage for every route and scheduler job;
4. secure external file storage and client/internal visibility;
5. project membership authorization.
