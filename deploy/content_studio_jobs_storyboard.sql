-- Content Studio jobs — section F addendum: persist the evidence-led STORYBOARD bound at generation.
-- A client-video render composites the SHA-verified website screenshot into the INTERIOR finding scene(s)
-- driven by this storyboard (which shot → which narration line). Without it, the web ENQUEUE binds a
-- storyboard the worker never sees (it was dropped at the PG boundary), so the screenshot reached neither
-- the interior scenes nor the cover in production. We persist it as jsonb so the worker's dbToFileJob can
-- forward it to the render pipeline. Web-owned + immutable at enqueue (never clobbered by a worker write).
-- Idempotent.
--
-- ROLLBACK:
--   ALTER TABLE "content_studio_jobs" DROP COLUMN IF EXISTS "storyboard";

ALTER TABLE "content_studio_jobs" ADD COLUMN IF NOT EXISTS "storyboard" jsonb;
