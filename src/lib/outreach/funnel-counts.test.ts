import { describe, it, expect } from "vitest";
import { classifyLead, computeFunnel, sendableNowCount, type LeadFunnelFacts } from "./funnel-counts";

const lead = (o: Partial<LeadFunnelFacts> & { leadId: string }): LeadFunnelFacts => ({
  videoRequired: false, videoReady: false, rendering: false, renderFailed: false,
  sendEligible: true, scheduled: false, sentToday: false, ...o,
});

describe("funnel classification (mandate VI) — one canonical status per lead", () => {
  it("email-only + send-eligible → eligible-now", () => {
    expect(classifyLead(lead({ leadId: "a" }))).toBe("eligible-now");
  });
  it("video-required WITHOUT a ready video → awaiting-video (never eligible, stays out of the batch)", () => {
    expect(classifyLead(lead({ leadId: "b", videoRequired: true, videoReady: false }))).toBe("awaiting-video");
  });
  it("video-required WITH a ready video → eligible-now", () => {
    expect(classifyLead(lead({ leadId: "c", videoRequired: true, videoReady: true }))).toBe("eligible-now");
  });
  it("video-required + rendering / failed → rendering / failed (not awaiting)", () => {
    expect(classifyLead(lead({ leadId: "d", videoRequired: true, rendering: true }))).toBe("rendering");
    expect(classifyLead(lead({ leadId: "e", videoRequired: true, renderFailed: true }))).toBe("failed");
  });
  it("not send-eligible → blocked", () => {
    expect(classifyLead(lead({ leadId: "f", sendEligible: false, blockedReason: "suppressed" }))).toBe("blocked");
  });
  it("scheduled and sent-today take precedence (counted once, unambiguously)", () => {
    expect(classifyLead(lead({ leadId: "g", scheduled: true, sendEligible: true }))).toBe("scheduled");
    expect(classifyLead(lead({ leadId: "h", sentToday: true, scheduled: true }))).toBe("sent-today");
  });
});

describe("computeFunnel — reconciled categories, distinct-lead, no padding", () => {
  const facts: LeadFunnelFacts[] = [
    lead({ leadId: "e1" }), lead({ leadId: "e2" }),                                   // eligible now (email-only)
    lead({ leadId: "v1", videoRequired: true, videoReady: true }),                    // eligible now (video ready)
    lead({ leadId: "w1", videoRequired: true }), lead({ leadId: "w2", videoRequired: true }), // awaiting video
    lead({ leadId: "r1", videoRequired: true, rendering: true }),                     // rendering
    lead({ leadId: "x1", sendEligible: false, blockedReason: "no evidence" }),        // blocked
    lead({ leadId: "s1", scheduled: true }),                                          // scheduled
    lead({ leadId: "t1", sentToday: true }),                                          // sent today
  ];

  it("counts each bucket exactly once and reconciles to the input size", () => {
    const c = computeFunnel({ leads: facts, dailyCap: 20, sentToday: 1 });
    expect(c.eligibleNow).toBe(3);
    expect(c.awaitingVideo).toBe(2);
    expect(c.rendering).toBe(1);
    expect(c.blocked).toBe(1);
    expect(c.scheduled).toBe(1);
    expect(c.sentToday).toBe(1);
    const total = c.eligibleNow + c.awaitingVideo + c.rendering + c.failed + c.blocked + c.scheduled + c.sentToday;
    expect(total).toBe(facts.length); // nothing lost, nothing double-counted
  });

  it("remaining capacity = cap − sentToday (capacity, not available emails); never padded", () => {
    const c = computeFunnel({ leads: facts, dailyCap: 20, sentToday: 8 });
    expect(c.remainingCapacity).toBe(12);
    // eligibleNow is the REAL eligible count (3), not padded up to capacity.
    expect(c.eligibleNow).toBe(3);
  });

  it("sendableNowCount is bounded by remaining capacity", () => {
    const many = Array.from({ length: 15 }, (_, i) => lead({ leadId: "m" + i }));
    const c = computeFunnel({ leads: many, dailyCap: 20, sentToday: 18 });
    expect(c.eligibleNow).toBe(15);
    expect(c.remainingCapacity).toBe(2);
    expect(sendableNowCount(c)).toBe(2); // can SEND 2 now, though 15 are eligible (rest schedule for next window)
  });

  it("actionable id buckets match the counts", () => {
    const c = computeFunnel({ leads: facts, dailyCap: 20, sentToday: 0 });
    expect(c.readyToApproveAndSchedule.sort()).toEqual(["e1", "e2", "v1"]);
    expect(c.needsVoiceover.sort()).toEqual(["w1", "w2"]);
    expect(c.renderingOrFailed).toEqual(["r1"]);
    expect(c.blockedLeads).toEqual([{ leadId: "x1", reason: "no evidence" }]);
  });

  it("de-duplicates repeated lead ids (distinct-lead accounting)", () => {
    const dup = [lead({ leadId: "z" }), lead({ leadId: "z" }), lead({ leadId: "z", sendEligible: false })];
    const c = computeFunnel({ leads: dup, dailyCap: 20, sentToday: 0 });
    expect(c.eligibleNow + c.blocked).toBe(1); // one distinct lead, counted once
  });
});
