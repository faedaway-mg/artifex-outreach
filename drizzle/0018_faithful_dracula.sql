-- ─────────────────────────────────────────────────────────────────────────────
-- 0018 — Multi-operator work distribution.
--
-- Schema additions are deliberately small: the ownership column already existed
-- (`leads.assigned_to`, since 0000) and the `users` table already existed. This
-- migration ACTIVATES them rather than introducing a parallel concept.
--
--   · `leads.assigned_to` loses its NOT NULL / DEFAULT so that "unassigned" is a
--     real, representable state instead of a lie that says jordan owns it.
--   · Three nullable columns record WHEN ownership moved, WHY, and when an
--     operator last actually worked the business (what staleness expiry reads).
--   · `users` gains the scheduling attributes an operator needs.
--
-- Ownership HISTORY is not added here — `audit_log` already is the workspace's
-- permanent append-only record and now carries lead.assigned / lead.reassigned /
-- lead.transferred.
--
-- Every statement is idempotent and every backfill is guarded, so re-running
-- this migration against production is a no-op rather than a data event.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "leads" ALTER COLUMN "assigned_to" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "leads" ALTER COLUMN "assigned_to" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "assigned_at" timestamp;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "assignment_reason" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "last_operator_activity_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "initials" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "availability_mode" text DEFAULT 'available' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "preferred_work_kinds" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "daily_capacity" integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "timezone" text DEFAULT 'America/Los_Angeles' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_active_at" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_assigned_idx" ON "leads" USING btree ("assigned_to");--> statement-breakpoint

-- ── Backfill: give the existing operator their monogram ──────────────────────
UPDATE "users" SET "initials" = 'JJ' WHERE "id" = 'jordan' AND "initials" = '';--> statement-breakpoint

-- ── Seed the second operator (a row, not a code path) ────────────────────────
INSERT INTO "users" ("id", "name", "email", "role", "initials", "created_at", "updated_at")
VALUES ('alex', 'Alex', 'alex@artifexlabs.tech', 'Operator', 'AX', now(), now())
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

-- ── Backfill: existing businesses keep their owner, and get a real history ───
-- Without this, every pre-existing lead would look "never touched" on day one and
-- the staleness rule would reassign the entire book at once. Seeding activity
-- from evidence that already exists (last contact, last row update) means the
-- first distribution pass sees the truth.
UPDATE "leads"
SET "assigned_at" = COALESCE("assigned_at", "created_at"),
    "assignment_reason" = COALESCE("assignment_reason", 'Owned before multi-operator distribution existed.'),
    "last_operator_activity_at" = COALESCE(
      "last_operator_activity_at",
      GREATEST("updated_at", COALESCE("last_contact_at", "updated_at"))
    )
WHERE "assigned_to" IS NOT NULL;
