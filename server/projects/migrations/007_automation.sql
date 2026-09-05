-- Qodo Projects — automation.
--
-- Blueprints, workflow rules, macros, webhooks and the run log.
--
-- The decision that shapes every table here: **nothing stored is executable.**
-- Criteria and actions are closed vocabularies evaluated by our own code, not
-- expressions, not templates that reach a function, and not code. The one place
-- customer logic actually runs is a sandboxed script runner, and it is
-- deliberately not in this migration.
--
-- The second: **a record remembers the rules it was created under.** Publishing
-- a new blueprint must not retroactively invalidate a task somebody closed last
-- month, which is why versions are immutable rows and records point at one.
--
-- Rollback: DROP SCHEMA qodo_projects CASCADE;

SET search_path TO qodo_projects, public;

-- ────────────────────────────────────────────────────────────────────
-- Blueprint — the state machine
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE blueprints (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  module_key      text NOT NULL,
  name            text NOT NULL,
  description     text NOT NULL DEFAULT '',
  is_active       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  UNIQUE (organization_id, module_key, name)
);

CREATE INDEX ON blueprints (organization_id, module_key) WHERE is_active;

-- Immutable. Publishing edits nothing; it writes a new version and points the
-- blueprint at it.
CREATE TABLE blueprint_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id    uuid NOT NULL REFERENCES blueprints(id) ON DELETE CASCADE,
  organization_id text NOT NULL,
  version_no      int NOT NULL,
  -- The whole definition, including its transitions. Stored as one document so
  -- a version is a single indivisible thing rather than a set of rows that
  -- could be half-published.
  definition      jsonb NOT NULL,
  state           text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'superseded')),
  published_at    timestamptz,
  published_by    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  UNIQUE (blueprint_id, version_no)
);

CREATE UNIQUE INDEX ON blueprint_versions (blueprint_id) WHERE state = 'published';

CREATE OR REPLACE FUNCTION blueprint_versions_are_immutable() RETURNS trigger AS $$
BEGIN
  -- The definition itself never changes. Only the lifecycle columns move, and
  -- only forwards: draft → published → superseded.
  IF NEW.definition IS DISTINCT FROM OLD.definition THEN
    RAISE EXCEPTION 'a blueprint version is immutable — publish a new one instead';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER blueprint_versions_no_edit
  BEFORE UPDATE ON blueprint_versions
  FOR EACH ROW EXECUTE FUNCTION blueprint_versions_are_immutable();

-- Which version a record is being governed by.
--
-- Without this, publishing a stricter blueprint would retroactively make every
-- existing record illegal — a task that moved to Done last month would fail a
-- validation written this month. Migration onto a new version is an action
-- somebody takes, never a side effect of publishing.
CREATE TABLE record_blueprint_versions (
  organization_id text NOT NULL,
  entity_type     text NOT NULL,
  entity_id       text NOT NULL,
  version_id      uuid NOT NULL REFERENCES blueprint_versions(id) ON DELETE CASCADE,
  attached_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, entity_id)
);

CREATE INDEX ON record_blueprint_versions (version_id);

-- ────────────────────────────────────────────────────────────────────
-- Workflow rules
--
-- One engine, parameterised by module. Seven modules with the same
-- trigger/criteria/action shape is one table, not seven.
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE workflow_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  module_key      text NOT NULL,
  project_id      uuid REFERENCES projects(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text NOT NULL DEFAULT '',

  trigger         text NOT NULL CHECK (trigger IN (
                    'create', 'update', 'field_change', 'status_change',
                    'assignment', 'completion', 'delete', 'time_based')),
  -- Which field a `field_change` watches. Null for the others.
  trigger_field   text,

  criteria        jsonb NOT NULL DEFAULT '[]'::jsonb,
  match           text NOT NULL DEFAULT 'all' CHECK (match IN ('all', 'any')),
  actions         jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- For `time_based`: an offset in working days from a date field.
  -- { field: 'end_date', offsetDays: -3 } is "three working days before due".
  schedule        jsonb,
  last_run_at     timestamptz,

  is_active       boolean NOT NULL DEFAULT true,
  order_index     int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON workflow_rules (organization_id, module_key, trigger) WHERE is_active;
CREATE INDEX ON workflow_rules (organization_id, trigger) WHERE is_active AND trigger = 'time_based';

-- A batch of actions somebody runs by hand, rather than a trigger firing it.
CREATE TABLE macros (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  module_key      text NOT NULL,
  name            text NOT NULL,
  actions         jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text
);

CREATE INDEX ON macros (organization_id, module_key) WHERE is_active;

CREATE TABLE email_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  key             text NOT NULL,
  subject_ar      text NOT NULL,
  subject_en      text NOT NULL,
  body_ar         text NOT NULL,
  body_en         text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, key)
);

-- ────────────────────────────────────────────────────────────────────
-- Webhooks
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE webhook_endpoints (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  name            text NOT NULL,
  url             text NOT NULL,
  method          text NOT NULL DEFAULT 'POST' CHECK (method IN ('POST', 'PUT', 'PATCH')),
  headers         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Never selected by any read endpoint. The API answers with a mask.
  secret          text NOT NULL,
  events          jsonb NOT NULL DEFAULT '[]'::jsonb,
  timeout_ms      int NOT NULL DEFAULT 5000 CHECK (timeout_ms BETWEEN 500 AND 30000),
  max_retries     int NOT NULL DEFAULT 3 CHECK (max_retries BETWEEN 0 AND 10),
  is_active       boolean NOT NULL DEFAULT true,
  -- Set when the endpoint has failed so persistently that retrying it is just
  -- noise. Cleared when somebody fixes it and re-enables it by hand.
  disabled_at     timestamptz,
  disabled_reason text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text
);

CREATE INDEX ON webhook_endpoints (organization_id) WHERE is_active AND disabled_at IS NULL;

CREATE TABLE webhook_deliveries (
  id              bigserial PRIMARY KEY,
  endpoint_id     uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  organization_id text NOT NULL,
  event           text NOT NULL,
  payload         jsonb NOT NULL,
  attempt         int NOT NULL DEFAULT 1,
  response_status int,
  response_body   text,
  error           text,
  duration_ms     int,
  delivered_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON webhook_deliveries (endpoint_id, created_at DESC);
CREATE INDEX ON webhook_deliveries (organization_id, created_at DESC);

-- ────────────────────────────────────────────────────────────────────
-- Runs
--
-- Automation runs at least once, so it has to be safe to run twice. The
-- idempotency key is what makes a retry after a crash insert nothing and do
-- nothing.
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE automation_runs (
  id              bigserial PRIMARY KEY,
  organization_id text NOT NULL,
  project_id      uuid,
  rule_type       text NOT NULL CHECK (rule_type IN ('workflow', 'business', 'blueprint', 'macro', 'sla')),
  rule_id         uuid,
  entity_type     text NOT NULL,
  entity_id       text NOT NULL,
  trigger         text,
  status          text NOT NULL CHECK (status IN ('applied', 'skipped', 'failed')),
  actions_applied jsonb NOT NULL DEFAULT '[]'::jsonb,
  error           text,
  -- How deep the chain that produced this run is. An action that re-triggers
  -- its own rule is the classic failure, and this is what stops it.
  depth           int NOT NULL DEFAULT 0,
  idempotency_key text NOT NULL,
  ran_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);

CREATE INDEX ON automation_runs (organization_id, ran_at DESC);
CREATE INDEX ON automation_runs (rule_id, ran_at DESC);
CREATE INDEX ON automation_runs (entity_type, entity_id, ran_at DESC);

-- Metered, not to bill anybody, but so a runaway loop costs something finite.
CREATE TABLE automation_quota (
  organization_id text NOT NULL,
  period_month    date NOT NULL,
  runs_used       int NOT NULL DEFAULT 0,
  runs_allowed    int NOT NULL DEFAULT 50000,
  PRIMARY KEY (organization_id, period_month)
);

CREATE TRIGGER workflow_rules_touch BEFORE UPDATE ON workflow_rules
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
