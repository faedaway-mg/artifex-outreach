import { describe, it, expect } from "vitest";
import { assessEvidence, isMaterialFinding } from "./evidence-gate";
import type { OfferFinding } from "./types";

function finding(over: Partial<OfferFinding>): OfferFinding {
  return {
    id: "f1",
    category: "conversion",
    observation: "the booking button on the homepage does not lead to a working booking flow",
    whyItMatters: "a visitor ready to book cannot complete the action",
    confidenceLabel: "Observed",
    confidenceScore: 0.8,
    impactLevel: "High",
    basis: ["homepage screenshot"],
    ...over,
  };
}

describe("materiality / sellability gate (§14)", () => {
  it("rejects the brand-recall example as concrete-but-immaterial", () => {
    const weak = finding({
      observation: "the business name appears in more than one form across the site",
      whyItMatters: "which quietly weakens brand recall",
    });
    expect(isMaterialFinding(weak)).toBe(false);
    const a = assessEvidence([weak]);
    expect(a.sufficientForOffer).toBe(false);
    expect(a.recommendation).toBe("DECLINE");
    expect(a.reason).toMatch(/immaterial/);
  });

  it("rejects cosmetic/stylistic nits", () => {
    expect(isMaterialFinding(finding({ observation: "the favicon is low resolution", whyItMatters: "a minor cosmetic issue" }))).toBe(false);
    expect(isMaterialFinding(finding({ observation: "the color scheme could feel more modern", whyItMatters: "" }))).toBe(false);
  });

  it("still qualifies a real, material booking defect", () => {
    const strong = finding({});
    expect(isMaterialFinding(strong)).toBe(true);
    const a = assessEvidence([strong]);
    expect(a.sufficientForOffer).toBe(true);
    expect(a.recommendation).toBe("OFFER");
  });

  it("a material finding survives even next to an immaterial one", () => {
    const a = assessEvidence([
      finding({ id: "weak", observation: "the business name appears in more than one form across the site", whyItMatters: "quietly weakens brand recall" }),
      finding({ id: "strong" }),
    ]);
    expect(a.qualifyingFindings.map((f) => f.id)).toEqual(["strong"]);
    expect(a.sufficientForOffer).toBe(true);
  });
});
