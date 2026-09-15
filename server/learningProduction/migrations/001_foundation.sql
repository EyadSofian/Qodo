-- E-Learning Production — foundation.
--
-- Courses, modules, lessons and their five production assets; versions,
-- approvals, comments, annotations and timeline markers; checklists, course
-- teams, the activity log and notification de-duplication.
--
-- The CHECK lists below repeat shared/learningProduction/constants.js, and
-- server/learningProduction.workflow.test.js fails if the two drift apart.
--
-- Three tables refuse to lose history at the database level, not just in the
-- services: a version is immutable once written, a review decision is final
-- once made, and the activity log is append-only.
--
-- Rollback: DROP SCHEMA qodo_elearning_production CASCADE;
--           Nothing outside this schema is touched by this module.

SET LOCAL search_path TO qodo_elearning_production, public;

-- ────────────────────────────────────────────────────────────────────
-- Shared trigger functions
-- ────────────────────────────────────────────────────────────────────

CREATE FUNCTION learning_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION learning_refuse_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (attempted %)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION learning_refuse_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'rows in % are archived, never deleted', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

-- ────────────────────────────────────────────────────────────────────
-- Courses
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE learning_courses (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          text NOT NULL,
  name                     text NOT NULL CHECK (length(btrim(name)) > 0),
  code                     text,
  description              text NOT NULL DEFAULT '',
  cover_storage_key        text,
  cover_mime_type          text,
  manager_user_id          text,
  status                   text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ON_HOLD')),
  priority                 text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  start_date               date,
  target_date              date,
  settings_json            jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Who normally makes and reviews each stage. New lessons inherit it.
  production_defaults_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_demo                  boolean NOT NULL DEFAULT false,
  created_by               text NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  archived_at              timestamptz,
  archived_by              text,
  CHECK (target_date IS NULL OR start_date IS NULL OR target_date >= start_date)
);

CREATE INDEX learning_courses_org_idx ON learning_courses (organization_id, updated_at DESC) WHERE archived_at IS NULL;
CREATE INDEX learning_courses_manager_idx ON learning_courses (organization_id, manager_user_id);
CREATE UNIQUE INDEX learning_courses_code_idx
  ON learning_courses (organization_id, lower(code))
  WHERE code IS NOT NULL AND archived_at IS NULL;
CREATE TRIGGER learning_courses_touch BEFORE UPDATE ON learning_courses
  FOR EACH ROW EXECUTE FUNCTION learning_touch_updated_at();
CREATE TRIGGER learning_courses_no_delete BEFORE DELETE ON learning_courses
  FOR EACH ROW EXECUTE FUNCTION learning_refuse_delete();

CREATE TABLE learning_course_modules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  course_id       uuid NOT NULL REFERENCES learning_courses(id) ON DELETE RESTRICT,
  name            text NOT NULL CHECK (length(btrim(name)) > 0),
  description     text NOT NULL DEFAULT '',
  sort_order      int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz
);

CREATE INDEX learning_modules_course_idx ON learning_course_modules (course_id, sort_order) WHERE archived_at IS NULL;
CREATE INDEX learning_modules_org_idx ON learning_course_modules (organization_id);
CREATE TRIGGER learning_modules_touch BEFORE UPDATE ON learning_course_modules
  FOR EACH ROW EXECUTE FUNCTION learning_touch_updated_at();

CREATE TABLE learning_lessons (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id            text NOT NULL,
  course_id                  uuid NOT NULL REFERENCES learning_courses(id) ON DELETE RESTRICT,
  module_id                  uuid REFERENCES learning_course_modules(id) ON DELETE RESTRICT,
  name                       text NOT NULL CHECK (length(btrim(name)) > 0),
  description                text NOT NULL DEFAULT '',
  sort_order                 int NOT NULL DEFAULT 0,
  estimated_duration_minutes int CHECK (estimated_duration_minutes IS NULL OR estimated_duration_minutes BETWEEN 1 AND 10000),
  owner_user_id              text,
  target_date                date,
  created_by                 text NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  archived_at                timestamptz,
  archived_by                text
);

CREATE INDEX learning_lessons_course_idx ON learning_lessons (course_id, module_id, sort_order) WHERE archived_at IS NULL;
CREATE INDEX learning_lessons_org_idx ON learning_lessons (organization_id);
CREATE INDEX learning_lessons_name_idx ON learning_lessons (organization_id, lower(name)) WHERE archived_at IS NULL;
CREATE TRIGGER learning_lessons_touch BEFORE UPDATE ON learning_lessons
  FOR EACH ROW EXECUTE FUNCTION learning_touch_updated_at();
CREATE TRIGGER learning_lessons_no_delete BEFORE DELETE ON learning_lessons
  FOR EACH ROW EXECUTE FUNCTION learning_refuse_delete();

-- ────────────────────────────────────────────────────────────────────
-- Production assets
--
-- Exactly five per lesson, enforced by the unique pair. The status column is
-- only ever written by the domain actions in assetService.js — there is no
-- endpoint that sets it directly.
--
-- The cycle timestamps describe the *current* cycle. The full history of every
-- cycle is the activity log plus learning_asset_approvals.
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE learning_assets (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id              text NOT NULL,
  course_id                    uuid NOT NULL REFERENCES learning_courses(id) ON DELETE RESTRICT,
  lesson_id                    uuid NOT NULL REFERENCES learning_lessons(id) ON DELETE RESTRICT,
  asset_type                   text NOT NULL CHECK (asset_type IN ('OUTLINE', 'PPT', 'SCRIPT', 'VOICE_OVER', 'VIDEO')),
  status                       text NOT NULL DEFAULT 'NOT_STARTED'
                               CHECK (status IN ('NOT_STARTED', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'RESUBMITTED', 'APPROVED', 'LOCKED')),
  priority                     text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  assignee_user_id             text,
  reviewer_user_id             text,
  start_date                   date,
  due_date                     date,
  current_version_id           uuid,
  assigned_at                  timestamptz,
  work_started_at              timestamptz,
  submitted_at                 timestamptz,
  submitted_by                 text,
  review_started_at            timestamptz,
  changes_requested_at         timestamptz,
  changes_requested_version_id uuid,
  resubmitted_at               timestamptz,
  approved_at                  timestamptz,
  approved_by                  text,
  approved_version_id          uuid,
  locked_at                    timestamptz,
  locked_by                    text,
  dependency_override_by       text,
  dependency_override_at       timestamptz,
  dependency_override_reason   text,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lesson_id, asset_type),
  CHECK (due_date IS NULL OR start_date IS NULL OR due_date >= start_date),
  CHECK ((dependency_override_at IS NULL) = (dependency_override_by IS NULL)),
  CHECK (dependency_override_at IS NULL OR length(btrim(coalesce(dependency_override_reason, ''))) > 0),
  CHECK ((status = 'LOCKED') = (locked_at IS NOT NULL))
);

CREATE INDEX learning_assets_org_status_idx ON learning_assets (organization_id, status);
CREATE INDEX learning_assets_course_idx ON learning_assets (course_id, asset_type);
CREATE INDEX learning_assets_assignee_idx ON learning_assets (organization_id, assignee_user_id) WHERE assignee_user_id IS NOT NULL;
CREATE INDEX learning_assets_reviewer_idx ON learning_assets (organization_id, reviewer_user_id) WHERE reviewer_user_id IS NOT NULL;
CREATE INDEX learning_assets_due_idx ON learning_assets (organization_id, due_date)
  WHERE due_date IS NOT NULL AND status NOT IN ('APPROVED', 'LOCKED');
CREATE TRIGGER learning_assets_touch BEFORE UPDATE ON learning_assets
  FOR EACH ROW EXECUTE FUNCTION learning_touch_updated_at();
CREATE TRIGGER learning_assets_no_delete BEFORE DELETE ON learning_assets
  FOR EACH ROW EXECUTE FUNCTION learning_refuse_delete();

-- The working copy of a written asset (Outline, Script). Autosave writes here;
-- submitting snapshots it into an immutable version.
CREATE TABLE learning_asset_drafts (
  asset_id        uuid PRIMARY KEY REFERENCES learning_assets(id) ON DELETE RESTRICT,
  organization_id text NOT NULL,
  content_json    jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision        int NOT NULL DEFAULT 0,
  updated_by      text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────────────
-- Versions — immutable
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE learning_asset_versions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     text NOT NULL,
  asset_id            uuid NOT NULL REFERENCES learning_assets(id) ON DELETE RESTRICT,
  version_number      int NOT NULL CHECK (version_number >= 1),
  source_kind         text NOT NULL CHECK (source_kind IN ('FILE', 'LINK', 'CONTENT')),
  storage_key         text,
  file_name           text,
  mime_type           text,
  file_size           bigint CHECK (file_size IS NULL OR file_size >= 0),
  checksum            text,
  external_url        text,
  content_json        jsonb,
  -- A PDF rendering of a PPTX, for slide-by-slide review. Attached once, never replaced.
  preview_storage_key text,
  preview_file_name   text,
  preview_mime_type   text,
  preview_file_size   bigint,
  duration_seconds    numeric(10, 3),
  version_notes       text NOT NULL DEFAULT '',
  created_by          text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, version_number),
  CHECK ((source_kind = 'FILE') = (storage_key IS NOT NULL)),
  CHECK ((source_kind = 'LINK') = (external_url IS NOT NULL)),
  CHECK ((source_kind = 'CONTENT') = (content_json IS NOT NULL))
);

CREATE INDEX learning_versions_asset_idx ON learning_asset_versions (asset_id, version_number DESC);

CREATE FUNCTION learning_versions_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'learning_asset_versions are never deleted';
  END IF;
  IF ROW(NEW.id, NEW.organization_id, NEW.asset_id, NEW.version_number, NEW.source_kind,
         NEW.storage_key, NEW.file_name, NEW.mime_type, NEW.file_size, NEW.checksum,
         NEW.external_url, NEW.content_json, NEW.version_notes, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.organization_id, OLD.asset_id, OLD.version_number, OLD.source_kind,
         OLD.storage_key, OLD.file_name, OLD.mime_type, OLD.file_size, OLD.checksum,
         OLD.external_url, OLD.content_json, OLD.version_notes, OLD.created_by, OLD.created_at) THEN
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

CREATE TRIGGER learning_versions_no_update BEFORE UPDATE ON learning_asset_versions
  FOR EACH ROW EXECUTE FUNCTION learning_versions_immutable();
CREATE TRIGGER learning_versions_no_delete BEFORE DELETE ON learning_asset_versions
  FOR EACH ROW EXECUTE FUNCTION learning_versions_immutable();

ALTER TABLE learning_assets
  ADD CONSTRAINT learning_assets_current_version_fk FOREIGN KEY (current_version_id) REFERENCES learning_asset_versions(id),
  ADD CONSTRAINT learning_assets_approved_version_fk FOREIGN KEY (approved_version_id) REFERENCES learning_asset_versions(id),
  ADD CONSTRAINT learning_assets_changes_version_fk FOREIGN KEY (changes_requested_version_id) REFERENCES learning_asset_versions(id);

-- ────────────────────────────────────────────────────────────────────
-- Assignment history — append-only
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE learning_asset_assignments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  text NOT NULL,
  asset_id         uuid NOT NULL REFERENCES learning_assets(id) ON DELETE RESTRICT,
  assignee_user_id text,
  reviewer_user_id text,
  due_date         date,
  priority         text NOT NULL CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  assigned_by      text NOT NULL,
  assigned_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX learning_assignments_asset_idx ON learning_asset_assignments (asset_id, assigned_at DESC);
CREATE TRIGGER learning_assignments_append_only BEFORE UPDATE OR DELETE ON learning_asset_assignments
  FOR EACH ROW EXECUTE FUNCTION learning_refuse_change();

-- ────────────────────────────────────────────────────────────────────
-- Review decisions — bound to one version, final once made
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE learning_asset_approvals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   text NOT NULL,
  asset_id          uuid NOT NULL REFERENCES learning_assets(id) ON DELETE RESTRICT,
  version_id        uuid NOT NULL REFERENCES learning_asset_versions(id) ON DELETE RESTRICT,
  submitted_by      text NOT NULL,
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  is_resubmission   boolean NOT NULL DEFAULT false,
  reviewer_user_id  text,
  decision          text NOT NULL DEFAULT 'PENDING' CHECK (decision IN ('PENDING', 'APPROVED', 'CHANGES_REQUESTED')),
  review_started_at timestamptz,
  reviewed_by       text,
  reviewed_at       timestamptz,
  notes             text NOT NULL DEFAULT '',
  CHECK ((decision = 'PENDING') = (reviewed_at IS NULL))
);

CREATE UNIQUE INDEX learning_approvals_one_pending ON learning_asset_approvals (asset_id) WHERE decision = 'PENDING';
CREATE INDEX learning_approvals_asset_idx ON learning_asset_approvals (asset_id, submitted_at DESC);
CREATE INDEX learning_approvals_reviewed_idx ON learning_asset_approvals (organization_id, reviewed_at) WHERE reviewed_at IS NOT NULL;

CREATE FUNCTION learning_approvals_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'review decisions are never deleted';
  END IF;
  IF OLD.decision <> 'PENDING' THEN
    RAISE EXCEPTION 'a review decision is final once made';
  END IF;
  IF ROW(NEW.asset_id, NEW.version_id, NEW.submitted_by, NEW.submitted_at, NEW.organization_id)
     IS DISTINCT FROM ROW(OLD.asset_id, OLD.version_id, OLD.submitted_by, OLD.submitted_at, OLD.organization_id) THEN
    RAISE EXCEPTION 'a submission cannot be moved to another version';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER learning_approvals_guard_update BEFORE UPDATE ON learning_asset_approvals
  FOR EACH ROW EXECUTE FUNCTION learning_approvals_guard();
CREATE TRIGGER learning_approvals_guard_delete BEFORE DELETE ON learning_asset_approvals
  FOR EACH ROW EXECUTE FUNCTION learning_approvals_guard();

-- ────────────────────────────────────────────────────────────────────
-- Comments, annotations and timeline markers
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE learning_comments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       text NOT NULL,
  asset_id              uuid NOT NULL REFERENCES learning_assets(id) ON DELETE RESTRICT,
  version_id            uuid REFERENCES learning_asset_versions(id) ON DELETE RESTRICT,
  parent_comment_id     uuid REFERENCES learning_comments(id) ON DELETE RESTRICT,
  user_id               text NOT NULL,
  comment_type          text NOT NULL DEFAULT 'GENERAL'
                        CHECK (comment_type IN ('GENERAL', 'TEXT_SELECTION', 'SCRIPT_BLOCK', 'SUGGESTION', 'SLIDE', 'ANNOTATION', 'AUDIO_TIMESTAMP', 'VIDEO_TIMESTAMP')),
  body                  text NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 10000),
  status                text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
  -- Where the comment points: a section and a quoted passage, a script block,
  -- a slide number. Timeline and drawing positions live in their own tables.
  anchor_json           jsonb,
  suggestion_text       text,
  suggestion_applied_at timestamptz,
  suggestion_applied_by text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  edited_at             timestamptz,
  resolved_by           text,
  resolved_at           timestamptz,
  deleted_at            timestamptz,
  deleted_by            text,
  CHECK ((status = 'RESOLVED') = (resolved_at IS NOT NULL))
);

CREATE INDEX learning_comments_asset_idx ON learning_comments (asset_id, created_at);
CREATE INDEX learning_comments_version_idx ON learning_comments (version_id);
CREATE INDEX learning_comments_parent_idx ON learning_comments (parent_comment_id) WHERE parent_comment_id IS NOT NULL;
CREATE INDEX learning_comments_open_idx ON learning_comments (asset_id)
  WHERE status = 'OPEN' AND parent_comment_id IS NULL AND deleted_at IS NULL;
CREATE TRIGGER learning_comments_touch BEFORE UPDATE ON learning_comments
  FOR EACH ROW EXECUTE FUNCTION learning_touch_updated_at();
CREATE TRIGGER learning_comments_no_delete BEFORE DELETE ON learning_comments
  FOR EACH ROW EXECUTE FUNCTION learning_refuse_delete();

-- A shape on a slide or page. Every coordinate is a fraction of the page, so
-- a pin lands on the same word at any zoom and on any screen. Free-hand points
-- and arrow ends live in metadata_json, normalised the same way.
CREATE TABLE learning_annotations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  asset_id        uuid NOT NULL REFERENCES learning_assets(id) ON DELETE RESTRICT,
  version_id      uuid NOT NULL REFERENCES learning_asset_versions(id) ON DELETE RESTRICT,
  page_number     int NOT NULL CHECK (page_number >= 1),
  annotation_type text NOT NULL CHECK (annotation_type IN ('PIN', 'RECTANGLE', 'CIRCLE', 'ARROW', 'FREEHAND', 'HIGHLIGHT')),
  x               numeric(9, 6) NOT NULL CHECK (x BETWEEN 0 AND 1),
  y               numeric(9, 6) NOT NULL CHECK (y BETWEEN 0 AND 1),
  width           numeric(9, 6) CHECK (width IS NULL OR width BETWEEN 0 AND 1),
  height          numeric(9, 6) CHECK (height IS NULL OR height BETWEEN 0 AND 1),
  metadata_json   jsonb NOT NULL DEFAULT '{}'::jsonb,
  comment_id      uuid NOT NULL UNIQUE REFERENCES learning_comments(id) ON DELETE RESTRICT,
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  deleted_at      timestamptz,
  deleted_by      text
);

CREATE INDEX learning_annotations_version_idx ON learning_annotations (version_id, page_number) WHERE deleted_at IS NULL;
CREATE TRIGGER learning_annotations_touch BEFORE UPDATE ON learning_annotations
  FOR EACH ROW EXECUTE FUNCTION learning_touch_updated_at();
CREATE TRIGGER learning_annotations_no_delete BEFORE DELETE ON learning_annotations
  FOR EACH ROW EXECUTE FUNCTION learning_refuse_delete();

CREATE TABLE learning_audio_markers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  asset_id        uuid NOT NULL REFERENCES learning_assets(id) ON DELETE RESTRICT,
  version_id      uuid NOT NULL REFERENCES learning_asset_versions(id) ON DELETE RESTRICT,
  start_seconds   numeric(10, 3) NOT NULL CHECK (start_seconds >= 0),
  end_seconds     numeric(10, 3) CHECK (end_seconds IS NULL OR end_seconds >= start_seconds),
  comment_id      uuid NOT NULL UNIQUE REFERENCES learning_comments(id) ON DELETE RESTRICT,
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX learning_audio_markers_version_idx ON learning_audio_markers (version_id, start_seconds);
CREATE TRIGGER learning_audio_markers_append_only BEFORE UPDATE OR DELETE ON learning_audio_markers
  FOR EACH ROW EXECUTE FUNCTION learning_refuse_change();

CREATE TABLE learning_video_markers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  asset_id        uuid NOT NULL REFERENCES learning_assets(id) ON DELETE RESTRICT,
  version_id      uuid NOT NULL REFERENCES learning_asset_versions(id) ON DELETE RESTRICT,
  start_seconds   numeric(10, 3) NOT NULL CHECK (start_seconds >= 0),
  end_seconds     numeric(10, 3) CHECK (end_seconds IS NULL OR end_seconds >= start_seconds),
  -- Set when the reviewer drew on a paused frame; annotation_json holds the shapes.
  frame_timestamp numeric(10, 3) CHECK (frame_timestamp IS NULL OR frame_timestamp >= 0),
  annotation_json jsonb,
  comment_id      uuid NOT NULL UNIQUE REFERENCES learning_comments(id) ON DELETE RESTRICT,
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX learning_video_markers_version_idx ON learning_video_markers (version_id, start_seconds);
CREATE TRIGGER learning_video_markers_append_only BEFORE UPDATE OR DELETE ON learning_video_markers
  FOR EACH ROW EXECUTE FUNCTION learning_refuse_change();

-- A voice-over transcript. One per version, entered by hand, imported, or
-- written later by an external transcription service — `segments_json` holds
-- timed passages when the source provides them.
CREATE TABLE learning_transcripts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  asset_id        uuid NOT NULL REFERENCES learning_assets(id) ON DELETE RESTRICT,
  version_id      uuid NOT NULL UNIQUE REFERENCES learning_asset_versions(id) ON DELETE RESTRICT,
  source          text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'IMPORTED', 'EXTERNAL')),
  provider        text,
  body            text NOT NULL DEFAULT '',
  segments_json   jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER learning_transcripts_touch BEFORE UPDATE ON learning_transcripts
  FOR EACH ROW EXECUTE FUNCTION learning_touch_updated_at();

-- ────────────────────────────────────────────────────────────────────
-- QA checklists
--
-- A course keeps one template per stage; reviewing a version copies the
-- template into a checklist of that version's own, so editing the template
-- never rewrites a review that already happened.
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE learning_checklists (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  course_id       uuid NOT NULL REFERENCES learning_courses(id) ON DELETE RESTRICT,
  asset_type      text NOT NULL CHECK (asset_type IN ('OUTLINE', 'PPT', 'SCRIPT', 'VOICE_OVER', 'VIDEO')),
  asset_id        uuid REFERENCES learning_assets(id) ON DELETE RESTRICT,
  version_id      uuid REFERENCES learning_asset_versions(id) ON DELETE RESTRICT,
  is_template     boolean NOT NULL DEFAULT false,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (is_template = (version_id IS NULL))
);

CREATE UNIQUE INDEX learning_checklists_template_idx ON learning_checklists (course_id, asset_type) WHERE is_template;
CREATE UNIQUE INDEX learning_checklists_version_idx ON learning_checklists (version_id) WHERE version_id IS NOT NULL;
CREATE TRIGGER learning_checklists_touch BEFORE UPDATE ON learning_checklists
  FOR EACH ROW EXECUTE FUNCTION learning_touch_updated_at();

CREATE TABLE learning_checklist_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  checklist_id    uuid NOT NULL REFERENCES learning_checklists(id) ON DELETE RESTRICT,
  sort_order      int NOT NULL DEFAULT 0,
  -- A built-in category key (CONTENT_ACCURACY…) the interface translates, or null for a custom item.
  category        text,
  label           text NOT NULL CHECK (length(btrim(label)) > 0),
  required        boolean NOT NULL DEFAULT true,
  status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PASSED', 'ISSUE')),
  notes           text NOT NULL DEFAULT '',
  updated_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz
);

CREATE INDEX learning_checklist_items_idx ON learning_checklist_items (checklist_id, sort_order) WHERE archived_at IS NULL;
CREATE TRIGGER learning_checklist_items_touch BEFORE UPDATE ON learning_checklist_items
  FOR EACH ROW EXECUTE FUNCTION learning_touch_updated_at();

-- ────────────────────────────────────────────────────────────────────
-- Course team
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE learning_course_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  course_id       uuid NOT NULL REFERENCES learning_courses(id) ON DELETE RESTRICT,
  user_id         text NOT NULL,
  roles           text[] NOT NULL CHECK (
                    cardinality(roles) > 0 AND
                    roles <@ ARRAY['PRODUCTION_MANAGER', 'COURSE_MANAGER', 'SUBJECT_MATTER_EXPERT', 'INSTRUCTIONAL_DESIGNER', 'OUTLINE_WRITER', 'SCRIPT_WRITER', 'PPT_DESIGNER', 'VOICE_OVER_ARTIST', 'AUDIO_REVIEWER', 'VIDEO_EDITOR', 'QUALITY_REVIEWER', 'VIEWER']::text[]
                  ),
  added_by        text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, user_id)
);

CREATE INDEX learning_members_user_idx ON learning_course_members (organization_id, user_id);
CREATE TRIGGER learning_members_touch BEFORE UPDATE ON learning_course_members
  FOR EACH ROW EXECUTE FUNCTION learning_touch_updated_at();

-- ────────────────────────────────────────────────────────────────────
-- Activity — append-only
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE learning_activity_log (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL,
  course_id       uuid REFERENCES learning_courses(id) ON DELETE RESTRICT,
  lesson_id       uuid REFERENCES learning_lessons(id) ON DELETE RESTRICT,
  asset_id        uuid REFERENCES learning_assets(id) ON DELETE RESTRICT,
  version_id      uuid REFERENCES learning_asset_versions(id) ON DELETE RESTRICT,
  actor_user_id   text,
  event_type      text NOT NULL CHECK (event_type IN ('COURSE_CREATED', 'COURSE_UPDATED', 'COURSE_ARCHIVED', 'COURSE_RESTORED', 'MODULE_CREATED', 'MODULE_UPDATED', 'MODULE_ARCHIVED', 'LESSON_CREATED', 'LESSON_UPDATED', 'LESSON_ARCHIVED', 'LESSON_RESTORED', 'TEAM_MEMBER_ADDED', 'TEAM_MEMBER_UPDATED', 'TEAM_MEMBER_REMOVED', 'ASSET_ASSIGNED', 'WORK_STARTED', 'VERSION_UPLOADED', 'SUBMITTED_FOR_REVIEW', 'REVIEW_STARTED', 'CHANGES_REQUESTED', 'RESUBMITTED', 'APPROVED', 'LOCKED', 'REOPENED', 'DEPENDENCY_OVERRIDDEN', 'COMMENT_CREATED', 'COMMENT_RESOLVED', 'COMMENT_REOPENED', 'SUGGESTION_APPLIED', 'CHECKLIST_UPDATED', 'TRANSCRIPT_UPDATED')),
  metadata_json   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX learning_activity_course_idx ON learning_activity_log (course_id, id DESC);
CREATE INDEX learning_activity_asset_idx ON learning_activity_log (asset_id, id DESC) WHERE asset_id IS NOT NULL;
CREATE INDEX learning_activity_org_idx ON learning_activity_log (organization_id, id DESC);
CREATE INDEX learning_activity_event_idx ON learning_activity_log (organization_id, event_type, created_at);
CREATE TRIGGER learning_activity_append_only BEFORE UPDATE OR DELETE ON learning_activity_log
  FOR EACH ROW EXECUTE FUNCTION learning_refuse_change();

-- ────────────────────────────────────────────────────────────────────
-- Notification de-duplication
--
-- The notification itself goes to the workspace bell (server/notify.js). This
-- row remembers that it was sent, so three saves in a minute are one alert and
-- a scheduler restart never repeats "this is overdue".
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE learning_notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  user_id         text NOT NULL,
  dedupe_key      text NOT NULL,
  event_type      text NOT NULL,
  asset_id        uuid REFERENCES learning_assets(id) ON DELETE RESTRICT,
  delivered_count int NOT NULL DEFAULT 1,
  suppressed_count int NOT NULL DEFAULT 0,
  first_sent_at   timestamptz NOT NULL DEFAULT now(),
  last_sent_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedupe_key)
);

CREATE INDEX learning_notifications_asset_idx ON learning_notifications (asset_id) WHERE asset_id IS NOT NULL;
