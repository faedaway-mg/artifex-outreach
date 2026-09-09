// Breakbot FULL PRESENTATION READINESS — the whole live customer experience end-to-end.
// These exercise the caller-gated `presentation` check group added for launch readiness:
// durable render, served-URL resolves, playable, trust resolves + generation-coherent,
// and no raw-storage/secret/filesystem leak into any customer asset URL. The checks run
// ONLY when `presentation` is supplied, so the baseline (no presentation) must be unchanged.
import { describe, it, expect } from "vitest";
import { runBreakbotPreflight, type BreakbotPreflightInput } from "./quickcash-preflight";
import { goldenOffer, baseInput, coherentMattVoice } from "./quickcash-fixtures";

type Presentation = NonNullable<BreakbotPreflightInput["presentation"]>;

function readyPresentation(over: Partial<Presentation> = {}): Presentation {
  return {
    personalizedVideo: {
      status: "READY",
      mp4Key: "content-studio/production/upload/pv-render/qfo_1_pv_abc123.mp4",
      mp4Url: "/api/quick-fix/qfo_1/personalized-video",
      posterKey: "content-studio/production/upload/pv-render/qfo_1_pv_abc123.jpg",
      durationSeconds: 24,
      voiceGeneration: "current-matt",
      servedUrlResolves: true,
    },
    trust: {
      outcome: "reuse-matt",
      generation: "current-matt",
      assetUrl: "/api/quick-fix/trust-video/cta-conversion",
      mattTrustMissing: false,
    },
    customerAssetUrls: [
      "/api/quick-fix/qfo_1/personalized-video",
      "/api/quick-fix/trust-video/cta-conversion",
      "/api/quick-fix/qfo_1/diagnostic-pdf",
    ],
    ...over,
  };
}

function withPresentation(p: Presentation): BreakbotPreflightInput {
  const offer = goldenOffer();
  const input = baseInput(offer);
  return { ...input, voiceCoherence: coherentMattVoice(input), presentation: p };
}

const surfaces = (v: ReturnType<typeof runBreakbotPreflight>) => v.issues.map((i) => i.surface);

describe("Breakbot presentation readiness", () => {
  it("a fully durable, served, coherent experience is READY", () => {
    const v = runBreakbotPreflight(withPresentation(readyPresentation()));
    expect(v.overall).toBe("READY");
    expect(v.issues.filter((i) => i.surface.startsWith("presentation."))).toHaveLength(0);
  });

  it("runs NO presentation checks when presentation is absent (no regress)", () => {
    const offer = goldenOffer();
    const input = baseInput(offer);
    const v = runBreakbotPreflight({ ...input, voiceCoherence: coherentMattVoice(input) });
    expect(surfaces(v).some((s) => s.startsWith("presentation."))).toBe(false);
  });

  it("BLOCKS a stale personalized render", () => {
    const v = runBreakbotPreflight(withPresentation(readyPresentation({
      personalizedVideo: { ...readyPresentation().personalizedVideo!, status: "STALE" },
    })));
    expect(v.overall).toBe("BLOCKED");
    expect(surfaces(v)).toContain("presentation.personalizedVideo");
  });

  it("BLOCKS a local-only render (no durable mp4Key)", () => {
    const v = runBreakbotPreflight(withPresentation(readyPresentation({
      personalizedVideo: { ...readyPresentation().personalizedVideo!, mp4Key: null },
    })));
    expect(v.overall).toBe("BLOCKED");
    expect(surfaces(v)).toContain("presentation.renderDurable");
  });

  it("BLOCKS when the served URL does not resolve the current render", () => {
    const v = runBreakbotPreflight(withPresentation(readyPresentation({
      personalizedVideo: { ...readyPresentation().personalizedVideo!, servedUrlResolves: false },
    })));
    expect(v.overall).toBe("BLOCKED");
    expect(surfaces(v)).toContain("presentation.servedResolves");
  });

  it("BLOCKS an unplayable render (no duration)", () => {
    const v = runBreakbotPreflight(withPresentation(readyPresentation({
      personalizedVideo: { ...readyPresentation().personalizedVideo!, durationSeconds: 0 },
    })));
    expect(v.overall).toBe("BLOCKED");
    expect(surfaces(v)).toContain("presentation.playable");
  });

  it("BLOCKS a Matt journey whose Matt trust video is not built yet (never falls back to Lucas)", () => {
    const v = runBreakbotPreflight(withPresentation(readyPresentation({
      trust: { outcome: "prepare-matt", generation: "current-matt", assetUrl: null, mattTrustMissing: true },
    })));
    expect(v.overall).toBe("BLOCKED");
    expect(surfaces(v)).toContain("presentation.trustResolves");
  });

  it("a coherent LEGACY LUCAS journey with a legacy trust asset is READY", () => {
    const v = runBreakbotPreflight(withPresentation(readyPresentation({
      personalizedVideo: { ...readyPresentation().personalizedVideo!, voiceGeneration: "legacy-lucas" },
      trust: { outcome: "use-legacy-lucas", generation: "legacy-lucas", assetUrl: "/trust-videos/cta-conversion-v2.mp4", mattTrustMissing: false },
    })));
    expect(v.issues.filter((i) => i.surface.startsWith("presentation."))).toHaveLength(0);
  });

  it("BLOCKS a mixed-generation experience (Matt video, Lucas trust)", () => {
    const v = runBreakbotPreflight(withPresentation(readyPresentation({
      personalizedVideo: { ...readyPresentation().personalizedVideo!, voiceGeneration: "current-matt" },
      trust: { outcome: "use-legacy-lucas", generation: "legacy-lucas", assetUrl: "/trust-videos/cta-conversion-v2.mp4", mattTrustMissing: false },
    })));
    expect(v.overall).toBe("BLOCKED");
    expect(surfaces(v)).toContain("presentation.trustGenerationMatch");
  });

  it("BLOCKS a raw storage KEY leaked into a customer asset URL", () => {
    const v = runBreakbotPreflight(withPresentation(readyPresentation({
      customerAssetUrls: ["content-studio/production/upload/pv-render/qfo_1_pv_abc123.mp4"],
    })));
    expect(v.overall).toBe("BLOCKED");
    expect(surfaces(v)).toContain("presentation.rawStorageLeak");
  });

  it("BLOCKS a signed cloud storage URL leaked to the customer", () => {
    const v = runBreakbotPreflight(withPresentation(readyPresentation({
      customerAssetUrls: ["https://bucket.s3.amazonaws.com/v.mp4?X-Amz-Signature=deadbeef"],
    })));
    expect(v.overall).toBe("BLOCKED");
    expect(surfaces(v)).toContain("presentation.rawStorageLeak");
  });

  it("BLOCKS the local public/ render path used as a customer URL", () => {
    const v = runBreakbotPreflight(withPresentation(readyPresentation({
      personalizedVideo: { ...readyPresentation().personalizedVideo!, mp4Url: "/personalized-videos/qfo_1/video.mp4" },
    })));
    expect(v.overall).toBe("BLOCKED");
    expect(surfaces(v)).toContain("presentation.rawStorageLeak");
  });

  it("BLOCKS when no trust video resolves at all", () => {
    const v = runBreakbotPreflight(withPresentation(readyPresentation({ trust: null })));
    expect(v.overall).toBe("BLOCKED");
    expect(surfaces(v)).toContain("presentation.trustResolves");
  });
});
