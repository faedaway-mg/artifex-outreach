// ─────────────────────────────────────────────────────────────────────────────
// Verify the production materialization route the way the cron does.
//
// Calls /api/cron/materialize with ?dryRun=1 so NOTHING is written, using the
// same Bearer CRON_SECRET the cron service uses. The secret is read from the
// environment and never printed. Prints only the HTTP status and the response
// body, which contains counts — no recipients, no message content.
//
//   railway run --service outreach-web -- node scripts/verify-materialize-route.mjs
// ─────────────────────────────────────────────────────────────────────────────
const BASE = "https://outreach.artifexlabs.tech";
const secret = process.env.CRON_SECRET;

async function call(label, url, headers) {
  const res = await fetch(url, { method: "POST", headers });
  let body;
  try { body = await res.json(); } catch { body = { note: "non-JSON" }; }
  console.log(`${label}\n  status: ${res.status}\n  body:   ${JSON.stringify(body)}`);
  return { status: res.status, body };
}

// 1. Unauthenticated — must be refused.
await call("unauthenticated POST /api/cron/materialize", `${BASE}/api/cron/materialize`, {});

// 2. Wrong secret — must be refused.
await call("wrong-secret POST /api/cron/materialize", `${BASE}/api/cron/materialize`, { Authorization: "Bearer not-the-secret" });

if (!secret) {
  console.log("\nCRON_SECRET not present in this environment — skipped the authenticated check.");
  process.exit(0);
}

// 3. Authenticated DRY RUN — proves the route works and writes nothing.
await call("authenticated DRY RUN (?dryRun=1)", `${BASE}/api/cron/materialize?dryRun=1`, { Authorization: `Bearer ${secret}` });

console.log("\nrows written by this script: 0 (dryRun=1)\nemails sent by this script: 0 (this route cannot send)");
