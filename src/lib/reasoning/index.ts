// ─────────────────────────────────────────────────────────────────────────────
// Relationship Reasoning — the aggregator.
//
// One call turns a lead's Relationship Memory into the full consultant read:
// inferences, a living narrative, flagged contradictions, opportunity chains,
// relationship health, reasoned recommendations, and follow-up references. Every
// piece traces back to memory ids, so the strategist surface can always explain
// itself. Deterministic; `now` (ms) drives every recency judgment.
// ─────────────────────────────────────────────────────────────────────────────
import type { RelationshipMemoryItem } from "../types";
import type { RelationshipReasoning } from "./types";
import { reason } from "./engine";
import { buildNarrative } from "./narrative";
import { detectContradictions } from "./contradiction";
import { buildOpportunityGraph } from "./opportunity-graph";
import { relationshipHealth, type HealthContext } from "./health";
import { reasonedRecommendations } from "./proposal";
import { memoryReferences } from "./follow-up";

export * from "./types";
export { scoreConfidence, isActive } from "./confidence";
export { reason } from "./engine";
export { buildNarrative } from "./narrative";
export { detectContradictions } from "./contradiction";
export { buildOpportunityGraph } from "./opportunity-graph";
export { relationshipHealth } from "./health";
export type { HealthContext } from "./health";
export { reasonedRecommendations } from "./proposal";
export { memoryReferences } from "./follow-up";

export function buildReasoning(memories: RelationshipMemoryItem[], ctx: HealthContext, now: number): RelationshipReasoning {
  const inferences = reason(memories, now);
  const contradictions = detectContradictions(memories);
  return {
    inferences,
    narrative: buildNarrative(memories, inferences, contradictions, now),
    contradictions,
    opportunityChains: buildOpportunityGraph(memories, inferences, now),
    health: relationshipHealth(memories, ctx),
    recommendations: reasonedRecommendations(memories, inferences, now),
    followUpReferences: memoryReferences(memories),
  };
}
