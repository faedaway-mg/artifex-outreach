-- Content Studio SHARES — PREPARED migration (NOT applied). Mirrors the file-backed ShareRecord so
-- hosted viewing links are durable in production, not local-only files. Ordered AFTER
-- content_studio_jobs. At deploy time, move both into drizzle/ with the NEXT sequential numbers (do not
-- hand-number here — other worktrees add migrations concurrently). Idempotent guards included.
--
-- BACKUP before applying (production):
--   pg_dump --no-owner --format=custom "$DATABASE_URL" > backup_pre_content_studio.dump
-- ROLLBACK (both CS tables, safe — nothing else references them):
--   DROP TABLE IF EXISTS content_studio_shares;
--   DROP TABLE IF EXISTS content_studio_jobs;
-- (Or restore: pg_restore --clean --no-owner -d "$DATABASE_URL" backup_pre_content_studio.dump)

CREATE TABLE IF NOT EXISTS "content_studio_shares" (
  "token"         text PRIMARY KEY,                 -- durable, unguessable (>=36 hex)
  "piece_id"      text NOT NULL,
  "business_id"   text,                             -- bound for client/prospect videos
  "business_name" text,
  "title"         text NOT NULL,
  "intro"         text,
  "video_key"     text NOT NULL,                    -- object-storage key of the FROZEN mp4 (private)
  "poster_key"    text,                             -- frozen poster (private; served via token route)
  "video_hash"    text NOT NULL,                    -- sha256 of the frozen mp4 (immutability receipt)
  "input_version" text NOT NULL,                    -- the approved render version this link is bound to
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "revoked_at"    timestamptz                       -- null = live
);

CREATE INDEX IF NOT EXISTS "content_studio_shares_piece_idx" ON "content_studio_shares" ("piece_id");
CREATE INDEX IF NOT EXISTS "content_studio_shares_biz_idx"   ON "content_studio_shares" ("business_id");

-- Email drafts bound to a share (video-artifact policy). A draft's approval is invalidated when its
-- share is revoked or its bound version changes (enforced in app logic; the columns make it auditable).
CREATE TABLE IF NOT EXISTS "content_studio_email_drafts" (
  "id"            text PRIMARY KEY,
  "business_id"   text NOT NULL,
  "share_token"   text NOT NULL REFERENCES "content_studio_shares" ("token"),
  "input_version" text NOT NULL,                    -- the share version at draft time (staleness check)
  "subject"       text NOT NULL,
  "body_text"     text NOT NULL,
  "body_html"     text NOT NULL,
  "artifact_kind" text NOT NULL DEFAULT 'video-link', -- 'video-link' | 'pdf' — explicit, never a silent fallback
  "approved_at"   timestamptz,                       -- explicit approval; cleared when share/version changes
  "sent_at"       timestamptz,                       -- set only by the real manual-send workflow
  "sent_version"  text,                              -- the exact shared version referenced at dispatch
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "content_studio_email_drafts_biz_idx" ON "content_studio_email_drafts" ("business_id");
