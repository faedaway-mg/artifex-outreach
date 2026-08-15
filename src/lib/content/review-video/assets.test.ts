// ─────────────────────────────────────────────────────────────────────────────
// Evidence-asset association (M1.1) — real surfaces are preferred over abstract scenes, focal regions
// clamp safely, coverage is measured, and a capture can NEVER cross leads or attach to the wrong
// finding. No screenshot is fabricated: absence yields no surface (→ honest fallback in the renderer).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { selectSceneSurface, sceneHasSurface, businessSurfaceCoverage, clampFocal, focalCenter, type EvidenceAsset } from "./assets";
import { buildReviewVideoPlan } from "./plan";
import type { QuickReview } from "../../outreach/quick-review";
import type { ReviewFinding, StartingPoint } from "../../outreach/review-evidence";
import type { FindingPresentation, VisualHook } from "../../outreach/review-hooks";

const hook = (over: Partial<VisualHook>): VisualHook => ({ type: "TEXT_ONLY", primaryValue: null, supportingLabel: null, screenshotRef: null, evidenceExcerpt: null, comparison: null, structure: null, ...over });
const f = (id: string, topic: ReviewFinding["topic"], observation: string): ReviewFinding => ({ id, category: "Customer Acquisition", topic, title: `T ${id}`, observation, evidence: { confidence: "Observed", sourceType: "website", sourceUrl: "https://x.com", displayLabel: "x.com · S", basis: ["b"], observedAt: null, screenshotRef: null }, whyItMatters: "w", whatWedDo: "Audit it.", score: 1 });
const pres = (findingId: string, textHook: string, visualHook: VisualHook): FindingPresentation => ({ findingId, textHook, title: "T", visualHook });
const start: StartingPoint = { sourceFindingId: "f1", label: "Mobile conversion pass", intervention: "Rework mobile.", why: "why.", proofReference: "x.com · Mobile experience" };
const review: QuickReview = {
  businessName: "Urban Americana", industryLabel: "V", location: "L", website: "x.com", brand: null,
  findings: [f("f1", "mobile", "On mobile the primary action is off-screen."), f("f2", "catalog", "The storefront exposes 19 collections with no filtering.")],
  presentations: [pres("f1", "mobile hook", hook({ type: "TEXT_ONLY" })), pres("f2", "19 ways in.", hook({ type: "STRUCTURE", primaryValue: "19" }))],
  openingHook: "19 ways in.", start, status: "SENDABLE", observations: [], whyItMatters: "", recommendations: [], ready: true,
};
const plan = buildReviewVideoPlan(review, { reviewId: "rv1", leadId: "lead_A" });

const A = (over: Partial<EvidenceAsset>): EvidenceAsset => ({ assetId: "a", reviewId: "rv1", businessId: "lead_A", findingId: null, type: "desktop-capture", sourceUrl: "https://x.com", localPath: "/tmp/s.png", dimensions: { width: 1000, height: 2000 }, focalRegion: null, rightsState: "PRIVATE_ONLY", provenance: "cap", ...over });

describe("surface selection — real evidence preferred, correctly associated", () => {
  const desktop = A({ assetId: "d", type: "desktop-capture", findingId: null });
  const catalog = A({ assetId: "c", type: "desktop-capture", findingId: "f2", focalRegion: { x: 0, y: 0.28, width: 1, height: 0.55 } });
  const mobile = A({ assetId: "m", type: "mobile-capture", findingId: "f1" });
  const assets = [desktop, catalog, mobile];

  it("the opening (site) scene uses the desktop capture", () => {
    expect(selectSceneSurface(plan.scenes[0], null, "lead_A", assets)?.type).toBe("desktop-capture");
  });
  it("the mobile finding scene uses the mobile capture (its own finding asset)", () => {
    const s = plan.scenes.find((sc) => sc.id === "finding-01")!;
    expect(selectSceneSurface(s, "f1", "lead_A", assets)?.assetId).toBe("m");
  });
  it("the catalog finding scene uses the finding-matched desktop capture with its focal region", () => {
    const s = plan.scenes.find((sc) => sc.id === "finding-02")!;
    const sel = selectSceneSurface(s, "f2", "lead_A", assets)!;
    expect(sel.assetId).toBe("c");
    expect(sel.focalRegion?.y).toBeCloseTo(0.28);
  });
  it("a CLOSE scene has no surface (Artifex-only), and returns null cleanly", () => {
    const s = plan.scenes.find((sc) => sc.type === "CLOSE")!;
    expect(selectSceneSurface(s, null, "lead_A", assets)).toBeNull();
  });
  it("NEVER returns an asset from another business (cross-lead guard)", () => {
    const foreign = [A({ assetId: "x", businessId: "lead_B", type: "mobile-capture", findingId: "f1" })];
    const s = plan.scenes.find((sc) => sc.id === "finding-01")!;
    expect(selectSceneSurface(s, "f1", "lead_A", foreign)).toBeNull();
  });
  it("no assets → no surface anywhere (honest fallback, never fabricated)", () => {
    for (const s of plan.scenes) expect(sceneHasSurface(s, null, "lead_A", [])).toBe(false);
  });
});

describe("focal math", () => {
  it("clamps out-of-range regions into the frame with a non-degenerate box", () => {
    const c = clampFocal({ x: -0.5, y: 1.5, width: 2, height: 0 });
    expect(c.x).toBeGreaterThanOrEqual(0); expect(c.y).toBeLessThanOrEqual(1);
    expect(c.width).toBeLessThanOrEqual(1); expect(c.height).toBeGreaterThanOrEqual(0.05);
  });
  it("null focal → whole surface centered", () => {
    expect(clampFocal(null)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(focalCenter(null)).toEqual({ cx: 0.5, cy: 0.5 });
  });
});

describe("business-surface coverage metric", () => {
  it("counts runtime backed by real surfaces vs Artifex-only", () => {
    const assets = [A({ assetId: "d", type: "desktop-capture" }), A({ assetId: "m", type: "mobile-capture", findingId: "f1" })];
    const durs = plan.scenes.map(() => 5);
    const cov = businessSurfaceCoverage(plan, durs, assets);
    expect(cov.totalSeconds).toBe(plan.scenes.length * 5);
    expect(cov.businessSeconds).toBeGreaterThan(0);
    expect(cov.fraction).toBeGreaterThan(0);
    expect(cov.fraction).toBeLessThanOrEqual(1);
    // With no assets, coverage is zero (honest).
    expect(businessSurfaceCoverage(plan, durs, []).fraction).toBe(0);
  });
});
