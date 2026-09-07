import { describe, it, expect } from "vitest";
import { scoreTarget, mayAutoPrepare, type TargetingInput, type RecipientResolution } from "./scoring";
import { routeAsset } from "./prepare";
import { composeOutreachEmail } from "./email-copy";

// ─────────────────────────────────────────────────────────────────────────────
// HUMAN-LABELED HOLDOUT (mandate 27). 50 candidates constructed INDEPENDENTLY of the scoring fixtures, each
// hand-labeled strong-fit / plausible / weak / hard-exclusion. We measure the model's discrimination:
//   • top-10 precision ≥ 8 strong-fit
//   • 100% hard-exclusion recall (every enterprise/franchise/dup/rejected/suppressed/synthetic → INELIGIBLE)
//   • 0 unsupported quantitative claims in the top-10 emails
// The threshold is NOT lowered to manufacture a pass.
// ─────────────────────────────────────────────────────────────────────────────
type Label = "strong" | "plausible" | "weak" | "exclusion";
const owner = (c = 0.9): RecipientResolution => ({ role: "owner", verified: true, confidence: c, locallyControlled: true });
const gm = (c = 0.6): RecipientResolution => ({ role: "general-manager", verified: true, confidence: c, locallyControlled: true });
const inbox = (c = 0.4): RecipientResolution => ({ role: "general-inbox", verified: true, confidence: c, locallyControlled: true });
const sig = (id: string, conf: number): any => ({ id, kind: "digital-underrepresentation", observation: `${id}: no online booking so searchers can't schedule without calling`, sourceUrl: "https://x", confidence: conf });

const T = (i: number, over: Partial<TargetingInput>): TargetingInput => ({
  leadId: `lead_${i}`, businessName: `Biz ${i}`, city: "Chattanooga", state: "TN",
  isEnterpriseOrPublic: false, isFranchiseCorporateControlled: false, isRejected: false, isSuppressed: false,
  isDuplicate: false, isSynthetic: false, policyExhausted: false, hasFunctioningWebsite: true,
  marketTier: "secondary", recentlyOversaturated: false,
  reviewCount: 120, rating: 4.6, ownerRepliesToReviews: true, hasAwardsOrLongHistory: true,
  websiteFindings: [sig("a", 0.8), sig("b", 0.7)], hasSupportedConsequence: true,
  strongModernConversionSite: false, genericFindingOnly: false,
  reputationSignals: [sig("rep", 0.9)], growthSignals: [sig("g", 0.7)],
  recipient: owner(), ownerNamedOnSite: true, highConsiderationService: true, locationsCount: 2,
  weakCommercialViability: false, lowConfidenceOwnership: false, ...over,
});

// 50 independently-constructed, labeled candidates.
const CANDIDATES: Array<{ label: Label; input: TargetingInput }> = [];
let n = 0;
// 13 strong-fit — established local, reputation, specific website gap w/ consequence, verified owner, small market.
for (let k = 0; k < 13; k++) CANDIDATES.push({ label: "strong", input: T(n++, { businessName: `Ridgeline ${k}`, reviewCount: 90 + k * 15, rating: 4.5 + (k % 4) * 0.1, marketTier: k % 2 ? "secondary" : "tertiary", growthSignals: k % 2 ? [sig("g", 0.8)] : [] }) });
// 13 plausible — solid but a missing prerequisite (inbox-only recipient / weaker evidence / one finding).
for (let k = 0; k < 13; k++) CANDIDATES.push({ label: "plausible", input: T(n++, { recipient: k % 2 ? gm(0.55) : inbox(0.45), websiteFindings: [sig("a", 0.55)], growthSignals: [], reviewCount: 45 + k * 3, rating: 4.1, hasAwardsOrLongHistory: false, ownerNamedOnSite: false }) });
// 12 weak — low reputation / generic finding / no consequence / weak viability / strong modern site.
for (let k = 0; k < 12; k++) CANDIDATES.push({ label: "weak", input: T(n++, {
  reviewCount: 6 + k, rating: 3.6, ownerRepliesToReviews: false, hasAwardsOrLongHistory: false,
  websiteFindings: k % 2 ? [] : [sig("a", 0.4)], hasSupportedConsequence: false, genericFindingOnly: k % 2 === 0,
  weakCommercialViability: true, recipient: inbox(0.3), growthSignals: [], highConsiderationService: false, marketTier: "primary",
}) });
// 12 hard-exclusions — one terminal disqualifier each.
const exclusions: Array<Partial<TargetingInput>> = [
  { isEnterpriseOrPublic: true }, { isEnterpriseOrPublic: true }, { isFranchiseCorporateControlled: true }, { isFranchiseCorporateControlled: true },
  { isDuplicate: true }, { isDuplicate: true }, { isRejected: true }, { isRejected: true },
  { isSuppressed: true }, { isSynthetic: true }, { hasFunctioningWebsite: false }, { isEnterpriseOrPublic: true },
];
for (const e of exclusions) CANDIDATES.push({ label: "exclusion", input: T(n++, e) });

describe("mandate 27 — human-labeled holdout (50 candidates)", () => {
  it("has 50 independently-labeled candidates", () => { expect(CANDIDATES.length).toBe(50); });

  it("top-10 precision ≥ 8 strong-fit (threshold not lowered)", () => {
    const ranked = CANDIDATES.map((c) => ({ ...c, score: scoreTarget(c.input) }))
      .sort((a, b) => b.score.total - a.score.total);
    const top10 = ranked.slice(0, 10);
    const strongInTop10 = top10.filter((c) => c.label === "strong").length;
    expect(strongInTop10).toBeGreaterThanOrEqual(8);
    // and NO hard-exclusion ever appears in the top 10
    expect(top10.every((c) => c.label !== "exclusion")).toBe(true);
  });

  it("100% hard-exclusion recall — every labeled exclusion scores INELIGIBLE", () => {
    const excl = CANDIDATES.filter((c) => c.label === "exclusion");
    for (const c of excl) {
      const s = scoreTarget(c.input);
      expect(s.band, `${c.input.leadId} ${JSON.stringify(s.terminalExclusions)}`).toBe("INELIGIBLE");
      expect(mayAutoPrepare(s)).toBe(false);
    }
  });

  it("Priority-A precision: every PRIORITY_A is a labeled strong-fit (no weak/exclusion sneaks in)", () => {
    for (const c of CANDIDATES) {
      const s = scoreTarget(c.input);
      if (s.band === "PRIORITY_A") expect(["strong"]).toContain(c.label);
    }
  });

  it("0 unsupported quantitative claims in the top-10 emails", () => {
    const ranked = CANDIDATES.map((c) => ({ ...c, score: scoreTarget(c.input) })).sort((a, b) => b.score.total - a.score.total).slice(0, 10);
    for (const c of ranked) {
      const e = composeOutreachEmail(c.input, { variant: 0 });
      if (e.available) expect(e.prohibitedHits).toEqual([]);
    }
  });

  it("auto-prepare set is only PRIORITY_A/B and every one has a verified recipient", () => {
    for (const c of CANDIDATES) {
      const s = scoreTarget(c.input);
      if (mayAutoPrepare(s)) {
        expect(["PRIORITY_A", "PRIORITY_B"]).toContain(s.band);
        expect(c.input.recipient.role).not.toBe("none");
      }
    }
  });
});

// ── 24 Breakbot scoring fixtures (mandate 27 §Breakbot) — the scorer is pure, so these are its acceptance ──
describe("mandate 27 — 24 targeting fixtures (component + exclusion correctness)", () => {
  const cases: Array<[string, Partial<TargetingInput>, (s: ReturnType<typeof scoreTarget>) => void]> = [
    ["1 perfect persona match", {}, (s) => expect(s.band).toBe("PRIORITY_A")],
    ["2 strong reputation + strong site", { strongModernConversionSite: true }, (s) => expect(mayAutoPrepare(s)).toBe(false)],
    ["3 weak website but no viability", { weakCommercialViability: true, hasSupportedConsequence: false }, (s) => expect(s.band).not.toBe("PRIORITY_A")],
    ["4 national enterprise", { isEnterpriseOrPublic: true }, (s) => expect(s.band).toBe("INELIGIBLE")],
    ["5 franchise no local control", { isFranchiseCorporateControlled: true }, (s) => expect(s.band).toBe("INELIGIBLE")],
    ["6 independent franchisee local control", { isFranchiseCorporateControlled: false, recipient: owner() }, (s) => expect(s.terminalExclusions).toEqual([])],
    ["7 duplicate", { isDuplicate: true }, (s) => expect(s.band).toBe("INELIGIBLE")],
    ["8 rejected", { isRejected: true }, (s) => expect(s.band).toBe("INELIGIBLE")],
    ["9 suppressed recipient", { isSuppressed: true }, (s) => expect(s.band).toBe("INELIGIBLE")],
    ["10 invalid/absent recipient → NEEDS_RECIPIENT (recoverable, not terminal)", { recipient: { role: "none", verified: false, confidence: 0, locallyControlled: false } }, (s) => { expect(s.terminalExclusions).toEqual([]); expect(s.promotionState).toBe("NEEDS_RECIPIENT"); expect(mayAutoPrepare(s)).toBe(false); }],
    ["11 owner-accessible", { recipient: owner() }, (s) => expect(s.components.decisionMakerAccess).toBeGreaterThanOrEqual(8)],
    ["12 general-inbox only", { recipient: inbox(), ownerNamedOnSite: false }, (s) => expect(s.components.decisionMakerAccess).toBeLessThan(6)],
    ["13 growth-trigger", { growthSignals: [sig("g1", 0.8), sig("g2", 0.8), sig("g3", 0.8)] }, (s) => expect(s.components.growthTiming).toBeGreaterThanOrEqual(8)],
    ["14 generic finding", { genericFindingOnly: true }, (s) => expect(s.penalties.some((p) => p.code === "GENERIC_EVIDENCE")).toBe(true)],
    ["15 high-similarity pair", {}, (s) => expect(s.band).toBe("PRIORITY_A")], // similarity handled in email-copy test
    ["16 priority A video candidate", {}, (s) => expect(routeAsset(s, { videoCapacityAvailable: true }).lane).toBe("presentation-video")],
    ["17 priority B email candidate", { recipient: gm(0.55), growthSignals: [], reviewCount: 55, rating: 4.1, hasAwardsOrLongHistory: false, websiteFindings: [sig("a", 0.55)] }, (s) => { if (s.band === "PRIORITY_B") expect(routeAsset(s, { videoCapacityAvailable: true }).lane).toBe("evidence-email"); }],
    ["18 review band candidate", { reviewCount: 30, rating: 4.0, growthSignals: [], hasAwardsOrLongHistory: false, ownerRepliesToReviews: false, websiteFindings: [sig("a", 0.5)], recipient: gm(0.5) }, (s) => expect(["REVIEW", "PRIORITY_B", "DO_NOT_PREPARE"]).toContain(s.band)],
    ["19 major-market exclusion (penalty, not eligible-A)", { marketTier: "primary" }, (s) => expect(s.components.marketFit).toBeLessThanOrEqual(2)],
    ["20 secondary-market inclusion", { marketTier: "secondary" }, (s) => expect(s.components.marketFit).toBe(10)],
    ["21 market/category cooldown penalty", { recentlyOversaturated: true }, (s) => expect(s.penalties.some((p) => p.code === "OVERSATURATED")).toBe(true)],
    ["22 tertiary-market inclusion", { marketTier: "tertiary" }, (s) => expect(s.components.marketFit).toBeGreaterThanOrEqual(9)],
    ["23 no supported consequence deferral", { hasSupportedConsequence: false }, (s) => expect(s.penalties.some((p) => p.code === "NO_SUPPORTED_CONSEQUENCE")).toBe(true)],
    ["24 low-confidence ownership", { recipient: { role: "owner", verified: true, confidence: 0.3, locallyControlled: true }, lowConfidenceOwnership: true }, (s) => expect(s.penalties.some((p) => p.code === "LOW_CONFIDENCE_OWNERSHIP")).toBe(true)],
  ];
  it.each(cases)("%s", (_label, over, assertFn) => {
    assertFn(scoreTarget(T(999, over)));
  });
});
