// ─────────────────────────────────────────────────────────────────────────────
// Railway cron function: daily-prospecting-cron
//
// Runs on a UTC cron (30 12,13 * * *) — the two possible UTC equivalents of
// 5:30 AM America/Los_Angeles across PDT/PST. Inside, it checks LA local time and
// only calls the protected prospecting endpoint when it is ~5:20–5:45 AM LA. The
// other UTC firing sees LA hour 4 or 6 and exits successfully without calling.
//
// The application endpoint enforces weekdays, the once-per-LA-day duplicate guard,
// queue-cap, and no-mock rules — so this function never uses force=1 in normal
// operation. The secret is read from the environment and never logged.
// ─────────────────────────────────────────────────────────────────────────────

const ENDPOINT = "https://outreach.artifexlabs.tech/api/cron/prospect";

function env(name: string): string | undefined {
  // Works on Bun (Railway Functions runtime) and Node.
  const anyGlobal = globalThis as any;
  return (typeof process !== "undefined" && process.env?.[name]) || anyGlobal.Bun?.env?.[name] || undefined;
}

function laParts(): { hour: number; minute: number; stamp: string } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZoneName: "short",
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = parseInt(get("hour"), 10) % 24;
  const minute = parseInt(get("minute"), 10);
  const stamp = `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} ${get("timeZoneName")}`;
  return { hour, minute, stamp };
}

async function main(): Promise<void> {
  const utc = new Date().toISOString();
  const la = laParts();
  const testMode = env("SCHEDULER_TEST") === "true";

  // Local-time gate: only around 5:20–5:45 AM LA (accommodates a late start).
  const inWindow = la.hour === 5 && la.minute >= 20 && la.minute <= 45;
  if (!testMode && !inWindow) {
    console.log(JSON.stringify({ utc, la: la.stamp, action: "skipped", reason: "outside 5:20-5:45 AM LA window" }));
    return;
  }

  const secret = env("CRON_SECRET");
  if (!secret) {
    console.log(JSON.stringify({ utc, la: la.stamp, action: "error", reason: "CRON_SECRET not configured" }));
    // Non-zero exit signals failure to Railway.
    if (typeof process !== "undefined") process.exitCode = 1;
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    // Normal scheduled operation — NO force=1. The endpoint self-throttles.
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      signal: controller.signal,
    });
    let summary: unknown = null;
    try {
      const body: any = await res.json();
      // Sanitized summary only — never echo headers or secret.
      summary = body?.run
        ? { added: body.run.addedToToday, mode: body.run.providerMode, distinct: body.run.distinctCategoriesAdded, stop: body.run.stopReason }
        : { skipped: body?.skipped ?? null, ok: body?.ok ?? null };
    } catch {
      summary = { note: "non-JSON response" };
    }

    if (!res.ok) {
      console.log(JSON.stringify({ utc, la: la.stamp, action: "called", testMode, status: res.status, result: "failure", summary }));
      if (typeof process !== "undefined") process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify({ utc, la: la.stamp, action: "called", testMode, status: res.status, result: "ok", summary }));
  } catch (err: any) {
    console.log(JSON.stringify({ utc, la: la.stamp, action: "called", result: "error", reason: err?.name === "AbortError" ? "timeout" : "network error" }));
    if (typeof process !== "undefined") process.exitCode = 1;
  } finally {
    clearTimeout(timer);
  }
}

await main();
