import { describe, it, expect, vi, beforeEach } from "vitest";
import { PV_NARRATION_VERSION, PV_RENDER_VERSION, PERSONALIZED_VIDEO_VERSION, type PersonalizedDiagnosticVideoRecord } from "./personalized-video";

// ── Escaped defect: a genuinely-READY personalized diagnostic video never reached the
//    customer (1) the offer page called buildEvidencePackage WITHOUT the record and it was
//    never fetched, and (2) the serve gate required the raw share token though the URL is
//    offerId-keyed, so every customer view 404'd. Both are guarded here. ─────────────────

function readyRecord(over: Partial<PersonalizedDiagnosticVideoRecord> = {}): PersonalizedDiagnosticVideoRecord {
  return {
    offerId: "qfo_x", offerVersion: "v1", leadId: "lead_x", company: "Acme", website: null,
    evidenceVersion: "EVX", narrationVersion: PV_NARRATION_VERSION, renderVersion: PV_RENDER_VERSION,
    personalizedVideoVersion: PERSONALIZED_VIDEO_VERSION, status: "READY",
    voiceoverId: null, voiceoverRevision: null, voiceGeneration: null,
    sourceEvidenceDigest: "EVX", narrationDigest: "n", renderedAssetDigest: "d",
    mp4Key: "k.mp4", posterKey: "k.jpg", captionsKey: "k.vtt",
    mp4Url: "/api/quick-fix/qfo_x/personalized-video", posterUrl: "/api/quick-fix/qfo_x/personalized-video/poster",
    captionsUrl: "/api/quick-fix/qfo_x/personalized-video/captions", durationSeconds: 30,
    captionVersion: "c", captionsVerified: true, idempotencyKey: "idem",
    queuedAt: "t", generatedAt: "t", verifiedAt: "t", failureReason: null, ...over,
  };
}

describe("evidence-package fetches the personalized-video record when the caller omits it", () => {
  beforeEach(() => vi.resetModules());
  it("a READY persisted record surfaces on the offer page even when opts.personalizedVideo is omitted", async () => {
    vi.doMock("./store", () => ({ getPersonalizedVideo: vi.fn(async () => readyRecord()) }));
    vi.doMock("../repo", () => ({ getLead: async () => null, getBusinessIntelligence: async () => ({ profile: { businessProfile: { opportunities: [{ id: "f1", category: "conversion", observation: "obs", whyItMatters: "why", confidence: { label: "Observed", score: 0.9 }, estimatedImpact: { level: "Meaningful" }, basis: [] }] } } }) }));
    vi.doMock("../content-studio/screenshot-jobs", () => ({ latestReadyShot: async () => null }));
    vi.doMock("./evidence-truth", () => ({ evidenceVersion: () => "EVX" }));
    const { buildEvidencePackage } = await import("./evidence-package");
    const offer = { offerId: "qfo_x", offerVersion: "v1", leadId: "lead_x", companyName: "Acme", findingIds: ["f1"], confidence: 0.9, evidenceGrade: "OBSERVED", generatedAt: "t" } as any;
    const pkg = await buildEvidencePackage(offer); // no opts → must fetch the record
    expect(pkg.personalizedVideo.status).toBe("READY");
    expect(pkg.personalizedVideo.url).toBe("/api/quick-fix/qfo_x/personalized-video");
  });
});

describe("personalized-video serve gate — offerId capability (mirrors the public offer page)", () => {
  beforeEach(() => vi.resetModules());

  async function resolve(opts: { operator: boolean }, storeMock: any, evVersion = "EVX") {
    vi.doMock("./store", () => storeMock);
    vi.doMock("./evidence-package", () => ({ buildEvidencePackage: async () => ({}) }));
    vi.doMock("./evidence-truth", () => ({ evidenceVersion: () => evVersion }));
    const { resolvePersonalizedVideoForServe } = await import("./personalized-video-serve");
    return resolvePersonalizedVideoForServe("qfo_x", opts);
  }

  it("serves a READY record for an APPROVED offer reached by its unguessable offerId (the fix)", async () => {
    const res = await resolve({ operator: false }, {
      getOfferByShareToken: async () => null,
      getOffer: async () => ({ offerId: "qfo_x", offerVersion: "v1", approvalStatus: "approved" }),
      getPersonalizedVideo: async () => readyRecord(),
    });
    expect(res.ok).toBe(true);
    expect(res.status).toBe("READY");
  });

  it("still 404s an UNAPPROVED offer to the public", async () => {
    const res = await resolve({ operator: false }, {
      getOfferByShareToken: async () => null,
      getOffer: async () => ({ offerId: "qfo_x", offerVersion: "v1", approvalStatus: "draft" }),
      getPersonalizedVideo: async () => readyRecord(),
    });
    expect(res.ok).toBe(false);
    expect(res.httpStatus).toBe(404);
  });

  it("still 404s when the share token is REVOKED", async () => {
    const res = await resolve({ operator: false }, {
      getOfferByShareToken: async () => ({ offerId: "qfo_x", offerVersion: "v1", approvalStatus: "approved", shareRevoked: true }),
      getOffer: async () => ({ offerId: "qfo_x", offerVersion: "v1", approvalStatus: "approved" }),
      getPersonalizedVideo: async () => readyRecord(),
    });
    expect(res.ok).toBe(false);
    expect(res.httpStatus).toBe(404);
  });

  it("409s a STALE record (evidence drifted) — never serves a non-current render", async () => {
    const res = await resolve({ operator: false }, {
      getOfferByShareToken: async () => null,
      getOffer: async () => ({ offerId: "qfo_x", offerVersion: "v1", approvalStatus: "approved" }),
      getPersonalizedVideo: async () => readyRecord({ evidenceVersion: "OLD" }),
    }, "EVX");
    expect(res.ok).toBe(false);
    expect(res.httpStatus).toBe(409);
    expect(res.status).toBe("STALE");
  });
});
