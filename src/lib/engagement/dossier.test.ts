import { describe, it, expect } from "vitest";
import type { RelationshipMemoryItem, MemoryCategory, MemoryStatus, RoadmapProgressItem, RoadmapStatus, OutcomeReviewItem, Lead } from "../types";
import { assembleEngagementContext, buildConsultingDossier, buildLivingProposal } from "./index";
import { buildKnowledgeGraph } from "../outcomes";

const NOW = Date.parse("2026-07-22T00:00:00Z");
let seq = 0;
const mem = (category: MemoryCategory, value: string, status: MemoryStatus = "Verified"): RelationshipMemoryItem => {
  seq += 1;
  return { id: `m${seq}`, leadId: "L1", category, title: value.slice(0, 20), value, status, confidence: "High", source: "Discovery Meeting", supportingContext: null, operatorNotes: null, createdAt: "2026-07-18T00:00:00Z", updatedAt: "2026-07-18T00:00:00Z" };
};
const prog = (recommendationId: string, status: RoadmapStatus): RoadmapProgressItem => { seq += 1; return { id: `p${seq}`, leadId: "L1", recommendationId, title: "Connect the tools they already trust", status, operatorNotes: null, createdAt: "2026-07-19T00:00:00Z", updatedAt: "2026-07-20T00:00:00Z" }; };
const review = (recommendationId: string, status: OutcomeReviewItem["status"], leadId = "L1"): OutcomeReviewItem => { seq += 1; return { id: `oc${seq}`, leadId, recommendationId, title: "Connect the tools", status, expectedOutcome: "Less re-keying", beforeState: "manual", observedOutcome: "Data stopped being re-keyed", evidence: "Operator note", unexpectedConsequences: "", lessonsLearned: "", confidence: "High", reviewedAt: "2026-07-21T00:00:00Z", operatorNotes: null, createdAt: "2026-07-20T00:00:00Z", updatedAt: "2026-07-21T00:00:00Z" }; };

function fullMemory(): RelationshipMemoryItem[] {
  return [
    mem("Existing Systems", "We use Square for checkout."),
    mem("Existing Systems", "We use QuickBooks for the books."),
    mem("Existing Systems", "No online booking — every appointment is by phone."),
    mem("Decision Makers", "The owner personally handles scheduling."),
    mem("Current Priorities", "The front desk is overwhelmed with phone calls."),
    mem("Business Goals", "We're trying to hire another hygienist."),
    mem("Known Constraints", "The team is completely overwhelmed already."),
  ];
}
function ctx(over: Partial<Parameters<typeof assembleEngagementContext>[0]> = {}) {
  return assembleEngagementContext({ lead: { id: "L1", businessName: "Bright Smiles Dental" } as unknown as Lead, memory: fullMemory(), meetings: [], proposals: [], plans: [], progress: [], reviews: [], outreach: [], inbound: [], snapshots: [], now: NOW, ...over });
}

describe("consulting dossier — full provenance, nothing without evidence", () => {
  it("every recommendation carries verified memories, reasoning, roadmap, outcome expectations", () => {
    const d = buildConsultingDossier(ctx());
    expect(d.recommendations.length).toBeGreaterThan(0);
    for (const r of d.recommendations) {
      expect(r.memories.length).toBeGreaterThan(0); // never without evidence
      expect(r.reasoning).toBeTruthy();
      expect(r.roadmap).toBeTruthy();
      expect(r.expectedOutcome.length).toBeGreaterThan(0);
      expect(r.successMetric).toBeTruthy();
      expect(r.confidence.factors.length).toBeGreaterThan(0);
    }
  });

  it("surfaces recorded outcome evidence when a review exists", () => {
    const d = buildConsultingDossier(ctx({ progress: [prog("rec_integration-over-replacement", "Completed")], reviews: [review("rec_integration-over-replacement", "Supported")] }));
    const rec = d.recommendations.find((r) => r.recommendationId === "rec_integration-over-replacement")!;
    expect(rec.outcome?.status).toBe("Supported");
  });

  it("attaches cross-engagement knowledge support only when a pattern exists", () => {
    const patterns = buildKnowledgeGraph([review("rec_integration-over-replacement", "Supported", "L1"), review("rec_integration-over-replacement", "Supported", "L2")]);
    const d = buildConsultingDossier(ctx(), patterns);
    const rec = d.recommendations.find((r) => r.recommendationId === "rec_integration-over-replacement");
    expect(rec?.knowledgeSupport?.engagements).toBe(2);
  });

  it("an empty business yields an empty, non-fabricated review", () => {
    const d = buildConsultingDossier(assembleEngagementContext({ lead: { id: "L1", businessName: "X" } as unknown as Lead, memory: [], meetings: [], proposals: [], plans: [], progress: [], reviews: [], outreach: [], inbound: [], snapshots: [], now: NOW }));
    expect(d.recommendations).toHaveLength(0);
  });
});

describe("living proposal — current, deduped, completed work disappears", () => {
  it("moves completed work to 'delivered' and out of active recommendations", () => {
    const c = ctx({ progress: [prog("rec_integration-over-replacement", "Completed")], reviews: [review("rec_integration-over-replacement", "Supported")] });
    const d = buildConsultingDossier(c);
    const p = buildLivingProposal(c, d, { entry: 5000, twelveMonth: 30000 });
    expect(p.delivered.some((x) => /connect the tools/i.test(x.title))).toBe(true);
    expect(p.recommendations.some((r) => r.recommendationId === "rec_integration-over-replacement")).toBe(false);
    expect(p.validatedOutcomes.length).toBeGreaterThanOrEqual(1);
  });

  it("recommendations are ordered and each is unique (no duplicates)", () => {
    const c = ctx();
    const p = buildLivingProposal(c, buildConsultingDossier(c), { entry: 5000, twelveMonth: 30000 });
    const ids = p.recommendations.map((r) => r.recommendationId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(p.recommendations.map((r) => r.order)).toEqual(p.recommendations.map((_, i) => i + 1));
  });

  it("stays a draft pending operator approval", () => {
    const c = ctx();
    const p = buildLivingProposal(c, buildConsultingDossier(c), { entry: 5000, twelveMonth: 30000 });
    expect(p.approvalNote.toLowerCase()).toMatch(/approve|draft/);
  });
});
