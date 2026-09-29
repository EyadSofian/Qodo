-- E-Learning Production — production runs.
--
-- A course stays the long-lived catalogue identity. A production run is one
-- pass of one pinned workflow-template version over it (AI-assisted new
-- program, expert-led new program, or a revamp of an earlier release); a
-- release is what a run publishes. Runs have stages, stages have tasks, tasks
-- have checklists, evidence and version-bound submissions. Dry-run and UAT
-- findings are tracked issues. Lesson assets (migration 001) are untouched in
-- meaning: the run reads them through automatic gates.
--
-- Additive only. Nothing existing is dropped, rewritten or re-typed. Two
-- CHECK lists are widened (course roles, activity events); four nullable
-- columns and one defaulted column are added to existing tables; the version
-- immutability function is replaced so it also covers the new version columns.
--
-- Backfill: every course that exists when this runs gets one LEGACY run — an
-- honest "production recorded before workflow tracking" state. It has no
-- stages: no curriculum, UAT or publication gate is inferred from approved
-- lesson assets.
--
-- The CHECK lists below repeat shared/learningProduction/{constants,runs}.js
-- and server/learningProduction.workflow.test.js fails if they drift apart.
--
-- Rollback: the tables below are new and can be dropped; the widened CHECK
-- lists only admit more values; the added columns are nullable or defaulted.

SET LOCAL search_path TO qodo_elearning_production, public;

-- ────────────────────────────────────────────────────────────────────
-- Wider vocabularies on existing tables
-- ────────────────────────────────────────────────────────────────────

ALTER TABLE learning_course_members DROP CONSTRAINT learning_course_members_roles_check;
ALTER TABLE learning_course_members ADD CONSTRAINT learning_course_members_roles_check CHECK (
  cardinality(roles) > 0 AND
  roles <@ ARRAY['PRODUCTION_MANAGER', 'COURSE_MANAGER', 'SUBJECT_MATTER_EXPERT', 'INSTRUCTIONAL_DESIGNER', 'OUTLINE_WRITER', 'SCRIPT_WRITER', 'PPT_DESIGNER', 'VOICE_OVER_ARTIST', 'AUDIO_REVIEWER', 'VIDEO_EDITOR', 'QUALITY_REVIEWER', 'VIEWER', 'RESEARCHER', 'EXPERT_COORDINATOR', 'TECHNICAL_PM', 'DELIVERY_PM', 'TECHNICAL_CONSULTANT', 'LEARNING_OPERATIONS', 'MARKETING', 'UAT_COORDINATOR', 'UAT_TESTER']::text[]
);

ALTER TABLE learning_activity_log DROP CONSTRAINT learning_activity_log_event_type_check;
ALTER TABLE learning_activity_log ADD CONSTRAINT learning_activity_log_event_type_check CHECK (event_type IN ('COURSE_CREATED', 'COURSE_UPDATED', 'COURSE_ARCHIVED', 'COURSE_RESTORED', 'MODULE_CREATED', 'MODULE_UPDATED', 'MODULE_ARCHIVED', 'LESSON_CREATED', 'LESSON_UPDATED', 'LESSON_ARCHIVED', 'LESSON_RESTORED', 'TEAM_MEMBER_ADDED', 'TEAM_MEMBER_UPDATED', 'TEAM_MEMBER_REMOVED', 'ASSET_ASSIGNED', 'WORK_STARTED', 'VERSION_UPLOADED', 'SUBMITTED_FOR_REVIEW', 'REVIEW_STARTED', 'CHANGES_REQUESTED', 'RESUBMITTED', 'APPROVED', 'LOCKED', 'REOPENED', 'DEPENDENCY_OVERRIDDEN', 'COMMENT_CREATED', 'COMMENT_RESOLVED', 'COMMENT_REOPENED', 'SUGGESTION_APPLIED', 'CHECKLIST_UPDATED', 'TRANSCRIPT_UPDATED', 'RUN_CREATED', 'RUN_UPDATED', 'RUN_STATUS_CHANGED', 'TEMPLATE_PUBLISHED', 'TEMPLATE_ADOPTED', 'RUN_MEMBER_ADDED', 'RUN_MEMBER_UPDATED', 'RUN_MEMBER_REMOVED', 'STAGE_COMPLETED', 'STAGE_REOPENED', 'STAGE_SKIPPED', 'TASK_ASSIGNED', 'TASK_STARTED', 'TASK_CHECKLIST_UPDATED', 'EVIDENCE_ADDED', 'EVIDENCE_WITHDRAWN', 'TASK_SUBMITTED', 'TASK_RESUBMITTED', 'TASK_REVIEW_STARTED', 'TASK_CHANGES_REQUESTED', 'TASK_APPROVED', 'TASK_COMPLETED', 'TASK_WAIVED', 'TASK_REOPENED', 'TASK_DEPENDENCY_OVERRIDDEN', 'TASK_COMMENTED', 'ISSUE_REPORTED', 'ISSUE_UPDATED', 'ISSUE_FIXED', 'ISSUE_VERIFIED', 'ISSUE_REOPENED', 'ISSUE_WONT_FIX', 'RELEASE_PREPARED', 'RELEASE_SIGNED_OFF', 'RELEASE_PUBLISHED', 'RELEASE_ROLLED_BACK', 'RELEASE_WITHDRAWN', 'IMPACT_RECORDED', 'IMPACT_APPLIED', 'CANDIDATE_ADDED', 'CANDIDATE_UPDATED', 'CANDIDATE_FILE_ADDED', 'ASSET_ADDED', 'ASSET_NOT_APPLICABLE', 'ASSET_APPLICABLE'));

-- ────────────────────────────────────────────────────────────────────
-- Workflow template versions — frozen once published
--
-- `definition_json` is the complete output of buildTemplate() for one
-- scenario and one set of options. A run points at the version it started
-- with, so publishing a new version never rewrites work in progress.
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE learning_workflow_template_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  scenario        text NOT NULL CHECK (scenario IN ('AI_NEW', 'EXPERT_NEW', 'REVAMP')),
  version_number  int NOT NULL CHECK (version_number >= 1),
  code_version    int NOT NULL,
  options_json    jsonb NOT NULL DEFAULT '{}'::jsonb,
  definition_json jsonb NOT NULL,
  checksum        text NOT NULL,
  notes           text NOT NULL DEFAULT '',
  is_current      boolean NOT NULL DEFAULT true,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  retired_at      timestamptz,
  UNIQUE (organization_id, scenario, version_number)
);

CREATE UNIQUE INDEX learning_template_current_idx
  ON learning_workflow_template_versions (organization_id, scenario) WHERE is_current;

CREATE FUNCTION learning_template_frozen() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'template versions are never deleted';
  END IF;
  IF ROW(NEW.id, NEW.organization_id, NEW.scenario, NEW.version_number, NEW.code_version,
         NEW.options_json, NEW.definition_json, NEW.checksum, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.organization_id, OLD.scenario, OLD.version_number, OLD.code_version,
         OLD.options_json, OLD.definition_json, OLD.checksum, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'a published template version is frozen — publish a new version instead';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER learning_template_versions_frozen BEFORE UPDATE OR DELETE ON learning_workflow_template_versions
  FOR EACH ROW EXECUTE FUNCTION learning_template_frozen();

-- ────────────────────────────────────────────────────────────────────
-- Production runs
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE learning_production_runs (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           text NOT NULL,
  course_id                 uuid NOT NULL REFERENCES learning_courses(id) ON DELETE RESTRICT,
  run_number                int NOT NULL CHECK (run_number >= 1),
  scenario                  text NOT NULL CHECK (scenario IN ('AI_NEW', 'EXPERT_NEW', 'REVAMP', 'LEGACY')),
  template_version_id       uuid REFERENCES learning_workflow_template_versions(id) ON DELETE RESTRICT,
  title                     text,
  -- RELEASED: its release was published. CLOSED: ended without a release from
  -- this system (a legacy run superseded by a new run). CANCELLED: abandoned.
  status                    text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ON_HOLD', 'RELEASED', 'CLOSED', 'CANCELLED')),
  manager_user_id           text,
  start_date                date,
  target_date               date,
  source_release_id         uuid,
  -- What the revamp started from: the release's lessons and approved version ids,
  -- copied at creation so later changes to the course never rewrite the baseline.
  source_snapshot_json      jsonb,
  options_json              jsonb NOT NULL DEFAULT '{}'::jsonb,
  lesson_asset_types        text[] NOT NULL DEFAULT ARRAY['OUTLINE', 'PPT', 'SCRIPT', 'VOICE_OVER', 'VIDEO']::text[]
                            CHECK (lesson_asset_types <@ ARRAY['OUTLINE', 'PPT', 'SCRIPT', 'VOICE_OVER', 'VIDEO']::text[]),
  expert_contracted_user_id text,
  expert_skip_reason        text,
  is_legacy                 boolean NOT NULL DEFAULT false,
  is_demo                   boolean NOT NULL DEFAULT false,
  created_by                text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  released_at               timestamptz,
  cancelled_at              timestamptz,
  cancelled_by              text,
  cancel_reason             text,
  closed_at                 timestamptz,
  closed_by                 text,
  close_reason              text,
  UNIQUE (course_id, run_number),
  CHECK (target_date IS NULL OR start_date IS NULL OR target_date >= start_date),
  -- Every run but a legacy one is pinned to the template version it started with.
  CHECK (scenario = 'LEGACY' OR template_version_id IS NOT NULL),
  CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
  CHECK (cancelled_at IS NULL OR length(btrim(coalesce(cancel_reason, ''))) > 0),
  CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)),
  CHECK (closed_at IS NULL OR length(btrim(coalesce(close_reason, ''))) > 0),
  CHECK (expert_contracted_user_id IS NULL OR length(btrim(coalesce(expert_skip_reason, ''))) > 0)
);

-- One run in flight per course: the lesson assets have one working copy each,
-- and two open runs would both claim it.
CREATE UNIQUE INDEX learning_runs_one_open_idx ON learning_production_runs (course_id) WHERE status IN ('ACTIVE', 'ON_HOLD');
CREATE INDEX learning_runs_org_idx ON learning_production_runs (organization_id, status);
CREATE INDEX learning_runs_manager_idx ON learning_production_runs (organization_id, manager_user_id);
CREATE TRIGGER learning_runs_touch BEFORE UPDATE ON learning_production_runs
  FOR EACH ROW EXECUTE FUNCTION learning_touch_updated_at();
CREATE TRIGGER learning_runs_no_delete BEFORE DELETE ON learning_production_runs
  FOR EACH ROW EXECUTE FUNCTION learning_refuse_delete();

CREATE TABLE learning_run_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  run_id          uuid NOT NULL REFERENCES learning_production_runs(id) ON DELETE RESTRICT,
  user_id         text NOT NULL,
  roles           text[] NOT NULL CHECK (
                    cardinality(roles) > 0 AND
                    roles <@ ARRAY['PRODUCTION_MANAGER', 'COURSE_MANAGER', 'SUBJECT_MATTER_EXPERT', 'INSTRUCTIONAL_DESIGNER', 'OUTLINE_WRITER', 'SCRIPT_WRITER', 'PPT_DESIGNER', 'VOICE_OVER_ARTIST', 'AUDIO_REVIEWER', 'VIDEO_EDITOR', 'QUALITY_REVIEWER', 'VIEWER', 'RESEARCHER', 'EXPERT_COORDINATOR', 'TECHNICAL_PM', 'DELIVERY_PM', 'TECHNICAL_CONSULTANT', 'LEARNING_OPERATIONS', 'MARKETING', 'UAT_COORDINATOR', 'UAT_TESTER']::text[]
                  ),
  added_by        text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, user_id)
);

CREATE INDEX learning_run_members_user_idx ON learning_run_members (organization_id, user_id);
CREATE TRIGGER learning_run_members_touch BEFORE UPDATE ON learning_run_members
  FOR EACH ROW EXECUTE FUNCTION learning_touch_updated_at();

-- ────────────────────────────────────────────────────────────────────
-- Releases — history that is never rewritten
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE learning_releases (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           text NOT NULL,
  course_id                 uuid NOT NULL REFERENCES learning_courses(id) ON DELETE RESTRICT,
  run_id                    uuid REFERENCES learning_production_runs(id) ON DELETE RESTRICT,
  release_number            int NOT NULL CHECK (release_number >= 1),
  version_label             text NOT NULL CHECK (length(btrim(version_label)) > 0),
  kind                      text NOT NULL DEFAULT 'RELEASE' CHECK (kind IN ('RELEASE', 'LEGACY_BASELINE')),
  status                    text NOT NULL DEFAULT 'CANDIDATE' CHECK (status IN ('CANDIDATE', 'SIGNED_OFF', 'PUBLISHED', 'SUPERSEDED', 'ROLLED_BACK', 'WITHDRAWN')),
  -- Every lesson and the approved version of each of its assets, at the moment
  -- the candidate was prepared. The versions themselves are immutable (001).
  snapshot_json             jsonb NOT NULL,
  summary_json              jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes                     text NOT NULL DEFAULT '',
  prepared_by               text,
  prepared_at               timestamptz NOT NULL DEFAULT now(),
  signoff_by                text,
  signoff_at                timestamptz,
  signoff_notes             text,
  signoff_override_reason   text,
  published_by              text,
  published_at              timestamptz,
  platform_url              text,
  deployment_notes          text,
  superseded_at             timestamptz,
  superseded_by_release_id  uuid REFERENCES learning_releases(id) ON DELETE RESTRICT,
  rolled_back_at            timestamptz,
  rolled_back_by            text,
  rollback_reason           text,
  withdrawn_at              timestamptz,
  withdrawn_by              text,
  withdraw_reason           text,
  UNIQUE (course_id, release_number),
  CHECK ((signoff_at IS NULL) = (signoff_by IS NULL)),
  CHECK (status NOT IN ('SIGNED_OFF', 'PUBLISHED') OR kind = 'LEGACY_BASELINE' OR signoff_at IS NOT NULL),
  CHECK (status <> 'PUBLISHED' OR published_at IS NOT NULL),
  CHECK (rolled_back_at IS NULL OR length(btrim(coalesce(rollback_reason, ''))) > 0),
  CHECK (withdrawn_at IS NULL OR length(btrim(coalesce(withdraw_reason, ''))) > 0)
);

CREATE UNIQUE INDEX learning_releases_label_idx ON learning_releases (course_id, lower(version_label));
CREATE INDEX learning_releases_run_idx ON learning_releases (run_id) WHERE run_id IS NOT NULL;

CREATE FUNCTION learning_release_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'releases are never deleted';
  END IF;
  IF ROW(NEW.id, NEW.organization_id, NEW.course_id, NEW.run_id, NEW.release_number, NEW.version_label,
         NEW.kind, NEW.snapshot_json, NEW.prepared_by, NEW.prepared_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.organization_id, OLD.course_id, OLD.run_id, OLD.release_number, OLD.version_label,
         OLD.kind, OLD.snapshot_json, OLD.prepared_by, OLD.prepared_at) THEN
    RAISE EXCEPTION 'a release snapshot is fixed once prepared';
  END IF;
  IF OLD.signoff_at IS NOT NULL AND
     ROW(NEW.signoff_by, NEW.signoff_at, NEW.signoff_notes, NEW.signoff_override_reason)
     IS DISTINCT FROM ROW(OLD.signoff_by, OLD.signoff_at, OLD.signoff_notes, OLD.signoff_override_reason) THEN
    RAISE EXCEPTION 'a release sign-off is final';
  END IF;
  IF OLD.published_at IS NOT NULL AND
     ROW(NEW.published_by, NEW.published_at, NEW.platform_url, NEW.deployment_notes)
     IS DISTINCT FROM ROW(OLD.published_by, OLD.published_at, OLD.platform_url, OLD.deployment_notes) THEN
    RAISE EXCEPTION 'a publication record is final';
  END IF;
  IF OLD.status IN ('SUPERSEDED', 'ROLLED_BACK', 'WITHDRAWN') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'a % release does not change state again', lower(OLD.status);
  END IF;
  IF OLD.status = 'PUBLISHED' AND NEW.status NOT IN ('PUBLISHED', 'SUPERSEDED', 'ROLLED_BACK') THEN
    RAISE EXCEPTION 'a published release can only be superseded or rolled back';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER learning_releases_guard BEFORE UPDATE OR DELETE ON learning_releases
  FOR EACH ROW EXECUTE FUNCTION learning_release_guard();

ALTER TABLE learning_production_runs
  ADD CONSTRAINT learning_runs_source_release_fk FOREIGN KEY (source_release_id) REFERENCES learning_releases(id);

ALTER TABLE learning_courses ADD COLUMN current_release_id uuid REFERENCES learning_releases(id);

-- ────────────────────────────────────────────────────────────────────
-- Stages and tasks
--
-- Copied from the pinned template version when the run is created, labels and
-- sources included, so a run reads the same tomorrow whatever the templates
-- become. Stage status is derived (runs.js computeRun) and stored for lists.
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE learning_stage_instances (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  text NOT NULL,
  run_id           uuid NOT NULL REFERENCES learning_production_runs(id) ON DELETE RESTRICT,
  stage_key        text NOT NULL,
  sort_order       int NOT NULL,
  label_json       jsonb NOT NULL,
  description_json jsonb,
  note_json        jsonb,
  origin           text NOT NULL CHECK (origin IN ('WORKBOOK', 'WORKBOOK_HIDDEN', 'OLD_PROMPT', 'PROPOSED')),
  source_json      jsonb,
  after_keys       text[] NOT NULL DEFAULT '{}'::text[],
  owner_role       text,
  skippable_json   jsonb,
  issue_log        boolean NOT NULL DEFAULT false,
  lesson_assets    boolean NOT NULL DEFAULT false,
  status           text NOT NULL DEFAULT 'BLOCKED' CHECK (status IN ('BLOCKED', 'READY', 'IN_PROGRESS', 'DONE', 'SKIPPED')),
  started_at       timestamptz,
  completed_at     timestamptz,
  skipped_at       timestamptz,
  skipped_by       text,
  skip_reason      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, stage_key),
  CHECK ((status = 'SKIPPED') = (skipped_at IS NOT NULL)),
  CHECK (skipped_at IS NULL OR length(btrim(coalesce(skip_reason, ''))) > 0)
);

CREATE INDEX learning_stages_run_idx ON learning_stage_instances (run_id, sort_order);
CREATE TRIGGER learning_stages_touch BEFORE UPDATE ON learning_stage_instances
  FOR EACH ROW EXECUTE FUNCTION learning_touch_updated_at();
CREATE TRIGGER learning_stages_no_delete BEFORE DELETE ON learning_stage_instances
  FOR EACH ROW EXECUTE FUNCTION learning_refuse_delete();

CREATE TABLE learning_task_instances (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id            text NOT NULL,
  run_id                     uuid NOT NULL REFERENCES learning_production_runs(id) ON DELETE RESTRICT,
  stage_id                   uuid NOT NULL REFERENCES learning_stage_instances(id) ON DELETE RESTRICT,
  task_key                   text NOT NULL,
  sort_order                 int NOT NULL,
  label_json                 jsonb NOT NULL,
  description_json           jsonb,
  note_json                  jsonb,
  condition_json             jsonb,
  origin                     text NOT NULL CHECK (origin IN ('WORKBOOK', 'WORKBOOK_HIDDEN', 'OLD_PROMPT', 'PROPOSED')),
  approval_origin            text CHECK (approval_origin IS NULL OR approval_origin IN ('WORKBOOK', 'WORKBOOK_HIDDEN', 'OLD_PROMPT', 'PROPOSED')),
  source_json                jsonb,
  kind                       text NOT NULL CHECK (kind IN ('WORK', 'REVIEW', 'HANDOFF', 'ISSUES', 'SIGNOFF', 'AUTO')),
  classification             text NOT NULL CHECK (classification IN ('REQUIRED', 'OPTIONAL', 'CONDITIONAL')),
  role                       text,
  reviewer_role              text,
  requires_evidence          boolean NOT NULL DEFAULT false,
  evidence_label_json        jsonb,
  requires_approval          boolean NOT NULL DEFAULT false,
  sensitive                  boolean NOT NULL DEFAULT false,
  external_tool              text,
  rule_json                  jsonb,
  status                     text NOT NULL DEFAULT 'NOT_STARTED'
                             CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'DONE', 'WAIVED')),
  priority                   text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  assignee_user_id           text,
  reviewer_user_id           text,
  start_date                 date,
  due_date                   date,
  assigned_at                timestamptz,
  started_at                 timestamptz,
  submitted_at               timestamptz,
  submitted_by               text,
  review_started_at          timestamptz,
  changes_requested_at       timestamptz,
  approved_at                timestamptz,
  approved_by                text,
  done_at                    timestamptz,
  done_by                    text,
  waived_at                  timestamptz,
  waived_by                  text,
  waive_reason               text,
  reopened_at                timestamptz,
  dependency_override_by     text,
  dependency_override_at     timestamptz,
  dependency_override_reason text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, task_key),
  CHECK (due_date IS NULL OR start_date IS NULL OR due_date >= start_date),
  CHECK ((status = 'WAIVED') = (waived_at IS NOT NULL)),
  CHECK (waived_at IS NULL OR length(btrim(coalesce(waive_reason, ''))) > 0),
  CHECK ((dependency_override_at IS NULL) = (dependency_override_by IS NULL)),
  CHECK (dependency_override_at IS NULL OR length(btrim(coalesce(dependency_override_reason, ''))) > 0),
  CHECK (NOT requires_approval OR kind <> 'AUTO')
);

CREATE INDEX learning_tasks_run_idx ON learning_task_instances (run_id, stage_id, sort_order);
CREATE INDEX learning_tasks_assignee_idx ON learning_task_instances (organization_id, assignee_user_id) WHERE assignee_user_id IS NOT NULL;
CREATE INDEX learning_tasks_reviewer_idx ON learning_task_instances (organization_id, reviewer_user_id) WHERE reviewer_user_id IS NOT NULL;
CREATE INDEX learning_tasks_due_idx ON learning_task_instances (organization_id, due_date)
  WHERE due_date IS NOT NULL AND status NOT IN ('APPROVED', 'DONE', 'WAIVED');
CREATE TRIGGER learning_tasks_touch BEFORE UPDATE ON learning_task_instances
  FOR EACH ROW EXECUTE FUNCTION learning_touch_updated_at();
CREATE TRIGGER learning_tasks_no_delete BEFORE DELETE ON learning_task_instances
  FOR EACH ROW EXECUTE FUNCTION learning_refuse_delete();

CREATE TABLE learning_task_dependencies (
  task_id            uuid NOT NULL REFERENCES learning_task_instances(id) ON DELETE RESTRICT,
  depends_on_task_id uuid NOT NULL REFERENCES learning_task_instances(id) ON DELETE RESTRICT,
  organization_id    text NOT NULL,
  PRIMARY KEY (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);

CREATE INDEX learning_task_dependencies_reverse_idx ON learning_task_dependencies (depends_on_task_id);

CREATE TABLE learning_task_checklist_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  task_id         uuid NOT NULL REFERENCES learning_task_instances(id) ON DELETE RESTRICT,
  item_key        text NOT NULL,
  sort_order      int NOT NULL,
  label_json      jsonb NOT NULL,
  group_json      jsonb,
  note_json       jsonb,
  origin          text NOT NULL CHECK (origin IN ('WORKBOOK', 'WORKBOOK_HIDDEN', 'OLD_PROMPT', 'PROPOSED')),
  source_json     jsonb,
  required        boolean NOT NULL DEFAULT true,
  status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DONE', 'ISSUE', 'NOT_APPLICABLE')),
  note            text NOT NULL DEFAULT '',
  issue_id        uuid,
  updated_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, item_key),
  -- Taking a line out of the count needs a reason, like any waiver.
  CHECK (status <> 'NOT_APPLICABLE' OR length(btrim(note)) > 0)
);

CREATE INDEX learning_task_checklist_idx ON learning_task_checklist_items (task_id, sort_order);
CREATE TRIGGER learning_task_checklist_touch BEFORE UPDATE ON learning_task_checklist_items
  FOR EACH ROW EXECUTE FUNCTION learning_touch_updated_at();
CREATE TRIGGER learning_task_checklist_no_delete BEFORE DELETE ON learning_task_checklist_items
  FOR EACH ROW EXECUTE FUNCTION learning_refuse_delete();

-- Evidence: a file, a link or a note. Immutable once written; it can be
-- withdrawn (with a reason) but its record stays, because a submission that
-- cited it must still say what it cited.
CREATE TABLE learning_task_evidence (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  task_id         uuid NOT NULL REFERENCES learning_task_instances(id) ON DELETE RESTRICT,
  kind            text NOT NULL CHECK (kind IN ('FILE', 'LINK', 'NOTE')),
  storage_key     text,
  file_name       text,
  mime_type       text,
  file_size       bigint CHECK (file_size IS NULL OR file_size >= 0),
  checksum        text,
  url             text,
  note            text NOT NULL DEFAULT '',
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  withdrawn_at    timestamptz,
  withdrawn_by    text,
  withdraw_reason text,
  CHECK ((kind = 'FILE') = (storage_key IS NOT NULL)),
  CHECK ((kind = 'LINK') = (url IS NOT NULL)),
  CHECK (kind <> 'NOTE' OR length(btrim(note)) > 0),
  CHECK (withdrawn_at IS NULL OR length(btrim(coalesce(withdraw_reason, ''))) > 0)
);

CREATE INDEX learning_task_evidence_idx ON learning_task_evidence (task_id, created_at);

CREATE FUNCTION learning_evidence_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'evidence is withdrawn, never deleted';
  END IF;
  IF ROW(NEW.id, NEW.organization_id, NEW.task_id, NEW.kind, NEW.storage_key, NEW.file_name, NEW.mime_type,
         NEW.file_size, NEW.checksum, NEW.url, NEW.note, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.organization_id, OLD.task_id, OLD.kind, OLD.storage_key, OLD.file_name, OLD.mime_type,
         OLD.file_size, OLD.checksum, OLD.url, OLD.note, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'evidence is immutable once added';
  END IF;
  IF OLD.withdrawn_at IS NOT NULL AND NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at THEN
    RAISE EXCEPTION 'withdrawn evidence stays withdrawn';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER learning_task_evidence_immutable BEFORE UPDATE OR DELETE ON learning_task_evidence
  FOR EACH ROW EXECUTE FUNCTION learning_evidence_immutable();

-- Submissions: what was sent for review — the evidence ids and the checklist
-- as they stood — and the decision on exactly that. Final once decided.
CREATE TABLE learning_task_submissions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   text NOT NULL,
  task_id           uuid NOT NULL REFERENCES learning_task_instances(id) ON DELETE RESTRICT,
  submission_number int NOT NULL CHECK (submission_number >= 1),
  evidence_ids      uuid[] NOT NULL DEFAULT '{}'::uuid[],
  checklist_json    jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes             text NOT NULL DEFAULT '',
  submitted_by      text NOT NULL,
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  is_resubmission   boolean NOT NULL DEFAULT false,
  reviewer_user_id  text,
  decision          text NOT NULL DEFAULT 'PENDING' CHECK (decision IN ('PENDING', 'APPROVED', 'CHANGES_REQUESTED')),
  review_started_at timestamptz,
  reviewed_by       text,
  reviewed_at       timestamptz,
  review_notes      text NOT NULL DEFAULT '',
  admin_override    boolean NOT NULL DEFAULT false,
  override_reason   text,
  UNIQUE (task_id, submission_number),
  CHECK ((decision = 'PENDING') = (reviewed_at IS NULL)),
  CHECK (NOT admin_override OR length(btrim(coalesce(override_reason, ''))) > 0)
);

CREATE UNIQUE INDEX learning_submissions_one_pending ON learning_task_submissions (task_id) WHERE decision = 'PENDING';
CREATE INDEX learning_submissions_reviewed_idx ON learning_task_submissions (organization_id, reviewed_at) WHERE reviewed_at IS NOT NULL;

CREATE FUNCTION learning_submission_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'submissions are never deleted';
  END IF;
  IF OLD.decision <> 'PENDING' THEN
    RAISE EXCEPTION 'a review decision is final once made';
  END IF;
  IF ROW(NEW.task_id, NEW.submission_number, NEW.evidence_ids, NEW.checklist_json, NEW.submitted_by, NEW.submitted_at, NEW.organization_id)
     IS DISTINCT FROM
     ROW(OLD.task_id, OLD.submission_number, OLD.evidence_ids, OLD.checklist_json, OLD.submitted_by, OLD.submitted_at, OLD.organization_id) THEN
    RAISE EXCEPTION 'a submission cannot be changed after it was sent';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER learning_submissions_guard BEFORE UPDATE OR DELETE ON learning_task_submissions
  FOR EACH ROW EXECUTE FUNCTION learning_submission_guard();

CREATE TABLE learning_task_comments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  task_id         uuid NOT NULL REFERENCES learning_task_instances(id) ON DELETE RESTRICT,
  parent_id       uuid REFERENCES learning_task_comments(id) ON DELETE RESTRICT,
  user_id         text NOT NULL,
  body            text NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 10000),
  mentions        text[] NOT NULL DEFAULT '{}'::text[],
  created_at      timestamptz NOT NULL DEFAULT now(),
  edited_at       timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX learning_task_comments_idx ON learning_task_comments (task_id, created_at);
CREATE TRIGGER learning_task_comments_touch BEFORE UPDATE ON learning_task_comments
  FOR EACH ROW EXECUTE FUNCTION learning_touch_updated_at();
CREATE TRIGGER learning_task_comments_no_delete BEFORE DELETE ON learning_task_comments
  FOR EACH ROW EXECUTE FUNCTION learning_refuse_delete();

-- ────────────────────────────────────────────────────────────────────
-- Dry-run and UAT issues
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE learning_run_issues (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   text NOT NULL,
  run_id            uuid NOT NULL REFERENCES learning_production_runs(id) ON DELETE RESTRICT,
  stage_id          uuid NOT NULL REFERENCES learning_stage_instances(id) ON DELETE RESTRICT,
  issue_number      int NOT NULL CHECK (issue_number >= 1),
  title             text NOT NULL CHECK (length(btrim(title)) > 0),
  description       text NOT NULL DEFAULT '',
  severity          text NOT NULL DEFAULT 'MEDIUM' CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  area              text NOT NULL DEFAULT 'CONTENT' CHECK (area IN ('CONTENT', 'OPERATIONS', 'PRODUCT', 'MEDIA', 'PLATFORM', 'OTHER')),
  status            text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'FIXED', 'VERIFIED', 'WONT_FIX')),
  owner_user_id     text,
  due_date          date,
  lesson_id         uuid REFERENCES learning_lessons(id) ON DELETE RESTRICT,
  asset_id          uuid REFERENCES learning_assets(id) ON DELETE RESTRICT,
  task_id           uuid REFERENCES learning_task_instances(id) ON DELETE RESTRICT,
  checklist_item_id uuid REFERENCES learning_task_checklist_items(id) ON DELETE RESTRICT,
  reported_by       text NOT NULL,
  reported_at       timestamptz NOT NULL DEFAULT now(),
  fix_note          text,
  fixed_by          text,
  fixed_at          timestamptz,
  verified_by       text,
  verified_at       timestamptz,
  verify_note       text,
  wont_fix_reason   text,
  wont_fix_by       text,
  wont_fix_at       timestamptz,
  reopen_count      int NOT NULL DEFAULT 0,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, issue_number),
  CHECK (status <> 'VERIFIED' OR (verified_at IS NOT NULL AND verified_by IS NOT NULL)),
  CHECK (status <> 'WONT_FIX' OR length(btrim(coalesce(wont_fix_reason, ''))) > 0)
);

CREATE INDEX learning_issues_run_idx ON learning_run_issues (run_id, stage_id, status);
CREATE INDEX learning_issues_owner_idx ON learning_run_issues (organization_id, owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE TRIGGER learning_issues_touch BEFORE UPDATE ON learning_run_issues
  FOR EACH ROW EXECUTE FUNCTION learning_touch_updated_at();
CREATE TRIGGER learning_issues_no_delete BEFORE DELETE ON learning_run_issues
  FOR EACH ROW EXECUTE FUNCTION learning_refuse_delete();

ALTER TABLE learning_task_checklist_items
  ADD CONSTRAINT learning_task_checklist_issue_fk FOREIGN KEY (issue_id) REFERENCES learning_run_issues(id);

-- ────────────────────────────────────────────────────────────────────
-- Revamp change impact
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE learning_change_impact_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   text NOT NULL,
  run_id            uuid NOT NULL REFERENCES learning_production_runs(id) ON DELETE RESTRICT,
  lesson_id         uuid REFERENCES learning_lessons(id) ON DELETE RESTRICT,
  asset_type        text CHECK (asset_type IS NULL OR asset_type IN ('OUTLINE', 'PPT', 'SCRIPT', 'VOICE_OVER', 'VIDEO')),
  source_version_id uuid REFERENCES learning_asset_versions(id) ON DELETE RESTRICT,
  decision          text NOT NULL CHECK (decision IN ('KEEP', 'CHANGE', 'REMOVE')),
  note              text NOT NULL DEFAULT '',
  decided_by        text NOT NULL,
  decided_at        timestamptz NOT NULL DEFAULT now(),
  applied_at        timestamptz,
  applied_by        text
);

CREATE UNIQUE INDEX learning_impact_item_idx
  ON learning_change_impact_items (run_id, coalesce(lesson_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(asset_type, ''));

-- ────────────────────────────────────────────────────────────────────
-- Expert candidates — sensitive
--
-- CVs, assessments and contracts. Readable only with experts.sensitive (see
-- permissions.js). Kept out of every list, search and activity sentence that
-- a course viewer can reach.
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE learning_expert_candidates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  text NOT NULL,
  run_id           uuid NOT NULL REFERENCES learning_production_runs(id) ON DELETE RESTRICT,
  course_id        uuid NOT NULL REFERENCES learning_courses(id) ON DELETE RESTRICT,
  full_name        text NOT NULL CHECK (length(btrim(full_name)) > 0),
  email            text,
  phone            text,
  source           text NOT NULL DEFAULT 'OTHER' CHECK (source IN ('LINKEDIN', 'APOLLO', 'REFERRAL', 'OTHER')),
  profile_url      text,
  years_experience int CHECK (years_experience IS NULL OR years_experience BETWEEN 0 AND 80),
  status           text NOT NULL DEFAULT 'SOURCED' CHECK (status IN ('SOURCED', 'CONTACTED', 'SCREENING', 'TECHNICAL_DISCUSSION', 'PASSED', 'ONBOARDING', 'CONTRACTED', 'REJECTED', 'WITHDRAWN')),
  assessment_json  jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes            text NOT NULL DEFAULT '',
  linked_user_id   text,
  created_by       text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX learning_candidates_run_idx ON learning_expert_candidates (run_id, status);
CREATE TRIGGER learning_candidates_touch BEFORE UPDATE ON learning_expert_candidates
  FOR EACH ROW EXECUTE FUNCTION learning_touch_updated_at();
CREATE TRIGGER learning_candidates_no_delete BEFORE DELETE ON learning_expert_candidates
  FOR EACH ROW EXECUTE FUNCTION learning_refuse_delete();

CREATE TABLE learning_candidate_files (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  candidate_id    uuid NOT NULL REFERENCES learning_expert_candidates(id) ON DELETE RESTRICT,
  kind            text NOT NULL CHECK (kind IN ('CV', 'SAMPLE', 'ASSESSMENT', 'CONTRACT', 'OTHER')),
  storage_key     text NOT NULL,
  file_name       text NOT NULL,
  mime_type       text NOT NULL,
  file_size       bigint NOT NULL CHECK (file_size >= 0),
  checksum        text,
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX learning_candidate_files_idx ON learning_candidate_files (candidate_id, created_at);
CREATE TRIGGER learning_candidate_files_append_only BEFORE UPDATE OR DELETE ON learning_candidate_files
  FOR EACH ROW EXECUTE FUNCTION learning_refuse_change();

-- ────────────────────────────────────────────────────────────────────
-- Lesson assets: applicability and provenance
-- ────────────────────────────────────────────────────────────────────

-- A template decides which assets a lesson needs; a manager may mark one not
-- applicable, with a reason, and bring it back. Not-applicable assets leave
-- the progress count; their history stays.
ALTER TABLE learning_assets
  ADD COLUMN applicable boolean NOT NULL DEFAULT true,
  ADD COLUMN not_applicable_reason text,
  ADD COLUMN not_applicable_by text,
  ADD COLUMN not_applicable_at timestamptz,
  ADD CONSTRAINT learning_assets_applicability_reason CHECK (applicable OR length(btrim(coalesce(not_applicable_reason, ''))) > 0);

-- Who (or what) made a version: AI-assisted versions are labelled, and still
-- need a person other than the submitter to approve them.
ALTER TABLE learning_asset_versions
  ADD COLUMN ai_assisted boolean NOT NULL DEFAULT false,
  ADD COLUMN ai_tool text,
  ADD COLUMN run_id uuid REFERENCES learning_production_runs(id);

CREATE OR REPLACE FUNCTION learning_versions_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'learning_asset_versions are never deleted';
  END IF;
  IF ROW(NEW.id, NEW.organization_id, NEW.asset_id, NEW.version_number, NEW.source_kind,
         NEW.storage_key, NEW.file_name, NEW.mime_type, NEW.file_size, NEW.checksum,
         NEW.external_url, NEW.content_json, NEW.version_notes, NEW.created_by, NEW.created_at,
         NEW.ai_assisted, NEW.ai_tool, NEW.run_id)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.organization_id, OLD.asset_id, OLD.version_number, OLD.source_kind,
         OLD.storage_key, OLD.file_name, OLD.mime_type, OLD.file_size, OLD.checksum,
         OLD.external_url, OLD.content_json, OLD.version_notes, OLD.created_by, OLD.created_at,
         OLD.ai_assisted, OLD.ai_tool, OLD.run_id) THEN
    RAISE EXCEPTION 'a version is immutable once written — upload a new version instead';
  END IF;
  IF OLD.preview_storage_key IS NOT NULL AND
     ROW(NEW.preview_storage_key, NEW.preview_file_name, NEW.preview_mime_type, NEW.preview_file_size)
     IS DISTINCT FROM
     ROW(OLD.preview_storage_key, OLD.preview_file_name, OLD.preview_mime_type, OLD.preview_file_size) THEN
    RAISE EXCEPTION 'a version preview is attached once and never replaced';
  END IF;
  IF OLD.duration_seconds IS NOT NULL AND NEW.duration_seconds IS DISTINCT FROM OLD.duration_seconds THEN
    RAISE EXCEPTION 'a version duration is recorded once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ────────────────────────────────────────────────────────────────────
-- History links
-- ────────────────────────────────────────────────────────────────────

ALTER TABLE learning_activity_log
  ADD COLUMN run_id uuid REFERENCES learning_production_runs(id) ON DELETE RESTRICT,
  ADD COLUMN stage_id uuid REFERENCES learning_stage_instances(id) ON DELETE RESTRICT,
  ADD COLUMN task_id uuid REFERENCES learning_task_instances(id) ON DELETE RESTRICT,
  ADD COLUMN issue_id uuid REFERENCES learning_run_issues(id) ON DELETE RESTRICT,
  ADD COLUMN release_id uuid REFERENCES learning_releases(id) ON DELETE RESTRICT;

CREATE INDEX learning_activity_run_idx ON learning_activity_log (run_id, id DESC) WHERE run_id IS NOT NULL;
CREATE INDEX learning_activity_task_idx ON learning_activity_log (task_id, id DESC) WHERE task_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────
-- Notifications: a transactional outbox and per-person preferences
--
-- Alerts are written here inside the same transaction as the change that
-- caused them, so a change that rolls back never announces itself and a
-- change that commits is announced even if the process dies before sending.
-- Delivery goes through the workspace bell (server/notify.js) after commit,
-- and the scheduler retries anything left undelivered.
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE learning_notification_outbox (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id   text NOT NULL,
  recipient_user_id text NOT NULL,
  actor_user_id     text,
  event_type        text NOT NULL,
  entity_type       text NOT NULL CHECK (entity_type IN ('ASSET', 'TASK', 'STAGE', 'RUN', 'ISSUE', 'RELEASE', 'COURSE')),
  entity_id         uuid,
  dedupe_key        text NOT NULL,
  window_minutes    int NOT NULL DEFAULT 10,
  link              text NOT NULL,
  message_key       text NOT NULL,
  data_json         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  attempts          int NOT NULL DEFAULT 0,
  next_attempt_at   timestamptz NOT NULL DEFAULT now(),
  last_error        text,
  delivered_at      timestamptz,
  suppressed_at     timestamptz,
  suppressed_reason text
);

CREATE INDEX learning_outbox_pending_idx ON learning_notification_outbox (next_attempt_at)
  WHERE delivered_at IS NULL AND suppressed_at IS NULL;

ALTER TABLE learning_notifications
  ADD COLUMN entity_type text,
  ADD COLUMN entity_id uuid;

CREATE TABLE learning_notification_preferences (
  user_id             text PRIMARY KEY,
  organization_id     text NOT NULL,
  muted_events        text[] NOT NULL DEFAULT '{}'::text[],
  due_soon_days       int NOT NULL DEFAULT 2 CHECK (due_soon_days BETWEEN 0 AND 14),
  overdue_repeat_days int NOT NULL DEFAULT 3 CHECK (overdue_repeat_days BETWEEN 0 AND 30),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────────────
-- Backfill: one LEGACY run per existing course
--
-- Deterministic and idempotent (it only touches courses with no run). Legacy
-- runs have no template and no stages, so nothing about curriculum, UAT or
-- publication is claimed on the course's behalf.
-- ────────────────────────────────────────────────────────────────────

INSERT INTO learning_production_runs
  (organization_id, course_id, run_number, scenario, status, manager_user_id, start_date, target_date,
   is_legacy, is_demo, created_by, created_at)
SELECT c.organization_id, c.id, 1, 'LEGACY',
       CASE WHEN c.status = 'ON_HOLD' THEN 'ON_HOLD' ELSE 'ACTIVE' END,
       c.manager_user_id, c.start_date, c.target_date, true, c.is_demo, c.created_by, c.created_at
  FROM learning_courses c
 WHERE NOT EXISTS (SELECT 1 FROM learning_production_runs r WHERE r.course_id = c.id);

INSERT INTO learning_activity_log (organization_id, course_id, run_id, actor_user_id, event_type, metadata_json, created_at)
SELECT r.organization_id, r.course_id, r.id, NULL, 'RUN_CREATED',
       jsonb_build_object('scenario', 'LEGACY', 'backfill', true, 'migration', '002_production_runs'), now()
  FROM learning_production_runs r
 WHERE r.is_legacy;
