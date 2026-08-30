-- Content Studio SHARES — lifecycle columns so the full ShareRecord persists in Postgres (the frozen
-- video/poster bytes live in content_studio_artifacts by key; this adds the display fields the file-backed
-- record carried). Extends content_studio_shares. Idempotent (ADD COLUMN IF NOT EXISTS).
--
-- ROLLBACK (safe — only drops the added columns):
--   ALTER TABLE content_studio_shares
--     DROP COLUMN IF EXISTS poster_content_type,
--     DROP COLUMN IF EXISTS poster_rel,
--     DROP COLUMN IF EXISTS email_thumb_rel;

ALTER TABLE "content_studio_shares" ADD COLUMN IF NOT EXISTS "poster_content_type" text NOT NULL DEFAULT 'image/jpeg';
ALTER TABLE "content_studio_shares" ADD COLUMN IF NOT EXISTS "poster_rel"          text;
ALTER TABLE "content_studio_shares" ADD COLUMN IF NOT EXISTS "email_thumb_rel"     text;
