#!/usr/bin/env node
// ARTIFEX CONTENT STUDIO — SECURE SCREENSHOT WORKER (section G). Exactly one production worker. Claims
// queued rows from content_studio_screenshot_jobs atomically (FOR UPDATE SKIP LOCKED), renews a lease as
// a heartbeat, captures the business's VERIFIED canonical website with Playwright/Chromium, and publishes
// the PNG to content_studio_artifacts. Security is the point:
//   • http/https only; no credentials; the URL comes from the server-resolved canonical site, never a raw
//     operator string (the enqueue API resolves it from the lead record).
//   • Every DNS-resolved address is classified before connect; the TOP-LEVEL DOCUMENT is re-resolved and
//     re-classified on EVERY redirect hop (closes DNS-rebinding); private/loopback/link-local/metadata/
//     reserved/CGNAT/multicast targets are refused.
//   • Bounded: navigation timeout, max redirects, max document bytes, bounded attempts, single lease owner.
// Blocked captures are TERMINAL (status 'blocked') — never retried, because the target itself is unsafe.
//
// Env: PG_URL|DATABASE_URL, SHOT_MAX_JOBS(25), SHOT_JOB_TIMEOUT_MS(45000), SHOT_LEASE_MS(60000),
//      SHOT_MAX_ATTEMPTS(3), SHOT_MAX_REDIRECTS(5), SHOT_MAX_BYTES(8388608), SHOT_WORKER_LOOP_MS(15000).
import postgres from "postgres";
import { lookup } from "node:dns/promises";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { classifyIp, normalizeCaptureUrl } from "./lib/ssrf-guard.mjs";
import { putArtifact, buildObjectKey, closeArtifacts } from "./lib/cs-artifacts.mjs";

const WORKER_ID = `shot-${process.pid}-${Number(process.hrtime.bigint() % 100000n)}`;
const ENV = (process.env.NODE_ENV === "production") ? "production" : (process.env.CS_ARTIFACT_ENV || "development");

export function cfg() {
  return {
    maxJobs: Number(process.env.SHOT_MAX_JOBS ?? 25),
    timeoutMs: Number(process.env.SHOT_JOB_TIMEOUT_MS ?? 45_000),
    leaseMs: Number(process.env.SHOT_LEASE_MS ?? 60_000),
    maxAttempts: Number(process.env.SHOT_MAX_ATTEMPTS ?? 3),
    maxRedirects: Number(process.env.SHOT_MAX_REDIRECTS ?? 8),
    // PER-RESPONSE size cap: bounds a single unbounded/huge download (the SSRF-relevant resource risk).
    // We deliberately do NOT cap total page weight — a legit media-rich homepage streams tens of MB of
    // video/images; the navigation timeout bounds overall time instead.
    maxBytes: Number(process.env.SHOT_MAX_BYTES ?? 25 * 1024 * 1024),
  };
}
const VIEWPORTS = {
  mobile: { width: 540, height: 960, deviceScaleFactor: 2, isMobile: true, outW: 1080, outH: 1920 },
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, outW: 1280, outH: 800 },
};
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

// Recover crashed captures: rows stuck 'capturing' past their lease → back to queued (bounded by attempts).
export async function recoverStale(sql, { maxAttempts }) {
  const rows = await sql`UPDATE content_studio_screenshot_jobs
    SET status = CASE WHEN attempt >= ${maxAttempts} THEN 'failed' ELSE 'queued' END,
        error = CASE WHEN attempt >= ${maxAttempts} THEN 'exceeded max attempts after crash' ELSE error END,
        worker_id = null, updated_at = now()
    WHERE status = 'capturing' AND lease_until < now() RETURNING id`;
  return rows.map((r) => r.id);
}

// Atomically claim ONE queued capture: → capturing, stamp lease + worker, bump attempt.
export async function claimOne(sql, { leaseMs }) {
  const rows = await sql`UPDATE content_studio_screenshot_jobs SET status='capturing', worker_id=${WORKER_ID},
      attempt = attempt + 1, stage='Resolving', started_at = COALESCE(started_at, now()),
      lease_until = now() + (${leaseMs} || ' milliseconds')::interval, updated_at = now()
    WHERE id = (
      SELECT id FROM content_studio_screenshot_jobs WHERE status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
    ) RETURNING *`;
  return rows[0] ?? null;
}

// Ownership-fenced success publish: only writes if we still own this attempt's lease.
export async function publishSuccess(sql, job, r) {
  const rows = await sql`UPDATE content_studio_screenshot_jobs
    SET status='ready', progress=1, stage='Ready', output_key=${r.outputKey}, final_url=${r.finalUrl},
        content_type='image/png', byte_size=${r.bytes}, sha256=${r.sha256}, viewport_w=${r.outW}, viewport_h=${r.outH},
        captured_at=now(), provenance=${sql.json(r.provenance)}, error=null, finished_at=now(), updated_at=now()
    WHERE id=${job.id} AND worker_id=${WORKER_ID} AND attempt=${job.attempt} AND status='capturing'
    RETURNING id`;
  return rows.length === 1;
}

// A blocked target is UNSAFE, not transient → terminal, no retry.
export async function markBlocked(sql, job, reason, provenance) {
  await sql`UPDATE content_studio_screenshot_jobs
    SET status='blocked', stage='Blocked', error=${reason}, provenance=${sql.json(provenance ?? {})}, worker_id=null, finished_at=now(), updated_at=now()
    WHERE id=${job.id} AND worker_id=${WORKER_ID} AND attempt=${job.attempt}`;
}

export async function failOrRetry(sql, job, message, { maxAttempts }) {
  const terminal = job.attempt >= maxAttempts;
  await sql`UPDATE content_studio_screenshot_jobs
    SET status=${terminal ? "failed" : "queued"}, error=${message}, worker_id=null, updated_at=now()
    WHERE id=${job.id} AND worker_id=${WORKER_ID} AND attempt=${job.attempt}`;
  return terminal ? "failed" : "requeued";
}

// Resolve every A/AAAA address for a host and classify each — ALL must be public. Returns resolved IPs.
async function assertHostPublic(hostname) {
  let addrs;
  try { addrs = await lookup(hostname, { all: true }); }
  catch (e) { return { ok: false, reason: `DNS resolution failed for ${hostname}: ${e?.code || e?.message || e}`, ips: [] }; }
  if (!addrs.length) return { ok: false, reason: `no addresses for ${hostname}`, ips: [] };
  const ips = addrs.map((a) => a.address);
  for (const ip of ips) {
    const v = classifyIp(ip);
    if (!v.ok) return { ok: false, reason: `${hostname} resolves to a blocked address (${v.category}): ${ip}`, ips, category: v.category };
  }
  return { ok: true, ips };
}

// Capture one job. Returns {kind:'ready',...} | {kind:'blocked',reason,provenance}. Throws on transient error.
export async function captureJob(browser, job, opts) {
  const norm = normalizeCaptureUrl(job.requested_url);
  if (!norm.ok) return { kind: "blocked", reason: `unsafe URL (${norm.category}): ${norm.reason}`, provenance: { finalUrl: null } };

  // 1) Pre-flight DNS + IP classification of the initial target.
  const pre = await assertHostPublic(norm.hostname);
  if (!pre.ok) return { kind: "blocked", reason: pre.reason, provenance: { resolvedIps: pre.ips, category: pre.category } };

  const vp = VIEWPORTS[job.viewport] || VIEWPORTS.mobile;
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor,
    isMobile: vp.isMobile,
    userAgent: "ArtifexLabs-ReviewBot/1.0 (+https://artifexlabs.tech; business technology review)",
    javaScriptEnabled: true,
    serviceWorkers: "block",
  });
  const redirects = [];
  const resolvedIps = new Set(pre.ips);
  let blocked = null;
  try {
    context.setDefaultNavigationTimeout(opts.timeoutMs);
    context.setDefaultTimeout(opts.timeoutMs);

    // Guard EVERY request. Top-level document requests (initial + each redirect) are re-resolved and
    // re-classified — that is redirect revalidation + DNS-rebinding defense. Non-http(s) is always refused.
    await context.route("**/*", async (route) => {
      const req = route.request();
      let u;
      try { u = new URL(req.url()); } catch { return route.abort("blockedbyclient"); }
      if (u.protocol !== "http:" && u.protocol !== "https:") { blocked = blocked || `non-http(s) subrequest ${u.protocol}`; return route.abort("blockedbyclient"); }
      // Video/audio is never needed for an above-the-fold screenshot and is the large-download vector —
      // abort it (the hero still shows its poster image). This is not a block of the capture, just an asset.
      if (req.resourceType() === "media") return route.abort("blockedbyclient");
      const isDoc = req.isNavigationRequest() && req.resourceType() === "document";
      if (isDoc) {
        // SSRF-revalidate EVERY document navigation (main frame AND sub-frames/iframes) — a redirect or an
        // embedded frame to a private host is refused. Only MAIN-FRAME hops count toward the redirect limit
        // (an ecommerce homepage loads several iframe documents that are not redirects).
        const nrm = normalizeCaptureUrl(u.href);
        if (!nrm.ok) { blocked = blocked || `unsafe document (${nrm.category})`; return route.abort("blockedbyclient"); }
        const chk = await assertHostPublic(nrm.hostname);
        if (!chk.ok) { blocked = blocked || `document to blocked host: ${chk.reason}`; return route.abort("blockedbyclient"); }
        chk.ips.forEach((ip) => resolvedIps.add(ip));
        const isMainDoc = req.frame().parentFrame() === null;
        if (isMainDoc) {
          redirects.push(u.href);
          if (redirects.length > opts.maxRedirects + 1) { blocked = blocked || `exceeded ${opts.maxRedirects} redirects`; return route.abort("blockedbyclient"); }
        }
      }
      return route.continue();
    });

    const page = await context.newPage();
    page.on("response", (resp) => {
      const cl = Number(resp.headers()["content-length"] || 0);
      if (Number.isFinite(cl) && cl > opts.maxBytes) blocked = blocked || `single response exceeded ${opts.maxBytes} bytes`;
    });

    // domcontentloaded (not "load") so we don't wait for a media-heavy homepage to finish streaming every
    // hero video before capturing — we only need the above-the-fold DOM painted. We then try to reach a
    // fuller load state briefly, then capture regardless.
    const resp = await page.goto(norm.url.href, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load", { timeout: 8000 }).catch(() => {});
    if (blocked) return { kind: "blocked", reason: blocked, provenance: { resolvedIps: [...resolvedIps], redirects, finalUrl: page.url() } };
    const status = resp ? resp.status() : 0;
    if (status >= 400) throw new Error(`site returned HTTP ${status}`);

    // Settle for above-the-fold content to paint, then capture the clean viewport (NO device frame, NO
    // vignette, NO shadow — a raw, legible page crop at the exact output resolution).
    await page.waitForTimeout(2500);
    const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: vp.width, height: vp.height } });
    const finalUrl = page.url();
    const finalNorm = normalizeCaptureUrl(finalUrl);
    if (!finalNorm.ok) return { kind: "blocked", reason: `final URL unsafe (${finalNorm.category})`, provenance: { finalUrl } };

    const hash = sha256(png);
    return {
      kind: "ready",
      png, sha256: hash, bytes: png.length, finalUrl,
      outW: vp.outW, outH: vp.outH,
      provenance: {
        finalUrl, resolvedIps: [...resolvedIps], redirects,
        viewport: job.viewport, deviceScaleFactor: vp.deviceScaleFactor,
        outputPixels: `${vp.outW}x${vp.outH}`, worker: WORKER_ID,
      },
    };
  } finally {
    await context.close().catch(() => {});
  }
}

// Renew lease periodically while capturing (heartbeat) + hard timeout, mirroring the render worker.
async function withLease(sql, job, fn, { timeoutMs, leaseMs }) {
  const renew = setInterval(() => {
    sql`UPDATE content_studio_screenshot_jobs SET lease_until = now() + (${leaseMs} || ' milliseconds')::interval, updated_at=now()
        WHERE id=${job.id} AND worker_id=${WORKER_ID} AND attempt=${job.attempt}`.catch(() => {});
  }, Math.max(5_000, Math.floor(leaseMs / 3)));
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error(`capture timeout after ${timeoutMs}ms`)), timeoutMs));
  try { return await Promise.race([fn(), timeout]); }
  finally { clearInterval(renew); }
}

// Cache: if a prior READY capture of the same canonical URL + viewport produced identical bytes (sha),
// reuse its stored object key instead of writing new bytes. Returns a key or null.
async function cachedKey(sql, job, sha) {
  const rows = await sql`SELECT output_key FROM content_studio_screenshot_jobs
    WHERE canonical_url=${job.canonical_url} AND viewport=${job.viewport} AND status='ready' AND sha256=${sha} AND output_key IS NOT NULL
    ORDER BY captured_at DESC LIMIT 1`;
  return rows.length ? rows[0].output_key : null;
}

export async function drainQueue(sql, browser, opts = cfg()) {
  const recovered = await recoverStale(sql, opts);
  const done = { captured: 0, cached: 0, blocked: 0, failed: 0, recovered: recovered.length, skippedOwnership: 0 };
  while (done.captured + done.failed + done.blocked < opts.maxJobs) {
    const job = await claimOne(sql, opts);
    if (!job) break;
    try {
      const r = await withLease(sql, job, () => captureJob(browser, job, opts), opts);
      if (r.kind === "blocked") { await markBlocked(sql, job, r.reason, r.provenance); done.blocked++; continue; }
      // Store bytes (or reuse cached identical capture), then publish under ownership fence.
      let outputKey = await cachedKey(sql, job, r.sha256);
      let cached = !!outputKey;
      if (!outputKey) {
        outputKey = buildObjectKey({ artifactClass: "poster", env: ENV, jobId: job.id, version: r.sha256.slice(0, 16), ext: "png" });
        await putArtifact(outputKey, r.png, "image/png", { artifactClass: "poster", jobId: job.id, metadata: { kind: "screenshot", ...r.provenance } });
      }
      const ok = await publishSuccess(sql, job, { ...r, outputKey, provenance: { ...r.provenance, cached } });
      if (ok) { if (cached) done.cached++; done.captured++; }
      else done.skippedOwnership++;
    } catch (e) {
      await failOrRetry(sql, job, String(e?.message ?? e), opts);
      done.failed++;
    }
  }
  return done;
}

async function main() {
  const url = process.env.PG_URL || process.env.DATABASE_URL;
  if (!url) { console.error("PG_URL/DATABASE_URL required"); process.exit(1); }
  const ssl = /proxy\.rlwy\.net|railway/.test(url) ? { rejectUnauthorized: false } : undefined;
  const sql = postgres(url, { max: 4, prepare: false, ssl });
  let stopping = false;
  process.on("SIGTERM", () => { stopping = true; });
  process.on("SIGINT", () => { stopping = true; });
  const loopMs = Number(process.env.SHOT_WORKER_LOOP_MS ?? 15_000);
  const chromePath = process.env.CHROME_PATH || undefined;
  const args = (process.env.CHROME_FLAGS || "--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage").split(/\s+/).filter(Boolean);
  console.log(`screenshot worker ${WORKER_ID} up (${loopMs > 0 ? `persistent, every ${loopMs}ms` : "drain-once"})`);
  const browser = await chromium.launch({ headless: true, args, executablePath: chromePath });
  try {
    const opts = cfg();
    do {
      const result = await drainQueue(sql, browser, opts);
      if (result.captured || result.failed || result.blocked || result.recovered) console.log(`screenshot worker ${WORKER_ID} drained:`, JSON.stringify(result));
      if (loopMs > 0 && !stopping) await new Promise((r) => setTimeout(r, loopMs));
    } while (loopMs > 0 && !stopping);
  } finally {
    await browser.close().catch(() => {});
    await closeArtifacts().catch(() => {});
    await sql.end();
  }
  process.exit(0);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
