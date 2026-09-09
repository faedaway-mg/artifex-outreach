#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// BREAKBOT PRODUCTION BATCH (Part V) — READ-ONLY QA over the live inventory.
//
// Loads the real READY_TO_SELL, high-confidence offers from the store, runs the
// finished Breakbot pre-flight over each, and prints a READY/BLOCKED summary + the
// most-common blockers + the SALES-QUALIFIED vs ASSET-READY split.
//
// SAFETY (Part Y): this NEVER sends, charges, schedules, or mutates. It uses only the
// read-only operator view (breakbotBatchView), which reads stored state + the fixed
// contracts and runs the pure engine. It FAILS CLOSED — before doing anything it hard-
// deletes any provider credential from the environment so no code path could send even
// if a bug tried to. Intended to be run against a production READ-ONLY database.
//
// Usage:  pnpm -s tsx scripts/breakbot-batch.ts [--limit N]
// ─────────────────────────────────────────────────────────────────────────────
import { breakbotBatchView, type BreakbotBatchView } from "../src/lib/quick-fix/operator-views";

// FAIL-CLOSED: strip every send/charge credential so no send path can ever fire from
// this read-only batch, even accidentally. The DB stays connected (read-only by intent).
for (const k of [
  "RESEND_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_QUICKFIX_SECRET_KEY",
  "TWILIO_AUTH_TOKEN",
  "SENDGRID_API_KEY",
]) {
  delete process.env[k];
}

const usd = (c: number | null) => (c == null ? "—" : `$${Math.round(c / 100)}`);

function print(view: BreakbotBatchView): void {
  console.log("BREAKBOT PRODUCTION BATCH (read-only)");
  console.log("─────────────────────────────────────");
  console.log(`Scanned (top high-confidence READY_TO_SELL offers): ${view.scanned}`);
  console.log("");
  console.log("ASSET / EXPERIENCE readiness (the Breakbot verdict):");
  console.log(`  READY   : ${view.assetReadyCount}`);
  console.log(`  BLOCKED : ${view.assetBlockedCount}`);
  console.log("");
  console.log("SALES qualification (independent of asset readiness):");
  console.log(`  SALES-QUALIFIED           : ${view.salesQualifiedCount}`);
  console.log(`  ...but ASSET-BLOCKED      : ${view.salesQualifiedButAssetBlocked}  (sell-ready lead, asset is a BUILD task — NOT a disqualification)`);
  console.log("");
  if (view.commonBlockers.length > 0) {
    console.log("Most-common blockers:");
    for (const b of view.commonBlockers) console.log(`  ${b.count}×  ${b.surface}`);
    console.log("");
  }
  console.log("Per-offer:");
  for (const r of view.rows) {
    const asset = r.assetReady ? "READY " : "BLOCKED";
    const sales = r.salesQualified === null ? "sales:?" : r.salesQualified ? "sales:QUALIFIED" : "sales:not-qual";
    const surfaces = r.blockerSurfaces.length ? `  [${r.blockerSurfaces.join(", ")}]` : "";
    console.log(`  ${asset}  ${sales}  ${usd(r.priceCents)}  conf ${r.confidence.toFixed(2)}  ${r.company} (${r.offerId})${surfaces}`);
  }
}

async function main(): Promise<void> {
  const idx = process.argv.indexOf("--limit");
  const limit = idx >= 0 ? Number(process.argv[idx + 1]) || 10 : 10;
  const view = await breakbotBatchView(limit);
  print(view);
  // Always exit 0 — this is a read-only report, not a pass/fail gate. (Use the
  // regression script for the deploy gate.)
  process.exit(0);
}

main().catch((err) => {
  console.error("breakbot-batch failed:", err);
  process.exit(1);
});
