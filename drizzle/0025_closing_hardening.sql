-- Gates 4 + 9: bound owner-approval records, retained signed artifacts, and explicit
-- live-payment authorizations. All additive; safe to run on an existing database.
CREATE TABLE IF NOT EXISTS "agreement_approvals" (
  "id" text PRIMARY KEY NOT NULL,
  "agreement_id" text NOT NULL,
  "agreement_version" integer DEFAULT 1 NOT NULL,
  "binding" jsonb NOT NULL,
  "digest" text NOT NULL,
  "approved_by" text NOT NULL,
  "approved_at" timestamp NOT NULL,
  "revoked_at" timestamp,
  "created_at" timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS "agreement_approvals_agreement_idx" ON "agreement_approvals" USING btree ("agreement_id");
CREATE INDEX IF NOT EXISTS "agreement_approvals_version_idx" ON "agreement_approvals" USING btree ("agreement_id","agreement_version");

CREATE TABLE IF NOT EXISTS "signed_artifacts" (
  "id" text PRIMARY KEY NOT NULL,
  "agreement_id" text NOT NULL,
  "esign_request_id" text DEFAULT '' NOT NULL,
  "kind" text NOT NULL,
  "sha256" text DEFAULT '' NOT NULL,
  "byte_size" integer DEFAULT 0 NOT NULL,
  "storage_key" text DEFAULT '' NOT NULL,
  "approval_digest" text,
  "esign_mode" text DEFAULT 'test' NOT NULL,
  "status" text DEFAULT 'failed' NOT NULL,
  "retry_count" integer DEFAULT 0 NOT NULL,
  "retrieved_at" timestamp NOT NULL,
  "created_at" timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS "signed_artifacts_agreement_idx" ON "signed_artifacts" USING btree ("agreement_id");
CREATE INDEX IF NOT EXISTS "signed_artifacts_kind_idx" ON "signed_artifacts" USING btree ("agreement_id","kind");

CREATE TABLE IF NOT EXISTS "live_payment_authorizations" (
  "id" text PRIMARY KEY NOT NULL,
  "agreement_id" text NOT NULL,
  "agreement_version" integer DEFAULT 1 NOT NULL,
  "approval_digest" text,
  "authorized_by" text NOT NULL,
  "authorized_at" timestamp NOT NULL,
  "revoked_at" timestamp,
  "created_at" timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS "live_payment_auth_agreement_idx" ON "live_payment_authorizations" USING btree ("agreement_id");
