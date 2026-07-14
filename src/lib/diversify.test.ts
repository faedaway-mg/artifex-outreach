import { describe, it, expect } from "vitest";
import { pickDiverse } from "./prospecting";
import { defaultCategories, categoryMetaForIndustry, applyPreset, slug } from "./categories";
import { categoryPerformance, MIN_SAMPLE } from "./analytics";
import type { Lead } from "./types";

function cand(category: string, score: number) {
  return { item: { category, score }, category, score };
}

describe("diversified fill (pickDiverse)", () => {
  it("#10 caps new leads per category (default 2)", () => {
    const entries = [
      cand("dental", 90), cand("dental", 88), cand("dental", 86), cand("dental", 84),
      cand("law", 80), cand("hvac", 78), cand("retail", 70),
    ];
    const { picked, rejectedByCap } = pickDiverse(entries, { target: 8, capFor: () => 2 });
    const dental = picked.filter((p) => p.category === "dental").length;
    expect(dental).toBe(2); // never more than 2 from one category
    expect(rejectedByCap).toBe(2); // the 2 extra dental candidates
  });

  it("#11 yields ≥4 distinct categories when available", () => {
    const entries = [
      cand("dental", 95), cand("dental", 94),
      cand("law", 93), cand("hvac", 92), cand("retail", 91),
      cand("fitness", 90), cand("consulting", 89),
    ];
    const { picked } = pickDiverse(entries, { target: 8, capFor: () => 2 });
    const distinct = new Set(picked.map((p) => p.category)).size;
    expect(distinct).toBeGreaterThanOrEqual(4);
  });

  it("#12 quality ordering respected — highest scores picked first within caps", () => {
    const entries = [cand("a", 50), cand("b", 99), cand("c", 75)];
    const { picked } = pickDiverse(entries, { target: 2, capFor: () => 1 });
    expect(picked.map((p) => p.score)).toEqual([99, 75]);
  });

  it("respects per-category cap of 0 (paused/exhausted)", () => {
    const entries = [cand("x", 90), cand("y", 80)];
    const { picked } = pickDiverse(entries, { target: 5, capFor: (c) => (c === "x" ? 0 : 2) });
    expect(picked.every((p) => p.category === "y")).toBe(true);
  });
});

describe("category portfolio", () => {
  it("#2 structured defaults span ≥6 groups", () => {
    const groups = new Set(defaultCategories().map((c) => c.group));
    expect(groups.size).toBeGreaterThanOrEqual(6);
    expect(defaultCategories().length).toBeGreaterThan(20);
  });
  it("#1 maps legacy industries to a normalized category + group", () => {
    expect(categoryMetaForIndustry("Dental practice")).toEqual({ normalizedCategory: "dental-practices", group: "Health and Wellness" });
    expect(categoryMetaForIndustry("HVAC companies").group).toBe("Home and Property Services");
  });
  it("#3/#4 preset enables the right groups", () => {
    const cats = defaultCategories();
    const home = applyPreset("Home Services", cats);
    expect(home.filter((c) => c.enabled).every((c) => c.group === "Home and Property Services")).toBe(true);
    expect(applyPreset("Balanced Portfolio", cats).every((c) => c.enabled)).toBe(true);
  });
  it("#8 custom category slug is stable", () => {
    expect(slug("Boutique Fitness Studios!")).toBe("boutique-fitness-studios");
  });
});

function lead(p: Partial<Lead>): Lead {
  return {
    id: Math.random().toString(), googlePlaceId: null, businessName: "B", normalizedName: "b", industry: "Law firm",
    normalizedCategory: "law-firms", categoryGroup: "Professional Services", address: "", city: "", state: "", postalCode: "",
    latitude: null, longitude: null, phone: null, website: null, websiteDomain: null, publicEmail: null, contactFormUrl: null,
    socialLinks: [], locationsCount: null, rating: null, reviewCount: null, businessStatus: "OPERATIONAL", googleMapsUrl: null,
    hours: null, source: "test", retrievedAt: null, tier: "B", leadScore: 60, scoreBreakdown: null, pipelineStage: "Qualified",
    estimatedValueLow: 5000, estimatedValueHigh: 9000, recommendedService: null, recommendedAction: null, recommendationReason: null,
    opportunitySummary: null, strengths: [], acquisitionStrategy: null, acquisitionScore: null, acquisitionReason: null, acquisitionScoreBreakdown: null, acquisitionOverride: false, assignedTo: "jordan", note: null, lastContactAt: null, nextFollowUpAt: null,
    createdAt: "", updatedAt: "", ...p,
  };
}

describe("category performance (#18/#19 small-sample guard)", () => {
  it("marks a group insufficient below the minimum contacted sample", () => {
    const leads = [lead({ categoryGroup: "Professional Services" }), lead({ categoryGroup: "Professional Services" })];
    const rows = categoryPerformance(leads, [], [], []);
    const prof = rows.find((r) => r.group === "Professional Services")!;
    expect(prof.discovered).toBe(2);
    expect(prof.sufficient).toBe(false); // <10 contacted
    expect(MIN_SAMPLE).toBe(10);
  });
});
