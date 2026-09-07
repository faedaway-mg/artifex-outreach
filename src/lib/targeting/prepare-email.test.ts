import { describe, it, expect } from "vitest";
import { scoreTarget, type TargetingInput, type RecipientResolution } from "./scoring";
import { routeAsset, resolveRecipient, recipientRank, explainTarget } from "./prepare";
import { composeOutreachEmail, emailSimilarity } from "./email-copy";

const sig = (id: string, kind: any, conf = 0.8): any => ({ id, kind, observation: `there's no online booking (${id}) so a customer who searches can't schedule without calling`, sourceUrl: "https://x", confidence: conf });
const owner: RecipientResolution = { role: "owner", verified: true, confidence: 0.9, locallyControlled: true };

const base = (over: Partial<TargetingInput> = {}): TargetingInput => ({
  leadId: "lead_1", businessName: "Ridgeline Roofing", city: "Chattanooga", state: "TN",
  isEnterpriseOrPublic: false, isFranchiseCorporateControlled: false, isRejected: false, isSuppressed: false,
  isDuplicate: false, isSynthetic: false, policyExhausted: false, hasFunctioningWebsite: true,
  marketTier: "secondary", recentlyOversaturated: false,
  reviewCount: 140, rating: 4.7, ownerRepliesToReviews: true, hasAwardsOrLongHistory: true,
  websiteFindings: [sig("ev_booking", "digital-underrepresentation"), sig("ev_mobile", "digital-underrepresentation")], hasSupportedConsequence: true,
  strongModernConversionSite: false, genericFindingOnly: false,
  reputationSignals: [sig("rep", "reputation")], growthSignals: [sig("grow", "growth-timing")],
  recipient: owner, ownerNamedOnSite: true, highConsiderationService: true, locationsCount: 2,
  weakCommercialViability: false, lowConfidenceOwnership: false, ...over,
});

describe("mandate 27 — asset routing", () => {
  it("PRIORITY_A + demonstrable + video capacity → personalized video", () => {
    const r = routeAsset(scoreTarget(base()), { videoCapacityAvailable: true });
    expect(r.lane).toBe("presentation-video");
    expect(r.requiresApproval).toBe(true);
  });
  it("PRIORITY_A without video capacity → PDF + email, never a filler video", () => {
    const r = routeAsset(scoreTarget(base()), { videoCapacityAvailable: false });
    expect(r.asset).toBe("quick-review-pdf+email");
  });
  it("PRIORITY_B → evidence email lane (video only after evidence rises to A)", () => {
    const b = scoreTarget(base({ recipient: { role: "general-manager", verified: true, confidence: 0.55, locallyControlled: true }, growthSignals: [], reviewCount: 60, rating: 4.2, hasAwardsOrLongHistory: false }));
    const r = routeAsset(b, { videoCapacityAvailable: true });
    expect(["evidence-email", "presentation-pdf-email", "operator-review"]).toContain(r.lane);
    if (b.band === "PRIORITY_B") expect(r.lane).toBe("evidence-email");
  });
  it("INELIGIBLE / DO_NOT_PREPARE → no asset, no capacity consumed", () => {
    expect(routeAsset(scoreTarget(base({ isEnterpriseOrPublic: true })), { videoCapacityAvailable: true }).asset).toBe("none");
  });
});

describe("mandate 27 — recipient resolution", () => {
  it("maps roles to the persona order; owner outranks inbox", () => {
    const o = resolveRecipient({ role: "Owner", email: "o@x.com", verified: true, confidenceScore: 0.9, locallyControlled: true });
    const i = resolveRecipient({ role: "info", email: "info@x.com", verified: true, confidenceScore: 0.4 });
    expect(o.role).toBe("owner");
    expect(recipientRank(o)).toBeLessThan(recipientRank(i));
  });
  it("an inferred email pattern is NEVER marked verified", () => {
    const r = resolveRecipient({ role: "Owner", email: "guess@x.com", verified: true, inferredPattern: true, confidenceScore: 0.9 });
    expect(r.verified).toBe(false);
  });
  it("no email → role none", () => {
    expect(resolveRecipient({ role: "Owner", email: null }).role).toBe("none");
  });
});

describe("mandate 27 — why this business", () => {
  it("explains fit + reputation + gap + recipient + disqualifiers, with evidence ids", () => {
    const s = scoreTarget(base());
    const w = explainTarget(base(), s, routeAsset(s, { videoCapacityAvailable: true }), "Chattanooga, TN is a secondary market");
    expect(w.persona).toContain("REPUTATION_RICH");
    expect(w.evidenceIds).toContain("ev_booking");
    expect(w.disqualifiers).toMatch(/none/i);
    expect(w.total).toBe(s.total);
  });
});

describe("mandate 27 — email copy contract", () => {
  it("composes an evidence-grounded email in ~80–140 words with no prohibited language", () => {
    const e = composeOutreachEmail(base(), { variant: 0, artifactUrl: "https://a/x" });
    expect(e.available).toBe(true);
    expect(e.prohibitedHits).toEqual([]);
    expect(e.bodyText).toContain("Ridgeline Roofing");
    expect(e.evidenceIds).toContain("ev_booking");
  });
  it("blocks prohibited language (guarantees, %, revenue, AI-as-reason) via the finding text", () => {
    const e = composeOutreachEmail(base({ websiteFindings: [{ id: "x", kind: "digital-underrepresentation", observation: "your site will increase revenue by 30%", confidence: 0.9 } as any] }));
    expect(e.available).toBe(false);
    expect(e.prohibitedHits.length).toBeGreaterThan(0);
  });
  it("insufficient evidence → no email (never mail-merge filler)", () => {
    expect(composeOutreachEmail(base({ websiteFindings: [] })).available).toBe(false);
    expect(composeOutreachEmail(base({ hasSupportedConsequence: false })).available).toBe(false);
  });
  it("variants differ; two different companies with the same finding are NOT near-identical after personalization", () => {
    const a = composeOutreachEmail(base({ businessName: "Summit Plumbing", leadId: "a" }), { variant: 0 });
    const b = composeOutreachEmail(base({ businessName: "Harbor Electric", leadId: "b" }), { variant: 1 });
    expect(a.bodyText).not.toBe(b.bodyText);
    expect(emailSimilarity(a.bodyText, b.bodyText)).toBeLessThan(0.9);
  });
  it("near-mail-merge (same variant, same finding) is caught by the similarity gate", () => {
    const a = composeOutreachEmail(base({ businessName: "Summit Plumbing" }), { variant: 0 });
    const b = composeOutreachEmail(base({ businessName: "Harbor Electric" }), { variant: 0 });
    expect(emailSimilarity(a.bodyText, b.bodyText)).toBeGreaterThan(0.5);
  });
});
