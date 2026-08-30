-- Content Studio POSTED markers — records when a piece was marked posted (operator status transition).
-- One row per piece. Replaces .data/.../posted.json. Idempotent guard included.
--
-- ROLLBACK (safe — CS-owned):
--   DROP TABLE IF EXISTS content_studio_posted;

CREATE TABLE IF NOT EXISTS "content_studio_posted" (
  "piece_id"  text PRIMARY KEY,
  "posted_at" timestamptz NOT NULL DEFAULT now()
);
