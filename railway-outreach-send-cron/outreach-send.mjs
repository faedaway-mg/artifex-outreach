// Weekday-morning OUTREACH cron. It only WAKES the server runner by POSTing the dispatch endpoint; the
// SERVER's America/Los_Angeles gate (05:00–07:00, weekdays) is authoritative and decides whether any
// dispatch is allowed, along with the shared daily cap of 20, staggered due-times, and the dispatch-time
// suppression / unsubscribe / recipient / frozen-attachment-SHA / quota / idempotency re-checks. The
// Railway cron fires across a UTC superset (12–15 UTC) so it is DST-robust; the server draws the line.
//
// Bounded + single-shot: one POST, then exit. Exit 0 only on a 2xx endpoint response; NONZERO on a
// missing secret, an auth failure, a non-2xx status, or a network error. Logs are sanitized — no
// secret, no recipient addresses (only aggregate counts + internal ids).
const URL = process.env.OUTREACH_URL || `${process.env.OUTREACH_BASE || "https://outreach.artifexlabs.tech"}/api/cron/outreach`;
const secret = process.env.CRON_SECRET;
const at = new Date().toISOString();

if (!secret) { console.log(JSON.stringify({ at, action: "error", reason: "CRON_SECRET not set" })); process.exit(1); }

try {
  const res = await fetch(URL, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
  const body = await res.json().catch(() => ({}));
  // Sanitized summary only (no outcomes[] with ids, no addresses, no secret).
  const summary = {
    at, status: res.status, ok: body.ok === true, dispatched: body.dispatched === true,
    due: body.due ?? null, sent: body.sent ?? null, quotaRemaining: body.quotaRemaining ?? null,
    reason: typeof body.reason === "string" ? body.reason : undefined,
  };
  console.log(JSON.stringify(summary));
  if (!res.ok) process.exit(1); // auth failure / endpoint error → nonzero
  process.exit(0);
} catch (e) {
  console.log(JSON.stringify({ at, action: "error", reason: String((e && e.message) || e).slice(0, 200) }));
  process.exit(1);
}
