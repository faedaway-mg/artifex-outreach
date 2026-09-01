-- Content Studio jobs — section I-C additive columns. A client-video render CONSUMES a verified website
-- screenshot; we persist which artifact + its SHA so the render is reproducible and provenance-true, and
-- so the worker can materialize + integrity-check the exact bytes it was bound to. Idempotent.
--
-- ROLLBACK:
--   ALTER TABLE "content_studio_jobs" DROP COLUMN IF EXISTS "screenshot_key";
--   ALTER TABLE "content_studio_jobs" DROP COLUMN IF EXISTS "screenshot_sha";

ALTER TABLE "content_studio_jobs" ADD COLUMN IF NOT EXISTS "screenshot_key" text;
ALTER TABLE "content_studio_jobs" ADD COLUMN IF NOT EXISTS "screenshot_sha" text;
