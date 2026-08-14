// Read-only production inventory diagnostic. Side-effect-free:
//   • POST /api/cron/materialize?dryRun=1  → considered/created/routed (writes NOTHING)
//   • GET  /api/comms/status               → comms metrics
// Reports ONLY non-secret flags/counts. Never prints CRON_SECRET/DATABASE_URL.
const BASE = process.env.OUTREACH_BASE || "https://outreach.artifexlabs.tech";
const secret = process.env.CRON_SECRET;
const out = { base: BASE, flags: {
  EMAIL_PREP_ENABLED: process.env.EMAIL_PREP_ENABLED === "1",
  EMAIL_PREP_PER_TICK: process.env.EMAIL_PREP_PER_TICK ?? "(default 8)",
  OPERATOR_DISTRIBUTION_ENABLED: process.env.OPERATOR_DISTRIBUTION_ENABLED === "1",
  COMMS_AUTOSEND_ENABLED: process.env.COMMS_AUTOSEND_ENABLED === "1",
  OUTREACH_SENDING_ENABLED: process.env.OUTREACH_SENDING_ENABLED === "1",
  CRON_SECRET_present: !!secret,
} };
if (!secret) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }
const H = { Authorization: `Bearer ${secret}` };
try {
  const m = await fetch(`${BASE}/api/cron/materialize?dryRun=1`, { method: "POST", headers: H });
  out.materialize_dryRun = { status: m.status, body: await m.json().catch(() => "(non-json)") };
} catch (e) { out.materialize_dryRun = { error: String(e?.message || e) }; }
try {
  const s = await fetch(`${BASE}/api/comms/status`, { headers: H });
  out.comms_status = { status: s.status, body: await s.json().catch(() => "(non-json)") };
} catch (e) { out.comms_status = { error: String(e?.message || e) }; }
console.log(JSON.stringify(out, null, 2));
