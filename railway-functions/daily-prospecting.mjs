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
//   1. REFILL — /api/cron/refill?discover=1&auto=1 is the ONE autonomous refill invocation (mandate §5).
//      It measures the DELIVERY_READY reserve and, ONLY when the reserve has dropped BELOW the refill
//      threshold of 40 (auto=1 hysteresis) AND discovery automation + a Places credential are configured,
//      runs BOUNDED nationwide discovery to top the reserve back toward 60. It NEVER sends email and it
//      persists the geographic/budget checkpoint server-side so the loop resumes. When the reserve is
//      healthy (≥40) it is a cheap no-op. This replaces the old direct /api/cron/prospect call: refill
//      subsumes discovery (?discover=1) and adds the reserve-aware gate on top.
//
//   2. MATERIALIZE — /api/cron/materialize projects acquisition steps that come due today into
//      operator-visible Tasks. It sends NO email; it only makes already-scheduled follow-up work visible
//      in Today. It is the canonical batch materializer the refill runs BEFORE.
//
// Order matters: refill (reserve replenishment, zero sends) runs first, then the batch materializer.
// Neither call authorizes delivery — real sending happens only on the separate outreach cron/scheduler.
// A refill failure is reported but never blocks materialization.
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
// ONE autonomous refill invocation (§5): discover=1 permits bounded discovery; auto=1 enforces the
// "do nothing when reserve ≥ 40" hysteresis. It never sends and persists its own checkpoint server-side.
const REFILL_ENDPOINT = `${BASE}/api/cron/refill?discover=1&auto=1`;
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

  // ── 1. FULL run only: REFILL the rolling reserve (mandate §5) BEFORE materialization ──────
  // Autonomous + reserve-aware: the endpoint no-ops when the reserve is ≥ 40, otherwise runs bounded
  // nationwide discovery (only if automation + a Places credential are configured) and advances the
  // persisted checkpoint. It NEVER sends email — `sentEmails` is asserted 0 below. Non-fatal: a slow or
  // failed refill is logged but never blocks materialization or fails the deploy-validation run.
  if (doFullRun) {
    const rController = new AbortController();
    const rTimer = setTimeout(() => rController.abort(), 120_000);
    try {
      const res = await fetch(REFILL_ENDPOINT, { method: "POST", headers: { Authorization: `Bearer ${secret}` }, signal: rController.signal });
      let summary = null;
      try {
        const body = await res.json();
        summary = {
          sent: body?.sentEmails ?? null,          // must be 0 — refill never dispatches email
          reserve: body?.reserve ?? null,
          status: body?.refillStatus ?? null,
          discoverRan: body?.discoverRan ?? null,
          tomorrow: body?.tomorrowScheduled ?? null,
        };
      } catch {
        summary = { note: "non-JSON response" };
      }
      console.log(JSON.stringify({ utc, la: la.stamp, action: "refill", runKind, testMode, status: res.status, result: res.ok ? "ok" : "failure", summary }));
    } catch (err) {
      console.log(JSON.stringify({ utc, la: la.stamp, action: "refill", runKind, result: err?.name === "AbortError" ? "triggered-async" : "error", reason: err?.name === "AbortError" ? "endpoint still running server-side (non-fatal)" : "network error" }));
    } finally {
      clearTimeout(rTimer);
    }
  }

  // ── 2. Materialize due sequence work (never sends email) — canonical batch materializer ────
  // This worker is a TRIGGER, not the executor: the endpoint runs reservoir-aware prep (website
  // analysis on up to EMAIL_PREP_MAX leads) synchronously server-side and COMPLETES even if this
  // fetch is slow. So a slow/timeout response here is NOT a real failure — it must never fail the
  // process, or a cron-service DEPLOY (whose validation run exits on our exit code) would be marked
  // failed and never promote. Generous timeout; failures are logged but non-fatal.
  const mController = new AbortController();
  const mTimer = setTimeout(() => mController.abort(), 120_000);
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
  } catch (err) {
    // Timeout here just means prep is still running server-side — report it, do not fail.
    console.log(JSON.stringify({
      utc, la: la.stamp, action: "materialize", runKind,
      result: err?.name === "AbortError" ? "triggered-async" : "error",
      reason: err?.name === "AbortError" ? "endpoint still running server-side (non-fatal)" : "network error",
    }));
  } finally {
    clearTimeout(mTimer);
  }

  // Intraday TOP-UP firings do materialize ONLY (above): they replenish the operator queue but never run
  // discovery, so extra firings cost nothing when inventory is healthy. Discovery/refill runs once per day
  // on the 5:30 AM PT full run, keeping the bounded Places budget under control.
  if (!doFullRun) {
    console.log(JSON.stringify({ utc, la: la.stamp, action: "refill", runKind, result: "skipped", reason: "top-up tick — refill/discovery runs only on the 5:30 full run" }));
  }
}

await main();
