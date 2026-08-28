-- Content Studio durable jobs — PREPARED migration (NOT applied). Mirrors the file-backed RenderJob
-- shape so the local `.data/content-studio/jobs/*.json` store ports to Postgres 1:1 for production
-- (same discipline as review_video_jobs). At deploy time, move this into drizzle/ with the NEXT
-- sequential migration number (do not hand-number it here — several worktrees are adding migrations and
-- a fixed number would collide). Idempotent guard included.

CREATE TABLE IF NOT EXISTS "content_studio_jobs" (
  "id"             text PRIMARY KEY,                       -- csjob_*
  "piece_id"       text NOT NULL,                          -- 004 / 007 / p-<id> / client-<leadId>
  "business_id"    text,                                   -- set for client/prospect videos (bound to a lead)
  "input_version"  text NOT NULL,                          -- deterministic hash(script, audioSig, template)
  "status"         text NOT NULL,                          -- queued | rendering | ready | failed
  "progress"       double precision NOT NULL DEFAULT 0,
  "stage"          text NOT NULL DEFAULT '',
  "mode"           text NOT NULL,                          -- reuse-approved-audio | uploaded-vo
  "audio_key"      text,                                   -- object-storage key of the uploaded VO (private)
  "audio_label"    text,
  "output_key"     text,                                   -- object-storage key of the rendered mp4
  "thumb_key"      text,
  "error"          text,
  "attempt"        integer NOT NULL DEFAULT 1,
  "lease_until"    timestamptz,                            -- worker heartbeat for crash recovery
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now(),
  "started_at"     timestamptz,
  "finished_at"    timestamptz
);

CREATE INDEX IF NOT EXISTS "content_studio_jobs_piece_idx"  ON "content_studio_jobs" ("piece_id");
CREATE INDEX IF NOT EXISTS "content_studio_jobs_status_idx" ON "content_studio_jobs" ("status");
CREATE INDEX IF NOT EXISTS "content_studio_jobs_biz_idx"    ON "content_studio_jobs" ("business_id");

-- Duplicate-render guard at the DB level (matches findActiveDuplicate): at most one ACTIVE job per
-- (piece, input_version). Partial unique index over the non-terminal states.
CREATE UNIQUE INDEX IF NOT EXISTS "content_studio_jobs_active_uniq"
  ON "content_studio_jobs" ("piece_id", "input_version")
  WHERE "status" IN ('queued', 'rendering');
