-- Content Studio ARTIFACT STORAGE — PostgreSQL-native durable bytes (the $0 backend behind cs-storage).
-- Holds MP3 uploads, render inputs, MP4 outputs, posters, and frozen share media as bytea. Publication
-- is atomic (a single INSERT — a partial write is never visible). SHA-256 is stored for verification.
-- Range reads use substring(data ...) so the DB extracts the slice server-side (no whole-video buffering
-- in the web process). Ordered AFTER content_studio_jobs/shares. PREPARED — apply to STAGING first, then
-- production, additive only, with a verified pg_dump backup. Idempotent guards included.
--
-- BACKUP:  pg_dump --no-owner -Fc "$DATABASE_URL" > backup_pre_cs_artifacts.dump
-- ROLLBACK (CS-owned, safe — nothing else references it): DROP TABLE IF EXISTS content_studio_artifacts;

CREATE TABLE IF NOT EXISTS "content_studio_artifacts" (
  "object_key"    text PRIMARY KEY,                       -- content-studio/<class>/<id>.<ext> (unguessable where private)
  "content_type"  text NOT NULL,
  "byte_size"     bigint NOT NULL,
  "sha256"        text NOT NULL,                          -- hex; verified on read
  "data"          bytea NOT NULL,                         -- the durable bytes (atomic with the row)
  "artifact_class" text NOT NULL,                         -- upload | render-input | render-output | poster | share-media
  "job_id"        text,                                   -- owning render job (ownership-fenced writes)
  "share_token"   text,                                   -- owning share (revoke → route returns 410)
  "metadata"      jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "published_at"  timestamptz NOT NULL DEFAULT now(),     -- set in the same INSERT → always fully written
  "expires_at"    timestamptz,                            -- pilot retention (abandoned uploads, failed, revoked)
  "deleted_at"    timestamptz                             -- soft delete → unavailable; explicit/audited cleanup
);

CREATE INDEX IF NOT EXISTS "cs_artifacts_class_idx"  ON "content_studio_artifacts" ("artifact_class");
CREATE INDEX IF NOT EXISTS "cs_artifacts_job_idx"    ON "content_studio_artifacts" ("job_id");
CREATE INDEX IF NOT EXISTS "cs_artifacts_share_idx"  ON "content_studio_artifacts" ("share_token");
CREATE INDEX IF NOT EXISTS "cs_artifacts_expiry_idx" ON "content_studio_artifacts" ("expires_at") WHERE "expires_at" IS NOT NULL;

-- Storage accounting view (used bytes / count, excluding soft-deleted).
CREATE OR REPLACE VIEW "content_studio_storage_usage" AS
  SELECT count(*)::bigint AS artifact_count,
         COALESCE(sum(byte_size), 0)::bigint AS used_bytes,
         min(created_at) FILTER (WHERE expires_at IS NOT NULL) AS oldest_expirable
  FROM "content_studio_artifacts"
  WHERE "deleted_at" IS NULL;
