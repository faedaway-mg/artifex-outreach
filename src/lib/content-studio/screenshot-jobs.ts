// Content Studio — screenshot capture JOB STORE (section G, web side). Mirrors the render-job store
// (cs-lifecycle-pg.ts): web ENQUEUE and the screenshot worker CLAIM operate on the SAME
// content_studio_screenshot_jobs rows. The web only ever enqueues a capture of a business's
// server-resolved canonical website and reads status/health — it never captures in-process (a browser
// in the request path is a reliability + SSRF risk). All capture + SSRF revalidation happens in the
// out-of-process worker (scripts/screenshot-worker-loop.mjs).
import postgres from "postgres";

export type Viewport = "mobile" | "desktop";
export type ScreenshotStatus = "queued" | "capturing" | "ready" | "failed" | "blocked";

export interface ScreenshotJob {
  id: string;
  businessId: string | null;
  pieceId: string | null;
  requestedUrl: string;
  canonicalUrl: string;
  viewport: Viewport;
  status: ScreenshotStatus;
  progress: number;
  stage: string;
  finalUrl: string | null;
  capturedAt: string | null;
  contentType: string | null;
  byteSize: number | null;
  sha256: string | null;
  outputKey: string | null;
  provenance: Record<string, unknown> | null;
  error: string | null;
  attempt: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

// The sanitized shape safe to hand a client component: never leaks worker_id / lease_until / raw IPs.
export interface SafeScreenshotJob {
  id: string;
  businessId: string | null;
  pieceId: string | null;
  viewport: Viewport;
  status: ScreenshotStatus;
  progress: number;
  stage: string;
  finalUrl: string | null;
  sha256: string | null;
  hasImage: boolean;
  attempt: number;
  error: string | null;
  capturedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

let _sql: ReturnType<typeof postgres> | null = null;
function db() {
  if (_sql) return _sql;
  const url = process.env.CS_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("screenshot-jobs: CS_DATABASE_URL/DATABASE_URL not set");
  const ssl = /proxy\.rlwy\.net|railway/.test(url) ? { rejectUnauthorized: false } : undefined;
  _sql = postgres(url, { max: 2, prepare: false, ssl });
  return _sql;
}
export async function __closeScreenshotPgForTests() { if (_sql) { await _sql.end(); _sql = null; } }

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? ""));
const isoOrNull = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

// Canonical capture URL: origin + path only (query/fragment dropped, trailing slash normalized, host
// lower-cased). This is the dedup + cache key — the SAME shape the worker computes, so both agree.
export function canonicalizeCaptureUrl(raw: string): string {
  const u = new URL(raw.trim());
  u.hash = ""; u.search = "";
  u.hostname = u.hostname.toLowerCase();
  let path = u.pathname.replace(/\/+$/, "");
  if (path === "") path = "/";
  return `${u.protocol}//${u.host}${path}`;
}

function rowToJob(r: Record<string, unknown>): ScreenshotJob {
  return {
    id: String(r.id),
    businessId: (r.business_id as string) ?? null,
    pieceId: (r.piece_id as string) ?? null,
    requestedUrl: String(r.requested_url),
    canonicalUrl: String(r.canonical_url),
    viewport: (r.viewport as Viewport) ?? "mobile",
    status: r.status as ScreenshotStatus,
    progress: Number(r.progress ?? 0),
    stage: String(r.stage ?? ""),
    finalUrl: (r.final_url as string) ?? null,
    capturedAt: isoOrNull(r.captured_at),
    contentType: (r.content_type as string) ?? null,
    byteSize: r.byte_size == null ? null : Number(r.byte_size),
    sha256: (r.sha256 as string) ?? null,
    outputKey: (r.output_key as string) ?? null,
    provenance: (r.provenance as Record<string, unknown>) ?? null,
    error: (r.error as string) ?? null,
    attempt: Number(r.attempt ?? 0),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    startedAt: isoOrNull(r.started_at),
    finishedAt: isoOrNull(r.finished_at),
  };
}

export function sanitizeScreenshotJob(j: ScreenshotJob): SafeScreenshotJob {
  return {
    id: j.id, businessId: j.businessId, pieceId: j.pieceId, viewport: j.viewport,
    status: j.status, progress: j.progress, stage: j.stage, finalUrl: j.finalUrl,
    sha256: j.sha256, hasImage: !!j.outputKey && j.status === "ready", attempt: j.attempt,
    error: j.error, capturedAt: j.capturedAt, createdAt: j.createdAt, updatedAt: j.updatedAt,
  };
}

const genId = (): string => "csshot_" + Array.from({ length: 12 }, () => "0123456789abcdef"[Math.floor(_rand() * 16)]).join("");
// Deterministic-enough id without Date.now/Math.random ban concerns in workflows; here (web) Math.random is fine.
function _rand(): number { return Math.random(); }

export interface EnqueueInput {
  businessId: string;
  pieceId?: string | null;
  requestedUrl: string;
  viewport: Viewport;
}

// Enqueue a capture, DEDUPED: if an active (queued/capturing) job already exists for the same
// (canonical_url, viewport), return it instead of creating a duplicate. Returns { job, deduped }.
export async function createScreenshotJob(input: EnqueueInput): Promise<{ job: ScreenshotJob; deduped: boolean }> {
  const sql = db();
  const canonical = canonicalizeCaptureUrl(input.requestedUrl);
  const existing = await sql`SELECT * FROM content_studio_screenshot_jobs
    WHERE canonical_url = ${canonical} AND viewport = ${input.viewport} AND status IN ('queued','capturing')
    ORDER BY created_at DESC LIMIT 1`;
  if (existing.length) return { job: rowToJob(existing[0]), deduped: true };
  const id = genId();
  try {
    const rows = await sql`INSERT INTO content_studio_screenshot_jobs
      (id, business_id, piece_id, requested_url, canonical_url, viewport, status)
      VALUES (${id}, ${input.businessId}, ${input.pieceId ?? null}, ${input.requestedUrl}, ${canonical}, ${input.viewport}, 'queued')
      RETURNING *`;
    return { job: rowToJob(rows[0]), deduped: false };
  } catch (e: any) {
    // Lost a race to the partial unique index → open the in-flight job instead of failing.
    if (String(e?.message ?? e).includes("css_jobs_active_uniq")) {
      const again = await sql`SELECT * FROM content_studio_screenshot_jobs
        WHERE canonical_url = ${canonical} AND viewport = ${input.viewport} AND status IN ('queued','capturing')
        ORDER BY created_at DESC LIMIT 1`;
      if (again.length) return { job: rowToJob(again[0]), deduped: true };
    }
    throw e;
  }
}

export async function readScreenshotJob(id: string): Promise<ScreenshotJob | null> {
  const rows = await db()`SELECT * FROM content_studio_screenshot_jobs WHERE id = ${id}`;
  return rows.length ? rowToJob(rows[0]) : null;
}

export async function listScreenshotJobs(businessId?: string): Promise<ScreenshotJob[]> {
  const sql = db();
  const rows = businessId
    ? await sql`SELECT * FROM content_studio_screenshot_jobs WHERE business_id = ${businessId} ORDER BY created_at DESC`
    : await sql`SELECT * FROM content_studio_screenshot_jobs ORDER BY created_at DESC LIMIT 200`;
  return rows.map(rowToJob);
}

// The freshest READY capture for a business + viewport (what the operator UI shows).
export async function latestReadyShot(businessId: string, viewport: Viewport): Promise<ScreenshotJob | null> {
  const rows = await db()`SELECT * FROM content_studio_screenshot_jobs
    WHERE business_id = ${businessId} AND viewport = ${viewport} AND status = 'ready' AND output_key IS NOT NULL
    ORDER BY captured_at DESC NULLS LAST, updated_at DESC LIMIT 1`;
  return rows.length ? rowToJob(rows[0]) : null;
}

// ── Health (section G) — same discipline as the render worker: never "active" from queued backlog alone.
const SHOT_STALE_MS = 5 * 60 * 1000;
export interface ScreenshotHealth {
  verdict: "active" | "idle" | "degraded";
  lastActivityAt: string | null;
  capturing: number;
  queued: number;
  stale: number;
  lastCompletedAt: string | null;
}
export function computeScreenshotHealth(
  jobs: Pick<ScreenshotJob, "status" | "updatedAt" | "finishedAt">[],
  now: number = Date.now(),
): ScreenshotHealth {
  let lastActivity = 0, lastCompleted = 0, capturing = 0, queued = 0, stale = 0;
  for (const j of jobs) {
    const upd = new Date(j.updatedAt).getTime();
    if (j.status === "capturing") {
      capturing++;
      if (upd > lastActivity) lastActivity = upd;
      if (now - upd > SHOT_STALE_MS) stale++;
    } else if (j.status === "queued") {
      queued++;
    } else if (j.status === "ready" && j.finishedAt) {
      const f = new Date(j.finishedAt).getTime();
      if (f > lastCompleted) lastCompleted = f;
      if (f > lastActivity) lastActivity = f;
    }
  }
  let verdict: ScreenshotHealth["verdict"];
  if (capturing > 0 && stale === 0) verdict = "active";
  else if (stale > 0 || (queued > 0 && (lastActivity === 0 || now - lastActivity > SHOT_STALE_MS))) verdict = "degraded";
  else verdict = "idle";
  return {
    verdict,
    lastActivityAt: lastActivity ? new Date(lastActivity).toISOString() : null,
    capturing, queued, stale,
    lastCompletedAt: lastCompleted ? new Date(lastCompleted).toISOString() : null,
  };
}
export async function getScreenshotHealth(now: number = Date.now()): Promise<ScreenshotHealth> {
  return computeScreenshotHealth(await listScreenshotJobs(), now);
}
