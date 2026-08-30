-- Content Studio DRAFTS — operator-created draft concepts (manual script entry, not yet renderable until a
-- scene template is authored). Replaces .data/.../drafts.json so drafts survive restarts. Idempotent guard.
--
-- ROLLBACK (safe — CS-owned):
--   DROP TABLE IF EXISTS content_studio_drafts;

CREATE TABLE IF NOT EXISTS "content_studio_drafts" (
  "id"         text PRIMARY KEY,                         -- draft_*
  "title"      text NOT NULL,
  "concept"    text NOT NULL DEFAULT '',
  "narration"  jsonb NOT NULL DEFAULT '[]'::jsonb,       -- string[]
  "created_at" timestamptz NOT NULL DEFAULT now()
);
