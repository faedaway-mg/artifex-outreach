ALTER TABLE "tasks" ADD COLUMN "source_plan_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "source_step_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tasks_source_step_idx" ON "tasks" USING btree ("source_step_id");