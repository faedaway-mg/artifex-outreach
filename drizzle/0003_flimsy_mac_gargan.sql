CREATE TABLE IF NOT EXISTS "concept_preview_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"preview_id" text NOT NULL,
	"version_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"view_count" integer DEFAULT 0 NOT NULL,
	"last_viewed_at" timestamp,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "concept_preview_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"preview_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"specification" jsonb NOT NULL,
	"rendered_html" text NOT NULL,
	"rendered_css" text NOT NULL,
	"desktop_screenshot_path" text,
	"mobile_screenshot_path" text,
	"tablet_screenshot_path" text,
	"generation_provider" text NOT NULL,
	"generation_model" text NOT NULL,
	"generation_cost" double precision DEFAULT 0 NOT NULL,
	"validation_results" jsonb,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "concept_previews" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"title" text NOT NULL,
	"preview_type" text NOT NULL,
	"status" text DEFAULT 'Not Started' NOT NULL,
	"visual_direction" text NOT NULL,
	"target_action" text NOT NULL,
	"recommended_service" text,
	"eligibility_reason" text,
	"source_facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved_facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"selected_finding_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generated_specification" jsonb,
	"current_version_id" text,
	"generation_count" integer DEFAULT 0 NOT NULL,
	"total_generation_cost" double precision DEFAULT 0 NOT NULL,
	"created_by" text DEFAULT 'jordan' NOT NULL,
	"approved_by" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"approved_at" timestamp,
	"archived_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "concept_preview_shares_token_idx" ON "concept_preview_shares" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "concept_preview_shares_preview_idx" ON "concept_preview_shares" USING btree ("preview_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "concept_preview_versions_preview_idx" ON "concept_preview_versions" USING btree ("preview_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "concept_previews_lead_idx" ON "concept_previews" USING btree ("lead_id");