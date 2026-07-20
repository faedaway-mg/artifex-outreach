import { describe, it, expect } from "vitest";
import { buildBusinessProfile } from "./profile";
import { OPPORTUNITY_CATEGORIES } from "./types";
import { FIXTURES } from "./fixtures";
import { makeLead } from "../test-lead";
import type { Lead } from "../types";

const noWeb: Partial<Lead> = { website: null, websiteDomain: null, publicEmail: null, googleMapsUrl: null, socialLinks: [] };

describe("Modernization opportunities", () => {
  it("categorizes every opportunity into the approved category set", () => {
    for (const f of FIXTURES) {
      const profile = buildBusinessProfile(f.input);
      for (const o of profile.opportunities) {
        expect(OPPORTUNITY_CATEGORIES).toContain(o.category);
        expect(o.observation.length).toBeGreaterThan(0);
        expect(o.whyItMatters.length).toBeGreaterThan(0);
        expect(o.estimatedImpact.rationale.length).toBeGreaterThan(0);
        expect(o.basis.length).toBeGreaterThan(0);
      }
    }
  });

  it("leads a no-website business with the foundational owned-presence opportunity", () => {
    const profile = buildBusinessProfile({ lead: makeLead({ ...noWeb, socialLinks: ["https://facebook.com/x"], rating: 4.7, reviewCount: 120 }) });
    expect(profile.opportunities[0].category).toBe("Customer Acquisition");
    expect(profile.opportunities[0].estimatedImpact.level).toBe("Foundational");
    expect(profile.opportunities.some((o) => o.id === "google-business")).toBe(true);
  });

  it("recommends online booking for an appointment business without it", () => {
    const profile = buildBusinessProfile({ lead: makeLead({ industry: "Dental practice", website: null, socialLinks: [] }) });
    expect(profile.opportunities.some((o) => o.category === "Scheduling")).toBe(true);
  });

  it("recommends review generation when there are no reviews", () => {
    const profile = buildBusinessProfile({ lead: makeLead({ ...noWeb, reviewCount: 0, rating: 0 }) });
    expect(profile.opportunities.some((o) => o.category === "Customer Retention")).toBe(true);
  });

  it("recommends multi-location coordination only for multi-location businesses", () => {
    const multi = buildBusinessProfile({ lead: makeLead({ locationsCount: 3 }) });
    expect(multi.opportunities.some((o) => o.id === "multi-location-coordination")).toBe(true);
    const single = buildBusinessProfile({ lead: makeLead({ locationsCount: 1 }) });
    expect(single.opportunities.some((o) => o.id === "multi-location-coordination")).toBe(false);
  });

  it("orders opportunities strongest-first (foundational before incremental)", () => {
    const profile = buildBusinessProfile({ lead: makeLead({ ...noWeb, rating: 0, reviewCount: 0 }) });
    const order = ["Foundational", "High", "Moderate", "Incremental"];
    const idx = profile.opportunities.map((o) => order.indexOf(o.estimatedImpact.level));
    const sorted = [...idx].sort((a, b) => a - b);
    expect(idx).toEqual(sorted);
  });

  it("exercises a broad range of categories across many business types", () => {
    const seen = new Set<string>();
    for (const f of FIXTURES) for (const o of buildBusinessProfile(f.input).opportunities) seen.add(o.category);
    // The fixtures span acquisition, scheduling, retention, operations, brand, etc.
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });
});
