// ─────────────────────────────────────────────────────────────────────────────
// MATT TRUST-VIDEO STORYBOARD — deterministic, kinetic-text-only, no attempted-use.
// Pure derivation: no I/O, no ElevenLabs, no store. Asserts the truth shape the render
// pipeline depends on and that a scope's storyboard + narration revision are stable.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import {
  buildTrustVideoStoryboard,
  trustNarrationRevision,
} from "./trust-video-storyboard";
import { trustVideoScript, TRUST_VIDEO_ASSETS, type TrustVideoScope } from "./trust-videos";

// Every renderable scope (general is script-only and excluded — it has no rendered asset).
const SCOPES = (Object.keys(TRUST_VIDEO_ASSETS) as TrustVideoScope[]).filter((s) => s !== "general");

describe("truth shape — every scene is kinetic-text company voice, no attempted-use", () => {
  for (const scope of SCOPES) {
    it(`${scope}: all scenes kinetic-text, claimsAttemptedUse=false, no screenshot/repair-concept`, () => {
      const sb = buildTrustVideoStoryboard(scope);
      expect(sb.scenes.length).toBeGreaterThan(0);
      for (const scene of sb.scenes) {
        expect(scene.visual.kind).toBe("kinetic-text");
        expect(scene.visual.screenshotId).toBeNull();
        expect(scene.visual.illustrative).toBe(false);
        expect(scene.claimsAttemptedUse).toBe(false);
      }
      expect(sb.attemptedUseHonest).toBe(true);
    });
  }
});

describe("narrationScript equals the full trust script", () => {
  for (const scope of SCOPES) {
    it(`${scope}: narrationScript === trustVideoScript(scope)`, () => {
      const sb = buildTrustVideoStoryboard(scope);
      expect(sb.narrationScript).toBe(trustVideoScript(scope));
    });
  }

  it("rejoining scene narrations with a space reproduces the script", () => {
    const scope: TrustVideoScope = "seo-metadata";
    const sb = buildTrustVideoStoryboard(scope);
    expect(sb.scenes.map((s) => s.narration).join(" ")).toBe(trustVideoScript(scope));
  });
});

describe("buildable + identity", () => {
  it("every scope's storyboard is buildable with no blockedReason", () => {
    for (const scope of SCOPES) {
      const sb = buildTrustVideoStoryboard(scope);
      expect(sb.buildable).toBe(true);
      expect(sb.blockedReason).toBeNull();
    }
  });

  it("is scope-keyed, not offer-keyed (shared across leads)", () => {
    const sb = buildTrustVideoStoryboard("cta-conversion");
    expect(sb.offerId).toBe("trust:cta-conversion");
    expect(sb.company).toBe("Artifex Labs");
  });

  it("roles: first is context, last is handoff, middle are observed", () => {
    const sb = buildTrustVideoStoryboard("accessibility");
    expect(sb.scenes[0].role).toBe("context");
    expect(sb.scenes[sb.scenes.length - 1].role).toBe("handoff");
    for (const mid of sb.scenes.slice(1, -1)) expect(mid.role).toBe("observed");
  });
});

describe("deterministic — same scope ⇒ identical storyboard", () => {
  for (const scope of SCOPES) {
    it(`${scope}: two builds are deeply equal`, () => {
      expect(buildTrustVideoStoryboard(scope)).toEqual(buildTrustVideoStoryboard(scope));
    });
  }

  it("different scopes produce different scripts (no accidental collapse)", () => {
    const a = buildTrustVideoStoryboard("seo-metadata").narrationScript;
    const b = buildTrustVideoStoryboard("mobile-responsive").narrationScript;
    expect(a).not.toBe(b);
  });
});

describe("trustNarrationRevision — stable, prefixed, scope-sensitive", () => {
  it("is a stable 'trust1_' + 16 hex chars", () => {
    const rev = trustNarrationRevision("seo-metadata");
    expect(rev).toMatch(/^trust1_[0-9a-f]{16}$/);
  });

  it("is deterministic across calls for the same scope", () => {
    expect(trustNarrationRevision("cta-conversion")).toBe(trustNarrationRevision("cta-conversion"));
  });

  it("differs between scopes with different scripts", () => {
    expect(trustNarrationRevision("seo-metadata")).not.toBe(trustNarrationRevision("mobile-responsive"));
  });
});
