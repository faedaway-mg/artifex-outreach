CREATE TYPE "public"."invoice_state" AS ENUM('draft', 'issued', 'processing', 'paid', 'failed', 'void', 'refunded', 'partially_refunded', 'disputed', 'uncollectible');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"agreement_id" text NOT NULL,
	"agreement_version" integer DEFAULT 1 NOT NULL,
	"issuer_id" text NOT NULL,
	"milestone_key" text NOT NULL,
	"milestone_label" text DEFAULT '' NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"state" "invoice_state" DEFAULT 'draft' NOT NULL,
	"idempotency_key" text NOT NULL,
	"provider" text,
	"provider_invoice_id" text,
	"hosted_invoice_url" text,
	"issued_at" timestamp,
	"paid_at" timestamp,
	"failed_at" timestamp,
	"voided_at" timestamp,
	"refunded_at" timestamp,
	"disputed_at" timestamp,
	"amount_refunded_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_lead_idx" ON "invoices" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_agreement_idx" ON "invoices" USING btree ("agreement_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_state_idx" ON "invoices" USING btree ("state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_provider_invoice_idx" ON "invoices" USING btree ("provider_invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_idempotency_key_idx" ON "invoices" USING btree ("idempotency_key");