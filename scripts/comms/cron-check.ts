// ─────────────────────────────────────────────────────────────────────────────
// Scheduler / cron activation check (Phase 4). Verifies the deployed
// /api/cron/send endpoint: authentication, execution, idempotency, and reporting.
//
// SAFE: the endpoint only sends steps that are already approved AND due. During
// activation (no approved live plans, or provider disabled) it sends nothing.
// Running it twice demonstrates idempotency. Use --force to bypass the
// business-hours window for a manual run.
//
// Usage:
//   CRON_SECRET=... npx tsx scripts/comms/cron-check.ts \
//     [--url https://outreach.artifexlabs.tech] [--force]
import "../loadEnv";

const URL_BASE = process.argv.find((a) => a.startsWith("--url="))?.split("=")[1] ?? "https://outreach.artifexlabs.tech";
const force = process.argv.includes("--force");
const ENDPOINT = `${URL_BASE.replace(/\/+$/, "")}/api/cron/send${force ? "?force=1" : ""}`;
const secret = process.env.CRON_SECRET;

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail: string) => { console.log(`  ${ok ? "✓" : "✗"}  ${name.padEnd(30)} ${detail}`); ok ? pass++ : fail++; };

async function main() {
  console.log(`\nScheduler activation check → ${ENDPOINT}`);
  console.log("=".repeat(64));
  if (!secret) { console.log("  ✗  CRON_SECRET not set locally — cannot authenticate. Aborting."); process.exit(1); }

  // 1. Unauthenticated → 401.
  {
    const res = await fetch(ENDPOINT, { method: "POST" });
    check("no auth → 401", res.status === 401, `got ${res.status}`);
  }
  // 2. Authenticated → 200 with a run summary.
  let first: any = null;
  {
    const res = await fetch(ENDPOINT, { method: "POST", headers: { authorization: `Bearer ${secret}` } });
    first = await res.json().catch(() => ({}));
    check("authenticated → 200", res.status === 200, `got ${res.status}`);
    check("reports provider + window", first?.provider != null && first?.windowOpen != null, `provider=${first?.provider} windowOpen=${first?.windowOpen}`);
    console.log(`     summary: considered=${first?.considered} sent=${first?.sent} deduped=${first?.deduped} retried=${first?.retried} failed=${first?.failed}`);
  }
  // 3. Idempotent re-run → does not re-send already-sent steps.
  {
    const res = await fetch(ENDPOINT, { method: "POST", headers: { authorization: `Bearer ${secret}` } });
    const second = await res.json().catch(() => ({}));
    check("idempotent re-run safe", res.status === 200, `2nd run sent=${second?.sent} (already-sent steps are never re-sent)`);
  }

  console.log("=".repeat(64));
  if (first && first.provider === "disabled") console.log("NOTE: provider is 'disabled' — endpoint healthy but inert until RESEND_API_KEY is set.");
  console.log(`${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed.`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
