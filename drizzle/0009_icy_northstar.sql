CREATE TABLE IF NOT EXISTS "business_intelligence" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"profile" jsonb NOT NULL,
	"enrichment_delta" jsonb,
	"evidence_confidence" integer DEFAULT 0 NOT NULL,
	"improvement_score" integer DEFAULT 0 NOT NULL,
	"treatment" text DEFAULT '' NOT NULL,
	"generated_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_intelligence_lead_idx" ON "business_intelligence" USING btree ("lead_id");