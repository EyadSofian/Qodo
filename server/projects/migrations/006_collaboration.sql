-- Qodo Projects — collaboration and documents.
--
-- `is_internal` on comments and `is_external` on folders and files are the
-- client boundary, and they appear here rather than being derived from the
-- parent for a reason: a comment on a client-visible task is not automatically
-- a client-visible comment. "Let's pad the estimate" written under a shared
-- deliverable is exactly the sentence that must not travel.
--
-- Rollback: DROP SCHEMA qodo_projects CASCADE;

SET search_path TO qodo_projects, public;

-- ────────────────────────────────────────────────────────────────────
-- Comments
--
-- Polymorphic: the same thread machinery serves tasks, issues, phases,
-- documents and forum posts. Five tables would mean writing mentions,
-- reactions, edit policy and the client filter five times.
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE comments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  project_id      uuid REFERENCES projects(id) ON DELETE CASCADE,
  entity_type     text NOT NULL,
  entity_id       text NOT NULL,
  author_id       text NOT NULL,
  body            text NOT NULL,
  parent_id       uuid REFERENCES comments(id) ON DELETE CASCADE,

  -- The default is internal. A comment that reaches a customer should be a
  -- decision somebody made, never something that happened because a flag
  -- defaulted the other way.
  is_internal     boolean NOT NULL DEFAULT true,

  -- Who was named. Stored so the notification fan-out does not have to re-parse
  -- the body, and so an edit that removes a mention does not un-notify anybody.
  mention_ids     jsonb NOT NULL DEFAULT '[]'::jsonb,

  edited_at       timestamptz,
  deleted_at      timestamptz,
  deleted_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON comments (entity_type, entity_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX ON comments (project_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX ON comments (parent_id) WHERE parent_id IS NOT NULL;

-- Zoho added these in August 2025, and they earn their place: a thread where
-- six people each type "agreed" is a thread nobody reads.
CREATE TABLE comment_reactions (
  comment_id      uuid NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  organization_id text NOT NULL,
  user_id         text NOT NULL,
  emoji           text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id, emoji)
);

-- ────────────────────────────────────────────────────────────────────
-- Documents
--
-- Metadata here, bytes behind the storage abstraction (ADR-5). One logical
-- document is N versions, and the current one is a pointer rather than a copy —
-- so restoring an old version is changing which row is current, not moving
-- bytes around.
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE document_folders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id       uuid REFERENCES document_folders(id) ON DELETE CASCADE,
  name            text NOT NULL,
  is_external     boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  deleted_at      timestamptz,
  deleted_batch_id uuid
);

CREATE INDEX ON document_folders (project_id, parent_id) WHERE deleted_at IS NULL;

CREATE TABLE document_files (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  folder_id       uuid REFERENCES document_folders(id) ON DELETE SET NULL,
  name            text NOT NULL,
  description     text NOT NULL DEFAULT '',
  is_external     boolean NOT NULL DEFAULT false,
  current_version int NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  deleted_by      text,
  deleted_batch_id uuid
);

CREATE INDEX ON document_files (project_id, folder_id) WHERE deleted_at IS NULL;
CREATE INDEX ON document_files (project_id, is_external) WHERE deleted_at IS NULL;

CREATE TABLE document_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id         uuid NOT NULL REFERENCES document_files(id) ON DELETE CASCADE,
  organization_id text NOT NULL,
  version_no      int NOT NULL,
  -- The key in the blob store. Never a filename and never anything the
  -- uploader chose, so a name can not escape the directory — the same rule
  -- server/store.js already follows for task attachments.
  blob_id         text NOT NULL,
  size_bytes      bigint NOT NULL,
  mime_type       text NOT NULL,
  checksum        text,
  uploaded_by     text,
  uploaded_at     timestamptz NOT NULL DEFAULT now(),
  notes           text NOT NULL DEFAULT '',
  UNIQUE (file_id, version_no)
);

CREATE INDEX ON document_versions (file_id, version_no DESC);

-- ────────────────────────────────────────────────────────────────────
-- Forums
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE forum_categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text NOT NULL DEFAULT '',
  is_external     boolean NOT NULL DEFAULT false,
  order_index     int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text
);

CREATE INDEX ON forum_categories (project_id, order_index);

CREATE TABLE forum_topics (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category_id     uuid REFERENCES forum_categories(id) ON DELETE SET NULL,
  title           text NOT NULL,
  body            text NOT NULL DEFAULT '',
  author_id       text NOT NULL,
  is_external     boolean NOT NULL DEFAULT false,
  is_pinned       boolean NOT NULL DEFAULT false,
  is_locked       boolean NOT NULL DEFAULT false,
  reply_count     int NOT NULL DEFAULT 0,
  last_reply_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX ON forum_topics (project_id, is_pinned DESC, last_reply_at DESC NULLS LAST)
  WHERE deleted_at IS NULL;

CREATE TABLE forum_posts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  topic_id        uuid NOT NULL REFERENCES forum_topics(id) ON DELETE CASCADE,
  author_id       text NOT NULL,
  body            text NOT NULL,
  mention_ids     jsonb NOT NULL DEFAULT '[]'::jsonb,
  edited_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  deleted_by      text
);

CREATE INDEX ON forum_posts (topic_id, created_at) WHERE deleted_at IS NULL;

CREATE TABLE forum_follows (
  topic_id        uuid NOT NULL REFERENCES forum_topics(id) ON DELETE CASCADE,
  user_id         text NOT NULL,
  organization_id text NOT NULL,
  PRIMARY KEY (topic_id, user_id)
);

-- ────────────────────────────────────────────────────────────────────
-- Pages
--
-- A wiki, not a message: pages are edited rather than replied to, and every
-- save keeps the previous body so a bad edit is one click from being undone.
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE project_pages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id       uuid REFERENCES project_pages(id) ON DELETE CASCADE,
  title           text NOT NULL,
  body            text NOT NULL DEFAULT '',
  is_external     boolean NOT NULL DEFAULT false,
  order_index     int NOT NULL DEFAULT 0,
  revision_no     int NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text,
  deleted_at      timestamptz
);

CREATE INDEX ON project_pages (project_id, parent_id, order_index) WHERE deleted_at IS NULL;

CREATE TABLE page_revisions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id         uuid NOT NULL REFERENCES project_pages(id) ON DELETE CASCADE,
  organization_id text NOT NULL,
  revision_no     int NOT NULL,
  title           text NOT NULL,
  body            text NOT NULL,
  author_id       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_id, revision_no)
);

CREATE INDEX ON page_revisions (page_id, revision_no DESC);

-- ────────────────────────────────────────────────────────────────────
-- Notification preferences
--
-- Per person, per project, per category — which is the granularity people
-- actually want: "tell me about everything on the tower job and only mentions
-- everywhere else".
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE notification_preferences (
  organization_id text NOT NULL,
  user_id         text NOT NULL,
  project_id      uuid REFERENCES projects(id) ON DELETE CASCADE,
  category        text NOT NULL,
  in_app          boolean NOT NULL DEFAULT true,
  push            boolean NOT NULL DEFAULT true,
  email           boolean NOT NULL DEFAULT false,
  is_muted        boolean NOT NULL DEFAULT false,
  PRIMARY KEY (organization_id, user_id, project_id, category)
);

CREATE TRIGGER comments_touch BEFORE UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER document_files_touch BEFORE UPDATE ON document_files
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER forum_topics_touch BEFORE UPDATE ON forum_topics
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER project_pages_touch BEFORE UPDATE ON project_pages
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
