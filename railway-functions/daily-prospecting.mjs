// ─────────────────────────────────────────────────────────────────────────────
// Artifex daily prospecting cron (Railway cron service).
//
// Runs on cron "30 12,13 * * *" — both UTC equivalents of 5:30 AM
// America/Los_Angeles across PDT/PST. It checks LA local time and calls the
// protected prospecting endpoint ONLY when LA hour = 5 and minute 20–45 (a safe
// late-start window). The other firing sees LA hour 4 or 6 and exits cleanly.
//
// The app endpoint enforces weekdays, the once-per-LA-day duplicate guard, the
// queue-cap, and the no-mock rule, so this never uses force=1. The secret is read
// from the environment and never logged. The process exits after running/skipping.
// ─────────────────────────────────────────────────────────────────────────────
const ENDPOINT = "https://outreach.artifexlabs.tech/api/cron/prospect";

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
  const inWindow = la.hour === 5 && la.minute >= 20 && la.minute <= 45;

  if (!testMode && !inWindow) {
    console.log(JSON.stringify({ utc, la: la.stamp, action: "skipped", reason: "outside 5:20-5:45 AM LA window" }));
    return;
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.log(JSON.stringify({ utc, la: la.stamp, action: "error", reason: "CRON_SECRET not configured" }));
    process.exitCode = 1;
    return;
  }

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
    console.log(JSON.stringify({ utc, la: la.stamp, action: "called", testMode, status: res.status, result, summary }));
    if (!res.ok) process.exitCode = 1;
  } catch (err) {
    console.log(JSON.stringify({ utc, la: la.stamp, action: "called", result: "error", reason: err?.name === "AbortError" ? "timeout" : "network error" }));
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
  }
}

await main();
