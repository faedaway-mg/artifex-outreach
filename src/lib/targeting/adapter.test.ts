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

  const F = (over: any) => buildTargetingInput({ lead: { ...strongLead, ...over }, findings, contact: ownerContact, flags: { isRejected: false, isSuppressed: false, isDuplicate: false, marketTier: "secondary", ownerRepliesToReviews: true, hasAwardsOrLongHistory: true } });

  it("§4 enterprise requires STRUCTURAL evidence — >10 locations or an unambiguous national/public name", () => {
    expect(F({ businessName: "Big Chain", locationsCount: 40 }).isEnterpriseOrPublic).toBe(true);      // structural
    expect(F({ businessName: "Nationwide Facilities", locationsCount: 1 }).isEnterpriseOrPublic).toBe(true); // explicit national token
  });

  it("§4 REGRESSION: a bare legal suffix (Inc / Group / Corp) NEVER flags enterprise — the 4 preserved names", () => {
    for (const name of ["Air Max HVAC Inc.", "Alpha One Construction Inc", "Green Advisor Inc.", "MK&C Dental Group Middletown"]) {
      const i = F({ businessName: name, locationsCount: 1 });
      expect(i.isEnterpriseOrPublic, name).toBe(false);
      expect(scoreTarget(i).terminalExclusions).toEqual([]); // NOT terminally excluded
    }
    // and a plain "Group"/"Inc" local business is not enterprise either
    expect(F({ businessName: "California Dental Group", locationsCount: 1 }).isEnterpriseOrPublic).toBe(false);
  });

  it("§4 genuine enterprise + genuine franchise are STILL excluded", () => {
    expect(scoreTarget(F({ businessName: "Regional Roofing", locationsCount: 25 })).promotionState).toBe("INELIGIBLE"); // 25 locations
    // H&R Block (corporate franchise, no independent local control) stays excluded — matches prod (no recipient).
    const hrb = buildTargetingInput({ lead: { ...strongLead, businessName: "H&R Block" }, findings, contact: null, flags: { isRejected: false, isSuppressed: false, isDuplicate: false, marketTier: "secondary" } });
    expect(hrb.isFranchiseCorporateControlled).toBe(true);
    expect(scoreTarget(hrb).promotionState).toBe("INELIGIBLE");
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
