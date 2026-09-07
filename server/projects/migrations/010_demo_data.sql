-- Qodo Projects — the demo-data manifest.
--
-- Demo data exists so that a first-time reader opens a screen with a working
-- product on it rather than eleven empty states. That is worth having, and it
-- is also the most dangerous kind of seed data there is: it is written into the
-- same tables as real work, by an administrator who may well be sitting in
-- front of production.
--
-- So the loader does not recognise its own rows by shape. "A project called
-- إطلاق متجر إلكتروني" and "a customer called شركة النور الرقمية" are guesses,
-- and a guess is what deletes a real project somebody named after the demo they
-- were shown. Every row the loader creates is recorded here instead, and the
-- unloader deletes exactly this list and nothing else. If it is not in this
-- table, it was not created by the demo loader, and the demo loader will not
-- touch it.
--
-- `entity_id` is text rather than uuid on purpose: a project task's identity is
-- its *document* id in the workspace store (ADR-3), which is not a uuid column
-- here. The manifest has to be able to name both halves of a task or the
-- unloader leaves orphaned documents in /tasks behind.
--
-- There is deliberately no foreign key to `projects`. A manifest whose rows
-- vanish when the thing they describe is deleted cannot tell the unloader what
-- is left to clean up, and `ON DELETE CASCADE` here would silently empty the
-- record of a load the moment somebody deleted one demo project by hand.
--
-- Rollback: DROP SCHEMA qodo_projects CASCADE;

SET search_path TO qodo_projects, public;

CREATE TABLE demo_seeds (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,

  -- One load is one batch. Loading twice and unloading once should remove the
  -- batch that was asked for, not "the demo data" as a category.
  batch_id        uuid NOT NULL,

  -- 'project', 'customer', 'user', 'task_document', 'project_group' … The
  -- unloader switches on this to decide *where* the row lives, because the
  -- manifest spans two storage engines.
  entity_type     text NOT NULL,
  entity_id       text NOT NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,

  -- The same entity must not be claimed twice by one batch, or the unloader
  -- counts its own work wrong and reports removing more than it did.
  UNIQUE (batch_id, entity_type, entity_id)
);

CREATE INDEX ON demo_seeds (organization_id, created_at DESC);
CREATE INDEX ON demo_seeds (organization_id, entity_type);
