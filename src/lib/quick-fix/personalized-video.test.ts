import { describe, it, expect } from "vitest";
import type { QuickFixOffer } from "./types";
import type { EvidencePackage, EvidenceFinding, EvidenceScreenshot } from "./evidence-package";
import { experienceFrameForOffer } from "./experience-frame";
import {
  buildVideoStoryboard,
  personalizedVideoReadiness,
  personalizedVideoAssetRef,
  personalizedVideoIdempotencyKey,
  sourceEvidenceDigestFor,
  narrationDigestFor,
  assessNarrationTruth,
  lineClaimsAttemptedUse,
  PV_NARRATION_VERSION,
  PV_RENDER_VERSION,
  type PersonalizedDiagnosticVideoRecord,
} from "./personalized-video";

// ── Fixtures ─────────────────────────────────────────────────────────────────
function screenshot(over: Partial<EvidenceScreenshot> = {}): EvidenceScreenshot {
  return {
    id: "lead1:desktop",
    imageRoute: "/api/content-studio/screenshot-image?business=lead1&viewport=desktop",
    publicUrl: null,
    viewport: "desktop",
    pageLabel: "Your homepage on a computer",
    sourceUrl: "https://example.com",
    capturedAt: "2026-09-01T00:00:00.000Z",
    sha256: "abc123",
    status: "READY",
    ...over,
  };
}

function finding(over: Partial<EvidenceFinding> = {}): EvidenceFinding {
  return {
    id: "f1",
    observation: "While reviewing your site, we noticed there was no way to book online.",
    plain: "There's no way to book an appointment from your website.",
    whyItMatters: "Visitors ready to book have nowhere to go.",
    confidenceLabel: "Directly observed",
    confidenceScore: 0.9,
    screenshotId: "lead1:desktop",
    ...over,
  };
}

function pkg(over: Partial<EvidencePackage> = {}): EvidencePackage {
  return {
    offerId: "qfo_v1",
    leadId: "lead1",
    company: "Robert Hall & Associates",
    websiteUrl: "https://example.com",
    screenshots: [screenshot()],
    screenshotStatus: "READY",
    findings: [finding()],
    personalizedVideo: { status: "MISSING", url: null, detail: "" },
    diagnosticPdf: { status: "READY", url: "/pdf", detail: "" },
    evergreenVideo: { status: "READY", url: "/evergreen.mp4", detail: "" },
    confidence: 0.9,
    evidenceGrade: "A",
    generatedAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

// A booking offer → attempted-use supported. A readability offer → observational only.
function offer(over: Partial<QuickFixOffer> = {}): QuickFixOffer {
  return {
    offerId: "qfo_v1",
    leadId: "lead1",
    companyName: "Robert Hall & Associates",
    capabilityKeys: ["booking-fix"],
    priceCents: 24900,
    findingIds: ["f1"],
    scope: {
      offerName: "Online Booking Fix",
      problemBeingSolved: "There is no way to book an appointment online.",
      proposedSolution: "add a clear booking path and confirm it works",
      includedItems: ["A booking button", "A confirmation step"],
      excludedItems: [],
      customerInputsRequired: [],
      deliveryWindow: "Delivered within 48 hours of receiving access",
      revisionPolicy: "One round of revisions included",
    },
    evidenceGrade: "A",
    confidence: 0.9,
    offerVersion: "v1",
    state: "DRAFT",
    band: "A",
    quickFixEligible: true,
    generatedAt: "2026-09-01T00:00:00.000Z",
    ...over,
  } as unknown as QuickFixOffer;
}

function record(over: Partial<PersonalizedDiagnosticVideoRecord> = {}): PersonalizedDiagnosticVideoRecord {
  return {
    offerId: "qfo_v1",
    offerVersion: "v1",
    leadId: "lead1",
    company: "Robert Hall & Associates",
    website: "https://example.com",
    evidenceVersion: "ev1_current",
    narrationVersion: PV_NARRATION_VERSION,
    renderVersion: PV_RENDER_VERSION,
    personalizedVideoVersion: "pvid.v1",
    status: "READY",
    voiceoverId: "vo_x",
    voiceoverRevision: "nar1_abc",
    voiceGeneration: "current-matt",
    sourceEvidenceDigest: "ev1_current",
    narrationDigest: "nar1_abc",
    renderedAssetDigest: "sha_xyz",
    mp4Key: "content-studio/test/upload/pv-render/qfo_v1_pv_deadbeef.mp4",
    posterKey: "content-studio/test/upload/pv-render/qfo_v1_pv_deadbeef.jpg",
    captionsKey: "content-studio/test/upload/pv-render/qfo_v1_pv_deadbeef.vtt",
    mp4Url: "/api/quick-fix/qfo_v1/personalized-video",
    posterUrl: "/api/quick-fix/qfo_v1/personalized-video/poster",
    captionsUrl: null,
    durationSeconds: 58,
    captionVersion: null,
    captionsVerified: false,
    idempotencyKey: "personalized-video:qfo_v1:v1:ev1_current:pv-narr.v1:pv-render.v1",
    queuedAt: "2026-09-01T00:00:00.000Z",
    generatedAt: "2026-09-01T00:05:00.000Z",
    verifiedAt: "2026-09-01T00:06:00.000Z",
    failureReason: null,
    ...over,
  };
}

// ── Storyboard ────────────────────────────────────────────────────────────────
describe("buildVideoStoryboard", () => {
  it("derives an attempted-use opener for a booking offer and stays honest", () => {
    const o = offer();
    const frame = experienceFrameForOffer(o);
    expect(frame.attemptSupported).toBe(true);
    const sb = buildVideoStoryboard(pkg(), frame, o);
    expect(sb.buildable).toBe(true);
    expect(sb.scenes[0].role).toBe("context");
    expect(sb.scenes[0].narration.toLowerCase()).toContain("we tried to book online");
    expect(sb.attemptedUseHonest).toBe(true);
    // shows the REAL screenshot in the evidence scene
    const evScene = sb.scenes.find((s) => s.role === "evidence")!;
    expect(evScene.visual.kind).toBe("screenshot");
    expect(evScene.visual.screenshotId).toBe("lead1:desktop");
  });

  it("uses an observational opener (no 'tried to') for a non-action defect", () => {
    const o = offer({
      capabilityKeys: ["readability-fix"],
      scope: {
        offerName: "Readability Fix",
        problemBeingSolved: "Some of the text on your website is hard to read.",
        proposedSolution: "increase the text contrast and size",
        includedItems: ["Legible text"],
        excludedItems: [],
        customerInputsRequired: [],
        deliveryWindow: "48 hours",
        revisionPolicy: "one round",
      },
    } as any);
    const frame = experienceFrameForOffer(o);
    expect(frame.attemptSupported).toBe(false);
    const sb = buildVideoStoryboard(pkg({ findings: [finding({ plain: "Some text is hard to read." })] }), frame, o);
    expect(lineClaimsAttemptedUse(sb.narrationScript)).toBe(false);
    expect(sb.attemptedUseHonest).toBe(true);
  });

  it("is NOT buildable when there are no evidence-backed findings", () => {
    const o = offer();
    const frame = experienceFrameForOffer(o);
    const sb = buildVideoStoryboard(pkg({ findings: [] }), frame, o);
    expect(sb.buildable).toBe(false);
    expect(sb.blockedReason).toMatch(/no evidence/i);
    expect(sb.scenes).toHaveLength(0);
  });

  it("falls back to an honest 'reviewed your live pages' line when no screenshot is READY", () => {
    const o = offer();
    const frame = experienceFrameForOffer(o);
    const sb = buildVideoStoryboard(
      pkg({ screenshots: [screenshot({ status: "MISSING" })], screenshotStatus: "MISSING" }),
      frame,
      o,
    );
    const evScene = sb.scenes.find((s) => s.role === "evidence")!;
    expect(evScene.visual.kind).toBe("kinetic-text");
    expect(evScene.visual.screenshotId).toBeNull();
  });

  it("marks the repair-concept scene illustrative (never observed evidence)", () => {
    const sb = buildVideoStoryboard(pkg(), experienceFrameForOffer(offer()), offer());
    const repair = sb.scenes.find((s) => s.role === "repair")!;
    expect(repair.visual.kind).toBe("repair-concept");
    expect(repair.visual.illustrative).toBe(true);
  });

  it("targets a short walkthrough (~45–90s)", () => {
    const sb = buildVideoStoryboard(pkg(), experienceFrameForOffer(offer()), offer());
    expect(sb.estimatedSeconds).toBeGreaterThan(10);
    expect(sb.estimatedSeconds).toBeLessThan(120);
  });
});

// ── Readiness / staleness ──────────────────────────────────────────────────────
describe("personalizedVideoReadiness", () => {
  const current = {
    offerVersion: "v1",
    evidenceVersion: "ev1_current",
    narrationVersion: PV_NARRATION_VERSION,
    renderVersion: PV_RENDER_VERSION,
  };

  it("NOT_GENERATED when there is no record", () => {
    expect(personalizedVideoReadiness(null, current)).toBe("NOT_GENERATED");
    expect(personalizedVideoReadiness(undefined, current)).toBe("NOT_GENERATED");
  });

  it("READY only when bound to current versions AND playable", () => {
    expect(personalizedVideoReadiness(record(), current)).toBe("READY");
  });

  it("STALE when the evidence version drifted", () => {
    expect(personalizedVideoReadiness(record({ evidenceVersion: "ev1_OLD" }), current)).toBe("STALE");
  });

  it("STALE when the narration or render version drifted", () => {
    expect(personalizedVideoReadiness(record({ narrationVersion: "pv-narr.v0" }), current)).toBe("STALE");
    expect(personalizedVideoReadiness(record({ renderVersion: "pv-render.v0" }), current)).toBe("STALE");
  });

  it("STALE when the asset is not playable (missing mp4/poster/duration)", () => {
    expect(personalizedVideoReadiness(record({ mp4Url: null }), current)).toBe("STALE");
    expect(personalizedVideoReadiness(record({ posterUrl: null }), current)).toBe("STALE");
    expect(personalizedVideoReadiness(record({ durationSeconds: 0 }), current)).toBe("STALE");
  });

  it("STALE when the render is local-only (no durable mp4Key)", () => {
    // A render that produced a public/ file but was never persisted to the object store
    // is NOT production-serveable — it degrades to STALE even though it looks playable.
    expect(personalizedVideoReadiness(record({ mp4Key: null }), current)).toBe("STALE");
  });

  it("READY ignores voiceover binding unless the current inputs require a revision", () => {
    expect(personalizedVideoReadiness(record({ voiceoverRevision: "nar1_abc" }), current)).toBe("READY");
  });

  it("STALE when a required voiceover revision does not match the render's", () => {
    const withVo = { ...current, voiceoverRevision: "nar1_NEW" };
    expect(personalizedVideoReadiness(record({ voiceoverRevision: "nar1_OLD" }), withVo)).toBe("STALE");
    // matching revision → READY
    expect(personalizedVideoReadiness(record({ voiceoverRevision: "nar1_NEW" }), withVo)).toBe("READY");
  });

  it("passes through in-flight and terminal states", () => {
    expect(personalizedVideoReadiness(record({ status: "QUEUED" }), current)).toBe("QUEUED");
    expect(personalizedVideoReadiness(record({ status: "RENDERING" }), current)).toBe("RENDERING");
    expect(personalizedVideoReadiness(record({ status: "FAILED" }), current)).toBe("FAILED");
    expect(personalizedVideoReadiness(record({ status: "BLOCKED" }), current)).toBe("BLOCKED");
  });
});

// ── Asset ref mapping (what evidence-package exposes) ───────────────────────────
describe("personalizedVideoAssetRef", () => {
  const current = {
    offerVersion: "v1",
    evidenceVersion: "ev1_current",
    narrationVersion: PV_NARRATION_VERSION,
    renderVersion: PV_RENDER_VERSION,
  };

  it("READY record → READY ref carrying the mp4 url", () => {
    const ref = personalizedVideoAssetRef(record(), current);
    expect(ref.status).toBe("READY");
    expect(ref.url).toBe("/api/quick-fix/qfo_v1/personalized-video");
  });

  it("no record → MISSING ref with null url", () => {
    const ref = personalizedVideoAssetRef(null, current);
    expect(ref.status).toBe("MISSING");
    expect(ref.url).toBeNull();
  });

  it("drifted record → STALE ref with null url (never silently READY)", () => {
    const ref = personalizedVideoAssetRef(record({ evidenceVersion: "ev1_OLD" }), current);
    expect(ref.status).toBe("STALE");
    expect(ref.url).toBeNull();
  });
});

// ── Idempotency + digests ──────────────────────────────────────────────────────
describe("idempotency + digests", () => {
  it("identical inputs → identical idempotency key", () => {
    const args = {
      offerId: "qfo_v1",
      offerVersion: "v1",
      evidenceDigest: "ev1_x",
      narrationVersion: PV_NARRATION_VERSION,
      renderVersion: PV_RENDER_VERSION,
    };
    expect(personalizedVideoIdempotencyKey(args)).toBe(personalizedVideoIdempotencyKey({ ...args }));
  });

  it("a changed evidence digest → a different key", () => {
    const base = {
      offerId: "qfo_v1",
      offerVersion: "v1",
      evidenceDigest: "ev1_x",
      narrationVersion: PV_NARRATION_VERSION,
      renderVersion: PV_RENDER_VERSION,
    };
    expect(personalizedVideoIdempotencyKey(base)).not.toBe(
      personalizedVideoIdempotencyKey({ ...base, evidenceDigest: "ev1_y" }),
    );
  });

  it("evidence digest matches evidence-truth's version for the same package", () => {
    expect(sourceEvidenceDigestFor(pkg())).toMatch(/^ev1_/);
  });

  it("narration digest is stable for the same storyboard", () => {
    const sb = buildVideoStoryboard(pkg(), experienceFrameForOffer(offer()), offer());
    expect(narrationDigestFor(sb)).toBe(narrationDigestFor(sb));
    expect(narrationDigestFor(sb)).toMatch(/^nar1_/);
  });
});

// ── Attempted-use truth check (Breakbot Part E) ─────────────────────────────────
describe("assessNarrationTruth", () => {
  it("passes an observational script", () => {
    const r = assessNarrationTruth("We took a close look at your website and some text was hard to read.", offer({ capabilityKeys: ["readability-fix"], scope: { ...offer().scope, problemBeingSolved: "Some text is hard to read." } } as any));
    expect(r.ok).toBe(true);
  });

  it("passes an attempted-use script when the evidence supports it (booking)", () => {
    const r = assessNarrationTruth("We tried to book online and couldn't find a way.", offer());
    expect(r.ok).toBe(true);
  });

  it("BLOCKS an attempted-use claim the evidence does not support", () => {
    // readability offer → attemptSupported false → a 'we tried to' claim is dishonest
    const readabilityOffer = offer({
      capabilityKeys: ["readability-fix"],
      scope: { ...offer().scope, problemBeingSolved: "Some of the text is hard to read.", proposedSolution: "increase contrast" },
    } as any);
    const r = assessNarrationTruth("We tried to book online and it failed.", readabilityOffer);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/attempted action/i);
  });
});
