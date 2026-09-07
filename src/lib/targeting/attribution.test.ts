import { describe, it, expect } from "vitest";
import { attributeOutcomes, mayRetrainPersona, MIN_RETRAIN_COHORT, COLD_RAMP, ATTRIBUTION_VERSION, type OutcomeEvent, type OutcomeEventType } from "./attribution";

const ev = (leadId: string, type: OutcomeEventType, over: Partial<OutcomeEvent> = {}): OutcomeEvent => ({
  leadId, at: "2026-09-07T00:00:00Z", type, personaVersion: "persona-v1", tier: "PRIORITY_A", vertical: "Roofing",
  marketBand: "secondary", evidencePattern: "booking", recipientRole: "owner", asset: "personalized-video",
  messageVersion: "m1", mailbox: "hello@x", transport: "google-workspace", ...over,
});

describe("persona gate Phase 9 — outcome attribution", () => {
  it("is versioned + aggregates events into rates (missing data → null, never invented)", () => {
    const r = attributeOutcomes([], "tier");
    expect(r.version).toBe(ATTRIBUTION_VERSION);
    expect(r.overall.delivered).toBe(0);
    expect(r.overall.replyRate).toBeNull(); // no deliveries → null, not 0-invented
  });

  it("attributes by dimension (tier / vertical / recipient / asset / transport)", () => {
    const events = [
      ev("a", "delivered"), ev("a", "positive-reply"), ev("a", "meeting-booked"), ev("a", "meeting-held"),
      ev("b", "delivered", { tier: "PRIORITY_B", vertical: "HVAC" }), ev("b", "hard-bounce", { tier: "PRIORITY_B", vertical: "HVAC" }),
      ev("c", "delivered"), ev("c", "negative-reply"),
    ];
    const byTier = attributeOutcomes(events, "tier");
    expect(byTier.overall.delivered).toBe(3);
    expect(byTier.byDimension["PRIORITY_A"].positiveReply).toBe(1);
    expect(byTier.byDimension["PRIORITY_A"].meetingHeld).toBe(1);
    expect(byTier.byDimension["PRIORITY_A"].heldRate).toBeCloseTo(0.5, 5); // 1 held / 2 delivered
    expect(byTier.byDimension["PRIORITY_B"].bounceRate).toBeCloseTo(1, 5);
    const byVertical = attributeOutcomes(events, "vertical");
    expect(byVertical.byDimension["Roofing"]).toBeTruthy();
    expect(byVertical.byDimension["HVAC"]).toBeTruthy();
  });

  it("does NOT allow auto-retrain from a small sample — requires cohort + operator approval", () => {
    const small = attributeOutcomes([ev("a", "delivered"), ev("a", "meeting-held")], "tier").overall;
    expect(mayRetrainPersona(small, true).allowed).toBe(false); // cohort too small even if approved
    // synthesize a large cohort
    const big = attributeOutcomes(Array.from({ length: 250 }, (_, i) => ev(`l${i}`, "delivered")).concat(Array.from({ length: 12 }, (_, i) => ev(`m${i}`, "meeting-held"))), "tier").overall;
    expect(mayRetrainPersona(big, false).allowed).toBe(false); // cohort ok but not approved
    expect(mayRetrainPersona(big, true).allowed).toBe(true);    // cohort + approval
    expect(MIN_RETRAIN_COHORT.delivered).toBeGreaterThan(0);
  });

  it("codifies the controlled cold ramp (20/weekday for 3 weeks)", () => {
    expect(COLD_RAMP.dailyCap).toBe(20);
    expect(COLD_RAMP.holdWeeks).toBe(3);
  });
});
