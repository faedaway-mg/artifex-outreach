ALTER TABLE "acquisition_plans" ADD COLUMN "estimated_value_snapshot" text;--> statement-breakpoint
ALTER TABLE "acquisition_plans" ADD COLUMN "asset_readiness_snapshot" boolean;--> statement-breakpoint
ALTER TABLE "acquisition_plans" ADD COLUMN "asset_missing_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "acquisition_plans" ADD COLUMN "contact_confidence_snapshot" text;--> statement-breakpoint
ALTER TABLE "acquisition_plans" ADD COLUMN "website_health_snapshot" text;