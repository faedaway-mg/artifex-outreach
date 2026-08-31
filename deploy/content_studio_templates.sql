-- Content Studio TEMPLATES — operator-authored data-driven Field Note templates (the UI-created ones,
-- e.g. auto-laid-out scripts and client/prospect videos). Stored as the validated ContentTemplate doc in
-- jsonb so create→edit→reopen survives restarts without writable container disk. Committed templates
-- (public/content/templates/*.json, e.g. #007) remain READ-ONLY SEEDS resolved from the image and are
-- NEVER copied in here — this table holds only authored/edited templates, which override a same-id seed.
-- Idempotent guard included.
--
-- ROLLBACK (safe — CS-owned, nothing else references it):
--   DROP TABLE IF EXISTS content_studio_templates;

CREATE TABLE IF NOT EXISTS "content_studio_templates" (
  "id"          text PRIMARY KEY,                       -- template id (also the piece id)
  "doc"         jsonb NOT NULL,                         -- the full validated ContentTemplate
  "business_id" text,                                   -- bound for client/prospect videos
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "content_studio_templates_biz_idx" ON "content_studio_templates" ("business_id");
