-- Qodo Projects — the work breakdown.
--
--   Project → Phase → Task List → Task → Subtask → Checklist item
--
-- The one structural decision worth explaining is `project_task_extensions`.
--
-- Qodo already has tasks, and they are not weak ones: `shared/workflow.js`
-- encodes a real two-sided contract — assign, accept or decline, work, submit
-- evidence, review, send back, approve, score — that Zoho has no equivalent
-- for. Those tasks live in the document store and thousands of them exist.
--
-- So a project task is not a new kind of record. It is an existing task with a
-- row here, keyed by the same id. Standalone department tasks keep working
-- untouched, `/tasks` keeps its queries, the review lifecycle is inherited
-- rather than reimplemented, and the rollback for all of this is still one
-- DROP SCHEMA. See ADR-3.
--
-- Rollback: DROP SCHEMA qodo_projects CASCADE;

SET search_path TO qodo_projects, public;

-- ────────────────────────────────────────────────────────────────────
-- Phases (Zoho calls them milestones in older docs, phases in the UI)
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE phases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text NOT NULL DEFAULT '',
  owner_id        text,
  status_id       uuid REFERENCES statuses(id) ON DELETE SET NULL,
  start_date      date,
  end_date        date,

  -- Internal phases never reach a client user. The flag is named for what it
  -- grants rather than what it withholds, because every client-facing query
  -- reads `is_external = true` and a positive condition is harder to invert by
  -- accident than a negative one.
  is_external     boolean NOT NULL DEFAULT false,

  sequence        int NOT NULL DEFAULT 0,
  color           text NOT NULL DEFAULT '#1D6FB8',
  layout_id       uuid REFERENCES layouts(id) ON DELETE SET NULL,

  deleted_at      timestamptz,
  deleted_by      text,
  deleted_batch_id uuid,

  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text,

  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE INDEX ON phases (project_id, sequence) WHERE deleted_at IS NULL;
CREATE INDEX ON phases (organization_id, status_id) WHERE deleted_at IS NULL;
CREATE INDEX ON phases (deleted_batch_id) WHERE deleted_batch_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────
-- Task lists
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE task_lists (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase_id        uuid REFERENCES phases(id) ON DELETE SET NULL,
  name            text NOT NULL,
  description     text NOT NULL DEFAULT '',
  -- The single most important flag for the client portal: an internal task list
  -- and everything inside it is invisible to a customer.
  is_external     boolean NOT NULL DEFAULT false,
  billing_type    text NOT NULL DEFAULT 'none'
                    CHECK (billing_type IN ('none', 'billable', 'non_billable')),
  order_index     int NOT NULL DEFAULT 0,
  color           text NOT NULL DEFAULT '#64748B',

  deleted_at      timestamptz,
  deleted_by      text,
  deleted_batch_id uuid,

  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text
);

CREATE INDEX ON task_lists (project_id, order_index) WHERE deleted_at IS NULL;
CREATE INDEX ON task_lists (phase_id) WHERE deleted_at IS NULL;
CREATE INDEX ON task_lists (project_id, is_external) WHERE deleted_at IS NULL;

-- ────────────────────────────────────────────────────────────────────
-- Project tasks
--
-- `task_id` is the primary key and it references a task *document*, not a row
-- in this database. Postgres cannot express that constraint against a jsonb
-- store, so the service is what enforces it — and a task extension whose
-- document has vanished is read as "not a project task", never as a crash.
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE project_task_extensions (
  task_id         text PRIMARY KEY,
  organization_id text NOT NULL,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase_id        uuid REFERENCES phases(id) ON DELETE SET NULL,
  task_list_id    uuid REFERENCES task_lists(id) ON DELETE SET NULL,

  -- Hierarchy. `depth` is denormalised so a "show me the tree" query does not
  -- need a recursive CTE per row, and the service keeps it honest — a subtask
  -- whose parent moves has its whole subtree renumbered inside one transaction.
  parent_task_id  text REFERENCES project_task_extensions(task_id) ON DELETE CASCADE,
  depth           int NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 5),
  order_index     int NOT NULL DEFAULT 0,

  status_id       uuid REFERENCES statuses(id) ON DELETE SET NULL,
  progress        int NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),

  start_date      date,
  end_date        date,
  -- Working days, not calendar days. Every duration in this product counts
  -- Engosoft's Sunday–Thursday week — see server/projects/schedulingService.js.
  duration_days   int NOT NULL DEFAULT 1 CHECK (duration_days >= 1),

  estimated_hours numeric(9,2),
  actual_hours    numeric(9,2) NOT NULL DEFAULT 0,
  remaining_hours numeric(9,2),

  billing_type    text NOT NULL DEFAULT 'none'
                    CHECK (billing_type IN ('none', 'billable', 'non_billable')),
  is_billable     boolean NOT NULL DEFAULT false,
  layout_id       uuid REFERENCES layouts(id) ON DELETE SET NULL,
  color           text,

  deleted_at      timestamptz,
  deleted_by      text,
  deleted_batch_id uuid,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text,

  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  -- A task cannot be its own parent. Longer cycles are caught in the service,
  -- where the error can name the path; this catches the trivial one for free.
  CHECK (parent_task_id IS NULL OR parent_task_id <> task_id)
);

CREATE INDEX ON project_task_extensions (project_id, status_id) WHERE deleted_at IS NULL;
CREATE INDEX ON project_task_extensions (project_id, task_list_id, order_index) WHERE deleted_at IS NULL;
CREATE INDEX ON project_task_extensions (phase_id) WHERE deleted_at IS NULL;
CREATE INDEX ON project_task_extensions (parent_task_id) WHERE parent_task_id IS NOT NULL;
CREATE INDEX ON project_task_extensions (organization_id, end_date) WHERE deleted_at IS NULL;
CREATE INDEX ON project_task_extensions (deleted_batch_id) WHERE deleted_batch_id IS NOT NULL;

-- Who is on a task, and in what capacity.
--
-- A table rather than an array on the task because the workspace already
-- learned that lesson: `taskAssignments` exists as its own collection so that
-- two managers adding a partner at the same time cannot have one write
-- overwrite the other. `kind` is what lets one person be an assignee and
-- another a reviewer without two columns that can disagree.
CREATE TABLE task_assignees (
  task_id         text NOT NULL REFERENCES project_task_extensions(task_id) ON DELETE CASCADE,
  organization_id text NOT NULL,
  user_id         text NOT NULL,
  kind            text NOT NULL DEFAULT 'assignee'
                    CHECK (kind IN ('assignee', 'contributor', 'reviewer', 'approver', 'follower')),
  added_at        timestamptz NOT NULL DEFAULT now(),
  added_by        text,
  PRIMARY KEY (task_id, user_id, kind)
);

CREATE INDEX ON task_assignees (user_id, kind);
CREATE INDEX ON task_assignees (organization_id, user_id);

-- ────────────────────────────────────────────────────────────────────
-- Checklists
--
-- `is_required` is the part that does work: a task with an unchecked required
-- item cannot be completed. That is enforced in the service, not by a
-- constraint, because "completed" lives in the task document.
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE task_checklists (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         text NOT NULL REFERENCES project_task_extensions(task_id) ON DELETE CASCADE,
  organization_id text NOT NULL,
  text            text NOT NULL,
  is_done         boolean NOT NULL DEFAULT false,
  is_required     boolean NOT NULL DEFAULT false,
  order_index     int NOT NULL DEFAULT 0,
  done_at         timestamptz,
  done_by         text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text
);

CREATE INDEX ON task_checklists (task_id, order_index);

-- ────────────────────────────────────────────────────────────────────
-- Dependencies
--
-- Cycles are rejected in `schedulingService.findCycle` rather than by a
-- constraint, because a database can only say "no" while the service can say
-- "a → b → c → a", which is the only version anybody can act on.
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE task_dependencies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  predecessor_id  text NOT NULL REFERENCES project_task_extensions(task_id) ON DELETE CASCADE,
  successor_id    text NOT NULL REFERENCES project_task_extensions(task_id) ON DELETE CASCADE,
  type            text NOT NULL DEFAULT 'FS' CHECK (type IN ('FS', 'SS', 'FF', 'SF')),
  lag_days        int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  UNIQUE (predecessor_id, successor_id),
  CHECK (predecessor_id <> successor_id)
);

CREATE INDEX ON task_dependencies (project_id);
CREATE INDEX ON task_dependencies (successor_id);

-- ────────────────────────────────────────────────────────────────────
-- Baselines
--
-- Insert-only. A baseline that can be edited is not a baseline — it is a second
-- copy of the current plan, and comparing the plan to itself always says
-- "on schedule".
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE project_baselines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            text NOT NULL,
  notes           text NOT NULL DEFAULT '',
  captured_at     timestamptz NOT NULL DEFAULT now(),
  captured_by     text
);

CREATE INDEX ON project_baselines (project_id, captured_at DESC);

CREATE TABLE task_baselines (
  baseline_id     uuid NOT NULL REFERENCES project_baselines(id) ON DELETE CASCADE,
  task_id         text NOT NULL,
  organization_id text NOT NULL,
  start_date      date,
  end_date        date,
  duration_days   int,
  estimated_hours numeric(9,2),
  PRIMARY KEY (baseline_id, task_id)
);

CREATE OR REPLACE FUNCTION baselines_are_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'a baseline is a record of what was planned and cannot be % ', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER task_baselines_no_update
  BEFORE UPDATE ON task_baselines
  FOR EACH ROW EXECUTE FUNCTION baselines_are_immutable();

-- ────────────────────────────────────────────────────────────────────
-- Recurrence and reminders
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE task_recurrences (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  task_id         text NOT NULL REFERENCES project_task_extensions(task_id) ON DELETE CASCADE,
  frequency       text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
  interval_count  int NOT NULL DEFAULT 1 CHECK (interval_count >= 1),
  weekdays        int[],
  day_of_month    int CHECK (day_of_month BETWEEN 1 AND 31),
  -- Business-day handling: what to do when an occurrence lands on a day off.
  on_non_working  text NOT NULL DEFAULT 'next'
                    CHECK (on_non_working IN ('next', 'previous', 'skip')),
  ends_on         date,
  ends_after      int,
  next_run_on     date,
  last_run_on     date,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text
);

CREATE INDEX ON task_recurrences (organization_id, next_run_on) WHERE is_active;

CREATE TABLE reminders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  project_id      uuid REFERENCES projects(id) ON DELETE CASCADE,
  entity_type     text NOT NULL,
  entity_id       text NOT NULL,
  user_id         text NOT NULL,
  remind_at       timestamptz NOT NULL,
  channel         text NOT NULL DEFAULT 'in_app'
                    CHECK (channel IN ('in_app', 'push', 'email')),
  message         text NOT NULL DEFAULT '',
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text
);

CREATE INDEX ON reminders (remind_at) WHERE sent_at IS NULL;
CREATE INDEX ON reminders (entity_type, entity_id);

CREATE TRIGGER phases_touch BEFORE UPDATE ON phases
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER task_lists_touch BEFORE UPDATE ON task_lists
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER project_task_extensions_touch BEFORE UPDATE ON project_task_extensions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
