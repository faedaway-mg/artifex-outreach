CREATE TABLE IF NOT EXISTS "review_video_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"review_id" text NOT NULL,
	"batch_id" text,
	"status" text NOT NULL,
	"rights_state" text DEFAULT 'PRIVATE_ONLY' NOT NULL,
	"target_seconds" integer DEFAULT 60 NOT NULL,
	"narration_words" integer DEFAULT 0 NOT NULL,
	"expected_audio_filename" text DEFAULT '' NOT NULL,
	"plan_key" text,
	"narration_key" text,
	"captions_key" text,
	"preview_key" text,
	"audio_key" text,
	"audio_duration_seconds" double precision,
	"final_key" text,
	"final_duration_seconds" double precision,
	"finding_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved_at" timestamp,
	"failure" jsonb,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp,
	"lease_until" timestamp,
	"render_version" text,
	"approved_version" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_video_jobs_lead_idx" ON "review_video_jobs" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_video_jobs_status_idx" ON "review_video_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_video_jobs_batch_idx" ON "review_video_jobs" USING btree ("batch_id");