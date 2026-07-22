// ─────────────────────────────────────────────────────────────────────────────
// Consultant sequencing — recommend the order, and say why.
//
// Reads like an experienced consultant planning a rollout: what to start with, what
// follows what, and what's waiting on a prerequisite. Order comes from the dependency
// graph first, then leverage (impact, then lighter effort, then confidence).
// ─────────────────────────────────────────────────────────────────────────────
import type { ReasonedRecommendation } from "../reasoning/types";
import type { RoadmapItem, SequenceStep, DependencyEdge, ImpactLevel } from "./types";
import { topologicalOrder, prerequisitesOf } from "./dependencies";

const IMPACT_RANK: Record<ImpactLevel, number> = { High: 3, Medium: 2, Low: 1 };
const EFFORT_RANK: Record<RoadmapItem["effort"], number> = { Light: 1, Moderate: 2, Substantial: 3 };
const CONF_RANK: Record<string, number> = { High: 3, Medium: 2, Low: 1 };

/**
 * Order the active (not-completed) recommendations for rollout. Dependencies win;
 * ties break by leverage. Each step carries the operator-facing reason.
 */
export function buildSequence(items: RoadmapItem[], recommendations: ReasonedRecommendation[], edges: DependencyEdge[]): SequenceStep[] {
  const active = items.filter((i) => i.phase !== "Completed");
  const itemById = new Map(active.map((i) => [i.recommendationId, i]));
  const recById = new Map(recommendations.map((r) => [r.id, r]));

  // Leverage-first input order, then topological sort respects prerequisites.
  const activeRecs = active
    .map((i) => recById.get(i.recommendationId))
    .filter((r): r is ReasonedRecommendation => Boolean(r))
    .sort((a, b) => {
      const ia = itemById.get(a.id)!;
      const ib = itemById.get(b.id)!;
      return (
        IMPACT_RANK[ib.impact] - IMPACT_RANK[ia.impact] ||
        EFFORT_RANK[ia.effort] - EFFORT_RANK[ib.effort] ||
        CONF_RANK[ib.confidence.label] - CONF_RANK[ia.confidence.label]
      );
    });

  const ordered = topologicalOrder(activeRecs, edges);
  const titleOf = (id: string) => itemById.get(id)?.title ?? id;

  let firstReady = true;
  return ordered.map((rec, idx) => {
    const item = itemById.get(rec.id)!;
    const prereqTitles = prerequisitesOf(rec.id, edges).map(titleOf);
    let reason: string;
    if (item.phase === "Blocked") {
      reason = `Waits on ${item.blockedBy.map(titleOf).join(" and ")}.`;
    } else if (firstReady) {
      reason = "Start here — the highest-leverage work that's ready to go.";
      firstReady = false;
    } else if (prereqTitles.length > 0) {
      reason = `Follows ${prereqTitles.join(" and ")}, which it builds on.`;
    } else {
      reason = `Then this — ${item.impact.toLowerCase()} impact at ${item.effort.toLowerCase()} effort.`;
    }
    return { recommendationId: rec.id, title: item.title, order: idx + 1, reason };
  });
}
