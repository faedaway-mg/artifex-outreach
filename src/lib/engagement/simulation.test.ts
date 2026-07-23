import { describe, it, expect } from "vitest";
import type { RelationshipMemoryItem, MemoryCategory, MemoryStatus, RoadmapProgressItem, RoadmapStatus, OutcomeReviewItem, Lead } from "../types";
import { assembleEngagementContext, buildCommandCenter, buildConsultingDossier, buildLivingProposal, buildPortfolioRow, pendingWork, engagementTimeline } from "./index";
import { checkIntegrity } from "../integrity";

const NOW = Date.parse("2026-07-22T00:00:00Z");
let seq = 0;
const M = (category: MemoryCategory, value: string, status: MemoryStatus = "Verified", at = "2026-07-18T00:00:00Z"): RelationshipMemoryItem => {
  seq += 1;
  return { id: `m${seq}`, leadId: "L1", category, title: value.slice(0, 20), value, status, confidence: "High", source: "Discovery Meeting", supportingContext: null, operatorNotes: null, createdAt: at, updatedAt: at };
};
const P = (recommendationId: string, status: RoadmapStatus): RoadmapProgressItem => { seq += 1; return { id: `p${seq}`, leadId: "L1", recommendationId, title: "Work", status, operatorNotes: null, createdAt: "2026-07-19T00:00:00Z", updatedAt: "2026-07-20T00:00:00Z" }; };
const R = (recommendationId: string, status: OutcomeReviewItem["status"]): OutcomeReviewItem => { seq += 1; return { id: `oc${seq}`, leadId: "L1", recommendationId, title: "Work", status, expectedOutcome: "x", beforeState: "before", observedOutcome: status === "Awaiting Review" ? "" : "observed change", evidence: status === "Awaiting Review" ? "" : "Operator note", unexpectedConsequences: "", lessonsLearned: "", confidence: "Medium", reviewedAt: status === "Awaiting Review" ? null : "2026-07-21T00:00:00Z", operatorNotes: null, createdAt: "2026-07-20T00:00:00Z", updatedAt: "2026-07-21T00:00:00Z" }; };

const SYSTEMS = () => [M("Existing Systems", "We use Square."), M("Existing Systems", "We use QuickBooks."), M("Existing Systems", "No online booking — every appointment is by phone.")];
const SCHED = () => [M("Decision Makers", "The owner personally handles scheduling."), M("Current Priorities", "The front desk is overwhelmed with phone calls.")];
const GROWTH = () => [M("Business Goals", "We're trying to hire another hygienist."), M("Known Constraints", "The team is completely overwhelmed already.")];

function build(over: Partial<Parameters<typeof assembleEngagementContext>[0]>) {
  return assembleEngagementContext({ lead: { id: "L1", businessName: "Test Co" } as unknown as Lead, memory: [], meetings: [], proposals: [], plans: [], progress: [], reviews: [], outreach: [], inbound: [], snapshots: [], now: NOW, ...over });
}

// Every scenario runs the full workflow and must stay coherent & deterministic.
const SCENARIOS: Array<{ name: string; over: Parameters<typeof build>[0]; check?: (r: ReturnType<typeof run>) => void }> = [
  { name: "small business", over: { memory: [M("Decision Makers", "The owner is Dana.")] } },
  { name: "large business", over: { memory: [...SYSTEMS(), ...SCHED(), ...GROWTH()], progress: [P("rec_integration-over-replacement", "Completed"), P("rec_manual-scheduling", "In Progress")] } },
  { name: "fast-moving client", over: { memory: SYSTEMS().map((m) => ({ ...m, createdAt: "2026-07-21T00:00:00Z", updatedAt: "2026-07-21T00:00:00Z" })) }, check: (r) => expect(r.cc.momentum.label).toBe("Active") },
  { name: "inactive client", over: { memory: SYSTEMS().map((m) => ({ ...m, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" })) }, check: (r) => expect(r.cc.momentum.label).toBe("Quiet") },
  { name: "contradictory information", over: { memory: [M("Decision Makers", "The owner is John."), M("Decision Makers", "The owner is Maria.")] }, check: (r) => expect(r.pending.some((p) => p.kind === "contradiction")).toBe(true) },
  { name: "no recommendations", over: { memory: [M("Important Dates", "They renovate in Q3.")] }, check: (r) => { expect(r.dossier.recommendations).toHaveLength(0); expect(r.proposal.recommendations).toHaveLength(0); } },
  { name: "heavy recommendation load", over: { memory: [...SYSTEMS(), ...SCHED(), ...GROWTH()] }, check: (r) => expect(r.dossier.recommendations.length).toBeGreaterThanOrEqual(2) },
  { name: "failed implementation", over: { memory: [...SYSTEMS(), ...SCHED()], progress: [P("rec_integration-over-replacement", "Completed")], reviews: [R("rec_integration-over-replacement", "Not Supported")] } },
  { name: "mixed outcomes", over: { memory: [...SYSTEMS(), ...SCHED()], progress: [P("rec_integration-over-replacement", "Completed")], reviews: [R("rec_integration-over-replacement", "Mixed")] } },
  { name: "long engagement", over: { memory: [...SYSTEMS().map((m) => ({ ...m, createdAt: "2026-02-01T00:00:00Z" })), ...SCHED()], progress: [P("rec_integration-over-replacement", "Measured")], reviews: [R("rec_integration-over-replacement", "Supported")] } },
];

function run(over: Parameters<typeof build>[0]) {
  const ctx = build(over);
  return {
    ctx,
    cc: buildCommandCenter(ctx),
    dossier: buildConsultingDossier(ctx),
    proposal: buildLivingProposal(ctx, buildConsultingDossier(ctx), { entry: 5000, twelveMonth: 30000 }),
    portfolio: buildPortfolioRow(ctx),
    pending: pendingWork(ctx),
    timeline: engagementTimeline(ctx),
  };
}

describe("full engagement simulation — every scenario stays coherent", () => {
  for (const s of SCENARIOS) {
    it(`${s.name}: composes end-to-end without contradiction`, () => {
      seq = 0;
      const r = run(s.over);
      // Coherence invariants that must hold for any business shape:
      expect(r.cc.healthTotal).toBeGreaterThan(0);
      expect(r.portfolio.recommendationCount).toBeGreaterThanOrEqual(r.dossier.recommendations.filter((x) => x.roadmap && x.roadmap.status !== "Completed" && x.roadmap.status !== "Measured").length);
      // Completed work never appears in the active proposal.
      const doneIds = new Set(r.dossier.recommendations.filter((x) => x.roadmap && ["Completed", "Measured"].includes(x.roadmap.status)).map((x) => x.recommendationId));
      expect(r.proposal.recommendations.every((p) => !doneIds.has(p.recommendationId))).toBe(true);
      // Every dossier recommendation has evidence.
      expect(r.dossier.recommendations.every((x) => x.memories.length > 0)).toBe(true);
      // Data integrity holds for the scenario's records.
      const integrity = checkIntegrity({ leadIds: new Set(["L1"]), memory: s.over.memory ?? [], progress: s.over.progress ?? [], reviews: s.over.reviews ?? [], snapshots: [] });
      expect(integrity.ok).toBe(true);
      s.check?.(r);
    });

    it(`${s.name}: is deterministic (same input → identical output)`, () => {
      seq = 0; const a = run(s.over);
      seq = 0; const b = run(s.over);
      expect(JSON.stringify(a.cc)).toBe(JSON.stringify(b.cc));
      expect(JSON.stringify(a.dossier)).toBe(JSON.stringify(b.dossier));
      expect(JSON.stringify(a.proposal)).toBe(JSON.stringify(b.proposal));
    });
  }
});
