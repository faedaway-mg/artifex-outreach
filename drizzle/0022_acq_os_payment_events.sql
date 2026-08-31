CREATE TABLE IF NOT EXISTS "payment_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"provider_invoice_id" text,
	"invoice_id" text,
	"issuer_id" text,
	"payload" jsonb,
	"occurred_at" timestamp NOT NULL,
	"received_at" timestamp NOT NULL,
	"processed_at" timestamp,
	"outcome" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_events_event_id_idx" ON "payment_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_events_invoice_idx" ON "payment_events" USING btree ("provider_invoice_id");