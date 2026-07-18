import { describe, it, expect } from "vitest";
import { buildSnapshot } from "./snapshot";
import { makeLead } from "./test-lead";
import type { Finding } from "./types";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    leadId: "lead_test",
    category: "Conversion journey",
    title: "No clear primary action on mobile",
    observation: "the homepage has no obvious way to book or call from a phone",
    evidence: "No tel: link or booking button above the fold on mobile viewport",
    businessImpact: "customers may give up before making contact",
    modernizationDirection: "Add a single clear primary action",
    findingType: "Automated technical finding",
    confidence: "Verified",
    sourceUrl: null,
    analyzedAt: null,
    deterministic: true,
    approved: true,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("Business Technology Snapshot", () => {
  it("separates directly-observed facts (safe for outreach) from inferences (hold for discovery)", () => {
    const findings = [
      finding({ id: "a", findingType: "Automated technical finding", confidence: "Verified" }),
      finding({ id: "b", findingType: "AI inference", confidence: "Unknown", observation: "the team probably handles follow-up manually" }),
    ];
    const snap = buildSnapshot(makeLead(), findings);
    const observed = snap.visibleFriction.find((f) => f.observationType === "Directly observed fact");
    const inferred = snap.visibleFriction.find((f) => f.observationType !== "Directly observed fact");
    expect(observed?.safeForOutreach).toBe(true);
    expect(inferred?.safeForOutreach).toBe(false);
  });

  it("hedges potential impact (never states certainty)", () => {
    const snap = buildSnapshot(makeLead(), [finding()]);
    expect(snap.visibleFriction[0].potentialImpact.toLowerCase()).toMatch(/^(may|might|could|can|likely)/);
  });

  it("produces strengths, hypotheses, discovery questions, and opportunity areas", () => {
    const snap = buildSnapshot(makeLead(), [finding()]);
    expect(snap.observedStrengths.length).toBeGreaterThan(0);
    expect(snap.hypothesesToValidate.length).toBeGreaterThan(0);
    expect(snap.discoveryQuestions.length).toBeGreaterThan(0);
    expect(snap.opportunityAreas.length).toBeGreaterThan(0);
  });

  it("recommends an outreach angle and a human conversation strategy", () => {
    const snap = buildSnapshot(makeLead(), [finding()]);
    expect(snap.outreachAngle.opener.length).toBeGreaterThan(0);
    expect(snap.conversationStrategy.doNotAssume.length).toBeGreaterThan(0);
    expect(snap.conversationStrategy.goalOfFirstConversation.length).toBeGreaterThan(0);
  });

  it("flags thin evidence as hypotheses to validate", () => {
    const snap = buildSnapshot(makeLead({ reviewCount: 2, website: null, scoreBreakdown: null }), []);
    expect(snap.evidence.confidence).toBeLessThan(60);
    expect(snap.evidence.note.toLowerCase()).toContain("hypothes");
  });
});
