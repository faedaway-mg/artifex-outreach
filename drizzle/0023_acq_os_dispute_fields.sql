ALTER TABLE "invoices" ADD COLUMN "charge_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "payment_intent_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "dispute_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "amount_disputed_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "dispute_resolved_at" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_charge_idx" ON "invoices" USING btree ("charge_id");