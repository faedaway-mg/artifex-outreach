CREATE TABLE IF NOT EXISTS "prospecting_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"trigger" text DEFAULT 'scheduled' NOT NULL,
	"provider_mode" text DEFAULT 'google' NOT NULL,
	"searches_performed" integer DEFAULT 0 NOT NULL,
	"places_requests" integer DEFAULT 0 NOT NULL,
	"examined" integer DEFAULT 0 NOT NULL,
	"duplicates_removed" integer DEFAULT 0 NOT NULL,
	"excluded" integer DEFAULT 0 NOT NULL,
	"qualified" integer DEFAULT 0 NOT NULL,
	"added_to_today" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" double precision DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"added_lead_ids" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prospecting_runs_started_idx" ON "prospecting_runs" USING btree ("started_at");