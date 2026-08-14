// ─────────────────────────────────────────────────────────────────────────────
// Artifex daily queue cron (Railway cron service).
//
// Runs on cron "30 12,13,17,20,23 * * *". The 12:30/13:30 UTC pair are the two DST equivalents of
// 5:30 AM America/Los_Angeles — the FULL daily run (materialize + discovery). The added 17:30/20:30/
// 23:30 UTC firings are bounded intraday reservoir TOP-UPS (~10:30 AM / 1:30 PM / 4:30 PM PT): they
// run materialize ONLY, which is reservoir-aware and self-throttles to zero once inventory is
// healthy. This keeps email supply from depending on one perfect overnight run, at no extra
// discovery cost. Any firing not in the 5:30 window is treated as a top-up (DST-robust).
//
// The FULL run makes TWO distinct calls, in this order, and reports both:
//
//   1. MATERIALIZE — /api/cron/materialize projects acquisition steps that come
//      due today into operator-visible Tasks. It sends NO email; it only makes
//      already-scheduled follow-up work visible in Today. Without this, a step
//      the sequence scheduled would never reach the operator's queue.
//
//   2. PROSPECT — /api/cron/prospect adds new leads, exactly as before.
//
// Order matters: warm follow-ups are materialized first so they take the
// queue-cap ahead of new cold prospects. A materialize failure is reported but
// never blocks prospecting.
//
// (The file keeps its original name because the deployed service's start command
// references it; the job it performs is the wider one described above.)
//
// DEPLOYING THIS SERVICE — the directory itself is the build context:
//
//     railway up <abs-path-to>/railway-functions --service daily-prospecting-cron --ci
//
// railway.json MUST sit next to this file. Railway reads the config from
// "/railway.json" at the root of the uploaded context, and that file is what
// carries cronSchedule and startCommand. This config was once named
// cron-service.railway.json, which Railway never reads: deploying then produced
// a service with no schedule and no start command, which ran once, exited, and
// was marked FAILED. Do not rename it back.
//
// The app endpoints enforce weekdays, the once-per-LA-day duplicate guard, the
// queue-cap, and the no-mock rule, so this never uses force=1. Neither endpoint
// authorizes unattended email delivery. The secret is read from the environment
// and never logged. The process exits after running/skipping.
// ─────────────────────────────────────────────────────────────────────────────
const BASE = "https://outreach.artifexlabs.tech";
const ENDPOINT = `${BASE}/api/cron/prospect`;
const MATERIALIZE_ENDPOINT = `${BASE}/api/cron/materialize`;

function laParts() {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit", minute: "2-digit", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", timeZoneName: "short",
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    hour: parseInt(get("hour"), 10) % 24,
    minute: parseInt(get("minute"), 10),
    stamp: `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} ${get("timeZoneName")}`,
  };
}

async function main() {
  const utc = new Date().toISOString();
  const la = laParts();
  const testMode = process.env.SCHEDULER_TEST === "true";
  // The 5:30 AM window is the FULL daily run: materialize + discovery (prospect). Every OTHER
  // scheduled firing (the added intraday times) is a bounded reservoir TOP-UP: materialize only,
  // which is reservoir-aware and SELF-THROTTLES to zero once inventory is healthy — so email supply
  // no longer depends on one perfect overnight run, and it adds NO extra discovery cost. Discovery
  // stays once/day. testMode forces a full run for manual verification.
  const fullWindow = la.hour === 5 && la.minute >= 20 && la.minute <= 45;
  const doFullRun = testMode || fullWindow;
  const runKind = doFullRun ? "full" : "topup";

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.log(JSON.stringify({ utc, la: la.stamp, action: "error", reason: "CRON_SECRET not configured" }));
    process.exitCode = 1;
    return;
  }

  // ── 1. Materialize due sequence work (never sends email) ───────────────────
  // Isolated in its own try/finally so a failure here is reported but still
  // lets prospecting run. Logged separately from the prospecting result.
  const mController = new AbortController();
  const mTimer = setTimeout(() => mController.abort(), 30_000);
  try {
    const res = await fetch(MATERIALIZE_ENDPOINT, {
      method: "POST", headers: { Authorization: `Bearer ${secret}` }, signal: mController.signal,
    });
    let summary = null;
    try {
      const body = await res.json();
      // `sent` is asserted, not assumed: this endpoint must never dispatch email.
      summary = { created: body?.created ?? null, reconciledStale: body?.reconciledStale ?? null, sent: body?.sent ?? null };
    } catch {
      summary = { note: "non-JSON response" };
    }
    console.log(JSON.stringify({
      utc, la: la.stamp, action: "materialize", runKind, testMode,
      status: res.status, result: res.ok ? "ok" : "failure", summary,
    }));
    if (!res.ok) process.exitCode = 1;
  } catch (err) {
    console.log(JSON.stringify({
      utc, la: la.stamp, action: "materialize", runKind, result: "error",
      reason: err?.name === "AbortError" ? "timeout" : "network error",
    }));
    process.exitCode = 1;
  } finally {
    clearTimeout(mTimer);
  }

  // Intraday TOP-UP firings stop here: they only replenish the reservoir (materialize above),
  // never discovery — so extra firings cost nothing when inventory is healthy.
  if (!doFullRun) {
    console.log(JSON.stringify({ utc, la: la.stamp, action: "prospect", runKind, result: "skipped", reason: "top-up tick — discovery runs only on the 5:30 full run" }));
    return;
  }

  // ── 2. Prospect for new leads (FULL run only) ──────────────────────────────
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    // Normal scheduled operation — NO force=1. The endpoint self-throttles.
    const res = await fetch(ENDPOINT, { method: "POST", headers: { Authorization: `Bearer ${secret}` }, signal: controller.signal });
    let summary = null;
    try {
      const body = await res.json();
      summary = body?.run
        ? { added: body.run.addedToToday, mode: body.run.providerMode, distinct: body.run.distinctCategoriesAdded, stop: body.run.stopReason }
        : { skipped: body?.skipped ?? null, ok: body?.ok ?? null };
    } catch {
      summary = { note: "non-JSON response" };
    }
    const result = res.ok ? "ok" : "failure";
    console.log(JSON.stringify({ utc, la: la.stamp, action: "prospect", runKind, testMode, status: res.status, result, summary }));
    if (!res.ok) process.exitCode = 1;
  } catch (err) {
    console.log(JSON.stringify({ utc, la: la.stamp, action: "prospect", runKind, result: "error", reason: err?.name === "AbortError" ? "timeout" : "network error" }));
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
  }
}

await main();
