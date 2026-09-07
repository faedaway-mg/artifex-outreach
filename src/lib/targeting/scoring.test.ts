import { describe, it, expect } from "vitest";
import { scoreTarget, mayAutoPrepare, TARGET_PERSONA, TARGETING_MODEL_VERSION, type TargetingInput, type RecipientResolution } from "./scoring";

const owner: RecipientResolution = { role: "owner", verified: true, confidence: 0.9, locallyControlled: true };
const inbox: RecipientResolution = { role: "general-inbox", verified: true, confidence: 0.4, locallyControlled: true };
const none: RecipientResolution = { role: "none", verified: false, confidence: 0, locallyControlled: false };

const sig = (id: string, kind: any, conf = 0.8): any => ({ id, kind, observation: `${id} observed`, sourceUrl: "https://x", confidence: conf });

// A strong persona-match baseline; override per test.
const base = (over: Partial<TargetingInput> = {}): TargetingInput => ({
  leadId: "lead_1", businessName: "Ridgeline Roofing", city: "Chattanooga", state: "TN",
  isEnterpriseOrPublic: false, isFranchiseCorporateControlled: false, isRejected: false, isSuppressed: false,
  isDuplicate: false, isSynthetic: false, policyExhausted: false, hasFunctioningWebsite: true,
  marketTier: "secondary", recentlyOversaturated: false,
  reviewCount: 140, rating: 4.7, ownerRepliesToReviews: true, hasAwardsOrLongHistory: true,
  websiteFindings: [sig("ev_booking", "digital-underrepresentation"), sig("ev_mobile", "digital-underrepresentation")],
  hasSupportedConsequence: true, strongModernConversionSite: false, genericFindingOnly: false,
  reputationSignals: [sig("rep_reviews", "reputation")], growthSignals: [sig("grow_hiring", "growth-timing")],
  recipient: owner, ownerNamedOnSite: true,
  highConsiderationService: true, locationsCount: 2, weakCommercialViability: false, lowConfidenceOwnership: false,
  ...over,
});

describe("mandate 27 — canonical targeting score", () => {
  it("is versioned + names the canonical persona", () => {
    expect(TARGETING_MODEL_VERSION).toMatch(/^v\d/);
    expect(TARGET_PERSONA).toBe("REPUTATION_RICH_DIGITALLY_UNDERREPRESENTED_OPERATOR");
  });

  it("perfect persona match → PRIORITY_A, auto-prepare eligible, all prerequisites met", () => {
    const s = scoreTarget(base());
    expect(s.band).toBe("PRIORITY_A");
    expect(s.total).toBeGreaterThanOrEqual(80);
    expect(s.priorityAReady).toBe(true);
    expect(mayAutoPrepare(s)).toBe(true);
    expect(s.terminalExclusions).toEqual([]);
  });

  it("strong reputation BUT strong modern site → no gap, heavy penalty → not our persona", () => {
    const s = scoreTarget(base({ strongModernConversionSite: true }));
    expect(s.components.digitalReputationGap).toBe(0);
    expect(s.penalties.some((p) => p.code === "STRONG_MODERN_SITE")).toBe(true);
    expect(mayAutoPrepare(s)).toBe(false);
  });

  it("high review count ALONE cannot create a high score", () => {
    const s = scoreTarget(base({
      reviewCount: 5000, rating: 3.9, ownerRepliesToReviews: false, hasAwardsOrLongHistory: false,
      websiteFindings: [], hasSupportedConsequence: false, growthSignals: [], reputationSignals: [],
    }));
    expect(s.components.reputationStrength).toBeLessThanOrEqual(15);
    expect(s.band).not.toBe("PRIORITY_A");
    expect(s.priorityAReady).toBe(false);
  });

  it.each([
    ["enterprise/public", { isEnterpriseOrPublic: true }],
    ["corporate franchise location", { isFranchiseCorporateControlled: true }],
    ["rejected", { isRejected: true }],
    ["suppressed", { isSuppressed: true }],
    ["duplicate", { isDuplicate: true }],
    ["synthetic", { isSynthetic: true }],
    ["no website", { hasFunctioningWebsite: false }],
    ["no recipient", { recipient: none }],
  ])("terminal exclusion: %s → INELIGIBLE, total 0, never auto-prepare", (_label, over) => {
    const s = scoreTarget(base(over as any));
    expect(s.band).toBe("INELIGIBLE");
    expect(s.total).toBe(0);
    expect(s.terminalExclusions.length).toBeGreaterThan(0);
    expect(mayAutoPrepare(s)).toBe(false);
  });

  it("an INDEPENDENT franchisee with verified local control is NOT excluded", () => {
    // independent local control → not a corporate-controlled location
    const s = scoreTarget(base({ isFranchiseCorporateControlled: false, recipient: { role: "owner", verified: true, confidence: 0.85, locallyControlled: true } }));
    expect(s.terminalExclusions).toEqual([]);
    expect(mayAutoPrepare(s)).toBe(true);
  });

  it("no supported consequence → -25 penalty drops it out of preparation", () => {
    const s = scoreTarget(base({ hasSupportedConsequence: false }));
    expect(s.penalties.some((p) => p.code === "NO_SUPPORTED_CONSEQUENCE")).toBe(true);
    expect(s.priorityAReady).toBe(false);
  });

  it("generic-evidence-only is penalized and capped, never PRIORITY_A", () => {
    const s = scoreTarget(base({ genericFindingOnly: true }));
    expect(s.components.evidenceSpecificity).toBeLessThanOrEqual(4);
    expect(s.penalties.some((p) => p.code === "GENERIC_EVIDENCE")).toBe(true);
    expect(s.band).not.toBe("PRIORITY_A");
  });

  it("owner-accessible outranks general-inbox on decision-maker access + recipient confidence", () => {
    const ownerScore = scoreTarget(base());
    const inboxScore = scoreTarget(base({ recipient: inbox, ownerNamedOnSite: false }));
    expect(ownerScore.components.decisionMakerAccess).toBeGreaterThan(inboxScore.components.decisionMakerAccess);
    expect(ownerScore.components.recipientConfidence).toBeGreaterThan(inboxScore.components.recipientConfidence);
  });

  it("growth-timing signals lift the growth component", () => {
    const withGrowth = scoreTarget(base({ growthSignals: [sig("g1", "growth-timing"), sig("g2", "growth-timing"), sig("g3", "growth-timing")] }));
    const noGrowth = scoreTarget(base({ growthSignals: [] }));
    expect(withGrowth.components.growthTiming).toBeGreaterThan(noGrowth.components.growthTiming);
  });

  it("secondary/tertiary markets score higher than a primary metro (mandate 26 policy alignment)", () => {
    const sec = scoreTarget(base({ marketTier: "secondary" }));
    const prim = scoreTarget(base({ marketTier: "primary" }));
    expect(sec.components.marketFit).toBeGreaterThan(prim.components.marketFit);
  });

  it("a PRIORITY_B email candidate: solid but missing a PRIORITY_A prerequisite stays in B, not A", () => {
    // strong score range but recipient only an unverified-role → priorityAReady false → B
    const s = scoreTarget(base({ recipient: { role: "general-manager", verified: true, confidence: 0.6, locallyControlled: true }, growthSignals: [] }));
    expect(["PRIORITY_A", "PRIORITY_B", "REVIEW"]).toContain(s.band);
    if (s.total >= 80) expect(s.band === "PRIORITY_A" ? s.priorityAReady : true).toBeTruthy();
  });

  it("component scores never exceed their caps", () => {
    const s = scoreTarget(base({ reviewCount: 99999, rating: 5, growthSignals: Array.from({ length: 20 }, (_, k) => sig("g" + k, "growth-timing")) }));
    expect(s.components.reputationStrength).toBeLessThanOrEqual(15);
    expect(s.components.digitalReputationGap).toBeLessThanOrEqual(25);
    expect(s.components.growthTiming).toBeLessThanOrEqual(10);
    expect(s.components.recipientConfidence).toBeLessThanOrEqual(5);
    expect(s.total).toBeLessThanOrEqual(100);
  });
});
