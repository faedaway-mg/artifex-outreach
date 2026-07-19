CREATE TYPE "public"."agreement_status" AS ENUM('draft', 'generated', 'approved', 'sent', 'viewed', 'signed', 'declined', 'voided');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'link_sent', 'paid', 'failed', 'void');--> statement-breakpoint
CREATE TYPE "public"."payment_type" AS ENUM('deposit', 'balance', 'monthly');--> statement-breakpoint
ALTER TYPE "public"."pipeline_stage" ADD VALUE 'Proposal Accepted';--> statement-breakpoint
ALTER TYPE "public"."pipeline_stage" ADD VALUE 'Agreement Signed';--> statement-breakpoint
ALTER TYPE "public"."pipeline_stage" ADD VALUE 'Deposit Paid';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agreement_events" (
	"id" text PRIMARY KEY NOT NULL,
	"agreement_id" text NOT NULL,
	"provider" text DEFAULT 'signwell' NOT NULL,
	"event_type" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb,
	"occurred_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agreements" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"proposal_id" text NOT NULL,
	"agreement_number" text NOT NULL,
	"template_version" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_id" text,
	"superseded_by_id" text,
	"status" "agreement_status" DEFAULT 'draft' NOT NULL,
	"content_snapshot" jsonb NOT NULL,
	"effective_date" text,
	"signer_name" text,
	"signer_email" text,
	"signer_company" text,
	"pdf_key" text,
	"pdf_url" text,
	"signed_pdf_key" text,
	"signed_pdf_url" text,
	"certificate_url" text,
	"esign_provider" text,
	"esign_request_id" text,
	"esign_url" text,
	"approved_at" timestamp,
	"sent_at" timestamp,
	"viewed_at" timestamp,
	"signed_at" timestamp,
	"declined_at" timestamp,
	"voided_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"agreement_id" text NOT NULL,
	"type" "payment_type" DEFAULT 'deposit' NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"stripe_payment_link_url" text,
	"stripe_session_id" text,
	"sent_at" timestamp,
	"paid_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "number" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agreement_events_dedupe_idx" ON "agreement_events" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agreement_events_agreement_idx" ON "agreement_events" USING btree ("agreement_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agreements_lead_idx" ON "agreements" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agreements_proposal_idx" ON "agreements" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agreements_status_idx" ON "agreements" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agreements_number_idx" ON "agreements" USING btree ("agreement_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agreements_esign_idx" ON "agreements" USING btree ("esign_request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_lead_idx" ON "payments" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_agreement_idx" ON "payments" USING btree ("agreement_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_status_idx" ON "payments" USING btree ("status");