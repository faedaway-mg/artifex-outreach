import { describe, it, expect } from "vitest";
import type { Lead } from "../types";
import type { BusinessProfile, ModernizationOpportunity, OpportunityCategory } from "../business-intelligence/types";
import { establishedBusiness, rankEmailProspect, orderEmailProspects } from "./email-ordering";
import { confidence, type ConfidenceLabel } from "../business-intelligence/confidence";

const lead = (id: string, over: Partial<Lead> = {}): Lead => ({
  id, businessName: `Biz ${id}`, publicEmail: `hi@${id}.com`, website: `https://${id}.com`,
  reviewCount: 25, rating: 4.5, leadScore: 60, ...over,
} as unknown as Lead);

const opp = (category: OpportunityCategory, label: ConfidenceLabel, observation: string): ModernizationOpportunity => ({
  id: `${category}-${label}`, category, observation, whyItMatters: `Why ${category}.`,
  estimatedImpact: { level: "Moderate", rationale: "x" }, confidence: confidence(label), basis: ["website HTML"],
});

const profile = (opps: ModernizationOpportunity[]): BusinessProfile => ({ opportunities: opps } as unknown as BusinessProfile);

describe("established business — a real footprint, so a signal may nudge it", () => {
  it("is true with a meaningful review presence", () => {
    expect(establishedBusiness(lead("a", { reviewCount: 40 }))).toBe(true);
  });
  it("is true for a smaller footprint with a real website + rating", () => {
    expect(establishedBusiness(lead("a", { reviewCount: 4, rating: 4.2, website: "https://x.com" }))).toBe(true);
  });
  it("is false for a tiny/no-footprint record (a signal alone can't make it attractive)", () => {
    expect(establishedBusiness(lead("a", { reviewCount: 0, rating: null, website: null }))).toBe(false);
    expect(establishedBusiness(lead("a", { reviewCount: 1, rating: 0, website: "https://x.com" }))).toBe(false);
  });
});

describe("email prospect ranking — fit foundational, receptivity a bounded evidence nudge", () => {
  it("a strong observed signal breaks a near-tie in favour of the receptive prospect", () => {
    const withSignal = rankEmailProspect({ lead: lead("a", { leadScore: 70 }), profile: profile([opp("Scheduling", "Observed", "No online booking")]) });
    const without = rankEmailProspect({ lead: lead("b", { leadScore: 70 }), profile: profile([]) });
    expect(withSignal.total).toBeGreaterThan(without.total);
    expect(without.receptivityBoost).toBe(0);
  });

  it("a weak signal never overpowers materially stronger fit", () => {
    const strongFit = rankEmailProspect({ lead: lead("a", { leadScore: 90 }), profile: profile([]) });
    const weakFitBigSignal = rankEmailProspect({ lead: lead("b", { leadScore: 80 }), profile: profile([opp("Scheduling", "Observed", "x"), opp("Communication", "Observed", "y")]) });
    expect(strongFit.total).toBeGreaterThan(weakFitBigSignal.total);
  });

  it("a tiny business is not made attractive by a signal (no boost when not established)", () => {
    const r = rankEmailProspect({ lead: lead("a", { leadScore: 40, reviewCount: 0, rating: null, website: null }), profile: profile([opp("Scheduling", "Observed", "x")]) });
    expect(r.receptivityBoost).toBe(0);
    expect(r.total).toBe(40);
  });

  it("surfaces a 'why now' only from a strong observed signal, grounded in the evidence, never intent", () => {
    const strong = rankEmailProspect({ lead: lead("a"), profile: profile([opp("Scheduling", "Observed", "No online booking; customers must call")]) });
    expect(strong.whyNow).toContain("no online booking; customers must call");
    expect((strong.whyNow ?? "").toLowerCase()).not.toContain("looking for");
    const reportedOnly = rankEmailProspect({ lead: lead("b"), profile: profile([opp("Communication", "Reported", "slow replies")]) });
    expect(reportedOnly.whyNow).toBeNull(); // no strong signal → keep existing copy
    const noBi = rankEmailProspect({ lead: lead("c"), profile: null });
    expect(noBi.whyNow).toBeNull();
    expect(noBi.receptivityScore).toBe(0);
  });

  it("orders a mixed set: strong-fit first, signal breaks ties, deterministic", () => {
    const leads = [lead("low", { leadScore: 50 }), lead("hi", { leadScore: 90 }), lead("mid-sig", { leadScore: 70 }), lead("mid", { leadScore: 70 })];
    const biByLead = new Map<string, { businessProfile?: BusinessProfile | null; generatedAt?: string | null }>([
      ["mid-sig", { businessProfile: profile([opp("Scheduling", "Observed", "No booking")]) }],
    ]);
    const { order } = orderEmailProspects({ leads, biByLead });
    const sorted = [...order.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([id]) => id);
    expect(sorted[0]).toBe("hi");        // strongest fit dominates
    expect(sorted[1]).toBe("mid-sig");   // signal breaks the 70-tie ahead of "mid"
    expect(sorted[2]).toBe("mid");
    expect(sorted[3]).toBe("low");
  });
});
