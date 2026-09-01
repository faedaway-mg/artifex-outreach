-- Content Studio — persisted social captions (one per piece) with revision history.
-- Additive + idempotent: safe to run repeatedly. Bytes/metadata only; no dependency on other CS tables.
CREATE TABLE IF NOT EXISTS "content_studio_captions" (
  piece_id   text PRIMARY KEY,
  text       text NOT NULL,
  source     text NOT NULL DEFAULT 'generated',      -- 'generated' | 'edited'
  edited     boolean NOT NULL DEFAULT false,          -- true once the owner has edited (guards regen overwrite)
  revisions  jsonb NOT NULL DEFAULT '[]'::jsonb,       -- [{ text, source, at }], newest last
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
