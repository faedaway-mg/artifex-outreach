CREATE TABLE IF NOT EXISTS "email_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_event_id" text NOT NULL,
	"type" text NOT NULL,
	"provider_message_id" text,
	"send_id" text,
	"payload" jsonb,
	"received_at" timestamp NOT NULL,
	"processed_at" timestamp,
	"result" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_events_event_idx" ON "email_events" USING btree ("provider_event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_events_msg_idx" ON "email_events" USING btree ("provider_message_id");