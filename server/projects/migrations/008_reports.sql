-- Qodo Projects — reports and dashboards.
--
-- A saved report is a *definition*, never a result set. Storing the rows would
-- mean a report that says something different from the project it describes the
-- moment anybody changes anything, and the whole value of a report is that it
-- is current.
--
-- Rollback: DROP SCHEMA qodo_projects CASCADE;

SET search_path TO qodo_projects, public;

CREATE TABLE report_folders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  name            text NOT NULL,
  module_key      text,
  order_index     int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text
);

CREATE INDEX ON report_folders (organization_id, order_index);

CREATE TABLE saved_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  folder_id       uuid REFERENCES report_folders(id) ON DELETE SET NULL,
  project_id      uuid REFERENCES projects(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text NOT NULL DEFAULT '',
  module_key      text NOT NULL,

  -- { groupBy, measure, aggregate, criteria, match, dateField, dateRange,
  --   chart, columns }. A closed vocabulary the report engine understands —
  -- not SQL, and not anything that becomes SQL without passing through the
  -- allowlists in reportService.
  definition      jsonb NOT NULL,

  visibility      text NOT NULL DEFAULT 'private'
                    CHECK (visibility IN ('private', 'shared', 'project', 'organization')),
  shared_with     jsonb NOT NULL DEFAULT '[]'::jsonb,
  owner_id        text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON saved_reports (organization_id, module_key);
CREATE INDEX ON saved_reports (organization_id, owner_id);
CREATE INDEX ON saved_reports (project_id) WHERE project_id IS NOT NULL;

CREATE TABLE report_schedules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  report_id       uuid NOT NULL REFERENCES saved_reports(id) ON DELETE CASCADE,
  frequency       text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  weekday         int CHECK (weekday BETWEEN 1 AND 7),
  day_of_month    int CHECK (day_of_month BETWEEN 1 AND 31),
  format          text NOT NULL DEFAULT 'xlsx' CHECK (format IN ('csv', 'xlsx', 'pdf')),
  recipients      jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_run_on     date,
  last_run_at     timestamptz,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text
);

CREATE INDEX ON report_schedules (organization_id, next_run_on) WHERE is_active;

-- ────────────────────────────────────────────────────────────────────
-- Dashboards
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE dashboards (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  project_id      uuid REFERENCES projects(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text NOT NULL DEFAULT '',
  visibility      text NOT NULL DEFAULT 'private'
                    CHECK (visibility IN ('private', 'shared', 'project', 'organization')),
  shared_with     jsonb NOT NULL DEFAULT '[]'::jsonb,
  owner_id        text NOT NULL,
  is_default      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON dashboards (organization_id, owner_id);
CREATE INDEX ON dashboards (project_id) WHERE project_id IS NOT NULL;

CREATE TABLE dashboard_widgets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id    uuid NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  organization_id text NOT NULL,
  type            text NOT NULL,
  title           text NOT NULL DEFAULT '',
  -- Either a saved report, or an inline definition. A widget pointing at a
  -- report means editing the report updates every dashboard showing it, which
  -- is usually what somebody wants.
  report_id       uuid REFERENCES saved_reports(id) ON DELETE SET NULL,
  config          jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- { x, y, w, h } on a twelve-column grid.
  position        jsonb NOT NULL DEFAULT '{"x":0,"y":0,"w":4,"h":3}'::jsonb,
  order_index     int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON dashboard_widgets (dashboard_id, order_index);

CREATE TRIGGER saved_reports_touch BEFORE UPDATE ON saved_reports
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER dashboards_touch BEFORE UPDATE ON dashboards
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
