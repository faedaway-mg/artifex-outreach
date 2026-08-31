-- Content Studio JOBS — lifecycle columns (durable web↔worker job records). Extends content_studio_jobs
-- so the RenderJob shape persists 1:1 in Postgres: web enqueue and worker claim operate on the SAME rows
-- (no filesystem JSON, no /tmp). Idempotent (ADD COLUMN IF NOT EXISTS). Ordered AFTER field_note_jobs.sql.
--
-- ROLLBACK (safe — only drops the added columns; the base table + existing data remain):
--   ALTER TABLE content_studio_jobs
--     DROP COLUMN IF EXISTS audio_kind, DROP COLUMN IF EXISTS audio_sha,
--     DROP COLUMN IF EXISTS poster_key, DROP COLUMN IF EXISTS output_rel,
--     DROP COLUMN IF EXISTS thumb_rel;

ALTER TABLE "content_studio_jobs" ADD COLUMN IF NOT EXISTS "audio_kind" text;   -- placeholder | uploaded | approved-master
ALTER TABLE "content_studio_jobs" ADD COLUMN IF NOT EXISTS "audio_sha"  text;   -- sha256 of the uploaded VO (integrity for materialize)
ALTER TABLE "content_studio_jobs" ADD COLUMN IF NOT EXISTS "poster_key" text;   -- ArtifactStore key of the published frame-zero poster
ALTER TABLE "content_studio_jobs" ADD COLUMN IF NOT EXISTS "output_rel" text;   -- dev-only public URL of the render (null in prod)
ALTER TABLE "content_studio_jobs" ADD COLUMN IF NOT EXISTS "thumb_rel"  text;   -- public URL of the thumbnail
