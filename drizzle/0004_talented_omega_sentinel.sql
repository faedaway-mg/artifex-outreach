CREATE TABLE IF NOT EXISTS "acquisition_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"strategy" text NOT NULL,
	"objective" text DEFAULT '' NOT NULL,
	"asset_package" text DEFAULT 'None' NOT NULL,
	"primary_channel" text DEFAULT 'none' NOT NULL,
	"secondary_channel" text,
	"status" text DEFAULT 'prepared' NOT NULL,
	"approval_status" text DEFAULT 'draft' NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"max_touches" integer DEFAULT 0 NOT NULL,
	"next_scheduled_at" timestamp,
	"reply_state" text,
	"approved_by" text,
	"approved_at" timestamp,
	"started_at" timestamp,
	"paused_at" timestamp,
	"completed_at" timestamp,
	"pause_reason" text,
	"stop_reason" text,
	"estimated_cost" double precision DEFAULT 0 NOT NULL,
	"owner" text DEFAULT 'jordan' NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acquisition_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"step_number" integer NOT NULL,
	"channel" text NOT NULL,
	"delay_days" integer DEFAULT 0 NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"approval_required" boolean DEFAULT true NOT NULL,
	"approval_status" text DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp,
	"sent_at" timestamp,
	"provider_message_id" text,
	"delivery_status" text,
	"stopped_at" timestamp,
	"stop_reason" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consent_bases" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"contact_id" text,
	"channel" text NOT NULL,
	"basis" text NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"captured_at" timestamp NOT NULL,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"notes" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inbound_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"acquisition_plan_id" text,
	"provider" text DEFAULT 'resend' NOT NULL,
	"provider_message_id" text,
	"from_addr" text DEFAULT '' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body_ref" text DEFAULT '' NOT NULL,
	"received_at" timestamp NOT NULL,
	"classification" text,
	"confidence" double precision,
	"reviewed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "acquisition_strategy" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "acquisition_score" integer;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "acquisition_reason" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "acquisition_score_breakdown" jsonb;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "acquisition_override" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acquisition_plans_lead_idx" ON "acquisition_plans" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acquisition_plans_status_idx" ON "acquisition_plans" USING btree ("approval_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acquisition_steps_plan_idx" ON "acquisition_steps" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consent_bases_lead_idx" ON "consent_bases" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbound_messages_lead_idx" ON "inbound_messages" USING btree ("lead_id");