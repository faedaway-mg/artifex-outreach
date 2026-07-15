CREATE TABLE IF NOT EXISTS "acquisition_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"field" text NOT NULL,
	"original" text,
	"updated" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"user" text DEFAULT 'jordan' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acquisition_feedback_lead_idx" ON "acquisition_feedback" USING btree ("lead_id");