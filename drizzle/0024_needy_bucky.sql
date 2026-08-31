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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "signed_artifact_blobs" (
	"id" text PRIMARY KEY NOT NULL,
	"artifact_id" text NOT NULL,
	"content_type" text DEFAULT 'application/pdf' NOT NULL,
	"byte_size" integer DEFAULT 0 NOT NULL,
	"sha256" text DEFAULT '' NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE "agreements" ADD COLUMN "esign_mode" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agreement_approvals_agreement_idx" ON "agreement_approvals" USING btree ("agreement_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agreement_approvals_version_idx" ON "agreement_approvals" USING btree ("agreement_id","agreement_version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "send_auth_agreement_idx" ON "agreement_send_authorizations" USING btree ("agreement_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "send_auth_idempotency_key_idx" ON "agreement_send_authorizations" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "live_payment_auth_agreement_idx" ON "live_payment_authorizations" USING btree ("agreement_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "signed_artifact_blobs_artifact_idx" ON "signed_artifact_blobs" USING btree ("artifact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signed_artifacts_agreement_idx" ON "signed_artifacts" USING btree ("agreement_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signed_artifacts_kind_idx" ON "signed_artifacts" USING btree ("agreement_id","kind");