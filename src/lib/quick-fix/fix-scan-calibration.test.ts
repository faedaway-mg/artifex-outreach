// ─────────────────────────────────────────────────────────────────────────────
// FIX SCAN CALIBRATION AUDIT (PART I).
//
// FINDING: production inventory reports FIX_SCAN = 0 / 174. This is LEGITIMATE, not
// a routing defect. routeLead routes a lead to FIX_SCAN when the evidence is
// "promising but insufficient" — concretely, when the evidence gate returns
// SOFT_DIAGNOSTIC (a CONCRETE, evidence-backed defect whose top confidence is below
// the 0.6 offer floor). That reason string contains "diagnostic", which routeLead
// matches → FIX_SCAN. The current evidence corpus simply does not produce that
// MIDDLE band: findings are either OBSERVED at high confidence (→ DIRECT_FIX) or
// vague/UNKNOWN with no concrete defect (→ NO_FIX_FOUND). So FIX_SCAN=0 reflects the
// data, not a mis-threshold. Lowering the 0.6 floor to manufacture Fix Scans would
// LOWER EVIDENCE STANDARDS — explicitly forbidden. No threshold change is made.
//
// These tests PROVE the router behaves as designed across the four bands, so a valid
// "real issue but diagnosis incomplete" lead is NOT lost to NO_FIX_FOUND, and Fix
// Scan is never manufactured from thin air.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { generateOffer } from "./offer-engine";
import { routeLead } from "./fix-scan";
import { assessEvidence } from "./evidence-gate";
import type { OfferFinding } from "./types";

const F = (over: Partial<OfferFinding>): OfferFinding => ({
  id: "f", category: "Customer Acquisition", observation: "x", whyItMatters: "y",
  confidenceLabel: "Observed", confidenceScore: 0.95, impactLevel: "High", basis: ["link: https://x"], ...over,
});
const gen = (findings: OfferFinding[], over: Partial<Parameters<typeof generateOffer>[0]> = {}) =>
  generateOffer({ leadId: "lead_1", companyName: "Acme Roofing", findings, generatedAt: null, ...over });

// Concrete defect at HIGH confidence → sellable repair.
const STRONG = F({ id: "cta", observation: "the primary CTA button links to a dead URL", confidenceLabel: "Observed", confidenceScore: 0.95 });
// Concrete defect but SUB-0.6 confidence → the "promising but insufficient" middle band.
const THIN_CONCRETE = F({ id: "cta2", observation: "the primary CTA button links to a dead URL", confidenceLabel: "Inferred", confidenceScore: 0.5 });
// Vague, non-concrete → not a pointable defect.
const VAGUE = F({ id: "v", observation: "their website could be better", category: "Brand Experience", confidenceLabel: "Inferred", confidenceScore: 0.5, basis: [] });

describe("Fix Scan calibration — the four routing bands behave as designed", () => {
  it("the middle band exists: a concrete defect below the 0.6 floor grades SOFT_DIAGNOSTIC", () => {
    const ev = assessEvidence([THIN_CONCRETE]);
    expect(ev.recommendation).toBe("SOFT_DIAGNOSTIC");
    expect(ev.reason).toMatch(/diagnostic/);
  });

  it("strong, concrete, high-confidence evidence → DIRECT_FIX (never downsold to a scan)", () => {
    expect(routeLead(gen([STRONG])).route).toBe("DIRECT_FIX");
  });

  it("concrete defect but sub-0.6 confidence → FIX_SCAN (NOT lost to NO_FIX_FOUND)", () => {
    // This is the case that would populate FIX_SCAN if the corpus produced it.
    expect(routeLead(gen([THIN_CONCRETE])).route).toBe("FIX_SCAN");
  });

  it("vague / non-concrete evidence → NO_FIX_FOUND (never manufactured into a scan)", () => {
    expect(routeLead(gen([VAGUE])).route).toBe("NO_FIX_FOUND");
  });

  it("no evidence at all → NO_FIX_FOUND, and no-website → CONVERSATION (Fix Scan is not a fallback dump)", () => {
    expect(routeLead(gen([])).route).toBe("NO_FIX_FOUND");
    expect(routeLead(gen([STRONG], { hasWebsite: false })).route).toBe("CONVERSATION_REQUIRED");
  });

  it("audit conclusion: FIX_SCAN=0 is inventory-driven — the router correctly reaches FIX_SCAN when the middle band appears", () => {
    // Given the SAME router, only the middle-band fixture yields FIX_SCAN; the others
    // never do. So a zero count means zero middle-band leads, not a mis-calibration.
    const routes = [STRONG, THIN_CONCRETE, VAGUE].map((f) => routeLead(gen([f])).route);
    expect(routes).toEqual(["DIRECT_FIX", "FIX_SCAN", "NO_FIX_FOUND"]);
  });
});
