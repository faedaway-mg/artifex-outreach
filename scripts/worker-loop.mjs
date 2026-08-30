#!/usr/bin/env node
// ARTIFEX CONTENT STUDIO — render worker (scheduled/Cron model: start → claim → render → drain → EXIT).
// Claims queued jobs from Postgres (content_studio_jobs) atomically, renders each via the proven Field
// Notes pipeline with lease renewal + a per-job timeout, publishes the result idempotently under an
// OWNERSHIP check (an expired worker can never overwrite a newer attempt), retries with a bounded cap,
// then EXITS — no permanent polling loop. Exported functions are pure enough to test against a real PG
// with an injected fake renderer (see scripts/verify-pg-worker.mjs); the CLI uses the real renderer.
//
// Usage (Cron): node scripts/worker-loop.mjs           (drains, then exits)
// Env: PG_URL (or DATABASE_URL), CS_MAX_JOBS (default 25), CS_JOB_TIMEOUT_MS (default 480000),
//      CS_LEASE_MS (default 120000), CS_MAX_ATTEMPTS (default 3), CS_CONCURRENCY (default 1).
import postgres from "postgres";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKER_ID = `w-${process.pid}-${Number(process.hrtime.bigint() % 100000n)}`;

export function cfg() {
  return {
    maxJobs: Number(process.env.CS_MAX_JOBS ?? 25),
    timeoutMs: Number(process.env.CS_JOB_TIMEOUT_MS ?? 480_000),
    leaseMs: Number(process.env.CS_LEASE_MS ?? 120_000),
    maxAttempts: Number(process.env.CS_MAX_ATTEMPTS ?? 3),
    concurrency: Number(process.env.CS_CONCURRENCY ?? 1),
  };
}

// Recover crashed jobs: rendering rows whose lease expired go back to queued (bounded by attempts).
export async function recoverStale(sql, { maxAttempts }) {
  const rows = await sql`UPDATE content_studio_jobs
    SET status = CASE WHEN attempt >= ${maxAttempts} THEN 'failed' ELSE 'queued' END,
        error = CASE WHEN attempt >= ${maxAttempts} THEN 'exceeded max attempts after crash' ELSE error END,
        updated_at = now()
    WHERE status = 'rendering' AND lease_until < now() RETURNING id`;
  return rows.map((r) => r.id);
}

// Atomically claim ONE queued job: flips it to rendering, stamps the lease + worker + bumps attempt.
// Returns the claimed row (incl. the attempt we own) or null. Concurrency-safe via row-level UPDATE.
export async function claimOne(sql, { leaseMs }) {
  const rows = await sql`UPDATE content_studio_jobs SET status='rendering', worker_id=${WORKER_ID},
      attempt = attempt + 1, started_at = COALESCE(started_at, now()),
      lease_until = now() + (${leaseMs} || ' milliseconds')::interval, updated_at = now()
    WHERE id = (
      SELECT id FROM content_studio_jobs WHERE status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
    ) RETURNING *`;
  return rows[0] ?? null;
}

// Ownership-checked, idempotent success publish: only writes if we still hold the lease for this attempt.
export async function publishSuccess(sql, job, result) {
  const rows = await sql`UPDATE content_studio_jobs
    SET status='ready', progress=1, stage='Ready', output_key=${result.outputKey},
        poster_key=${result.posterKey ?? null},
        error=null, finished_at=now(), updated_at=now()
    WHERE id=${job.id} AND worker_id=${WORKER_ID} AND attempt=${job.attempt} AND status='rendering'
    RETURNING id`;
  return rows.length === 1; // false = a newer attempt/owner won; we DROP our result (no overwrite)
}

export async function failOrRetry(sql, job, message, { maxAttempts }) {
  const terminal = job.attempt >= maxAttempts;
  await sql`UPDATE content_studio_jobs
    SET status=${terminal ? "failed" : "queued"}, error=${message}, worker_id=null, updated_at=now()
    WHERE id=${job.id} AND worker_id=${WORKER_ID} AND attempt=${job.attempt}`;
  return terminal ? "failed" : "requeued";
}

// Run renderFn with lease renewal + a hard timeout. renderFn(job, {signal}) → {outputKey, videoHash}.
export async function renderWithLease(sql, job, renderFn, { timeoutMs, leaseMs }) {
  const ac = new AbortController();
  const renew = setInterval(() => {
    sql`UPDATE content_studio_jobs SET lease_until = now() + (${leaseMs} || ' milliseconds')::interval, updated_at=now()
        WHERE id=${job.id} AND worker_id=${WORKER_ID} AND attempt=${job.attempt}`.catch(() => {});
  }, Math.max(5_000, Math.floor(leaseMs / 3)));
  const timer = setTimeout(() => ac.abort(new Error(`job timeout after ${timeoutMs}ms`)), timeoutMs);
  try {
    return await renderFn(job, { signal: ac.signal });
  } finally {
    clearInterval(renew);
    clearTimeout(timer);
  }
}

// Drain the queue: claim → render → publish, up to maxJobs, then RETURN (caller exits). Bounded.
export async function drainQueue(sql, renderFn, opts = cfg()) {
  const recovered = await recoverStale(sql, opts);
  const done = { rendered: 0, failed: 0, recovered: recovered.length, skippedOwnership: 0 };
  while (done.rendered + done.failed < opts.maxJobs) {
    const job = await claimOne(sql, opts);
    if (!job) break; // queue empty → exit
    try {
      const result = await renderWithLease(sql, job, renderFn, opts);
      const published = await publishSuccess(sql, job, result);
      if (published) done.rendered++;
      else done.skippedOwnership++; // a newer attempt won — we discard, never overwrite
    } catch (e) {
      await failOrRetry(sql, job, String(e?.message ?? e), opts);
      done.failed++;
    }
  }
  return done;
}

// The REAL renderer: hand the DB job to the proven file-based render pipeline as a child process with a
// timeout, then read the output back. Temp files are cleaned up. (Local/mock: output stays on the durable
// disk path; with S3 configured, content-studio-render uploads + returns the object key.)
function realRenderFn(job, { signal }) {
  return new Promise((resolve, reject) => {
    const jobsDir = join(ROOT, ".data", "content-studio", "jobs");
    mkdirSync(jobsDir, { recursive: true });
    const fileJob = { ...dbToFileJob(job) };
    const jf = join(jobsDir, `${job.id}.json`);
    writeFileSync(jf, JSON.stringify(fileJob, null, 2));
    const child = spawn(process.execPath, [join(ROOT, "scripts", "content-studio-render.mjs"), job.id],
      { cwd: ROOT, stdio: "ignore", env: process.env });
    const onAbort = () => { try { process.kill(-child.pid, "SIGKILL"); } catch {} try { child.kill("SIGKILL"); } catch {} };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("exit", (code) => {
      signal?.removeEventListener?.("abort", onAbort);
      try {
        const out = JSON.parse(readFileSync(jf, "utf8"));
        rmSync(jf, { force: true });
        // Prefer the DURABLE ArtifactStore key the render worker published; fall back to the legacy
        // rel/path only in dev where no key was produced.
        if (out.status === "ready" && (out.outputKey || out.outputFile)) resolve({ outputKey: out.outputKey || out.outputRel || out.outputFile, posterKey: out.posterKey ?? null, videoHash: null });
        else reject(new Error(out.error || `render exited ${code}`));
      } catch (e) { reject(new Error("render output unreadable: " + e.message)); }
    });
  });
}
function dbToFileJob(job) {
  return { id: job.id, pieceId: job.piece_id, inputVersion: job.input_version, status: "queued", progress: 0,
    stage: "Queued", mode: job.mode, audioKind: "uploaded", audioFile: null, audioKey: job.audio_key ?? null,
    audioSha: job.audio_sha ?? null, outputFile: null, outputRel: null, outputKey: null, posterKey: null,
    thumbRel: null, error: null, attempt: job.attempt, pid: null, createdAt: job.created_at, updatedAt: job.created_at,
    startedAt: null, finishedAt: null };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
async function main() {
  const url = process.env.PG_URL || process.env.DATABASE_URL;
  if (!url) { console.error("PG_URL/DATABASE_URL required"); process.exit(1); }
  const sql = postgres(url, { max: 4, prepare: false });
  let stopping = false;
  const shutdown = () => { stopping = true; };
  process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
  try {
    const opts = cfg();
    const result = await drainQueue(sql, (job, ctx) => (stopping ? Promise.reject(new Error("worker stopping")) : realRenderFn(job, ctx)), opts);
    console.log(`worker ${WORKER_ID} drained:`, JSON.stringify(result));
  } finally {
    await sql.end();
  }
  process.exit(0);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
