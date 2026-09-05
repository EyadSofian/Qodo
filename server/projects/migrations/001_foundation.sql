-- Qodo Projects — foundation.
--
-- Projects, membership, roles, permission sets, customers, work calendars and
-- the append-only audit log. Everything Phase 1 needs to answer the only
-- question that matters before any feature is built: "may this person see this
-- project, and what did they do to it".
--
-- Rollback: DROP SCHEMA qodo_projects CASCADE;
--           No workspace data lives in this schema — see ADR-2.

SET search_path TO qodo_projects, public;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ────────────────────────────────────────────────────────────────────
-- Permission sets and project roles
--
-- Stored rather than hardcoded because §60 requires custom profiles. The
-- built-in five are seeded below with `is_builtin`, which the API refuses to
-- delete — an organization that deleted its own "Client" set would have no way
-- to express a client at all.
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE permission_sets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  key             text NOT NULL,
  name_ar         text NOT NULL,
  name_en         text NOT NULL,
  description_ar  text NOT NULL DEFAULT '',
  description_en  text NOT NULL DEFAULT '',
  is_client       boolean NOT NULL DEFAULT false,
  is_builtin      boolean NOT NULL DEFAULT false,
  permissions     jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, key)
);

CREATE TABLE user_permission_sets (
  organization_id   text NOT NULL,
  user_id           text NOT NULL,
  permission_set_id uuid NOT NULL REFERENCES permission_sets(id) ON DELETE RESTRICT,
  assigned_at       timestamptz NOT NULL DEFAULT now(),
  assigned_by       text,
  PRIMARY KEY (organization_id, user_id)
);

-- A role names somebody inside the organization — "QA Lead", "Architect" — and
-- is an @mention target and a hierarchy node. It is not an access level; that
-- is the permission set. Keeping them apart is why one employee can be a
-- project manager on their own project and a member on somebody else's.
CREATE TABLE project_roles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  name_ar         text NOT NULL,
  name_en         text NOT NULL,
  parent_id       uuid REFERENCES project_roles(id) ON DELETE SET NULL,
  is_client_role  boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON project_roles (organization_id);

-- ────────────────────────────────────────────────────────────────────
-- Working time
--
-- Every date calculation in the product — duration, critical path, SLA, budget
-- burn — needs to know which days are working days. Zoho moved to per-user
-- calendars in July 2025 for regional teams; the same shape is here from the
-- start because retrofitting "whose calendar?" through a scheduler is worse
-- than carrying the column.
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE work_calendars (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  name            text NOT NULL,
  -- ISO-8601 weekday numbers, 1 = Monday. Egypt's working week is Sun–Thu,
  -- so the seeded default is {7,1,2,3,4} rather than the Mon–Fri assumption
  -- most scheduling code is born with.
  workdays        int[] NOT NULL DEFAULT '{7,1,2,3,4}',
  day_start_minutes int NOT NULL DEFAULT 540,
  day_end_minutes   int NOT NULL DEFAULT 1020,
  timezone        text NOT NULL DEFAULT 'Africa/Cairo',
  is_default      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (day_end_minutes > day_start_minutes)
);

CREATE UNIQUE INDEX ON work_calendars (organization_id) WHERE is_default;

CREATE TABLE calendar_holidays (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id uuid NOT NULL REFERENCES work_calendars(id) ON DELETE CASCADE,
  holiday_on  date NOT NULL,
  name        text NOT NULL DEFAULT '',
  UNIQUE (calendar_id, holiday_on)
);

CREATE TABLE user_calendars (
  organization_id text NOT NULL,
  user_id         text NOT NULL,
  calendar_id     uuid NOT NULL REFERENCES work_calendars(id) ON DELETE CASCADE,
  PRIMARY KEY (organization_id, user_id)
);

-- ────────────────────────────────────────────────────────────────────
-- Customers and groups
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE customers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  name            text NOT NULL,
  -- Zoho renamed "Client Company" to "Customers" in June 2025 and made the
  -- individual/business distinction explicit. A freelance client is not a
  -- company, and invoicing cares.
  kind            text NOT NULL DEFAULT 'business' CHECK (kind IN ('individual', 'business')),
  email           text,
  phone           text,
  address         text NOT NULL DEFAULT '',
  website         text,
  notes           text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  deleted_at      timestamptz,
  deleted_by      text
);

CREATE INDEX ON customers (organization_id) WHERE deleted_at IS NULL;

CREATE TABLE project_groups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  name_ar         text NOT NULL,
  name_en         text NOT NULL,
  description     text NOT NULL DEFAULT '',
  color           text NOT NULL DEFAULT '#1D6FB8',
  order_index     int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  deleted_at      timestamptz
);

CREATE INDEX ON project_groups (organization_id, order_index) WHERE deleted_at IS NULL;

-- ────────────────────────────────────────────────────────────────────
-- Projects
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE projects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  -- The readable prefix: ENG-42 on an issue, on an export, in a mail subject.
  -- Unique per organization and immutable after creation, because it is
  -- embedded in every reference that has already left the system.
  key             text NOT NULL,
  name            text NOT NULL,
  description     text NOT NULL DEFAULT '',
  owner_id        text NOT NULL,
  customer_id     uuid REFERENCES customers(id) ON DELETE SET NULL,
  group_id        uuid REFERENCES project_groups(id) ON DELETE SET NULL,
  calendar_id     uuid REFERENCES work_calendars(id) ON DELETE SET NULL,

  -- Statuses are rows (migration 002), not an enum, because §32 requires
  -- organizations to define their own and to retire one without breaking the
  -- records that still point at it.
  status_id       uuid,
  start_date      date,
  end_date        date,

  -- 'private'  — only members, the default and the safe one
  -- 'portal'   — any authenticated workspace member may find and open it
  access          text NOT NULL DEFAULT 'private' CHECK (access IN ('private', 'portal')),

  currency        char(3) NOT NULL DEFAULT 'EGP',
  billing_method  text NOT NULL DEFAULT 'none'
                    CHECK (billing_method IN ('none', 'fixed_cost', 'based_on_project_hours',
                                              'based_on_staff_hours', 'based_on_task_hours')),
  color           text NOT NULL DEFAULT '#1D6FB8',
  layout_id       uuid,

  is_template     boolean NOT NULL DEFAULT false,
  archived_at     timestamptz,
  archived_by     text,

  -- Soft delete. §65 is explicit that a normal delete must not destroy business
  -- data; the recycle bin reads exactly these two columns, and the batch id is
  -- what makes a cascading restore possible — see 007 in the database doc.
  deleted_at      timestamptz,
  deleted_by      text,
  deleted_batch_id uuid,

  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text,

  UNIQUE (organization_id, key),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE INDEX ON projects (organization_id, status_id) WHERE deleted_at IS NULL AND archived_at IS NULL;
CREATE INDEX ON projects (organization_id, group_id) WHERE deleted_at IS NULL;
CREATE INDEX ON projects (organization_id, customer_id) WHERE deleted_at IS NULL;
CREATE INDEX ON projects (organization_id, owner_id) WHERE deleted_at IS NULL;
CREATE INDEX ON projects (deleted_batch_id) WHERE deleted_batch_id IS NOT NULL;

-- The authorization join, and the hottest table in the schema.
--
-- Every Projects request begins by asking "which projects may this person
-- see". Membership is that answer. It is a table rather than an array on the
-- project for the reason a calendar invite is not an array on the event, which
-- server/store.js already explains for this codebase: two people being added at
-- once must not have one write overwrite the other, and the audit log needs a
-- subject id per membership to say who added whom.
CREATE TABLE project_members (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    text NOT NULL,
  project_id         uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id            text NOT NULL,
  role               text NOT NULL DEFAULT 'member'
                       CHECK (role IN ('owner', 'manager', 'member', 'viewer', 'client')),
  project_role_id    uuid REFERENCES project_roles(id) ON DELETE SET NULL,
  -- Denormalised from the role so the client boundary is one indexed column
  -- rather than a join every request. The service writes both together.
  is_client          boolean NOT NULL DEFAULT false,
  allocation_percent int NOT NULL DEFAULT 100 CHECK (allocation_percent BETWEEN 0 AND 100),
  added_at           timestamptz NOT NULL DEFAULT now(),
  added_by           text,
  UNIQUE (project_id, user_id)
);

CREATE INDEX ON project_members (user_id, organization_id);
CREATE INDEX ON project_members (project_id, is_client);

CREATE TABLE project_favorites (
  organization_id text NOT NULL,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id         text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE project_recent_views (
  organization_id text NOT NULL,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id         text NOT NULL,
  viewed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX ON project_recent_views (user_id, viewed_at DESC);

-- ────────────────────────────────────────────────────────────────────
-- Audit
--
-- §64 asks for an append-only log, and the workspace's existing `activity`
-- collection cannot be one: it is written through store.update(), so history is
-- mutable. This table is the replacement for Projects, and the guarantee is
-- enforced by the database rather than by everyone remembering — the trigger
-- below refuses UPDATE and DELETE outright, so even a mistaken service, a
-- migration or a psql session cannot rewrite what happened.
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE audit_events (
  id              bigserial PRIMARY KEY,
  organization_id text NOT NULL,
  project_id      uuid,
  actor_id        text,
  -- 'user' | 'automation' | 'system' | 'import' | 'api'. Kept as text because
  -- an automation engine that cannot say "this was me, not the manager" makes
  -- its own audit trail useless.
  source          text NOT NULL DEFAULT 'user',
  entity_type     text NOT NULL,
  entity_id       text NOT NULL,
  action          text NOT NULL,
  before_state    jsonb,
  after_state     jsonb,
  correlation_id  text,
  ip              inet,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON audit_events (organization_id, entity_type, entity_id, occurred_at DESC);
CREATE INDEX ON audit_events (organization_id, project_id, occurred_at DESC);
CREATE INDEX ON audit_events (organization_id, actor_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION audit_events_are_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only (attempted %)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_are_immutable();

CREATE TRIGGER audit_events_no_delete
  BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_are_immutable();

-- ────────────────────────────────────────────────────────────────────
-- updated_at
--
-- One trigger rather than every service remembering. A service that forgets is
-- not a caught bug — it is a row that quietly reports the wrong modification
-- time forever.
-- ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER projects_touch BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER customers_touch BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER permission_sets_touch BEFORE UPDATE ON permission_sets
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
