-- Qodo Projects — time, timesheets and money.
--
-- Two decisions in this file are worth reading before the tables.
--
-- **The running-timer invariant is a database constraint, not a service check.**
-- A person may have at most one timer running. Enforcing that in JavaScript
-- means two browser tabs can both start one, and the second write wins silently
-- — the partial unique index below makes the second write fail instead.
--
-- **Rates live in their own tables, not on the user.** What somebody costs per
-- hour is the most sensitive number in the product, it changes over time, and a
-- report about last quarter must use last quarter's rate. A column on `users`
-- could express none of that.
--
-- Rollback: DROP SCHEMA qodo_projects CASCADE;

SET search_path TO qodo_projects, public;

-- ────────────────────────────────────────────────────────────────────
-- Timers
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE timers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  user_id         text NOT NULL,
  project_id      uuid REFERENCES projects(id) ON DELETE CASCADE,
  entity_type     text NOT NULL CHECK (entity_type IN ('task', 'issue')),
  entity_id       text NOT NULL,
  started_at      timestamptz NOT NULL DEFAULT now(),
  -- Time already banked by pausing. A timer that has been paused twice carries
  -- both stretches here and only the current run in `started_at`.
  accumulated_seconds int NOT NULL DEFAULT 0,
  paused_at       timestamptz,
  stopped_at      timestamptz,
  notes           text NOT NULL DEFAULT ''
);

-- The invariant. One running timer per person, enforced by the database so two
-- tabs cannot both claim one.
CREATE UNIQUE INDEX timers_one_running_per_user
  ON timers (organization_id, user_id)
  WHERE stopped_at IS NULL;

CREATE INDEX ON timers (entity_type, entity_id) WHERE stopped_at IS NULL;

-- ────────────────────────────────────────────────────────────────────
-- Timesheets
--
-- Zoho rebuilt these in November 2025 as "a collection of time logs grouped for
-- review and approval", which is exactly the object this models. A time log on
-- its own is a fact; a timesheet is a claim somebody submits and somebody else
-- answers for.
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE timesheets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  user_id         text NOT NULL,
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  submitted_at    timestamptz,
  reviewed_at     timestamptz,
  reviewed_by     text,
  rejection_reason text NOT NULL DEFAULT '',
  -- Once time has been invoiced it stops being editable, whatever its approval
  -- state. Billing is downstream of approval and must not be silently rewritten.
  locked_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, period_start),
  CHECK (period_end >= period_start)
);

CREATE INDEX ON timesheets (organization_id, status);
CREATE INDEX ON timesheets (organization_id, user_id, period_start DESC);

CREATE TABLE time_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id         text REFERENCES project_task_extensions(task_id) ON DELETE SET NULL,
  issue_id        uuid REFERENCES issues(id) ON DELETE SET NULL,
  user_id         text NOT NULL,
  timesheet_id    uuid REFERENCES timesheets(id) ON DELETE SET NULL,

  log_date        date NOT NULL,
  hours           numeric(9,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  notes           text NOT NULL DEFAULT '',
  is_billable     boolean NOT NULL DEFAULT false,

  -- The rates in force when the entry was approved, copied here on purpose.
  -- A report about last quarter must use last quarter's rate, and a live join
  -- to the rate table would silently restate history every time somebody got a
  -- raise.
  bill_rate       numeric(12,4),
  cost_rate       numeric(12,4),
  currency        char(3),

  approval_status text NOT NULL DEFAULT 'draft'
                    CHECK (approval_status IN ('draft', 'submitted', 'approved', 'rejected')),
  invoiced_at     timestamptz,
  invoice_reference text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text,

  -- Time is logged against exactly one thing, or against the project itself.
  CHECK (task_id IS NULL OR issue_id IS NULL)
);

CREATE INDEX ON time_entries (organization_id, user_id, log_date);
CREATE INDEX ON time_entries (project_id, log_date);
CREATE INDEX ON time_entries (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX ON time_entries (issue_id) WHERE issue_id IS NOT NULL;
CREATE INDEX ON time_entries (timesheet_id) WHERE timesheet_id IS NOT NULL;
CREATE INDEX ON time_entries (organization_id, approval_status, log_date);

-- ────────────────────────────────────────────────────────────────────
-- Rates
--
-- Effective-dated, because a raise must not rewrite last quarter's cost report.
-- The row that applies to a date is the one with the latest `effective_from`
-- not after it.
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE cost_rates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  user_id         text NOT NULL,
  -- A project-specific rate overrides the organization-wide one. NULL is the
  -- default rate for that person everywhere.
  project_id      uuid REFERENCES projects(id) ON DELETE CASCADE,
  rate            numeric(12,4) NOT NULL CHECK (rate >= 0),
  currency        char(3) NOT NULL DEFAULT 'EGP',
  effective_from  date NOT NULL DEFAULT CURRENT_DATE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  UNIQUE (organization_id, user_id, project_id, effective_from)
);

CREATE INDEX ON cost_rates (organization_id, user_id, effective_from DESC);

CREATE TABLE billing_rates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  user_id         text,
  project_id      uuid REFERENCES projects(id) ON DELETE CASCADE,
  rate            numeric(12,4) NOT NULL CHECK (rate >= 0),
  currency        char(3) NOT NULL DEFAULT 'EGP',
  effective_from  date NOT NULL DEFAULT CURRENT_DATE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text
);

CREATE INDEX ON billing_rates (organization_id, project_id, user_id, effective_from DESC);

-- ────────────────────────────────────────────────────────────────────
-- Budgets
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE budgets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase_id        uuid REFERENCES phases(id) ON DELETE CASCADE,

  -- The six kinds Zoho supports, because they answer different questions:
  -- "how many hours have we got" is not "how much money", and "per task" is
  -- not "for the project".
  type            text NOT NULL CHECK (type IN (
                    'project_hours', 'staff_hours', 'project_amount',
                    'fixed_cost', 'task_hours', 'issue_hours')),

  amount          numeric(14,4),
  hours           numeric(12,2),
  currency        char(3) NOT NULL DEFAULT 'EGP',
  -- Warn at this proportion of the budget. 0.8 is a warning worth having;
  -- finding out at 1.0 is finding out too late.
  threshold_percent int NOT NULL DEFAULT 80 CHECK (threshold_percent BETWEEN 1 AND 200),
  threshold_notified_at timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (amount IS NOT NULL OR hours IS NOT NULL)
);

CREATE INDEX ON budgets (project_id);
CREATE UNIQUE INDEX ON budgets (project_id, type) WHERE phase_id IS NULL;

CREATE TABLE expenses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase_id        uuid REFERENCES phases(id) ON DELETE SET NULL,
  description     text NOT NULL,
  category        text,
  amount          numeric(14,4) NOT NULL CHECK (amount >= 0),
  currency        char(3) NOT NULL DEFAULT 'EGP',
  incurred_on     date NOT NULL DEFAULT CURRENT_DATE,
  is_billable     boolean NOT NULL DEFAULT false,
  invoiced_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  deleted_at      timestamptz
);

CREATE INDEX ON expenses (project_id, incurred_on) WHERE deleted_at IS NULL;

-- Where the money went once it left this system. A reference, not a copy: the
-- invoice itself belongs to the accounting system, and duplicating it here
-- would give the company two answers to "what did we bill".
CREATE TABLE invoice_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  external_system text NOT NULL,
  external_id     text NOT NULL,
  reference       text,
  status          text,
  amount          numeric(14,4),
  currency        char(3),
  issued_on       date,
  synced_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, external_system, external_id)
);

CREATE INDEX ON invoice_links (project_id);

CREATE TRIGGER timesheets_touch BEFORE UPDATE ON timesheets
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER time_entries_touch BEFORE UPDATE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER budgets_touch BEFORE UPDATE ON budgets
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
