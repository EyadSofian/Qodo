-- Qodo Projects — integrations, import and export.
--
-- A connector row is a *configuration*, not a claim. An adapter with no
-- credentials reports "not connected" and its endpoints answer 409 — §68 is
-- explicit that an integration must not be presented as operational until a
-- real credential exists, and the alternative is a settings page full of logos
-- that do nothing.
--
-- Rollback: DROP SCHEMA qodo_projects CASCADE;

SET search_path TO qodo_projects, public;

CREATE TABLE integration_connections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  provider        text NOT NULL,
  name            text NOT NULL,

  -- Encrypted at rest and never selected by a read endpoint. The API answers
  -- with a mask, exactly as webhook secrets do.
  credentials     text,
  scopes          jsonb NOT NULL DEFAULT '[]'::jsonb,
  settings        jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- 'not_configured' is the honest default and the one that matters: it is what
  -- an adapter says before anybody has given it a credential.
  status          text NOT NULL DEFAULT 'not_configured'
                    CHECK (status IN ('not_configured', 'connected', 'error', 'disabled')),
  last_sync_at    timestamptz,
  last_error      text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider, name)
);

CREATE INDEX ON integration_connections (organization_id, provider);

-- ────────────────────────────────────────────────────────────────────
-- Imports
--
-- Every import is a run, and a run remembers its mapping, its dry-run result
-- and its errors. §66 forbids faking a successful import, and the way to keep
-- that promise is to make the failures as durable as the successes.
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE import_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  project_id      uuid REFERENCES projects(id) ON DELETE CASCADE,
  source          text NOT NULL CHECK (source IN ('csv', 'xlsx', 'json', 'jira', 'basecamp', 'mpp')),
  target_module   text NOT NULL,
  file_name       text NOT NULL DEFAULT '',
  -- { csvColumn: fieldKey }. Chosen by a person after seeing the preview, not
  -- guessed and applied.
  mapping         jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_dry_run      boolean NOT NULL DEFAULT true,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'previewed', 'completed', 'failed')),
  totals          jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Row number and reason for everything that did not import. A run that
  -- reports "42 imported" out of 50 without saying which eight failed has told
  -- somebody nothing they can act on.
  errors          jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  completed_at    timestamptz
);

CREATE INDEX ON import_runs (organization_id, created_at DESC);
CREATE INDEX ON import_runs (project_id) WHERE project_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────
-- Exports
--
-- Audited, because §67 asks for it and because "who took the client list" is a
-- question that gets asked after somebody leaves.
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE export_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  project_id      uuid REFERENCES projects(id) ON DELETE SET NULL,
  module_key      text NOT NULL,
  format          text NOT NULL CHECK (format IN ('csv', 'xlsx', 'json')),
  row_count       int NOT NULL DEFAULT 0,
  filters         jsonb NOT NULL DEFAULT '{}'::jsonb,
  exported_by     text NOT NULL,
  exported_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON export_runs (organization_id, exported_at DESC);
CREATE INDEX ON export_runs (organization_id, exported_by, exported_at DESC);

CREATE TRIGGER integration_connections_touch BEFORE UPDATE ON integration_connections
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
