CREATE TABLE IF NOT EXISTS "engagement_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"recommendation_id" text NOT NULL,
	"trigger" text NOT NULL,
	"payload" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "engagement_snapshots_lead_idx" ON "engagement_snapshots" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "engagement_snapshots_rec_idx" ON "engagement_snapshots" USING btree ("recommendation_id");