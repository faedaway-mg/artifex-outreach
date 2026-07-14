import { describe, it, expect } from "vitest";
import { computeScore, tierFromScore } from "./scoring";
import { normalizeName, domainFromUrl, normalizePhone } from "./store";
import { qualificationSchema, modernizationBriefSchema } from "./schemas";
import type { Lead } from "./types";

function lead(partial: Partial<Lead>): Lead {
  return {
    id: "l1", googlePlaceId: null, businessName: "Test Co", normalizedName: "testco",
    industry: "Dental practice", normalizedCategory: "dental-practices", categoryGroup: "Health and Wellness", address: "1 St", city: "LA", state: "CA", postalCode: "90012",
    latitude: null, longitude: null, phone: "(213) 555-0100", website: "https://test.com",
    websiteDomain: "test.com", publicEmail: "a@test.com", contactFormUrl: "https://test.com/c",
    socialLinks: [], locationsCount: null, rating: 4.8, reviewCount: 200, businessStatus: "OPERATIONAL",
    googleMapsUrl: null, hours: null, source: "Google Places", retrievedAt: null, tier: null, leadScore: null,
    scoreBreakdown: null, pipelineStage: "Discovered", estimatedValueLow: null, estimatedValueHigh: null,
    recommendedService: null, recommendedAction: null, recommendationReason: null, opportunitySummary: null,
    strengths: [], assignedTo: "jordan", note: null, lastContactAt: null, nextFollowUpAt: null,
    createdAt: "", updatedAt: "", ...partial,
  };
}

describe("scoring", () => {
  it("produces a breakdown that sums to the total within bounds", () => {
    const r = computeScore(lead({}));
    const sum = Object.values(r.breakdown).reduce((a, b) => a + b, 0);
    expect(r.total).toBe(sum);
    expect(r.total).toBeGreaterThan(0);
    expect(r.total).toBeLessThanOrEqual(100);
  });

  it("validates against the qualification schema (no unexplained numbers)", () => {
    const r = computeScore(lead({}));
    const parsed = qualificationSchema.safeParse({ breakdown: r.breakdown, total: r.total, tier: r.tier, rationale: r.rationale });
    expect(parsed.success).toBe(true);
  });

  it("scores a strong dental practice as Tier A and a payday lender low", () => {
    const strong = computeScore(lead({}));
    const weak = computeScore(lead({ industry: "Financial services", rating: 2.4, reviewCount: 10, publicEmail: null, contactFormUrl: null, website: null }));
    expect(strong.tier).toBe("A");
    expect(weak.total).toBeLessThan(strong.total);
  });

  it("maps thresholds correctly", () => {
    expect(tierFromScore(75)).toBe("A");
    expect(tierFromScore(50)).toBe("B");
    expect(tierFromScore(20)).toBe("C");
  });
});

describe("dedupe helpers", () => {
  it("normalizes business names for matching", () => {
    expect(normalizeName("Taylor Family Dental, LLC")).toBe(normalizeName("taylor family dental llc"));
  });
  it("extracts bare domains", () => {
    expect(domainFromUrl("https://www.Taylor.com/contact")).toBe("taylor.com");
    expect(domainFromUrl(null)).toBeNull();
  });
  it("normalizes phones to last 10 digits", () => {
    expect(normalizePhone("+1 (213) 555-0100")).toBe("2135550100");
  });
});

describe("schemas", () => {
  it("rejects a brief with more than 3 opportunities", () => {
    const bad = { opportunities: new Array(4).fill({ observation: "a", evidence: "a", businessConsequence: "a", modernizationDirection: "a" }) };
    expect(modernizationBriefSchema.safeParse(bad).success).toBe(false);
  });
});
