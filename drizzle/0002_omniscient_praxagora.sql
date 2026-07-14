ALTER TABLE "leads" ADD COLUMN "normalized_category" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "category_group" text;--> statement-breakpoint
ALTER TABLE "prospecting_runs" ADD COLUMN "categories_considered" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "prospecting_runs" ADD COLUMN "categories_selected" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "prospecting_runs" ADD COLUMN "selection_reasons" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "prospecting_runs" ADD COLUMN "by_category_examined" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "prospecting_runs" ADD COLUMN "by_category_added" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "prospecting_runs" ADD COLUMN "rejected_by_cap" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "prospecting_runs" ADD COLUMN "distinct_categories_added" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "prospecting_runs" ADD COLUMN "diversity_target_achieved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "prospecting_runs" ADD COLUMN "stop_reason" text;