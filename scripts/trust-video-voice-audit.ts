/**
 * ─────────────────────────────────────────────────────────────────────────────
 * TRUST-VIDEO VOICE PRESERVATION AUDIT (read-only, offline)
 *
 * POLICY: this script performs a PRESERVATION AUDIT and an INFORMATIONAL dry-run
 * estimate ONLY. It NEVER regenerates, deletes, or supersedes any asset, and it
 * NEVER calls ElevenLabs or any provider. There is NO bulk-migration authorization.
 * Matt is the default for NEW journeys only; the Matt trust-video library is built
 * INCREMENTALLY and REUSED, on demand — never in bulk.
 *
 * It reads only the trust-videos.ts config (no DB, no network) and reports:
 *   • total trust videos
 *   • already-compatible-Matt count (0 today, honestly)
 *   • legacy-preserved count
 *   • would-require-generation count (IF built incrementally)
 *   • estimated narration minutes + estimated ElevenLabs requests (IF built incrementally)
 *
 * Run: pnpm -s tsx scripts/trust-video-voice-audit.ts
 * ─────────────────────────────────────────────────────────────────────────────
 */
import {
  TRUST_VIDEO_ASSETS,
  trustVideoScript,
  type TrustVideoScope,
} from "@/lib/quick-fix/trust-videos";
import {
  classifyTrustVideo,
  estimateMattMigration,
  ESTIMATE_WORDS_PER_MINUTE,
} from "@/lib/voice/trust-video-plan";

// The 9 scope trust-video families (every scope except the script-only "general" fallback).
const SCOPES: TrustVideoScope[] = (Object.keys(TRUST_VIDEO_ASSETS) as TrustVideoScope[]).filter(
  (s) => s !== "general" && TRUST_VIDEO_ASSETS[s].assetUrl !== null,
);

// Today the Matt trust-video library is EMPTY — no scope has a Matt-narrated asset yet.
// (Built incrementally, on demand, later.) This set is intentionally empty and honest.
const EXISTING_MATT_TRUST_VIDEOS = new Set<TrustVideoScope>();

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function main(): void {
  // Average narration length across the 9 scope scripts (opening + module + close).
  const wordCounts = SCOPES.map((s) => wordCount(trustVideoScript(s)));
  const avgNarrationWords = Math.round(
    wordCounts.reduce((a, b) => a + b, 0) / (wordCounts.length || 1),
  );

  const classifications = SCOPES.map((s) => classifyTrustVideo(s, EXISTING_MATT_TRUST_VIDEOS));
  const estimate = estimateMattMigration(SCOPES, avgNarrationWords, EXISTING_MATT_TRUST_VIDEOS);

  const line = "═".repeat(78);
  console.log(line);
  console.log("PRESERVATION AUDIT — no regeneration performed; bulk migration is NOT");
  console.log("authorized; Matt library is built incrementally on demand.");
  console.log("(read-only • offline • no ElevenLabs calls • no assets touched)");
  console.log(line);
  console.log("");

  console.log(`Scopes audited: ${SCOPES.length}  |  avg narration ≈ ${avgNarrationWords} words  |  assumed pace ${ESTIMATE_WORDS_PER_MINUTE} wpm`);
  console.log("");
  console.log("Per-scope classification (legacy Lucas assets PRESERVED as-is):");
  for (const c of classifications) {
    const a = TRUST_VIDEO_ASSETS[c.scope];
    console.log(
      `  • ${c.scope.padEnd(26)} ${c.class.padEnd(24)} action=${c.action.padEnd(22)} asset=${a.assetUrl ?? "(script-only)"}`,
    );
  }
  console.log("");

  console.log("Dry-run estimate (INFORMATIONAL ONLY — NOT an authorization to generate):");
  console.log(`  total trust videos ................. ${estimate.totalTrustVideos}`);
  console.log(`  already-compatible Matt ............ ${estimate.alreadyCompatibleMatt}   (0 today — Matt library built incrementally)`);
  console.log(`  legacy-preserved ................... ${estimate.legacyPreserved}   (kept exactly as-is; never regenerated)`);
  console.log(`  would-require-generation ........... ${estimate.wouldRequireGeneration}   (IF a future incremental build were done, on demand)`);
  console.log(`  estimated narration minutes ........ ${estimate.estimatedNarrationMinutes}`);
  console.log(`  estimated ElevenLabs requests ...... ${estimate.estimatedRequests}   (hypothetical — none issued by this script)`);
  console.log("");

  console.log(line);
  console.log("NO REGENERATION PERFORMED. NO ASSETS DELETED OR SUPERSEDED. NO PROVIDER CALLED.");
  console.log("Legacy Lucas trust videos are preserved for legacy journeys. Matt assets are");
  console.log("added incrementally, on demand, only for the Matt journeys that need them.");
  console.log(line);
}

main();
