CREATE TABLE IF NOT EXISTS "relationship_memory" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"value" text NOT NULL,
	"status" text DEFAULT 'Proposed' NOT NULL,
	"confidence" text DEFAULT 'Medium' NOT NULL,
	"source" text NOT NULL,
	"supporting_context" text,
	"operator_notes" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "relationship_memory_lead_idx" ON "relationship_memory" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "relationship_memory_category_idx" ON "relationship_memory" USING btree ("category");