CREATE TABLE IF NOT EXISTS "outcome_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"recommendation_id" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'Awaiting Review' NOT NULL,
	"expected_outcome" text DEFAULT '' NOT NULL,
	"before_state" text DEFAULT '' NOT NULL,
	"observed_outcome" text DEFAULT '' NOT NULL,
	"evidence" text DEFAULT '' NOT NULL,
	"unexpected_consequences" text DEFAULT '' NOT NULL,
	"lessons_learned" text DEFAULT '' NOT NULL,
	"confidence" text DEFAULT 'Low' NOT NULL,
	"reviewed_at" timestamp,
	"operator_notes" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outcome_reviews_lead_idx" ON "outcome_reviews" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outcome_reviews_rec_idx" ON "outcome_reviews" USING btree ("recommendation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outcome_reviews_status_idx" ON "outcome_reviews" USING btree ("status");