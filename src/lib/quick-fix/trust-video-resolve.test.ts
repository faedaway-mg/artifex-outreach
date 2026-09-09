// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY-AWARE TRUST VIDEO RESOLUTION — generation coherence. The resolver ties an
// offer's scope + the lead's journey voice + the incrementally-built Matt trust library
// together and must NEVER mix generations:
//   • Lucas journey → the preserved legacy Lucas asset. NEVER a Matt asset. No ElevenLabs.
//   • Matt journey WITH a Matt asset → reuse the served Matt URL. No generation.
//   • Matt journey WITHOUT a Matt asset → prepare-matt: script-only, assetUrl NULL —
//     NEVER a Lucas fallback — and mattTrustMissing=true (Breakbot blocks).
//
// These tests are pure store reads: the in-memory Settings store is reset each test and
// the Matt library is seeded directly. The journey voice is driven by passing an explicit
// leadVoiceKey so no ElevenLabs, no render, and no send is ever touched.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach } from "vitest";
import { __resetStoreForTests } from "../store";
import { resolveJourneyTrustVideo } from "./trust-video-resolve";
import { setMattTrustVideo, mattTrustServedPaths, type MattTrustVideoRecord } from "../voice/matt-trust-store";
import { DEFAULT_VOICE_KEY, LEGACY_LUCAS_VOICE_KEY } from "../voice/registry";
import { scopeForOffer, TRUST_VIDEO_ASSETS, type TrustVideoScope } from "./trust-videos";

// A CTA offer → scope "cta-conversion"; a SEO offer → "seo-metadata".
const CTA_OFFER = { capabilityKeys: ["cta-repair"], leadId: "lead_cta" };
const SEO_OFFER = { capabilityKeys: ["metadata-seo-cleanup"], leadId: "lead_seo" };

beforeEach(() => {
  __resetStoreForTests();
});

function seedMatt(scope: TrustVideoScope, over: Partial<MattTrustVideoRecord> = {}): Promise<void> {
  const served = mattTrustServedPaths(scope);
  return setMattTrustVideo(
    {
      scope,
      voiceoverId: `vo_${scope}`,
      narrationRevision: "trust1_seed",
      scriptVersion: "qf-trust-v1-2026-09",
      mp4Key: `content-studio/test/upload/matt-trust-render/${scope}_seed.mp4`,
      posterKey: `content-studio/test/upload/matt-trust-render/${scope}_seed.jpg`,
      captionsKey: `content-studio/test/upload/matt-trust-render/${scope}_seed.vtt`,
      mp4Url: served.mp4Url,
      posterUrl: served.posterUrl,
      captionsUrl: served.captionsUrl,
      captionsVerified: true,
      durationSeconds: 71.4,
      createdAt: "2026-09-09T00:00:00.000Z",
      updatedAt: "2026-09-09T00:00:00.000Z",
      ...over,
    },
    "test",
  );
}

// The legacy Lucas served URL for a scope — the on-disk asset the resolver must return
// (and only ever return) for a legacy journey.
function legacyUrlFor(scope: TrustVideoScope): string {
  return TRUST_VIDEO_ASSETS[scope].assetUrl!;
}

describe("Lucas journey → use-legacy-lucas (never Matt, no ElevenLabs)", () => {
  it("returns the preserved legacy Lucas asset URL", async () => {
    const r = await resolveJourneyTrustVideo(CTA_OFFER, LEGACY_LUCAS_VOICE_KEY);
    expect(r.outcome).toBe("use-legacy-lucas");
    expect(r.generation).toBe("legacy-lucas");
    expect(r.assetUrl).toBe(legacyUrlFor("cta-conversion"));
    expect(r.mattTrustMissing).toBe(false);
  });

  it("uses the legacy Lucas asset EVEN IF a Matt asset happens to exist for the scope (no mixing)", async () => {
    await seedMatt("cta-conversion");
    const r = await resolveJourneyTrustVideo(CTA_OFFER, LEGACY_LUCAS_VOICE_KEY);
    expect(r.outcome).toBe("use-legacy-lucas");
    expect(r.assetUrl).toBe(legacyUrlFor("cta-conversion"));
    // The Matt served URL must NOT leak into a Lucas journey.
    expect(r.assetUrl).not.toBe(mattTrustServedPaths("cta-conversion").mp4Url);
  });

  it("carries the trust script and the scope regardless of asset", async () => {
    const r = await resolveJourneyTrustVideo(SEO_OFFER, LEGACY_LUCAS_VOICE_KEY);
    expect(r.scope).toBe("seo-metadata");
    expect(r.script.length).toBeGreaterThan(0);
    expect(r.mattTrustMissing).toBe(false);
  });
});

describe("Matt journey WITH a Matt asset → reuse-matt (served URL, no generation)", () => {
  it("returns the served Matt URL, not a Lucas URL", async () => {
    await seedMatt("cta-conversion");
    const r = await resolveJourneyTrustVideo(CTA_OFFER, DEFAULT_VOICE_KEY);
    expect(r.outcome).toBe("reuse-matt");
    expect(r.generation).toBe("current-matt");
    expect(r.assetUrl).toBe(mattTrustServedPaths("cta-conversion").mp4Url);
    expect(r.assetUrl).not.toBe(legacyUrlFor("cta-conversion"));
    expect(r.mattTrustMissing).toBe(false);
  });

  it("exposes the poster; captions only when verified", async () => {
    await seedMatt("seo-metadata", { captionsVerified: true });
    const r = await resolveJourneyTrustVideo(SEO_OFFER, DEFAULT_VOICE_KEY);
    expect(r.posterUrl).toBe(mattTrustServedPaths("seo-metadata").posterUrl);
    expect(r.captionsUrl).toBe(mattTrustServedPaths("seo-metadata").captionsUrl);
    expect(r.captionsVerified).toBe(true);
  });

  it("withholds the caption track when captions are NOT verified", async () => {
    await seedMatt("seo-metadata", { captionsVerified: false });
    const r = await resolveJourneyTrustVideo(SEO_OFFER, DEFAULT_VOICE_KEY);
    expect(r.captionsVerified).toBe(false);
    expect(r.captionsUrl).toBeNull();
  });

  it("an unknown voice key normalizes to Matt and still reuses the Matt asset", async () => {
    await seedMatt("cta-conversion");
    const r = await resolveJourneyTrustVideo(CTA_OFFER, "totally_unknown_voice");
    expect(r.generation).toBe("current-matt");
    expect(r.outcome).toBe("reuse-matt");
    expect(r.assetUrl).toBe(mattTrustServedPaths("cta-conversion").mp4Url);
  });
});

describe("Matt journey WITHOUT a Matt asset → prepare-matt (NEVER Lucas fallback)", () => {
  it("assetUrl is null and mattTrustMissing is true", async () => {
    const r = await resolveJourneyTrustVideo(CTA_OFFER, DEFAULT_VOICE_KEY);
    expect(r.outcome).toBe("prepare-matt");
    expect(r.generation).toBe("current-matt");
    expect(r.assetUrl).toBeNull();
    expect(r.mattTrustMissing).toBe(true);
  });

  it("does NOT fall back to the legacy Lucas URL for the scope", async () => {
    const r = await resolveJourneyTrustVideo(CTA_OFFER, DEFAULT_VOICE_KEY);
    expect(r.assetUrl).not.toBe(legacyUrlFor("cta-conversion"));
    expect(r.posterUrl).toBeNull();
    expect(r.captionsUrl).toBeNull();
  });

  it("a Matt asset for a DIFFERENT scope does not satisfy this scope", async () => {
    await seedMatt("seo-metadata"); // different scope
    const r = await resolveJourneyTrustVideo(CTA_OFFER, DEFAULT_VOICE_KEY);
    expect(r.outcome).toBe("prepare-matt");
    expect(r.mattTrustMissing).toBe(true);
    expect(r.assetUrl).toBeNull();
  });

  it("a Matt record present but WITHOUT an mp4Key still resolves to prepare-matt (blocks)", async () => {
    await seedMatt("cta-conversion", { mp4Key: null });
    const r = await resolveJourneyTrustVideo(CTA_OFFER, DEFAULT_VOICE_KEY);
    expect(r.outcome).toBe("prepare-matt");
    expect(r.assetUrl).toBeNull();
    expect(r.mattTrustMissing).toBe(true);
  });
});

describe("no cross-generation leakage in any case", () => {
  it("Matt served URL never equals the Lucas URL; scope is consistent", async () => {
    await seedMatt("cta-conversion");
    const matt = await resolveJourneyTrustVideo(CTA_OFFER, DEFAULT_VOICE_KEY);
    const lucas = await resolveJourneyTrustVideo(CTA_OFFER, LEGACY_LUCAS_VOICE_KEY);
    expect(matt.scope).toBe(scopeForOffer(CTA_OFFER));
    expect(lucas.scope).toBe(scopeForOffer(CTA_OFFER));
    expect(matt.assetUrl).not.toBe(lucas.assetUrl);
    expect(matt.generation).toBe("current-matt");
    expect(lucas.generation).toBe("legacy-lucas");
  });
});
