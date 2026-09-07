import { describe, it, expect } from "vitest";
import { buildTargetingInput, backlogCounts, exclusionsByReason } from "./adapter";
import { scoreTarget } from "./scoring";

const strongLead = { id: "l1", businessName: "Ridgeline Roofing", city: "Chattanooga", state: "TN", website: "https://r.com", reviewCount: 160, rating: 4.7, locationsCount: 2, industry: "Roofing" };
const findings = [
  { id: "f1", observation: "no online booking so searchers can't schedule without calling", whyItMatters: "after-hours jobs slip away", confidenceScore: 0.8 },
  { id: "f2", observation: "reviews live on Google, not the site", whyItMatters: "reputation isn't reinforcing the brand", confidenceScore: 0.7 },
];
const ownerContact = { role: "Owner", email: "o@r.com", verified: true, confidenceScore: 0.9, locallyControlled: true };

describe("mandate 27 — targeting adapter", () => {
  it("maps a strong local business to a PRIORITY_A/B input", () => {
    const input = buildTargetingInput({ lead: strongLead, findings, contact: ownerContact, flags: { isRejected: false, isSuppressed: false, isDuplicate: false, marketTier: "secondary", ownerRepliesToReviews: true, hasAwardsOrLongHistory: true, ownerNamedOnSite: true } });
    expect(input.hasFunctioningWebsite).toBe(true);
    expect(input.hasSupportedConsequence).toBe(true); // findings carry whyItMatters
    expect(input.recipient.role).toBe("owner");
    expect(input.recipient.verified).toBe(true);
    expect(input.highConsiderationService).toBe(true); // roofing
    const s = scoreTarget(input);
    expect(["PRIORITY_A", "PRIORITY_B"]).toContain(s.band);
  });

  it("detects a national enterprise from the name → terminal exclusion", () => {
    const input = buildTargetingInput({ lead: { ...strongLead, businessName: "Nationwide Industries Inc", locationsCount: 40 }, findings, contact: ownerContact, flags: { isRejected: false, isSuppressed: false, isDuplicate: false, marketTier: "secondary" } });
    expect(input.isEnterpriseOrPublic).toBe(true);
    expect(scoreTarget(input).band).toBe("INELIGIBLE");
  });

  it("a rejected / suppressed / duplicate lead is terminal", () => {
    for (const f of [{ isRejected: true }, { isSuppressed: true }, { isDuplicate: true }]) {
      const input = buildTargetingInput({ lead: strongLead, findings, contact: ownerContact, flags: { isRejected: false, isSuppressed: false, isDuplicate: false, marketTier: "secondary", ...f } });
      expect(scoreTarget(input).band).toBe("INELIGIBLE");
    }
  });

  it("no website → terminal INELIGIBLE; no recipient → NEEDS_RECIPIENT (recoverable, not terminal)", () => {
    expect(scoreTarget(buildTargetingInput({ lead: { ...strongLead, website: null }, findings, contact: ownerContact, flags: { isRejected: false, isSuppressed: false, isDuplicate: false, marketTier: "secondary" } })).promotionState).toBe("INELIGIBLE");
    const noRec = scoreTarget(buildTargetingInput({ lead: strongLead, findings, contact: null, flags: { isRejected: false, isSuppressed: false, isDuplicate: false, marketTier: "secondary", ownerRepliesToReviews: true, hasAwardsOrLongHistory: true } }));
    expect(noRec.terminalExclusions).toEqual([]);
    expect(noRec.promotionState).toBe("NEEDS_RECIPIENT");
  });

  it("backlogCounts + exclusionsByReason aggregate correctly", () => {
    const scores = [
      scoreTarget(buildTargetingInput({ lead: strongLead, findings, contact: ownerContact, flags: { isRejected: false, isSuppressed: false, isDuplicate: false, marketTier: "secondary", ownerRepliesToReviews: true, hasAwardsOrLongHistory: true } })),
      scoreTarget(buildTargetingInput({ lead: strongLead, findings, contact: ownerContact, flags: { isRejected: true, isSuppressed: false, isDuplicate: false, marketTier: "secondary" } })),
    ];
    const c = backlogCounts(scores);
    expect(c.total).toBe(2);
    expect(c.ineligible).toBe(1);
    expect(Object.keys(exclusionsByReason(scores)).length).toBeGreaterThan(0);
  });
});
