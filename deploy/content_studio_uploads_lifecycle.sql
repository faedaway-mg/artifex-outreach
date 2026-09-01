-- Content Studio uploads — section I-A additive columns. Records the container type DETECTED from the
-- file's real bytes (not the client MIME/filename). Idempotent; safe to re-run.
--
-- ROLLBACK: ALTER TABLE "content_studio_uploads" DROP COLUMN IF EXISTS "detected_type";

ALTER TABLE "content_studio_uploads" ADD COLUMN IF NOT EXISTS "detected_type" text;
