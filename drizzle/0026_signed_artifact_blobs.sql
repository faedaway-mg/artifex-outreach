-- Gate 9: durable PostgreSQL storage for signed-artifact BYTES. Additive; safe to
-- run on an existing database. One row per artifact key; `artifact_id` is UNIQUE so
-- re-uploading the same document is a no-op instead of a duplicate.
CREATE TABLE IF NOT EXISTS "signed_artifact_blobs" (
  "id" text PRIMARY KEY NOT NULL,
  "artifact_id" text NOT NULL,
  "content_type" text DEFAULT 'application/pdf' NOT NULL,
  "byte_size" integer DEFAULT 0 NOT NULL,
  "sha256" text DEFAULT '' NOT NULL,
  "data" bytea NOT NULL,
  "created_at" timestamp NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "signed_artifact_blobs_artifact_idx" ON "signed_artifact_blobs" USING btree ("artifact_id");
