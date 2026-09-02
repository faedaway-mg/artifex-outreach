import { describe, it, expect } from "vitest";
import { deriveLeadFacts, type LeadInputs } from "./today-funnel";
import { classifyLead, computeFunnel } from "./funnel-counts";

const base = (o: Partial<LeadInputs> & { id: string }): LeadInputs => ({
  lead: { id: o.id, businessName: "Biz " + o.id, publicEmail: "x@y.com" } as any,
  hasOpenVideoTask: false, videoReady: false, videoRendering: false, videoFailed: false,
  sendEligible: true, blockedReason: null, scheduled: false, sentToday: false, finding: "f", recipient: "x@y.com",
  ...o,
});

describe("today-funnel deriveLeadFacts → canonical classification (mandate IV/VI)", () => {
  it("a video-REQUIRED lead cannot be scheduleable before its video is ready (never eligible-now)", () => {
    const f = deriveLeadFacts(base({ id: "a", hasOpenVideoTask: true, videoReady: false, sendEligible: true }));
    expect(classifyLead(f)).toBe("awaiting-video");
    const funnel = computeFunnel({ leads: [f], dailyCap: 20, sentToday: 0 });
    expect(funnel.readyToApproveAndSchedule).not.toContain("a"); // NOT scheduleable
    expect(funnel.needsVoiceover).toContain("a");
  });

  it("the same lead becomes eligible-now ONLY once its video is ready", () => {
    const f = deriveLeadFacts(base({ id: "a", hasOpenVideoTask: true, videoReady: true, sendEligible: true }));
    expect(classifyLead(f)).toBe("eligible-now");
    expect(computeFunnel({ leads: [f], dailyCap: 20, sentToday: 0 }).readyToApproveAndSchedule).toContain("a");
  });

  it("no lead appears in conflicting categories — classifyLead is total and single-valued", () => {
    const inputs: LeadInputs[] = [
      base({ id: "e" }),                                                        // eligible
      base({ id: "w", hasOpenVideoTask: true }),                               // awaiting video
      base({ id: "r", hasOpenVideoTask: true, videoRendering: true }),         // rendering
      base({ id: "x", sendEligible: false, blockedReason: "suppressed" }),     // blocked
      base({ id: "s", scheduled: true }),                                      // scheduled
      base({ id: "t", sentToday: true }),                                      // sent today
    ];
    const facts = inputs.map(deriveLeadFacts);
    const funnel = computeFunnel({ leads: facts, dailyCap: 20, sentToday: 1 });
    // Every lead lands in exactly ONE of the id buckets (union is disjoint + covers all).
    const buckets = [funnel.readyToApproveAndSchedule, funnel.needsVoiceover, funnel.renderingOrFailed, funnel.blockedLeads.map((b) => b.leadId), funnel.scheduledLeads];
    for (const id of ["e", "w", "r", "x", "s"]) {
      const hits = buckets.filter((b) => b.includes(id)).length;
      expect(hits, `${id} should be in exactly one bucket`).toBe(1);
    }
    // 't' (sent-today) is counted but not in any actionable bucket.
    expect(buckets.every((b) => !b.includes("t"))).toBe(true);
    expect(funnel.sentToday).toBe(1);
  });
});
