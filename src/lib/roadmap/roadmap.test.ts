import { describe, it, expect } from "vitest";
import type { RelationshipMemoryItem, MemoryCategory, MemoryStatus, RoadmapProgressItem, RoadmapStatus } from "../types";
import { reason } from "../reasoning/engine";
import { reasonedRecommendations } from "../reasoning/proposal";
import { buildDependencies, topologicalOrder, prerequisitesOf } from "./dependencies";
import { buildRoadmap } from "./roadmap";
import { buildSequence } from "./sequencing";
import { buildTransformation } from "./transformation";
import { buildExecutionPlan } from "./index";

const NOW = Date.parse("2026-07-22T00:00:00Z");
let seq = 0;
function mem(category: MemoryCategory, value: string, status: MemoryStatus = "Proposed"): RelationshipMemoryItem {
  seq += 1;
  return {
    id: `m${seq}`, leadId: "lead_x", category, title: value.slice(0, 20), value,
    status, confidence: "Medium", source: "Discovery Meeting", supportingContext: null, operatorNotes: null,
    createdAt: "2026-07-20T00:00:00Z", updatedAt: "2026-07-20T00:00:00Z",
  };
}

// A business that triggers all three recommendations (integration, manual-scheduling, capacity).
function fullCase(status: MemoryStatus = "Verified"): RelationshipMemoryItem[] {
  return [
    mem("Existing Systems", "We use Square for checkout.", status),
    mem("Existing Systems", "We use QuickBooks for the books.", status),
    mem("Existing Systems", "No online booking — every appointment is by phone.", status),
    mem("Decision Makers", "The owner personally handles scheduling.", status),
    mem("Current Priorities", "The front desk is overwhelmed with phone calls.", status),
    mem("Business Goals", "We're trying to hire another hygienist.", status),
    mem("Known Constraints", "The team is completely overwhelmed already.", status),
  ];
}

function recsFor(memories: RelationshipMemoryItem[]) {
  return reasonedRecommendations(memories, reason(memories, NOW), NOW);
}
function progress(entries: Array<[string, RoadmapStatus]>): RoadmapProgressItem[] {
  return entries.map(([recommendationId, status], i) => ({
    id: `p${i}`, leadId: "lead_x", recommendationId, title: recommendationId, status,
    operatorNotes: null, createdAt: "2026-07-21T00:00:00Z", updatedAt: "2026-07-21T00:00:00Z",
  }));
}

describe("dependency graph", () => {
  it("only includes edges between recommendations that exist", () => {
    const recs = recsFor(fullCase());
    const edges = buildDependencies(recs);
    expect(edges.length).toBeGreaterThan(0);
    const ids = new Set(recs.map((r) => r.id));
    for (const e of edges) { expect(ids.has(e.from)).toBe(true); expect(ids.has(e.to)).toBe(true); }
  });

  it("fabricates no dependency when only one recommendation exists", () => {
    const recs = recsFor([mem("Existing Systems", "We use Square.", "Verified"), mem("Existing Systems", "We use QuickBooks.", "Verified")]);
    // integration-only → no prerequisite edges apply
    expect(buildDependencies(recs)).toHaveLength(0);
  });

  it("orders prerequisites before dependents", () => {
    const recs = recsFor(fullCase());
    const edges = buildDependencies(recs);
    const order = topologicalOrder(recs, edges).map((r) => r.id);
    for (const e of edges) expect(order.indexOf(e.from)).toBeLessThan(order.indexOf(e.to));
  });
});

describe("roadmap placement — respects the journal and dependencies", () => {
  it("blocks a recommendation whose prerequisite isn't done", () => {
    const recs = recsFor(fullCase());
    const edges = buildDependencies(recs);
    const items = buildRoadmap(recs, new Map(), edges);
    const sched = items.find((i) => i.recommendationId === "rec_manual-scheduling")!;
    // manual-scheduling depends on integration, which isn't completed → Blocked
    expect(sched.phase).toBe("Blocked");
    expect(sched.blockedBy).toContain("rec_integration-over-replacement");
    expect(sched.explain.whatBlocks.length).toBeGreaterThan(0);
  });

  it("unblocks once the prerequisite is completed", () => {
    const recs = recsFor(fullCase());
    const edges = buildDependencies(recs);
    const items = buildRoadmap(recs, new Map([["rec_integration-over-replacement", "Completed"]]), edges);
    const sched = items.find((i) => i.recommendationId === "rec_manual-scheduling")!;
    expect(sched.phase).not.toBe("Blocked");
    expect(sched.blockedBy).toHaveLength(0);
  });

  it("an approved / in-progress item sits in Immediate", () => {
    const recs = recsFor(fullCase());
    const edges = buildDependencies(recs);
    const items = buildRoadmap(recs, new Map([["rec_integration-over-replacement", "In Progress"]]), edges);
    expect(items.find((i) => i.recommendationId === "rec_integration-over-replacement")!.phase).toBe("Immediate");
  });

  it("every item explains why now, why not earlier, what blocks, what if we wait", () => {
    const items = buildRoadmap(recsFor(fullCase()), new Map(), buildDependencies(recsFor(fullCase())));
    for (const i of items) {
      expect(i.why.length).toBeGreaterThan(0);
      expect(i.explain.whyNow.length).toBeGreaterThan(0);
      expect(i.explain.whyNotEarlier.length).toBeGreaterThan(0);
      expect(i.explain.whatBlocks.length).toBeGreaterThan(0);
      expect(i.explain.whatIfWait.length).toBeGreaterThan(0);
      expect(i.successMetric.looksLike.length).toBeGreaterThan(0);
      expect(i.successMetric.measuredBy.length).toBeGreaterThan(0);
    }
  });
});

describe("sequencing — order with reasons", () => {
  it("names a starting point and flags blocked items", () => {
    const recs = recsFor(fullCase());
    const edges = buildDependencies(recs);
    const items = buildRoadmap(recs, new Map(), edges);
    const steps = buildSequence(items, recs, edges);
    expect(steps.length).toBe(items.filter((i) => i.phase !== "Completed").length);
    expect(steps.some((s) => /start here/i.test(s.reason))).toBe(true);
    // the item that depends on an unfinished prerequisite reads as waiting
    const blocked = steps.find((s) => s.recommendationId === "rec_manual-scheduling");
    expect(blocked?.reason).toMatch(/waits on/i);
  });
});

describe("transformation timeline", () => {
  it("is monotonic and marks the current stage", () => {
    const stages = buildTransformation({ memories: 7, categories: 4, inferences: 3, meetingsHeld: 1, proposalsDiscussed: 0, approvedOrInProgress: 1, completedOrMeasured: 0, measured: 0, acceptedProposals: 0 });
    const reachedIdx = stages.map((s, i) => (s.reached ? i : -1)).filter((i) => i >= 0);
    // reached stages are a contiguous prefix
    expect(Math.max(...reachedIdx)).toBe(reachedIdx.length - 1);
    expect(stages.filter((s) => s.current)).toHaveLength(1);
  });

  it("an empty engagement has reached nothing", () => {
    const stages = buildTransformation({ memories: 0, categories: 0, inferences: 0, meetingsHeld: 0, proposalsDiscussed: 0, approvedOrInProgress: 0, completedOrMeasured: 0, measured: 0, acceptedProposals: 0 });
    expect(stages.every((s) => !s.reached)).toBe(true);
  });
});

describe("execution plan — proposal evolution", () => {
  const signals = { memories: 7, categories: 4, inferences: 3, meetingsHeld: 1, proposalsDiscussed: 0, acceptedProposals: 0 };

  it("carries completed work separately and never re-recommends it", () => {
    const recs = recsFor(fullCase());
    const plan = buildExecutionPlan({ recommendations: recs, progress: progress([["rec_integration-over-replacement", "Completed"]]), signals });
    expect(plan.completed.some((i) => i.recommendationId === "rec_integration-over-replacement")).toBe(true);
    expect(plan.items.some((i) => i.recommendationId === "rec_integration-over-replacement")).toBe(false);
    expect(plan.sequence.some((s) => s.recommendationId === "rec_integration-over-replacement")).toBe(false);
  });

  it("an empty business yields an empty plan — no invented work", () => {
    const plan = buildExecutionPlan({ recommendations: [], progress: [], signals: { memories: 0, categories: 0, inferences: 0, meetingsHeld: 0, proposalsDiscussed: 0, acceptedProposals: 0 } });
    expect(plan.items).toHaveLength(0);
    expect(plan.completed).toHaveLength(0);
    expect(plan.dependencies).toHaveLength(0);
  });
});
