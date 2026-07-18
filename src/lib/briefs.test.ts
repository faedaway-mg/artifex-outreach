import { describe, it, expect } from "vitest";
import { buildSnapshot } from "./snapshot";
import { internalOpportunityBrief, clientConversationBrief } from "./briefs";
import { makeLead } from "./test-lead";
import type { Finding } from "./types";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1", leadId: "lead_test", category: "Conversion journey",
    title: "No clear primary action on mobile",
    observation: "no obvious way to book or call from a phone",
    evidence: "No tel: link above the fold on mobile", businessImpact: "customers may give up before contact",
    modernizationDirection: "Add a single clear primary action", findingType: "Automated technical finding",
    confidence: "Verified", sourceUrl: null, analyzedAt: null, deterministic: true, approved: true,
    createdAt: "", updatedAt: "", ...overrides,
  };
}

describe("Tiered deliverables", () => {
  const snap = buildSnapshot(makeLead(), [
    finding({ id: "a", findingType: "Automated technical finding", confidence: "Verified" }),
    finding({ id: "b", findingType: "AI inference", confidence: "Unknown", observation: "the team likely handles follow-up by hand" }),
  ]);

  it("internal brief carries full evidence, scoring, and strategy", () => {
    const b = internalOpportunityBrief(snap);
    expect(b.audience).toBe("internal");
    expect(typeof b.improvementScore).toBe("number");
    expect(b.hypothesesToValidate.length).toBeGreaterThan(0);
    expect(b.relationshipValue.entry).toBeGreaterThan(0);
    expect(b.conversationStrategy.doNotAssume.length).toBeGreaterThan(0);
  });

  it("client brief is redacted: no scores, no investment numbers, not a diagnosis", () => {
    const c = clientConversationBrief(snap);
    const blob = JSON.stringify(c).toLowerCase();
    expect(blob).not.toContain("score");
    expect(blob).not.toContain("partnershiplikelihood");
    expect(blob).not.toContain("$");
    expect(c.disclaimer.toLowerCase()).toContain("not a diagnosis");
  });

  it("client brief only states directly-observed friction as 'what we noticed'", () => {
    const c = clientConversationBrief(snap);
    // The AI-inference finding must NOT appear as a stated observation.
    expect(c.whatWeNoticed.join(" ").toLowerCase()).not.toContain("by hand");
    expect(c.whatWeNoticed.join(" ").toLowerCase()).toContain("book or call");
  });
});
