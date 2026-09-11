// ─────────────────────────────────────────────────────────────────────────────
// RECONCILE ACTIVE INVENTORY (Active Inventory Integrity mandate §49, §50, §35, §9).
//
// Runs ONE full reconciliation of the current Quick Cash inventory against the CURRENT
// package contracts and prints the honest §50 inventory report. DRY-RUN by default
// (reports only); pass --apply to run Repair All Eligible (idempotent, bounded,
// cost-aware — cheap deterministic repairs only; NEVER spends paid media, NEVER sends,
// NEVER contacts anyone). --no-screenshots skips queueing captures.
//
// RUN AGAINST PRODUCTION (read-only report):
//   railway run pnpm tsx scripts/reconcile-active-inventory.ts
// RUN AGAINST PRODUCTION (apply cheap repairs):
//   railway run pnpm tsx scripts/reconcile-active-inventory.ts --apply
//
// `railway run` injects the service env (DATABASE_URL etc.) WITHOUT printing secrets.
// The script only talks to the store abstraction — no direct SQL, no Stripe/Resend/Twilio,
// no outbound. Paid personalized video stays behind #202 + Voice Capacity and is only
// ever REPORTED here as "waiting for paid production", never generated.
// ─────────────────────────────────────────────────────────────────────────────
import "./loadEnv";
import * as store from "../src/lib/quick-fix/store";
import type { QuickFixOffer } from "../src/lib/quick-fix/types";
import { packageInventorySweep } from "../src/lib/quick-fix/package-qa";
import { repairAllEligible } from "../src/lib/quick-fix/package-repair";

const APPLY = process.argv.includes("--apply");
const NO_SHOTS = process.argv.includes("--no-screenshots");
const ACTOR = "reconcile-active-inventory";

function bar(label: string, n: number) {
  console.log(`  ${label.padEnd(34)} ${String(n).padStart(4)}`);
}

async function main() {
  const now = new Date().toISOString();
  const offers = await store.listOffers();
  console.log(`\n=== RECONCILE ACTIVE INVENTORY (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
  console.log(`stored offers: ${offers.length}\n`);

  if (APPLY) {
    console.log("Running Repair All Eligible (cheap deterministic repairs only — no paid media, no sends)…");
    const res = await repairAllEligible({ actor: ACTOR, now, enqueueScreenshots: !NO_SHOTS });
    console.log(`  processed ${res.processed} · changed ${res.changed} · retire-recommended ${res.retireRecommended}`);
    // Show what each changed package did (bounded to the first 40 for readability).
    for (const r of res.perOffer.filter((p) => p.applied.length).slice(0, 40)) {
      console.log(`   · ${r.company.slice(0, 28).padEnd(28)} ${r.readinessBefore}→${r.readinessAfter}  [${r.applied.join(", ")}]`);
    }
    console.log("");
  }

  // Honest §50 inventory report from a fresh sweep (post-repair when --apply).
  const fresh = await store.listOffers();
  const sweep = await packageInventorySweep({ offers: fresh });
  const eligible = fresh.filter((o) => (o as unknown as QuickFixOffer).quickFixEligible && !o.retiredAt);
  const conversationOnly = fresh.filter((o) => !(o as unknown as QuickFixOffer).quickFixEligible && !o.retiredAt).length;

  // Per-facet completeness (§50) over the ACTIVE eligible packages.
  let withSubject = 0, withScreens = 0, withPv = 0, waitingPv = 0, withEvergreen = 0;
  const { buildCanonicalPackage } = await import("../src/lib/quick-fix/canonical-package");
  for (const o of eligible) {
    const pkg = await buildCanonicalPackage(o as unknown as QuickFixOffer, { stored: o });
    if (pkg.story.subject && pkg.story.subject.toLowerCase() !== "website note") withSubject++;
    if (pkg.assets.screenshots.status === "READY") withScreens++;
    if (pkg.assets.personalizedVideo.status === "READY") withPv++;
    else if (pkg.completeness.waitingForPaidOnly) waitingPv++;
    if (pkg.assets.evergreen.status === "READY") withEvergreen++;
  }

  console.log("=== INVENTORY REPORT (§50) ===");
  bar("Total records", fresh.length);
  bar("Active (eligible)", eligible.length);
  bar("Conversation-only (non-quick-fix)", conversationOnly);
  bar("Retired", sweep.counts.retired);
  console.log("  ── active package readiness ──");
  bar("Ready-to-send (PASS)", sweep.counts.pass);
  bar("Repairing (preparing)", sweep.counts.repairing);
  bar("Waiting for paid production", sweep.counts.waitingForPaid);
  bar("Blocked", sweep.counts.blocked);
  console.log("  ── active facet coverage ──");
  bar("with specific subject", withSubject);
  bar("with sufficient screenshots", withScreens);
  bar("with personalized video", withPv);
  bar("awaiting paid personalized video", waitingPv);
  bar("with evergreen explainer", withEvergreen);

  if (sweep.notReady.length) {
    console.log("\n=== NOT-READY ACTIVE PACKAGES (blocker reasons) ===");
    for (const r of sweep.notReady.slice(0, 40)) {
      console.log(`  ${r.verdict.padEnd(16)} ${r.company.slice(0, 26).padEnd(26)} ${(r.reasons[0] ?? r.open.join(",")) || "—"}`);
    }
    if (sweep.notReady.length > 40) console.log(`  … and ${sweep.notReady.length - 40} more`);
  }

  console.log(`\n${APPLY ? "Applied cheap repairs." : "DRY-RUN — no writes."} No prospect was contacted; no paid media generated; delivery/autosend untouched.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
