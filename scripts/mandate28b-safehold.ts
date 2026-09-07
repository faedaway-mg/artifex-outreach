// MANDATE 28B PRIORITY ZERO — engage the reversible, audited cold-outreach safe-hold. The 15 scheduled
// bindings are classified COLD_OUTREACH and route to Resend-only; Resend now prohibits cold outreach.
// Engaging outreachPaused=true guarantees no cold dispatch at the final boundary (DB-backed, effective next
// tick, no redeploy) WITHOUT touching any binding/package/receipt/approval/audit/artifact. Reversible via
// setOutreachPaused(false, ...) once a compliant mailbox transport passes its own acceptance.
//   railway run --service Postgres bash -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" ./node_modules/.bin/tsx scripts/mandate28b-safehold.ts [--engage]'
import "./loadEnv";
if (process.env.DATABASE_PUBLIC_URL && process.env.DATABASE_URL?.includes(".railway.internal")) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
}
const ENGAGE = process.argv.includes("--engage");
async function main() {
  const { outreachPausedNow, setOutreachPaused } = await import("../src/lib/outreach/outreach-pause");
  const before = await outreachPausedNow();
  console.log(`safe-hold BEFORE: outreachPaused=${before}`);
  if (!ENGAGE) { console.log("(dry-run — pass --engage to set the hold)"); return; }
  if (before) { console.log("already engaged — no change (idempotent)."); return; }
  await setOutreachPaused(true, { actor: "operator:mandate-28b", reason: "Resend prohibits cold outreach; hold all cold-outreach dispatch until a compliant mailbox transport passes acceptance. Bindings/packages/receipts preserved." });
  const after = await outreachPausedNow();
  console.log(`safe-hold AFTER: outreachPaused=${after} (reversible via setOutreachPaused(false, ...))`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e?.stack || e); process.exit(1); });
