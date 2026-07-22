import { describe, it, expect } from "vitest";
import type { RelationshipMemoryItem, MemoryCategory, MemoryStatus, MemoryConfidence, MemorySource } from "../types";
import { scoreConfidence } from "./confidence";
import { reason } from "./engine";
import { detectContradictions } from "./contradiction";
import { buildNarrative } from "./narrative";
import { buildOpportunityGraph } from "./opportunity-graph";
import { relationshipHealth } from "./health";
import { reasonedRecommendations } from "./proposal";
import { memoryReferences } from "./follow-up";
import { buildReasoning } from "./index";
import { voiceViolations } from "../outreach/voice-engine";

const NOW = Date.parse("2026-07-22T00:00:00Z");
let seq = 0;
function mem(p: Partial<RelationshipMemoryItem> & { category: MemoryCategory; value: string }): RelationshipMemoryItem {
  seq += 1;
  const at = p.createdAt ?? "2026-07-20T00:00:00Z";
  return {
    id: p.id ?? `m${seq}`,
    leadId: "lead_x",
    category: p.category,
    title: p.title ?? p.value.slice(0, 20),
    value: p.value,
    status: (p.status as MemoryStatus) ?? "Proposed",
    confidence: (p.confidence as MemoryConfidence) ?? "Medium",
    source: (p.source as MemorySource) ?? "Discovery Meeting",
    supportingContext: p.supportingContext ?? null,
    operatorNotes: null,
    createdAt: at,
    updatedAt: p.updatedAt ?? at,
  };
}

// ── The spec's flagship scenario ─────────────────────────────────────────────
function schedulingCase(): RelationshipMemoryItem[] {
  return [
    mem({ id: "owner", category: "Decision Makers", title: "Owner handles scheduling", value: "The owner personally handles scheduling.", status: "Verified" }),
    mem({ id: "desk", category: "Current Priorities", title: "Front desk overwhelmed", value: "The front desk is overwhelmed with phone calls.", status: "Verified" }),
    mem({ id: "square", category: "Existing Systems", title: "Uses Square", value: "They use Square for checkout.", status: "Verified" }),
    mem({ id: "nobook", category: "Existing Systems", title: "No online booking", value: "No online booking — every appointment is by phone.", status: "Verified" }),
  ];
}

describe("confidence engine", () => {
  it("is measured and explainable — never a bare number", () => {
    const c = scoreConfidence(schedulingCase(), NOW);
    expect(c.factors.length).toBeGreaterThan(2);
    expect(["High", "Medium", "Low"]).toContain(c.label);
    expect(c.score).toBeGreaterThan(0);
  });

  it("a single unverified observation is never High", () => {
    const c = scoreConfidence([mem({ category: "Existing Systems", value: "We use Square." })], NOW);
    expect(c.label).not.toBe("High");
  });

  it("superseded memories don't support a claim", () => {
    const c = scoreConfidence([mem({ category: "Existing Systems", value: "We use Square.", status: "Superseded" })], NOW);
    expect(c.score).toBe(0);
  });

  it("more verified, recent memories score higher than one stale proposed one", () => {
    const strong = scoreConfidence(schedulingCase(), NOW);
    const weak = scoreConfidence([mem({ category: "Existing Systems", value: "We use Square.", status: "Proposed", createdAt: "2025-01-01T00:00:00Z" })], NOW);
    expect(strong.score).toBeGreaterThan(weak.score);
  });
});

describe("reasoning engine — connects, never invents", () => {
  it("draws the manual-scheduling inference from the four memories, citing all evidence", () => {
    const inf = reason(schedulingCase(), NOW);
    const sched = inf.find((i) => i.id === "manual-scheduling");
    expect(sched).toBeTruthy();
    expect(sched!.memoryIds.length).toBeGreaterThanOrEqual(2);
    // every cited id is a real memory
    const ids = new Set(schedulingCase().map((m) => m.id));
    sched!.memoryIds.forEach((id) => expect(ids.has(id)).toBe(true));
  });

  it("produces NOTHING without evidence", () => {
    expect(reason([], NOW)).toHaveLength(0);
    expect(reason([mem({ category: "Existing Systems", value: "We use Square." })], NOW)).toHaveLength(0);
  });

  it("every inference cites at least two memories", () => {
    for (const i of reason(schedulingCase(), NOW)) expect(i.memoryIds.length).toBeGreaterThanOrEqual(2);
  });

  it("recognises capacity-bound growth", () => {
    const inf = reason([
      mem({ category: "Business Goals", value: "We're trying to hire another hygienist." }),
      mem({ category: "Known Constraints", value: "The team is completely overwhelmed already." }),
    ], NOW);
    expect(inf.some((i) => i.id === "capacity-bound-growth")).toBe(true);
  });
});

describe("contradiction detection — flag, never resolve", () => {
  it("flags opposite polarity on the same topic", () => {
    const c = detectContradictions([
      mem({ id: "a", category: "Current Priorities", value: "We don't have any scheduling problems." }),
      mem({ id: "b", category: "Current Priorities", value: "Our front desk spends three hours every day scheduling and is behind." }),
    ]);
    expect(c).toHaveLength(1);
    expect(c[0].between).toEqual(["a", "b"]);
    expect(c[0].prompt).toMatch(/supersede/i); // asks the operator; doesn't decide
  });

  it("flags two different named decision makers", () => {
    const c = detectContradictions([
      mem({ category: "Decision Makers", value: "The owner is John." }),
      mem({ category: "Decision Makers", value: "The owner is Maria." }),
    ]);
    expect(c.length).toBeGreaterThanOrEqual(1);
  });

  it("does not invent contradictions where none exist", () => {
    expect(detectContradictions(schedulingCase())).toHaveLength(0);
  });
});

describe("narrative — grounded prose, links back to memory", () => {
  const inf = reason(schedulingCase(), NOW);
  const narr = buildNarrative(schedulingCase(), inf, [], NOW);

  it("opens like a consultant and produces grounded sections", () => {
    expect(narr.opening.length).toBeGreaterThan(0);
    expect(narr.sections.length).toBeGreaterThan(0);
    for (const s of narr.sections) expect(s.prose.length).toBeGreaterThan(0);
  });

  it("every section links to real memory ids", () => {
    const ids = new Set(schedulingCase().map((m) => m.id));
    for (const s of narr.sections) for (const id of s.memoryIds) expect(ids.has(id)).toBe(true);
  });

  it("names unknowns when core categories are missing", () => {
    const thin = buildNarrative([mem({ category: "Existing Systems", value: "We use Square." })], [], [], NOW);
    expect(thin.sections.some((s) => s.key === "Unknowns")).toBe(true);
  });

  it("reads clean in the founder voice", () => {
    for (const s of narr.sections) expect(voiceViolations(s.prose)).toHaveLength(0);
    expect(voiceViolations(narr.opening)).toHaveLength(0);
  });
});

describe("opportunity graph — chains grounded at the root", () => {
  it("builds the scheduling chain with an observed root and projected consequences", () => {
    const inf = reason(schedulingCase(), NOW);
    const chains = buildOpportunityGraph(schedulingCase(), inf, NOW);
    const chain = chains.find((c) => c.id === "chain_manual-scheduling");
    expect(chain).toBeTruthy();
    expect(chain!.nodes[0].observed).toBe(true); // root grounded
    expect(chain!.nodes.length).toBeGreaterThan(2);
  });

  it("no chain without its root inference", () => {
    expect(buildOpportunityGraph([], [], NOW)).toHaveLength(0);
  });
});

describe("relationship health — progress explained by evidence", () => {
  it("marks decision-maker identified only when a memory names one", () => {
    const withDM = relationshipHealth(schedulingCase(), { meetingsHeld: 1, proposalsDiscussed: 0, activePlans: 0, acceptedProposals: 0 });
    expect(withDM.find((s) => s.milestone === "Decision-maker identified")!.reached).toBe(true);
    const without = relationshipHealth([mem({ category: "Existing Systems", value: "We use Square." })], { meetingsHeld: 0, proposalsDiscussed: 0, activePlans: 0, acceptedProposals: 0 });
    expect(without.find((s) => s.milestone === "Decision-maker identified")!.reached).toBe(false);
  });

  it("every signal carries a one-line evidence explanation", () => {
    for (const s of relationshipHealth(schedulingCase(), { meetingsHeld: 1, proposalsDiscussed: 0, activePlans: 0, acceptedProposals: 0 })) {
      expect(s.evidence.length).toBeGreaterThan(0);
    }
  });
});

describe("proposal intelligence — recommendations that reason", () => {
  it("carries evidence, impact, outcome, dependencies, effort, confidence", () => {
    const inf = reason(schedulingCase(), NOW);
    const recs = reasonedRecommendations(schedulingCase(), inf, NOW);
    expect(recs.length).toBeGreaterThan(0);
    const r = recs[0];
    expect(r.evidenceMemoryIds.length).toBeGreaterThan(0);
    expect(r.observedImpact.length).toBeGreaterThan(0);
    expect(r.suggestedOutcome.length).toBeGreaterThan(0);
    expect(r.dependencies.length).toBeGreaterThan(0);
    expect(["Light", "Moderate", "Substantial"]).toContain(r.effort);
  });
});

describe("adaptive follow-up — memory in the founder's voice", () => {
  it("references only confirmed memory, naturally, never 'our system'", () => {
    const refs = memoryReferences(schedulingCase());
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) {
      expect(r.sentence).toMatch(/you|since|last time/i);
      expect(r.sentence.toLowerCase()).not.toContain("our system");
      expect(r.sentence.toLowerCase()).not.toContain("detected");
    }
  });

  it("says nothing when nothing is confirmed", () => {
    expect(memoryReferences([mem({ category: "Business Goals", value: "grow", status: "Proposed", confidence: "Low" })])).toHaveLength(0);
  });
});

describe("buildReasoning — the whole read is consistent", () => {
  it("assembles every layer, all citing real memories", () => {
    const r = buildReasoning(schedulingCase(), { meetingsHeld: 1, proposalsDiscussed: 0, activePlans: 0, acceptedProposals: 0 }, NOW);
    const ids = new Set(schedulingCase().map((m) => m.id));
    const allCited = [
      ...r.inferences.flatMap((i) => i.memoryIds),
      ...r.narrative.sections.flatMap((s) => s.memoryIds),
      ...r.recommendations.flatMap((x) => x.evidenceMemoryIds),
    ];
    for (const id of allCited) expect(ids.has(id)).toBe(true);
    expect(r.inferences.length).toBeGreaterThan(0);
  });

  it("an empty business yields no fabricated insight", () => {
    const r = buildReasoning([], { meetingsHeld: 0, proposalsDiscussed: 0, activePlans: 0, acceptedProposals: 0 }, NOW);
    expect(r.inferences).toHaveLength(0);
    expect(r.recommendations).toHaveLength(0);
    expect(r.opportunityChains).toHaveLength(0);
  });
});
