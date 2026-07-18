import { describe, it, expect } from "vitest";
import { estimateRelationshipValue, ENGAGEMENT_MODELS, engagementModel } from "./pricing";
import { makeLead } from "./test-lead";

describe("Relationship value + engagement models", () => {
  it("exposes the three engagement models", () => {
    const keys = ENGAGEMENT_MODELS.map((m) => m.key);
    expect(keys).toContain("focused-improvement");
    expect(keys).toContain("phased-modernization");
    expect(keys).toContain("ongoing-partnership");
    expect(engagementModel("focused-improvement").low).toBe(1000);
  });

  it("relationship value grows across the horizon and stays confidence-adjusted", () => {
    const rv = estimateRelationshipValue(makeLead());
    expect(rv.threeMonth).toBeGreaterThanOrEqual(rv.entry);
    expect(rv.sixMonth).toBeGreaterThanOrEqual(rv.threeMonth);
    expect(rv.twelveMonth).toBeGreaterThanOrEqual(rv.sixMonth);
    expect(rv.confidenceAdjustedTwelveMonth).toBeLessThanOrEqual(rv.twelveMonth);
    expect(rv.partnershipLikelihood).toBeGreaterThanOrEqual(0);
    expect(rv.partnershipLikelihood).toBeLessThanOrEqual(1);
  });

  it("multi-location established businesses lean toward a partnership entry, not a one-off", () => {
    const rv = estimateRelationshipValue(makeLead({ locationsCount: 5, reviewCount: 400, rating: 4.7, estimatedValueHigh: 20000, estimatedValueLow: 12000 }));
    expect(["phased-modernization", "ongoing-partnership"]).toContain(rv.recommendedEntry);
    expect(rv.partnershipLikelihood).toBeGreaterThan(0.4);
  });

  it("does not overstate cold pipeline: low-evidence lead has a modest confidence-adjusted value", () => {
    const rv = estimateRelationshipValue(makeLead({ reviewCount: 3, website: null, scoreBreakdown: null, estimatedValueLow: 1000, estimatedValueHigh: 2000 }));
    expect(rv.confidenceAdjustedTwelveMonth).toBeLessThan(rv.twelveMonth);
  });
});
