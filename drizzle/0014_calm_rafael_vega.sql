CREATE TABLE IF NOT EXISTS "roadmap_progress" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"recommendation_id" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'Recommended' NOT NULL,
	"operator_notes" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "roadmap_progress_lead_idx" ON "roadmap_progress" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "roadmap_progress_rec_idx" ON "roadmap_progress" USING btree ("recommendation_id");