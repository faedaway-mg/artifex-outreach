CREATE TYPE "public"."confidence" AS ENUM('Verified', 'Likely', 'Unknown');--> statement-breakpoint
CREATE TYPE "public"."pipeline_stage" AS ENUM('Discovered', 'Qualified', 'Analysis Ready', 'Deliverable Ready', 'Contacted', 'Follow-Up', 'Meeting Booked', 'Discovery Complete', 'Proposal Sent', 'Won', 'Lost', 'Nurture', 'Disqualified');--> statement-breakpoint
CREATE TYPE "public"."tier" AS ENUM('A', 'B', 'C');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"actor" text DEFAULT 'jordan' NOT NULL,
	"target_type" text,
	"target_id" text,
	"meta" jsonb,
	"ip" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"email" text,
	"phone" text,
	"linkedin_url" text,
	"source" text NOT NULL,
	"confidence" "confidence" DEFAULT 'Unknown' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"opted_out" boolean DEFAULT false NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deliverables" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"content" jsonb NOT NULL,
	"pdf_url" text,
	"pdf_key" text,
	"approved_at" timestamp,
	"sent_at" timestamp,
	"ai_meta" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "findings" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"observation" text NOT NULL,
	"evidence" text NOT NULL,
	"business_impact" text NOT NULL,
	"modernization_direction" text NOT NULL,
	"finding_type" text NOT NULL,
	"confidence" "confidence" DEFAULT 'Unknown' NOT NULL,
	"source_url" text,
	"analyzed_at" timestamp,
	"deterministic" boolean DEFAULT false NOT NULL,
	"approved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leads" (
	"id" text PRIMARY KEY NOT NULL,
	"google_place_id" text,
	"business_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"industry" text NOT NULL,
	"address" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"postal_code" text NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"phone" text,
	"website" text,
	"website_domain" text,
	"public_email" text,
	"contact_form_url" text,
	"social_links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"locations_count" integer,
	"rating" double precision,
	"review_count" integer,
	"business_status" text,
	"google_maps_url" text,
	"hours" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"retrieved_at" timestamp,
	"tier" "tier",
	"lead_score" integer,
	"score_breakdown" jsonb,
	"pipeline_stage" "pipeline_stage" DEFAULT 'Discovered' NOT NULL,
	"estimated_value_low" integer,
	"estimated_value_high" integer,
	"recommended_service" text,
	"recommended_action" text,
	"recommendation_reason" text,
	"opportunity_summary" text,
	"strengths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assigned_to" text DEFAULT 'jordan' NOT NULL,
	"note" text,
	"last_contact_at" timestamp,
	"next_follow_up_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meetings" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"contact_id" text,
	"scheduled_at" timestamp NOT NULL,
	"meeting_url" text,
	"discovery_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"likely_objections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"next_step" text DEFAULT '' NOT NULL,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outreach" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"contact_id" text,
	"channel" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"sent_at" timestamp,
	"response_status" text DEFAULT 'none' NOT NULL,
	"ai_meta" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"amount" integer,
	"proposal_url" text,
	"sent_at" timestamp,
	"accepted_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "screenshots" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"page_url" text NOT NULL,
	"viewport" text NOT NULL,
	"storage_url" text NOT NULL,
	"storage_key" text,
	"caption" text DEFAULT '' NOT NULL,
	"approved" boolean DEFAULT true NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
	"id" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "suppressions" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"domain" text,
	"phone" text,
	"reason" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"due_at" timestamp NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"snoozed_until" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'operator' NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "videos" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"title" text NOT NULL,
	"recommended_length" text NOT NULL,
	"positive_opening" text NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"screenshot_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"script" text NOT NULL,
	"cta" text NOT NULL,
	"accompanying_email" text NOT NULL,
	"follow_up_date" timestamp,
	"video_url" text,
	"status" text DEFAULT 'not_started' NOT NULL,
	"sent_at" timestamp,
	"ai_meta" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_lead_idx" ON "contacts" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contacts_email_idx" ON "contacts" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deliverables_lead_idx" ON "deliverables" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "findings_lead_idx" ON "findings" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "leads_place_id_idx" ON "leads" USING btree ("google_place_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_domain_idx" ON "leads" USING btree ("website_domain");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_phone_idx" ON "leads" USING btree ("phone");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_normalized_name_idx" ON "leads" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_stage_idx" ON "leads" USING btree ("pipeline_stage");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_follow_up_idx" ON "leads" USING btree ("next_follow_up_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meetings_lead_idx" ON "meetings" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_lead_idx" ON "outreach" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_lead_idx" ON "proposals" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "screenshots_lead_idx" ON "screenshots" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "suppressions_email_idx" ON "suppressions" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "suppressions_domain_idx" ON "suppressions" USING btree ("domain");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_lead_idx" ON "tasks" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_due_idx" ON "tasks" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "videos_lead_idx" ON "videos" USING btree ("lead_id");