/**
 * Daily Learning Review (Phase 6) — the end-of-day operational debrief.
 *
 *   pnpm launch:review
 *
 * Summarizes the day's activity, what the platform learned, what is working, which
 * industries respond best, the most common friction, and concrete suggestions.
 * Designed to be run by a nightly cron and/or read by the operator each morning.
 */
import "./loadEnv";
import { dailyReview } from "../src/lib/launch/review";

async function main() {
  const review = await dailyReview();
  console.log("\n" + review.summaryText + "\n");
  console.log("Instrumentation still needed to sharpen this review:");
  for (const g of review.instrumentationGaps) console.log(`  • ${g}`);
  console.log("");
}

main().catch((e) => {
  console.error("daily-review failed:", e);
  process.exit(1);
});
