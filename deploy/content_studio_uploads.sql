-- Content Studio UPLOADS — durable voiceover-upload metadata (bytes live in content_studio_artifacts by
-- object_key; this is the per-piece index the UI + runner read). Replaces the .data/.../uploads/*.meta.json
-- files so uploads survive a restart and never need writable container storage. Idempotent guard included.
--
-- ROLLBACK (safe — CS-owned, nothing else references it):
--   DROP TABLE IF EXISTS content_studio_uploads;

CREATE TABLE IF NOT EXISTS "content_studio_uploads" (
  "id"               text PRIMARY KEY,                    -- stamped upload id (up<...>)
  "piece_id"         text NOT NULL,
  "object_key"       text NOT NULL,                       -- ArtifactStore key of the uploaded VO bytes (private)
  "name"             text NOT NULL,                       -- original filename (display only)
  "byte_size"        bigint NOT NULL,
  "sha256"           text NOT NULL,                       -- integrity (verified when the worker materializes)
  "duration_seconds" double precision,
  "kind"             text NOT NULL DEFAULT 'uploaded',    -- uploaded | placeholder (explicit, never inferred)
  "uploaded_at"      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "content_studio_uploads_piece_idx" ON "content_studio_uploads" ("piece_id");
