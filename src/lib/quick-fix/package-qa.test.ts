// ─────────────────────────────────────────────────────────────────────────────
// PACKAGE QA + INVENTORY SWEEP (§32–§36). Reuses the evidence-package test harness:
// mock the read-only repo + screenshot store, build a real offer via generateOffer,
// then QA the canonical package. Proves: a complete package PASSes; a screenshot-less
// package is REPAIRING (never a silent PASS); a touch to customer-facing material
// invalidates a prior PASS (§33); and the pre-send re-gate refuses a non-PASS (§36).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLead: { website: string | null } = { website: "https://acme-roofing.example" };
let mockOpportunities: any[] = [];
let mockReadyShots: Record<string, any> = {};

vi.mock("../repo", () => ({
  getLead: vi.fn(async () => mockLead),
  getBusinessIntelligence: vi.fn(async () => ({ profile: { businessProfile: { opportunities: mockOpportunities } } })),
  // matt-trust-store reads settings; return an empty singleton so it resolves to legacy Lucas.
  getSettings: vi.fn(async () => ({})),
}));

vi.mock("../content-studio/screenshot-jobs", () => ({
  latestReadyShot: vi.fn(async (_b: string, viewport: "mobile" | "desktop") => mockReadyShots[viewport] ?? null),
}));

import { generateOffer } from "./offer-engine";
import { runPackageQA, packageInventorySweep, preSendRegate } from "./package-qa";
import type { StoredOffer } from "./store";
import type { QuickFixOffer } from "./types";

const readyShot = (viewport: "mobile" | "desktop") => ({
  id: `csshot_${viewport}`, businessId: "lead_1", pieceId: null,
  requestedUrl: "https://acme-roofing.example/", canonicalUrl: "https://acme-roofing.example/",
  viewport, status: "ready", progress: 100, stage: "done",
  finalUrl: "https://acme-roofing.example/", capturedAt: "2026-09-01T10:00:00Z",
  contentType: "image/png", byteSize: 1234, sha256: `sha-${viewport}`, outputKey: `key/${viewport}.png`,
  provenance: null, error: null, attempt: 1, createdAt: "", updatedAt: "", startedAt: null, finishedAt: "",
});

function stored(offer: QuickFixOffer, over: Partial<StoredOffer> = {}): StoredOffer {
  return {
    ...offer,
    approvalStatus: "approved", approvedBy: "system-reconcile", recipientEmail: null,
    shareToken: "tok_test", shareRevoked: false, createdAt: "", updatedAt: "",
    // Default fixtures carry a PROVEN reality so a materialized package can PASS; individual
    // tests override this to exercise the reality gate.
    problemRealityVerdict: "PROVEN", problemRealityScore: 100,
    ...over,
  } as StoredOffer;
}

const genOffer = () => generateOffer({ leadId: "lead_1", companyName: "Acme Roofing", findings: [
  { id: "cta", category: "Customer Acquisition", observation: "the primary contact form on mobile does not submit", whyItMatters: "a visitor on a phone cannot send an inquiry", confidenceLabel: "Observed", confidenceScore: 0.92, impactLevel: "High", basis: ["link: https://x"] },
], generatedAt: "2026-09-01T00:00:00Z" });

beforeEach(() => {
  mockLead.website = "https://acme-roofing.example";
  mockOpportunities = [{
    id: "cta", category: "Customer Acquisition",
    observation: "the primary contact form on mobile does not submit",
    whyItMatters: "a visitor on a phone cannot send an inquiry",
    confidence: { label: "Observed", score: 0.92 }, basis: ["link: https://x"],
    estimatedImpact: { level: "High" },
  }];
  mockReadyShots = { mobile: readyShot("mobile"), desktop: readyShot("desktop") };
});

describe("runPackageQA over a real canonical package", () => {
  it("PASSes a complete, coherent, approved package with evidence", async () => {
    const offer = genOffer();
    const res = await runPackageQA(offer, { stored: stored(offer) });
    expect(res.verdict).toBe("PASS");
    expect(res.reasons).toEqual([]);
    expect(res.revision).toMatch(/^pkg_/);
  });

  it("is REPAIRING (never a silent PASS) when supporting screenshots are missing", async () => {
    mockReadyShots = {};
    const offer = genOffer();
    const res = await runPackageQA(offer, { stored: stored(offer) });
    // Mobile finding with no mobile screenshot → coherence BLOCK OR completeness gap.
    expect(res.verdict).not.toBe("PASS");
    expect(res.open.length).toBeGreaterThan(0);
  });

  it("invalidates a prior PASS when the package revision changed under it (§33)", async () => {
    const offer = genOffer();
    const res = await runPackageQA(offer, { stored: stored(offer, { qaVerdict: "PASS", qaRevision: "pkg_stale000000000" }) });
    expect(res.wasInvalidatedByTouch).toBe(true);
  });

  it("does not flag touch-invalidation when the recorded revision matches", async () => {
    const offer = genOffer();
    const live = await runPackageQA(offer, { stored: stored(offer) });
    const again = await runPackageQA(offer, { stored: stored(offer, { qaVerdict: "PASS", qaRevision: live.revision }) });
    expect(again.wasInvalidatedByTouch).toBe(false);
  });

  it("FAIL-CLOSED: a materialized package cannot PASS without a PROVEN problem reality (§33/§46)", async () => {
    const offer = genOffer();
    // Reality never assessed → not Ready-to-Send even though the package is complete.
    const res = await runPackageQA(offer, { stored: stored(offer, { problemRealityVerdict: null, problemRealityScore: null }) });
    expect(res.verdict).not.toBe("PASS");
    expect(res.reasons.join(" ")).toMatch(/problem reality/i);
  });

  it("BLOCKS + recommends retire when the problem is NO_MATERIAL_PROBLEM (§1/§33)", async () => {
    const offer = genOffer();
    const res = await runPackageQA(offer, { stored: stored(offer, { problemRealityVerdict: "NO_MATERIAL_PROBLEM", problemRealityScore: 0 }) });
    expect(res.verdict).toBe("BLOCKED");
    expect(res.problemReality).toBe("NO_MATERIAL_PROBLEM");
  });

  it("out-of-market lead cannot PASS and is flagged for retire (§10)", async () => {
    const offer = genOffer();
    // buildCanonicalPackage takes location via opts; runPackageQA passes stored only, so
    // exercise the gate directly through the canonical package location path.
    const { buildCanonicalPackage } = await import("./canonical-package");
    const pkg = await buildCanonicalPackage(offer, { stored: stored(offer), location: { city: "Los Angeles", state: "CA" } });
    expect(pkg.market?.inMarket).toBe(false);
    expect(pkg.readiness).toBe("BLOCKED");
    expect(pkg.nextAction.kind).toBe("retire");
  });
});

describe("packageInventorySweep counts honestly (§39/§50)", () => {
  it("classifies retired offers out of ACTIVE and tallies verdicts", async () => {
    const good = genOffer();
    const sweep = await packageInventorySweep({
      offers: [stored(good), stored(good, { offerId: good.offerId + "_retired", retiredAt: "2026-09-02T00:00:00Z" })],
    });
    expect(sweep.counts.active).toBe(1);
    expect(sweep.counts.retired).toBe(1);
    expect(sweep.counts.pass).toBe(1);
  });
});

describe("preSendRegate refuses a non-PASS revision (§36)", () => {
  it("blocks a package whose evidence is missing", async () => {
    mockReadyShots = {};
    const offer = genOffer();
    const gate = await preSendRegate(offer, stored(offer));
    expect(gate.sendable).toBe(false);
    expect(gate.reasons.length).toBeGreaterThan(0);
  });

  it("allows a complete PASS package", async () => {
    const offer = genOffer();
    const gate = await preSendRegate(offer, stored(offer));
    expect(gate.sendable).toBe(true);
  });
});
