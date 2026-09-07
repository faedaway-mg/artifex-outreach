// MANDATE 27 §Campaign Preview — read-only. Builds the targeting board over canonical production leads +
// business intelligence and prints the exact qualified campaign preview: markets, backlog counts, hard
// exclusions by reason, and the top qualified companies with score breakdowns + recommended asset + recipient.
// It NEVER prepares, approves, schedules, or sends. Run in-network:
//   railway run --service Postgres bash -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" ... ./node_modules/.bin/tsx scripts/mandate27-campaign-preview.ts'
import "./loadEnv";
if (process.env.DATABASE_PUBLIC_URL && process.env.DATABASE_URL?.includes(".railway.internal")) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
}
async function main() {
  const { buildTargetingBoard } = await import("../src/lib/targeting/board");
  const board = await buildTargetingBoard({ limit: 200 });
  console.log(`MANDATE 27 CAMPAIGN PREVIEW (read-only) — model ${board.version}`);
  console.log(`population source: ${board.populationSource} · ${board.excludedMajorCount} major metros excluded`);
  console.log(`\nNEXT MARKETS: ${board.nextMarkets.map((m) => `${m.city},${m.state}(${m.tier})`).join(" · ")}`);
  const c = board.counts;
  console.log(`\nBACKLOG (persona-fit): PRIORITY_A=${c.priorityA} PRIORITY_B=${c.priorityB} MANUAL_REVIEW=${c.review} NEEDS_RECIPIENT=${c.needsRecipient} NEEDS_EVIDENCE=${c.needsEvidence} DO_NOT_PREPARE=${c.doNotPrepare} INELIGIBLE=${c.ineligible} · auto-prepare-eligible=${c.autoPrepareEligible} · scored=${c.total}`);
  console.log(`(NEEDS_RECIPIENT = good persona fit blocked only on recipient resolution — the external-credential activation gate, NOT a poor fit.)`);
  console.log(`\nHARD EXCLUSIONS BY REASON (terminal only):`);
  for (const [r, n] of Object.entries(board.exclusions).sort((a, b) => b[1] - a[1])) console.log(`  ${n}× ${r}`);
  const qualified = board.cards.filter((x) => x.promotionState === "PRIORITY_A" || x.promotionState === "PRIORITY_B");
  console.log(`\nTOP QUALIFIED (${qualified.length}):`);
  for (const t of qualified.slice(0, 20)) {
    const cm = t.score.components;
    console.log(`  [${t.band} ${t.total}] ${t.businessName} · ${t.city},${t.state} ${t.marketTier} · asset=${t.recommendedAsset} · recipient=${t.recipientRole}${t.recipientVerified ? "✓" : "✗"}`);
    console.log(`      rep${cm.reputationStrength} gap${cm.digitalReputationGap} ev${cm.evidenceSpecificity} acc${cm.decisionMakerAccess} val${cm.customerValue} mkt${cm.marketFit} grw${cm.growthTiming} rcp${cm.recipientConfidence}`);
  }
  console.log(`\n0 packages prepared · 0 approved · 0 scheduled · 0 emails sent · 0 provider calls (read-only preview).`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e?.stack || e); process.exit(1); });
