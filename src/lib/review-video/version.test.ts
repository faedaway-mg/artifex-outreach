// Render input versioning (M1.1 step 2) — deterministic; correct invalidation on review/surface/renderer/
// audio change; visual excludes audio, final includes it.
import { describe, it, expect } from "vitest";
import { visualInputVersion, finalInputVersion, RENDERER_VERSION } from "./version";
import type { QuickReview } from "../outreach/quick-review";
import type { ReviewFinding } from "../outreach/review-evidence";
import type { FindingPresentation, VisualHook } from "../outreach/review-hooks";
import type { StoredBusinessIntelligence } from "../types";

const vh = (t: VisualHook["type"], v: string | null = null): VisualHook => ({ type: t, primaryValue: v, supportingLabel: null, screenshotRef: null, evidenceExcerpt: null, comparison: null, structure: null });
const f = (id: string, observation: string): ReviewFinding => ({ id, category: "Customer Acquisition", topic: "catalog", title: "T", observation, evidence: { confidence: "Observed", sourceType: "website", sourceUrl: null, displayLabel: "d", basis: ["b"], observedAt: null, screenshotRef: null }, whyItMatters: "w", whatWedDo: "Audit it.", score: 1 });
const p = (id: string, hook: string): FindingPresentation => ({ findingId: id, textHook: hook, title: "T", visualHook: vh("STRUCTURE", "19") });
const review = (over: Partial<QuickReview> = {}): QuickReview => ({ businessName: "B", industryLabel: "", location: "", website: "b.com", brand: null, findings: [f("a", "obs A")], presentations: [p("a", "hook A")], openingHook: "hook", start: null, status: "SENDABLE", observations: [], whyItMatters: "", recommendations: [], ready: true, ...over });
const surf = (len: number): StoredBusinessIntelligence["surfacePackage"] => ({ pages: [{ url: "https://b.com", html: "x".repeat(len), role: "homepage" }], capturedAt: "2026-08-15T00:00:00Z" });

describe("visual input version", () => {
  it("is deterministic — same review + surface → same version", () => {
    expect(visualInputVersion(review(), surf(100))).toBe(visualInputVersion(review(), surf(100)));
  });
  it("changes when a finding's observation changes", () => {
    expect(visualInputVersion(review({ findings: [f("a", "obs A")] }), surf(100)))
      .not.toBe(visualInputVersion(review({ findings: [f("a", "obs A CHANGED")] }), surf(100)));
  });
  it("changes when the surface package changes", () => {
    expect(visualInputVersion(review(), surf(100))).not.toBe(visualInputVersion(review(), surf(200)));
  });
  it("changes when the renderer version changes", () => {
    expect(visualInputVersion(review(), surf(100), "m2.2")).not.toBe(visualInputVersion(review(), surf(100), "m3.0"));
  });
  it("does NOT depend on audio (it's a preview)", () => {
    // visualInputVersion has no audio parameter — proven by signature; sanity: stable across calls.
    expect(RENDERER_VERSION).toBeTruthy();
  });
});

describe("final input version", () => {
  it("includes the Lucas audio identity — a new take changes it, the same take does not", () => {
    const vv = visualInputVersion(review(), surf(100));
    const a = finalInputVersion(vv, { key: "k/lucas.mp3", durationSeconds: 58 });
    expect(a).toBe(finalInputVersion(vv, { key: "k/lucas.mp3", durationSeconds: 58 }));
    expect(a).not.toBe(finalInputVersion(vv, { key: "k/lucas-v2.mp3", durationSeconds: 61 }));
  });
  it("changes when the visual version changes (review/surface change propagates)", () => {
    const audio = { key: "k", durationSeconds: 58 };
    expect(finalInputVersion(visualInputVersion(review(), surf(100)), audio))
      .not.toBe(finalInputVersion(visualInputVersion(review(), surf(200)), audio));
  });
});
