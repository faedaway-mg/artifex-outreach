// ─────────────────────────────────────────────────────────────────────────────
// QUICK-CASH CONSOLIDATION — freeze the legacy cold-outreach pipeline (belt) and
// print the reclassified lead inventory. Read-only except the reversible, audited
// operational pause (only with --engage-pause). No sends, no charges, nothing
// deleted; scheduled bindings are preserved (inert while frozen).
//
//   railway run --service Postgres bash -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" \
//     ./node_modules/.bin/tsx scripts/quickcash-consolidation.ts [--engage-pause]'
// ─────────────────────────────────────────────────────────────────────────────
import "./loadEnv";
if (process.env.DATABASE_PUBLIC_URL && process.env.DATABASE_URL?.includes(".railway.internal")) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
}
const ENGAGE = process.argv.includes("--engage-pause");

async function main() {
  const { legacyColdOutreachFrozen } = await import("../src/lib/outreach/legacy-freeze");
  const { outreachPausedNow, setOutreachPaused } = await import("../src/lib/outreach/outreach-pause");
  const { quickCashInventory } = await import("../src/lib/quick-fix/operator-views");

  const codeFrozen = legacyColdOutreachFrozen();
  const pausedBefore = await outreachPausedNow();
  console.log(`legacy cold outreach — code-default frozen: ${codeFrozen}`);
  console.log(`operational pause (outreachPaused) BEFORE: ${pausedBefore}`);

  if (ENGAGE && !pausedBefore) {
    await setOutreachPaused(true, {
      actor: "operator:quick-cash-consolidation",
      reason: "Quick-Cash Consolidation — legacy cold outreach moved to secondary/frozen posture. Reversible; bindings/customers/replies/payments preserved.",
    });
    console.log(`operational pause AFTER: ${await outreachPausedNow()} (reversible via setOutreachPaused(false, ...))`);
  } else if (ENGAGE) {
    console.log("operational pause already engaged — idempotent, no change.");
  }

  const inv = await quickCashInventory();
  console.log("\n──────── QUICK-CASH LEAD INVENTORY ────────");
  console.log(`TOTAL LEADS ............ ${inv.totalLeads}`);
  console.log(`  DIRECT_FIX ........... ${inv.routes.DIRECT_FIX}`);
  console.log(`  FIX_SCAN ............. ${inv.routes.FIX_SCAN}`);
  console.log(`  CONVERSATION_REQUIRED  ${inv.routes.CONVERSATION_REQUIRED}`);
  console.log(`  NO_FIX_FOUND ......... ${inv.routes.NO_FIX_FOUND}`);
  console.log(`READY_TO_SELL .......... ${inv.readyToSell}`);
  console.log(`CUSTOMERS .............. ${inv.customers}`);
  console.log(`SUPPRESSED ............. ${inv.suppressed}`);
  console.log(`LEGACY_FROZEN (sched) .. ${inv.legacyFrozenScheduled}`);
  console.log(`ADDRESSABLE REVENUE .... $${Math.round(inv.addressableRevenueCents / 100).toLocaleString()}`);
  console.log(`cold outreach frozen ... ${inv.coldOutreachFrozen}`);
  console.log(`exactly-one-route/lead . ${inv.exactlyOneRoutePerLead}`);
  console.log("───────────────────────────────────────────\n");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e?.stack || e); process.exit(1); });
