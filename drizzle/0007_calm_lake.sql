CREATE TABLE IF NOT EXISTS "email_sends" (
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"step_id" text,
	"plan_id" text,
	"lead_id" text,
	"to_addr" text DEFAULT '' NOT NULL,
	"from_addr" text DEFAULT '' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider" text DEFAULT 'resend' NOT NULL,
	"provider_message_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"last_error_code" text,
	"next_attempt_at" timestamp,
	"queued_at" timestamp,
	"sending_at" timestamp,
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"opened_at" timestamp,
	"clicked_at" timestamp,
	"bounced_at" timestamp,
	"complained_at" timestamp,
	"unsubscribed_at" timestamp,
	"failed_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_sends_key_idx" ON "email_sends" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_sends_status_idx" ON "email_sends" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_sends_provider_msg_idx" ON "email_sends" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_sends_plan_idx" ON "email_sends" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_sends_lead_idx" ON "email_sends" USING btree ("lead_id");