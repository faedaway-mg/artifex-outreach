-- Gate 2: persisted, immutable signing mode ("test" | "production"; null → treated as
-- test). Additive + nullable so existing rows are unaffected; a null mode is fail-closed
-- (test) and can never unlock live payment.
ALTER TABLE "agreements" ADD COLUMN IF NOT EXISTS "esign_mode" text;
