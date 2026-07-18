import { describe, it, expect } from "vitest";
import { makeLead } from "../test-lead";
import type { Finding } from "../types";
import { classify, TAXONOMY, FRICTION_DOMAINS } from "./friction-taxonomy";
import { buildOpportunityGraph } from "./opportunity-graph";
import { assessMaturity, MATURITY_LEVELS } from "./maturity";
import { projectEvolution } from "./evolution";
import { createLearningStore } from "./learning";
import { leadFactsProvider, findingsProvider, providers, readyProviders, PLANNED_PROVIDERS, enrich } from "./providers";
import { mergeEvidence, evidenceConfidenceScore } from "./evidence";
import { analyzeBusiness } from "./engine";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1", leadId: "lead_test", category: "Conversion journey",
    title: "No clear primary action on mobile", observation: "no obvious way to book or call from a phone",
    evidence: "No tel: link above the fold", businessImpact: "customers may give up before contact",
    modernizationDirection: "Add a single clear primary action", findingType: "Automated technical finding",
    confidence: "Verified", sourceUrl: null, analyzedAt: null, deterministic: true, approved: true,
    createdAt: "", updatedAt: "", ...overrides,
  };
}

describe("Friction taxonomy", () => {
  it("every domain carries a full knowledge entry", () => {
    for (const d of FRICTION_DOMAINS) {
      const e = TAXONOMY[d];
      expect(e.symptoms.length).toBeGreaterThan(0);
      expect(e.discoveryQuestions.length).toBeGreaterThan(0);
      expect(e.implementationApproaches.length).toBeGreaterThan(0);
      expect(e.basePriority).toBeGreaterThanOrEqual(1);
    }
  });
  it("classifies a mobile conversion observation into Customer Journey", () => {
    expect(classify("no obvious way to book or call from a phone", "Conversion journey")).toContain("Customer Journey");
  });
  it("classifies operational manual work into Operations", () => {
    expect(classify("the team re-enters everything into a spreadsheet by hand")).toContain("Operations");
  });
  it("always returns at least one domain", () => {
    expect(classify("something vague").length).toBeGreaterThan(0);
  });
});

describe("Opportunity graph", () => {
  it("connects journey friction into a downstream story with a root cause", () => {
    const g = buildOpportunityGraph([{ domain: "Customer Journey", label: "confusing journey", confidence: "Verified" }]);
    expect(g.rootCauses).toContain("Customer Journey");
    expect(g.nodes.length).toBeGreaterThan(1); // implied downstream nodes added
    expect(g.story).toContain("→");
  });
  it("recommends a single highest-leverage intervention", () => {
    const g = buildOpportunityGraph([
      { domain: "Customer Journey", label: "x", confidence: "Verified" },
      { domain: "Customer Communication", label: "y", confidence: "Likely" },
    ]);
    expect(g.highLeverage).not.toBeNull();
    expect(g.highLeverage!.resolves.length).toBeGreaterThan(0);
  });
});

describe("Technology maturity", () => {
  it("returns human-language levels and improvement potential per dimension", () => {
    const m = assessMaturity({
      hasWebsite: true, mobileFriendly: false, hasBooking: false, hasLeadForm: false, hasPublicContact: true,
      rating: 4.7, reviewCount: 180, locationsCount: 1, frictionDomains: ["Customer Journey"], analyzed: true,
    });
    expect(MATURITY_LEVELS).toContain(m.overall);
    expect(m.dimensions.length).toBe(10);
    for (const d of m.dimensions) expect(d.improvementPotential).toBeGreaterThanOrEqual(0);
    expect(m.priorityDimensions.length).toBe(3);
  });
  it("a business with no website is Emerging on Digital Presence", () => {
    const m = assessMaturity({ hasWebsite: false, mobileFriendly: null, hasBooking: null, hasLeadForm: null, hasPublicContact: true, rating: null, reviewCount: null, locationsCount: 1, frictionDomains: [], analyzed: false });
    expect(m.dimensions.find((d) => d.dimension === "Digital Presence")!.current).toBe("Emerging");
  });
});

describe("Business evolution", () => {
  it("sequences immediate → near-term → future respecting dependencies", () => {
    const g = buildOpportunityGraph([{ domain: "Customer Journey", label: "x", confidence: "Verified" }]);
    const m = assessMaturity({ hasWebsite: true, mobileFriendly: false, hasBooking: false, hasLeadForm: false, hasPublicContact: true, rating: 4.5, reviewCount: 200, locationsCount: 3, frictionDomains: ["Customer Journey"], analyzed: true });
    const plan = projectEvolution({ graph: g, maturity: m, locationsCount: 3, growthSignal: true });
    expect(plan.opportunities.some((o) => o.horizon === "immediate")).toBe(true);
    expect(plan.opportunities.some((o) => o.horizon === "future")).toBe(true);
    // immediate opportunity must come before anything that depends on it
    const seq = plan.recommendedSequence;
    const immediateIdx = seq.indexOf("op-immediate");
    const nearIdx = seq.indexOf("op-near-0");
    if (immediateIdx >= 0 && nearIdx >= 0) expect(immediateIdx).toBeLessThan(nearIdx);
  });
});

describe("Learning engine", () => {
  it("neutral prior with no samples does not move confidence", () => {
    const store = createLearningStore();
    expect(store.adjustConfidence(0.8, "Dental practice", "Customer Journey")).toBeCloseTo(0.8);
  });
  it("recorded confirmations bias confidence toward observed reality", () => {
    const store = createLearningStore();
    for (let i = 0; i < 10; i++) store.recordFriction({ industry: "Dental practice", domain: "Customer Journey", confirmed: true, leadId: "l" + i, capturedAt: null });
    const adjusted = store.adjustConfidence(0.5, "Dental practice", "Customer Journey");
    expect(adjusted).toBeGreaterThan(0.5);
  });
  it("aggregates industry engagement summaries", () => {
    const store = createLearningStore();
    store.recordEngagement({ industry: "Law firm", leadId: "l1", entryModel: "focused-improvement", durationMonths: 6, expanded: true, retainedMonths: 6, observedImprovements: [], capturedAt: null });
    const s = store.industrySummary("Law firm");
    expect(s.engagements).toBe(1);
    expect(s.expansionRate).toBe(1);
  });
});

describe("Provider architecture", () => {
  it("local adapters are ready; planned providers are not yet", () => {
    expect(readyProviders().map((p) => p.id)).toContain("lead-facts");
    expect(readyProviders().map((p) => p.id)).toContain("findings");
    expect(PLANNED_PROVIDERS.every((p) => !p.ready())).toBe(true);
    expect(providers().length).toBeGreaterThanOrEqual(2);
  });
  it("produces normalized evidence the engine can merge, provider-agnostic", async () => {
    const lead = makeLead();
    const results = await enrich({ lead, findings: [finding()], signals: { hasWebsite: true, mobileFriendly: false, slowLoad: true, hasOnlineBooking: false, hasLeadForm: false } });
    const evidence = mergeEvidence(results);
    expect(evidence.length).toBeGreaterThan(0);
    // Evidence carries no provider-specific shape beyond the id/providerId tag.
    expect(evidence.every((e) => typeof e.field === "string" && "statement" in e)).toBe(true);
    expect(evidenceConfidenceScore(evidence)).toBeGreaterThan(0);
  });
});

describe("BI engine end-to-end", () => {
  it("produces a unified understanding + operator briefing", async () => {
    const bi = await analyzeBusiness({
      lead: makeLead({ locationsCount: 3, reviewCount: 220 }),
      findings: [finding(), finding({ id: "f2", category: "Intake", observation: "appointment requests go through several separate steps" })],
      signals: { hasWebsite: true, mobileFriendly: false, slowLoad: true, hasOnlineBooking: false, hasLeadForm: false },
    });
    expect(bi.evidence.length).toBeGreaterThan(0);
    expect(bi.frictionDomains.length).toBeGreaterThan(0);
    expect(bi.opportunityGraph.highLeverage).not.toBeNull();
    expect(bi.maturity.dimensions.length).toBe(10);
    expect(bi.evolution.recommendedSequence.length).toBeGreaterThan(0);
    expect(bi.briefing.nextAction.length).toBeGreaterThan(0);
    expect(bi.briefing.businessImprovementPotential.treatment).toBe(bi.improvement.treatment);
    expect(bi.providerCoverage.contributing).toContain("lead-facts");
  });

  it("respects hard overrides end-to-end (closed business → Do Not Contact)", async () => {
    const bi = await analyzeBusiness({ lead: makeLead({ businessStatus: "CLOSED_PERMANENTLY" }) });
    expect(bi.improvement.treatment).toBe("Do Not Contact");
    expect(bi.briefing.nextAction.toLowerCase()).toContain("do not contact");
  });
});
