import { describe, it, expect } from "vitest";
import { businessImprovementPotential } from "./improvement";
import { TREATMENT_CATEGORIES } from "./positioning";
import { makeLead } from "./test-lead";
import type { WebsiteSignals } from "./scoring";

const poorSite: WebsiteSignals = { hasWebsite: true, mobileFriendly: false, slowLoad: true, hasOnlineBooking: false, hasLeadForm: false };
const goodSite: WebsiteSignals = { hasWebsite: true, mobileFriendly: true, slowLoad: false, hasOnlineBooking: true, hasLeadForm: true };

describe("Business Improvement Potential", () => {
  it("returns a valid treatment category and 0..100 score", () => {
    const bip = businessImprovementPotential(makeLead(), poorSite);
    expect(TREATMENT_CATEGORIES).toContain(bip.treatment);
    expect(bip.score).toBeGreaterThanOrEqual(0);
    expect(bip.score).toBeLessThanOrEqual(100);
  });

  it("does not let website quality dominate: a strong operational lead with a GOOD site is still viable", () => {
    // Acceptable website but a multi-location home-service business with real ops depth.
    const lead = makeLead({
      industry: "Home-service company",
      locationsCount: 4,
      reviewCount: 320,
      rating: 4.6,
    });
    const bip = businessImprovementPotential(lead, goodSite);
    expect(bip.treatment).not.toBe("Do Not Contact");
    // Website friction is a minor part of the picture.
    expect(bip.dimensions.technologyFriction).toBeLessThan(50);
    expect(bip.dimensions.operationalComplexity).toBeGreaterThan(50);
    expect(bip.score).toBeGreaterThan(20);
  });

  it("a poor website alone (weak everything else) does not make a lead valuable", () => {
    const weak = makeLead({
      industry: "Financial services", // low fit
      rating: 3.1,
      reviewCount: 4,
      locationsCount: 1,
      estimatedValueLow: 1000,
      estimatedValueHigh: 2000,
    });
    const strongOps = makeLead({ industry: "Home-service company", reviewCount: 300, rating: 4.6, locationsCount: 3 });
    const weakBip = businessImprovementPotential(weak, poorSite);
    const strongBip = businessImprovementPotential(strongOps, goodSite);
    // Even though `weak` has the worse website, the strong-ops lead scores higher.
    expect(strongBip.score).toBeGreaterThan(weakBip.score);
  });

  it("hard override: permanently closed → Do Not Contact, score 0", () => {
    const bip = businessImprovementPotential(makeLead({ businessStatus: "CLOSED_PERMANENTLY" }));
    expect(bip.hardOverride.triggered).toBe(true);
    expect(bip.treatment).toBe("Do Not Contact");
    expect(bip.score).toBe(0);
  });

  it("hard override: suppressed / opted out → Do Not Contact", () => {
    expect(businessImprovementPotential(makeLead(), undefined, { suppressed: true }).treatment).toBe("Do Not Contact");
    expect(businessImprovementPotential(makeLead(), undefined, { optedOut: true }).treatment).toBe("Do Not Contact");
  });

  it("hard override: no reachable contact route → Do Not Contact", () => {
    const bip = businessImprovementPotential(makeLead({ publicEmail: null, phone: null, website: null }));
    expect(bip.hardOverride.triggered).toBe(true);
  });

  it("explicitly documents website as one signal", () => {
    const bip = businessImprovementPotential(makeLead(), poorSite);
    expect(bip.websiteIsOneSignalNote.toLowerCase()).toContain("one signal");
  });
});
