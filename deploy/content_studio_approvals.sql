-- Content Studio APPROVALS — the explicit operator posting-approval, version-bound to the EXACT render it
-- approved (goes stale automatically when a newer inputVersion exists). One row per piece. Replaces
-- .data/.../approvals.json so approvals are durable and shared by web + worker. Idempotent guard included.
--
-- ROLLBACK (safe — CS-owned):
--   DROP TABLE IF EXISTS content_studio_approvals;

CREATE TABLE IF NOT EXISTS "content_studio_approvals" (
  "piece_id"      text PRIMARY KEY,                       -- one active approval per piece
  "job_id"        text NOT NULL,                          -- the exact render approved
  "input_version" text NOT NULL,                          -- binds the approval to that version (staleness)
  "output_rel"    text,                                   -- recorded output reference at approval time
  "audio_sig"     text NOT NULL,                          -- the audio that was approved
  "approved_at"   timestamptz NOT NULL DEFAULT now()
);
