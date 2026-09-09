#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// BREAKBOT RELEASE-REGRESSION GATE (Part U) — the pre-deploy QA gate.
//
// Runs the 5 GOLDEN + 20 FAILURE fixtures through the finished runBreakbotPreflight
// engine and asserts: every golden is READY, every failure BLOCKS on its EXACT expected
// blocker surface. EXITS NONZERO on ANY critical regression, so a broken customer-journey
// contract can block a deploy. Pure/offline: NO store, NO DB, NO provider, NO sends,
// NO charges. Fail-closed — this script cannot itself send, charge, or mutate anything.
//
// Usage:  pnpm -s tsx scripts/breakbot-regression.ts
// ─────────────────────────────────────────────────────────────────────────────
import { runRegression, type RegressionResult } from "../src/lib/breakbot/regression";

// Fail-closed environment hygiene: guarantee no real DB / provider / recipient can be
// reached even accidentally while this offline gate runs.
delete process.env.DATABASE_URL;
delete process.env.CS_DATABASE_URL;
delete process.env.RESEND_API_KEY;
process.env.BREAKBOT_TEST_TENANT = "1";

function print(result: RegressionResult): void {
  const ok = (b: boolean) => (b ? "✓" : "✕");
  console.log("BREAKBOT RELEASE-REGRESSION");
  console.log("───────────────────────────");
  console.log(`GOLDEN (expect READY):  ${result.goldenPassed}/${result.goldenTotal}`);
  for (const g of result.golden) {
    console.log(`  ${ok(g.pass)} ${g.id} — ${g.overall}${g.blockerSurfaces.length ? ` [${g.blockerSurfaces.join(", ")}]` : ""}`);
  }
  console.log(`FAILURE (expect BLOCKED on surface):  ${result.failurePassed}/${result.failureTotal}`);
  for (const f of result.failure) {
    console.log(`  ${ok(f.pass)} ${f.id} — expect "${f.expectBlockerSurface}" → ${f.overall}${f.blockerSurfaces.length ? ` [${f.blockerSurfaces.join(", ")}]` : ""}`);
  }
  if (result.regressions.length > 0) {
    console.log("\nCRITICAL REGRESSIONS:");
    for (const r of result.regressions) console.log(`  ✕ [${r.kind}] ${r.id}: ${r.reason}`);
  }
}

export { runRegression } from "../src/lib/breakbot/regression";
export type { RegressionResult } from "../src/lib/breakbot/regression";

// Only execute the gate when run directly (not when imported by the API route / a test).
const invokedDirectly = (() => {
  try {
    const arg = process.argv[1] ?? "";
    return /breakbot-regression(\.[tj]s)?$/.test(arg);
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const result = runRegression();
  print(result);
  if (result.allPass) {
    console.log(`\nPASS — all ${result.goldenTotal} golden READY, all ${result.failureTotal} failures blocked on their surface.`);
    process.exit(0);
  } else {
    console.error(`\nFAIL — ${result.regressions.length} critical regression(s). Deploy gate BLOCKED.`);
    process.exit(1);
  }
}
