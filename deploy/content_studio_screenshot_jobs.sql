-- Content Studio — persisted screenshot capture jobs (section G). One row per requested capture of a
-- business's VERIFIED canonical website. The secure screenshot worker claims these atomically
-- (FOR UPDATE SKIP LOCKED), renews a lease as a heartbeat, records full provenance (final URL after
-- revalidated redirects, resolved IPs, viewport, SHA-256, content type, capture time), and publishes the
-- PNG bytes to content_studio_artifacts. Idempotent: safe to re-run.
--
-- ROLLBACK: DROP TABLE IF EXISTS "content_studio_screenshot_jobs";

CREATE TABLE IF NOT EXISTS "content_studio_screenshot_jobs" (
  "id"             text PRIMARY KEY,               -- csshot_*
  "business_id"    text,                            -- lead id this capture supports (server-resolved)
  "piece_id"       text,                            -- optional client-<leadId> binding
  "requested_url"  text NOT NULL,                   -- the canonical website we intend to capture
  "canonical_url"  text NOT NULL,                   -- normalized origin+path used for dedup + cache
  "viewport"       text NOT NULL DEFAULT 'mobile',  -- mobile | desktop
  "status"         text NOT NULL DEFAULT 'queued',  -- queued | capturing | ready | failed | blocked
  "progress"       double precision NOT NULL DEFAULT 0,
  "stage"          text NOT NULL DEFAULT '',
  "final_url"      text,                            -- URL after all (revalidated) redirect hops
  "captured_at"    timestamptz,
  "viewport_w"     integer,
  "viewport_h"     integer,
  "content_type"   text,
  "byte_size"      integer,
  "sha256"         text,                            -- integrity + cache key of the captured image bytes
  "output_key"     text,                            -- content_studio_artifacts object key of the PNG
  "provenance"     jsonb,                            -- { finalUrl, resolvedIps[], redirects[], deviceScaleFactor, worker }
  "error"          text,
  "attempt"        integer NOT NULL DEFAULT 0,
  "worker_id"      text,                            -- id of the worker holding the lease (ownership fence)
  "lease_until"    timestamptz,                     -- heartbeat expiry for crash/stale recovery
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now(),
  "started_at"     timestamptz,
  "finished_at"    timestamptz
);

CREATE INDEX IF NOT EXISTS "css_jobs_biz_idx"    ON "content_studio_screenshot_jobs" ("business_id");
CREATE INDEX IF NOT EXISTS "css_jobs_status_idx" ON "content_studio_screenshot_jobs" ("status");
CREATE INDEX IF NOT EXISTS "css_jobs_canon_idx"  ON "content_studio_screenshot_jobs" ("canonical_url", "viewport");

-- At most ONE active capture per (canonical_url, viewport): repeated Prepare clicks never enqueue a
-- duplicate capture — the second insert conflicts and opens the in-flight one instead.
CREATE UNIQUE INDEX IF NOT EXISTS "css_jobs_active_uniq"
  ON "content_studio_screenshot_jobs" ("canonical_url", "viewport")
  WHERE "status" IN ('queued', 'capturing');
