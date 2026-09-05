# Qodo Projects — Database

Implements ADR-2 and ADR-3 from `QODO_PROJECTS_ARCHITECTURE.md`.

---

## 1. Two stores, one seam

| Store | Owns | Reached through |
| --- | --- | --- |
| `documents` / `blobs` (existing) | users, organizations, apps, standalone tasks, mail, calendar, HR, offices, management | `server/store.js` |
| `qodo_projects` schema (new) | everything in the parity matrix | `server/projects/db.js` |

They meet at exactly two points, and nowhere else:

1. **`user_id` / `organization_id`** in Projects tables reference documents by
   id. There is no FK across the seam — Postgres cannot express one to a `jsonb`
   row — so `projectAccess` resolves the user through `store.js` and treats a
   missing user as a denied request, never as an absent constraint.
2. **`project_task_extensions.task_id`** references a task document (ADR-3).

Everything else is inside the relational schema, with real foreign keys.

---

## 2. Conventions

- Schema `qodo_projects`. One namespace, so `DROP SCHEMA` is a complete rollback.
- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`.
- `organization_id text NOT NULL` on **every** table. No exceptions — a table
  without it cannot be tenant-filtered, and §70 forbids that.
- `created_at`, `updated_at` `timestamptz NOT NULL DEFAULT now()`.
- `created_by`, `updated_by` `text` — user document ids.
- Soft delete is `deleted_at timestamptz` + `deleted_by text` (§65). Every read
  path filters `deleted_at IS NULL`; the recycle bin is the one that does not.
- Money is `numeric(14,4)` with an explicit `currency char(3)`. Never a float.
- Hours are `numeric(9,2)`. Never minutes-as-integer mixed with hours-as-decimal.
- Enumerations that users can extend (statuses) are **rows**, not Postgres enums.
  Enumerations the code branches on (dependency type, field type) are `text` with
  a `CHECK`, so adding a value is a migration and a code change together.
- Every FK column is indexed. Every column used in a `WHERE` or `ORDER BY` on a
  list endpoint is indexed, composite with `organization_id` first.

---

## 3. Migrations

Forward-only SQL files, `server/projects/migrations/NNN-name.sql`, applied in
order by a runner that records `(filename, checksum, applied_at)` in
`qodo_projects.schema_migrations`.

- A changed checksum on an applied migration is a **startup error**, not a
  silent skip. Editing history is the failure this catches.
- Each file is one transaction. A failure leaves nothing half-applied.
- The runner is idempotent, so Railway's restart-on-deploy is safe.
- Every migration file carries a `-- Rollback:` comment describing the reverse.
  Because Projects is additive (ADR-3), the honest rollback for the whole module
  is `DROP SCHEMA qodo_projects CASCADE`, and no workspace data is touched.

Backfill policy: **there is none to write.** No existing row is rewritten. A
standalone task becomes a project task only when a person moves it, which
inserts an extension row.

---

## 4. Tables

Grouped as they will be created. `→` marks a foreign key.

### 4.1 Foundation (migration 001)

| Table | Key columns | Notes |
| --- | --- | --- |
| `schema_migrations` | filename, checksum, applied_at | — |
| `project_groups` | name, description, order_index, color | — |
| `customers` | name, kind (`individual`\|`business`), email, phone, address | Zoho renamed Client Company → Customers, Jun 2025 |
| `projects` | name, key (prefix), description, owner_id, → `customers`, → `project_groups`, status_id, start_date, end_date, access (`private`\|`portal`), currency, billing_method, layout_id, color, archived_at, deleted_at | `UNIQUE (organization_id, key)` — the readable prefix |
| `project_members` | → `projects`, user_id, role_id, allocation_percent, is_client | **The authorization join.** `UNIQUE (project_id, user_id)` |
| `project_roles` | name, parent_id, is_client_role | Hierarchy for @mentions and time-log access |
| `permission_sets` | name, is_client, permissions `jsonb` | "Profiles", renamed by Zoho May 2025 |
| `user_permission_sets` | user_id, → `permission_sets` | — |
| `audit_events` | actor_id, entity_type, entity_id, → `projects`, action, before `jsonb`, after `jsonb`, source, correlation_id, ip, occurred_at | **Append-only.** `REVOKE UPDATE, DELETE` from the app role |
| `work_calendars` | name, workdays `int[]`, day_start, day_end, timezone, is_default | Portal + per-user (Zoho, Jul 2025) |
| `calendar_holidays` | → `work_calendars`, date, name | Working-day math |
| `user_calendars` | user_id, → `work_calendars` | — |

### 4.2 Metadata (migration 002 — early, per ADR-4)

| Table | Key columns | Notes |
| --- | --- | --- |
| `modules` | key, label_ar, label_en, icon, is_custom, is_project_scoped, → `projects` | Built-ins seeded as rows so *renaming* a module is data |
| `layouts` | → `modules`, name, is_default, → `projects` | |
| `layout_sections` | → `layouts`, label_ar, label_en, order_index, columns | |
| `custom_fields` | → `modules`, → `layout_sections`, key, type, label_ar, label_en, required, default_value, options `jsonb`, validation `jsonb`, order_index, permissions `jsonb` | `type` CHECK: text, textarea, richtext, integer, decimal, currency, percent, checkbox, select, multiselect, radio, date, datetime, email, phone, url, user, multiuser, lookup, **summary**, **connect** |
| `custom_field_values` | → `custom_fields`, entity_type, entity_id, value `jsonb` | `UNIQUE (field_id, entity_id)`; index on `(entity_type, entity_id)` |
| `layout_rules` | → `layouts`, name, conditions `jsonb`, effects `jsonb`, order_index | New in Zoho 2025-26. **Closed condition/effect vocabulary — never executable** |
| `statuses` | → `modules`, key, label_ar, label_en, color, category (`open`\|`active`\|`review`\|`done`\|`cancelled`), order_index, is_active | Retiring sets `is_active=false`; historical rows keep pointing at it (§32) |
| `custom_views` | → `modules`, name, criteria `jsonb`, sort `jsonb`, group_by, columns `jsonb`, visibility, owner_id, shared_with `jsonb` | |
| `tags` | name, color | `UNIQUE (organization_id, name)` |
| `entity_tags` | → `tags`, entity_type, entity_id | |
| `custom_module_records` | → `modules`, → `projects`, status_id, values in `custom_field_values` | Custom-module rows reuse the same field-value table |
| `config_versions` | scope, payload `jsonb`, state (`draft`\|`published`), published_at, published_by | ADR-9 sandbox |

`custom_field_values` is the one deliberate EAV table. The alternative — a
`jsonb` column per entity — cannot be indexed per field for filtering, and §33
requires filtering and reporting on custom fields. Indexes:
`(entity_type, entity_id)` for reads, `(field_id, (value #>> '{}'))` for filters.

### 4.3 Work breakdown (migration 003)

| Table | Key columns | Notes |
| --- | --- | --- |
| `phases` | → `projects`, name, owner_id, start_date, end_date, status_id, sequence, is_external, color, deleted_at | |
| `task_lists` | → `projects`, → `phases`, name, description, is_external, billing_type, order_index, color | `is_external` is what a client user may see |
| `project_task_extensions` | **`task_id` (PK, → task document)**, → `projects`, → `phases`, → `task_lists`, parent_task_id, depth, order_index, progress, start_date, duration_days, estimated_hours, actual_hours, remaining_hours, billing_type, is_billable, status_id, layout_id, color | ADR-3. The task's title/assignees/lifecycle stay in the document |
| `task_assignees` | task_id, user_id, kind (`assignee`\|`contributor`\|`reviewer`\|`approver`\|`follower`) | Multi-assignee without a `jsonb` array |
| `task_checklists` | task_id, text, is_done, is_required, order_index | A required unchecked item blocks completion |
| `task_dependencies` | predecessor_task_id, successor_task_id, type (`FS`\|`SS`\|`FF`\|`SF`), lag_days | `UNIQUE (predecessor, successor)`; **cycles rejected in the service, not the DB** |
| `task_recurrences` | task_id, frequency, interval, weekdays `int[]`, ends_on, ends_after, next_run_at | Deterministic generated ids prevent retry duplicates |
| `reminders` | entity_type, entity_id, user_id, remind_at, channel, sent_at | |
| `project_baselines` | → `projects`, name, captured_at, captured_by | Immutable |
| `task_baselines` | → `project_baselines`, task_id, start_date, end_date, duration_days, estimated_hours | Insert-only |

### 4.4 Issues (migration 004)

`issues` (→ `projects`, → `phases`, key, title, description, reporter_id,
assignee_id, status_id, priority, severity, classification, reproducibility,
module_affected, affected_phase_id, target_phase_id, due_date, resolution,
closed_at, layout_id, deleted_at), `issue_links` (issue_id, linked_type,
linked_id, relation), `sla_policies` (name, criteria `jsonb`, response_target_minutes,
resolution_target_minutes, → `work_calendars`, escalations `jsonb`),
`sla_clocks` (→ `issues`, → `sla_policies`, started_at, paused_ms,
response_due_at, resolution_due_at, breached_at, escalation_level),
`business_rules` (→ `modules`, name, order_index, criteria `jsonb`,
actions `jsonb`, stop_processing, is_active).

`issues.key` is `UNIQUE (project_id, key)` and is generated from the project
prefix — `ENG-42` — inside the insert transaction, so two concurrent creates
cannot collide.

### 4.5 Time, budget, finance (migration 005)

`time_entries` (→ `projects`, task_id, → `issues`, user_id, log_date, hours,
notes, is_billable, bill_rate, cost_rate, → `timesheets`, approval_status),
`timers` (user_id, entity_type, entity_id, started_at, accumulated_seconds) with
`UNIQUE (organization_id, user_id) WHERE stopped_at IS NULL` — **the
running-timer invariant is a database constraint, not a service check**,
`timesheets` (user_id, period_start, period_end, status, submitted_at,
approved_by, rejected_reason, locked_at), `budgets` (→ `projects`, → `phases`,
type, amount, hours, threshold_percent), `budget_allocations`, `cost_rates`
(user_id, → `projects`, rate, currency, effective_from), `billing_rates`,
`expenses`, `invoice_links` (→ `projects`, external_system, external_id, status,
amount, synced_at).

Rate tables are read through a projection that requires `rate.view`; there is no
service function that returns a rate without taking a user to check.

### 4.6 Collaboration & documents (migration 006)

`comments` (entity_type, entity_id, → `projects`, author_id, body, parent_id,
is_internal, edited_at, deleted_at), `comment_reactions` (→ `comments`, user_id,
emoji), `document_folders` (→ `projects`, parent_id, name, is_external),
`document_files` (→ `document_folders`, → `projects`, name, current_version_id,
is_external, deleted_at), `document_versions` (→ `document_files`, version_no,
blob_id, size_bytes, mime_type, uploaded_by), `forum_categories`, `forum_topics`,
`forum_posts`, `project_pages` (→ `projects`, parent_id, title, body, order_index),
`page_revisions` (→ `project_pages`, revision_no, body, author_id).

`is_internal` and `is_external` appear on comments, task lists, phases, folders
and files. They are the client boundary, and **every** client-facing query
filters on them in SQL — never in the component.

### 4.7 Automation (migration 007)

`blueprints` (→ `modules`, name, is_active), `blueprint_versions` (→ `blueprints`,
version_no, definition `jsonb`, published_at), `blueprint_states`,
`blueprint_transitions` (from_status_id, to_status_id, name, allowed_roles
`jsonb`, required_fields `jsonb`, requires_comment, before_actions `jsonb`,
after_actions `jsonb`), `record_blueprint_versions` (entity_type, entity_id,
→ `blueprint_versions`) — so a record keeps the rules it was created under (§25),
`workflow_rules` (→ `modules`, trigger, criteria `jsonb`, actions `jsonb`,
schedule `jsonb`, is_active), `macros`, `email_templates`, `webhook_endpoints`
(name, url, method, headers `jsonb`, secret_encrypted, events `jsonb`, is_active,
timeout_ms, max_retries), `webhook_deliveries` (→ `webhook_endpoints`, event,
payload `jsonb`, response_status, attempt, delivered_at, error),
`automation_runs` (rule_type, rule_id, entity_type, entity_id, status,
idempotency_key, error, ran_at) with `UNIQUE (idempotency_key)`,
`custom_scripts` + `custom_script_versions` + `script_runs` (ADR-10),
`automation_quota`.

`webhook_endpoints.secret_encrypted` is never selected by any read endpoint. The
API returns a masked constant.

### 4.8 Reports, dashboards, integrations (migration 008)

`report_folders`, `saved_reports` (→ `modules`, name, definition `jsonb`,
→ `report_folders`, visibility, owner_id), `report_schedules`, `dashboards`
(name, → `projects`, visibility, owner_id), `dashboard_widgets` (→ `dashboards`,
type, config `jsonb`, position `jsonb`), `integration_connections` (provider,
name, credentials_encrypted, scopes `jsonb`, status, last_sync_at, last_error),
`import_runs` (source, file_name, mapping `jsonb`, status, dry_run, totals `jsonb`,
errors `jsonb`), `notification_preferences` (user_id, → `projects`, category,
channel, is_muted).

---

## 5. Indexes that are not optional

The list endpoints in §73 are the reason ADR-2 exists; these are the indexes
that make them true.

```sql
CREATE INDEX ON qodo_projects.projects (organization_id, status_id) WHERE deleted_at IS NULL;
CREATE INDEX ON qodo_projects.project_members (user_id, organization_id);
CREATE INDEX ON qodo_projects.project_members (project_id);
CREATE INDEX ON qodo_projects.project_task_extensions (project_id, status_id);
CREATE INDEX ON qodo_projects.project_task_extensions (project_id, task_list_id, order_index);
CREATE INDEX ON qodo_projects.project_task_extensions (parent_task_id);
CREATE INDEX ON qodo_projects.task_assignees (user_id, kind);
CREATE INDEX ON qodo_projects.time_entries (organization_id, user_id, log_date);
CREATE INDEX ON qodo_projects.time_entries (project_id, log_date);
CREATE INDEX ON qodo_projects.issues (project_id, status_id) WHERE deleted_at IS NULL;
CREATE INDEX ON qodo_projects.audit_events (organization_id, entity_type, entity_id, occurred_at DESC);
CREATE INDEX ON qodo_projects.custom_field_values (entity_type, entity_id);
CREATE INDEX ON qodo_projects.comments (entity_type, entity_id) WHERE deleted_at IS NULL;
```

`project_members (user_id, organization_id)` is the hottest index in the schema:
every single Projects request starts by asking "which projects may this person
see", and it is the index that keeps that from being a scan.

---

## 6. Transactions

These are multi-row and must be atomic. A partial apply is a data-integrity bug,
not a slow request.

- Create project from template — project, phases, task lists, tasks,
  dependencies, checklists.
- Reschedule with cascade — many tasks plus their baselines comparison.
- Timesheet approval — entries plus sheet plus lock.
- Blueprint transition — status, field updates, after-actions, audit.
- Import execution — all-or-nothing per batch, with the run row recording it.
- Soft delete with children — project → phases → lists → tasks, one `deleted_at`
  stamp shared by the cascade so restore can find exactly that set.

That last point is why restore works: the cascade writes one `deleted_batch_id`,
and restoring reverses the batch rather than guessing which children were
already deleted before the parent went.

---

## 7. Deployment

- Railway sets `DATABASE_URL`; `server/projects/db.js` reuses it and creates the
  schema on first boot.
- Migrations run at startup before the HTTP listener binds. A failed migration
  fails the deploy — Railway keeps the previous release serving.
- Local development without `DATABASE_URL`: the workspace runs as it does today
  and Projects routes return `503 projects_storage_unavailable` with the
  one-line `docker run` in the message. Projects is the first module in this
  repo that needs a real database, and pretending otherwise with a JSON
  fallback would mean two implementations of every query — the exact duplication
  §83 forbids.
