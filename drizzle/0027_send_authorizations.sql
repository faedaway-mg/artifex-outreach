-- Gate 3: one-time, version-bound, exact-approval/recipient/PDF-bound send authorization
-- (separate from approval; consumed exactly once when a SignWell document is created).
-- Additive; safe to re-run.
CREATE TABLE IF NOT EXISTS "agreement_send_authorizations" (
  "id" text PRIMARY KEY NOT NULL,
  "agreement_id" text NOT NULL,
  "agreement_version" integer DEFAULT 1 NOT NULL,
  "approval_id" text NOT NULL,
  "approval_digest" text NOT NULL,
  "unsigned_pdf_sha256" text NOT NULL,
  "esign_mode" text DEFAULT 'test' NOT NULL,
  "provider_email" text DEFAULT '' NOT NULL,
  "client_email" text DEFAULT '' NOT NULL,
  "recipient_digest" text DEFAULT '' NOT NULL,
  "operator_id" text NOT NULL,
  "authorized_at" timestamp NOT NULL,
  "expires_at" timestamp,
  "revoked_at" timestamp,
  "consumed_at" timestamp,
  "esign_request_id" text,
  "authorization_version" integer DEFAULT 1 NOT NULL,
  "idempotency_key" text NOT NULL,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS "send_auth_agreement_idx" ON "agreement_send_authorizations" USING btree ("agreement_id");
CREATE UNIQUE INDEX IF NOT EXISTS "send_auth_idempotency_key_idx" ON "agreement_send_authorizations" USING btree ("idempotency_key");
