import { describe, it, expect } from "vitest";
import { DEFAULT_VOICE_KEY, LEGACY_LUCAS_VOICE_KEY } from "@/lib/voice/registry";
import type { TrustVideoScope } from "@/lib/quick-fix/trust-videos";
import {
  classifyTrustVideo,
  resolveTrustVideoForJourney,
  estimateMattMigration,
  ESTIMATE_WORDS_PER_MINUTE,
} from "@/lib/voice/trust-video-plan";

// The 9 scope trust-video families (the non-"general" scopes).
const SCOPES: TrustVideoScope[] = [
  "contact-form-lead-capture",
  "cta-conversion",
  "mobile-responsive",
  "accessibility",
  "analytics-tracking",
  "cms-technical",
  "seo-metadata",
  "homepage-sprint",
  "fix-scan",
];

describe("resolveTrustVideoForJourney", () => {
  it("Matt journey WITH an existing Matt asset → reuse (no generation)", () => {
    const mattAssets = new Set<TrustVideoScope>(["cta-conversion"]);
    const d = resolveTrustVideoForJourney("cta-conversion", DEFAULT_VOICE_KEY, mattAssets);
    expect(d.generation).toBe("current-matt");
    expect(d.outcome).toBe("reuse-matt");
    expect(d.reuse).toBe(true);
  });

  it("Matt journey with NO Matt asset → prepare-matt on demand, NOT a Lucas fallback", () => {
    const noMatt = new Set<TrustVideoScope>();
    const d = resolveTrustVideoForJourney("accessibility", DEFAULT_VOICE_KEY, noMatt);
    expect(d.generation).toBe("current-matt");
    expect(d.outcome).toBe("prepare-matt");
    expect(d.reuse).toBe(false);
    // Never silently falls back to the legacy Lucas asset.
    expect(d.outcome).not.toBe("use-legacy-lucas");
  });

  it("unknown voice key is treated as Matt (default) — never resolves to Lucas", () => {
    const d = resolveTrustVideoForJourney("seo-metadata", "totally_unknown_voice", new Set());
    expect(d.generation).toBe("current-matt");
    expect(d.outcome).toBe("prepare-matt");
    expect(d.outcome).not.toBe("use-legacy-lucas");
  });

  it("legacy-lucas journey → legacy asset preserved, NEVER a Matt asset", () => {
    // Even if a Matt asset happens to exist for the scope, a legacy journey stays legacy.
    const mattAssets = new Set<TrustVideoScope>(["cms-technical"]);
    const d = resolveTrustVideoForJourney("cms-technical", LEGACY_LUCAS_VOICE_KEY, mattAssets);
    expect(d.generation).toBe("legacy-lucas");
    expect(d.outcome).toBe("use-legacy-lucas");
    expect(d.reuse).toBe(true);
    // No silent mixing into a Matt asset.
    expect(d.outcome).not.toBe("reuse-matt");
    expect(d.outcome).not.toBe("prepare-matt");
  });
});

describe("classifyTrustVideo", () => {
  it("existing Matt asset → matt-available (reuse)", () => {
    const c = classifyTrustVideo("cta-conversion", new Set<TrustVideoScope>(["cta-conversion"]));
    expect(c.class).toBe("matt-available");
    expect(c.action).toBe("reuse-existing-matt");
  });

  it("no Matt asset → legacy-lucas-preserved (kept as-is)", () => {
    const c = classifyTrustVideo("accessibility", new Set());
    expect(c.class).toBe("legacy-lucas-preserved");
    expect(c.action).toBe("preserve-legacy-lucas");
  });

  it("NEVER proposes deleting or superseding a legacy asset for ANY scope", () => {
    const destructive = ["delete", "regenerate", "supersede", "remove", "overwrite"];
    for (const scope of SCOPES) {
      // With no Matt library today, every scope classifies as legacy-preserved.
      const c = classifyTrustVideo(scope, new Set());
      expect(c.class).toBe("legacy-lucas-preserved");
      expect(destructive).not.toContain(c.action);
      expect(c.action).toBe("preserve-legacy-lucas");
    }
  });
});

describe("estimateMattMigration", () => {
  it("counts are correct with an empty Matt library (today's honest state)", () => {
    const avgWords = 150;
    const est = estimateMattMigration(SCOPES, avgWords);
    expect(est.totalTrustVideos).toBe(9);
    expect(est.alreadyCompatibleMatt).toBe(0);
    expect(est.legacyPreserved).toBe(9);
    expect(est.wouldRequireGeneration).toBe(9);
    expect(est.estimatedRequests).toBe(9);
    // 150 words / 150 wpm = 1 min each × 9 = 9 minutes.
    const expectedMinutes =
      Math.round((avgWords / ESTIMATE_WORDS_PER_MINUTE) * 9 * 100) / 100;
    expect(est.estimatedNarrationMinutes).toBe(expectedMinutes);
    expect(est.estimatedNarrationMinutes).toBe(9);
  });

  it("counts already-compatible Matt assets and excludes them from generation", () => {
    const mattAssets = new Set<TrustVideoScope>(["cta-conversion", "accessibility"]);
    const est = estimateMattMigration(SCOPES, 150, mattAssets);
    expect(est.totalTrustVideos).toBe(9);
    expect(est.alreadyCompatibleMatt).toBe(2);
    expect(est.legacyPreserved).toBe(7);
    expect(est.wouldRequireGeneration).toBe(7);
    expect(est.estimatedRequests).toBe(7);
    expect(est.estimatedNarrationMinutes).toBe(7);
  });

  it("all-Matt library → zero would-require-generation, zero requests", () => {
    const all = new Set<TrustVideoScope>(SCOPES);
    const est = estimateMattMigration(SCOPES, 200, all);
    expect(est.alreadyCompatibleMatt).toBe(9);
    expect(est.legacyPreserved).toBe(0);
    expect(est.wouldRequireGeneration).toBe(0);
    expect(est.estimatedRequests).toBe(0);
    expect(est.estimatedNarrationMinutes).toBe(0);
  });
});
