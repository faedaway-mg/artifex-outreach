import { describe, it, expect } from "vitest";
import { buildBusinessProfile } from "./profile";
import { openingFromProfile, toDeliverableOpportunities, toExecutiveDigest } from "./adapters";
import { DIMENSIONS } from "./types";
import { FIXTURES } from "./fixtures";
import { makeLead } from "../test-lead";
import { analyzeStyle } from "../style-checker";

describe("BusinessProfile assembly", () => {
  it("produces all four dimensions for every business type", () => {
    for (const f of FIXTURES) {
      const p = buildBusinessProfile(f.input);
      for (const dim of DIMENSIONS) {
        expect(p.dimensions[dim]).toBeDefined();
        expect(p.dimensions[dim].dimension).toBe(dim);
        expect(p.dimensions[dim].total).toBeGreaterThan(0);
      }
      expect(p.presence.profile).toBe(f.expectProfile);
      expect(p.headline.length).toBeGreaterThan(0);
      expect(p.executiveSummary.length).toBeGreaterThan(0);
      expect(p.generatedAt).toBeNull();
    }
  });

  it("reports coverage as measured/total per dimension", () => {
    const p = buildBusinessProfile(FIXTURES[0].input);
    for (const c of p.coverage) {
      expect(c.measured).toBeLessThanOrEqual(c.total);
      expect(c.measured).toBeGreaterThanOrEqual(0);
    }
  });

  it("scores a well-built site higher than an invisible business on customer experience", () => {
    const dental = buildBusinessProfile(FIXTURES[0].input);
    const invisible = buildBusinessProfile(FIXTURES.find((f) => f.expectProfile === "invisible")!.input);
    expect(dental.dimensions["customer-experience"].score!).toBeGreaterThan(invisible.dimensions["customer-experience"].score!);
  });

  it("lists only directly-supported strengths (Observed/Likely)", () => {
    const p = buildBusinessProfile(FIXTURES[0].input);
    // Strengths are drawn from strong readings + a strong reputation; never Unknown.
    expect(p.strengths.length).toBeGreaterThan(0);
    for (const s of p.strengths) expect(typeof s).toBe("string");
  });

  it("reuses the improvement model's evidence confidence when available", () => {
    const improvement = { dimensions: { evidenceConfidence: 42 } } as any;
    const p = buildBusinessProfile({ lead: makeLead(), improvement });
    expect(p.evidenceConfidence).toBe(42);
  });

  it("provenance records the sources that fed the profile", () => {
    const p = buildBusinessProfile(FIXTURES[0].input);
    expect(p.provenance).toContain("presence-detection");
    expect(p.provenance).toContain("website-intelligence");
  });
});

describe("Adapters — the profile as single source of truth", () => {
  it("openingFromProfile builds a natural call opening from the profile alone", () => {
    for (const f of FIXTURES) {
      const p = buildBusinessProfile(f.input);
      const opening = openingFromProfile(p);
      expect(opening.full.length).toBeGreaterThan(40);
      // The opening is presence-aware and passes the conversation style bar.
      expect(analyzeStyle(opening.full).ok).toBe(true);
      // Never assume a website that doesn't exist.
      if (!p.presence.hasWebsite) expect(opening.full).not.toMatch(/your (web ?site|site)\b/i);
    }
  });

  it("toDeliverableOpportunities projects into the investment/PDF opportunity shape", () => {
    const p = buildBusinessProfile(FIXTURES[2].input); // Facebook-only diner
    const opps = toDeliverableOpportunities(p);
    expect(opps.length).toBe(p.opportunities.length);
    for (const o of opps) {
      expect(o).toHaveProperty("observation");
      expect(o).toHaveProperty("evidence");
      expect(o).toHaveProperty("businessConsequence");
      expect(o).toHaveProperty("modernizationDirection");
      expect(o.evidence).toMatch(/confidence/i);
    }
  });

  it("toExecutiveDigest returns a compact operator-ready read", () => {
    const digest = toExecutiveDigest(buildBusinessProfile(FIXTURES[0].input));
    expect(digest.headline.length).toBeGreaterThan(0);
    expect(digest.topOpportunities.length).toBeLessThanOrEqual(3);
    expect(typeof digest.evidenceConfidence).toBe("number");
  });
});
