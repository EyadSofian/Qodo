-- Qodo Projects — the issue tracker.
--
-- Separate from tasks on purpose, and Zoho keeps them separate for the same
-- reason: a task is work somebody agreed to do, an issue is something wrong
-- that somebody found. They carry different fields (severity, reproducibility,
-- the release it affects), different reports, and different automation — and an
-- issue that is really a task gets linked to one rather than becoming one.
--
-- Rollback: DROP SCHEMA qodo_projects CASCADE;

SET search_path TO qodo_projects, public;

CREATE TABLE issues (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- `ENG-42`. Generated from the project prefix inside the insert transaction,
  -- so two concurrent reports cannot claim the same number.
  key             text NOT NULL,
  number          int NOT NULL,

  title           text NOT NULL,
  description     text NOT NULL DEFAULT '',
  reporter_id     text NOT NULL,
  assignee_id     text,

  status_id       uuid REFERENCES statuses(id) ON DELETE SET NULL,
  priority        text NOT NULL DEFAULT 'normal'
                    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  severity        text NOT NULL DEFAULT 'minor'
                    CHECK (severity IN ('cosmetic', 'minor', 'major', 'critical', 'blocker')),
  classification  text,
  reproducibility text CHECK (reproducibility IN ('always', 'sometimes', 'rarely', 'unable', 'not_tried')),
  module_affected text,

  -- Which phase the defect showed up in, and which one it is meant to be fixed
  -- for. Two different questions, and reports ask both.
  affected_phase_id uuid REFERENCES phases(id) ON DELETE SET NULL,
  target_phase_id   uuid REFERENCES phases(id) ON DELETE SET NULL,

  due_date        date,
  resolution      text,
  closed_at       timestamptz,
  layout_id       uuid REFERENCES layouts(id) ON DELETE SET NULL,

  -- Issues raised by a client are visible to that client. Staff-raised issues
  -- are internal unless somebody says otherwise — the safe default, since an
  -- internal defect discussion is not something a customer should stumble into.
  is_external     boolean NOT NULL DEFAULT false,

  deleted_at      timestamptz,
  deleted_by      text,
  deleted_batch_id uuid,

  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text,

  UNIQUE (project_id, number)
);

CREATE INDEX ON issues (project_id, status_id) WHERE deleted_at IS NULL;
CREATE INDEX ON issues (organization_id, assignee_id) WHERE deleted_at IS NULL;
CREATE INDEX ON issues (organization_id, reporter_id) WHERE deleted_at IS NULL;
CREATE INDEX ON issues (project_id, severity, priority) WHERE deleted_at IS NULL;
CREATE INDEX ON issues (organization_id, due_date) WHERE deleted_at IS NULL AND closed_at IS NULL;
CREATE UNIQUE INDEX ON issues (organization_id, key);

-- An issue links to a task, or to another issue.
--
-- Polymorphic on purpose: "this bug blocks that task" and "this bug duplicates
-- that bug" are the same relationship with different ends, and two tables would
-- mean writing every traversal twice.
CREATE TABLE issue_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  issue_id        uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  linked_type     text NOT NULL CHECK (linked_type IN ('task', 'issue')),
  linked_id       text NOT NULL,
  relation        text NOT NULL DEFAULT 'relates_to'
                    CHECK (relation IN ('relates_to', 'blocks', 'blocked_by', 'duplicates', 'caused_by')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  UNIQUE (issue_id, linked_type, linked_id, relation)
);

CREATE INDEX ON issue_links (linked_type, linked_id);

-- ────────────────────────────────────────────────────────────────────
-- SLA
--
-- A promise about how quickly something gets answered and fixed, measured in
-- *working* hours against the project's calendar — a four-hour response target
-- signed on a Thursday afternoon is not breached at Friday lunchtime.
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE sla_policies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  name            text NOT NULL,
  description     text NOT NULL DEFAULT '',
  -- Which issues this policy applies to: [{field, operator, value}].
  criteria        jsonb NOT NULL DEFAULT '[]'::jsonb,
  match           text NOT NULL DEFAULT 'all' CHECK (match IN ('all', 'any')),
  calendar_id     uuid REFERENCES work_calendars(id) ON DELETE SET NULL,
  response_minutes   int,
  resolution_minutes int,
  -- [{ afterMinutes, notify: [...], assignTo }] — who is told, and when.
  escalations     jsonb NOT NULL DEFAULT '[]'::jsonb,
  order_index     int NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  CHECK (response_minutes IS NOT NULL OR resolution_minutes IS NOT NULL)
);

CREATE INDEX ON sla_policies (organization_id, order_index) WHERE is_active;

-- One clock per issue.
--
-- `paused_ms` is what makes "waiting on the customer" not count against us:
-- the clock stops, and the target moves out by however long it was stopped.
CREATE TABLE sla_clocks (
  issue_id        uuid PRIMARY KEY REFERENCES issues(id) ON DELETE CASCADE,
  organization_id text NOT NULL,
  policy_id       uuid NOT NULL REFERENCES sla_policies(id) ON DELETE CASCADE,
  started_at      timestamptz NOT NULL DEFAULT now(),
  paused_at       timestamptz,
  paused_ms       bigint NOT NULL DEFAULT 0,
  response_due_at   timestamptz,
  resolution_due_at timestamptz,
  responded_at    timestamptz,
  resolved_at     timestamptz,
  response_breached_at   timestamptz,
  resolution_breached_at timestamptz,
  escalation_level int NOT NULL DEFAULT 0,
  last_escalated_at timestamptz
);

CREATE INDEX ON sla_clocks (organization_id, response_due_at)
  WHERE responded_at IS NULL AND response_breached_at IS NULL;
CREATE INDEX ON sla_clocks (organization_id, resolution_due_at)
  WHERE resolved_at IS NULL AND resolution_breached_at IS NULL;

-- ────────────────────────────────────────────────────────────────────
-- Business rules
--
-- Distinct from workflow rules, and Zoho keeps them distinct for a reason:
-- these are an *ordered* list evaluated top to bottom on save, and any rule may
-- stop the ones below it. The subtlety is entirely in the ordering.
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE business_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  module_key      text NOT NULL DEFAULT 'issue',
  name            text NOT NULL,
  criteria        jsonb NOT NULL DEFAULT '[]'::jsonb,
  match           text NOT NULL DEFAULT 'all' CHECK (match IN ('all', 'any')),
  actions         jsonb NOT NULL DEFAULT '[]'::jsonb,
  stop_processing boolean NOT NULL DEFAULT false,
  order_index     int NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text
);

CREATE INDEX ON business_rules (organization_id, module_key, order_index) WHERE is_active;

CREATE TRIGGER issues_touch BEFORE UPDATE ON issues
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
