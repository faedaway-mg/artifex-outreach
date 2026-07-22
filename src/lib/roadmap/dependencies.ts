// ─────────────────────────────────────────────────────────────────────────────
// Dependency graph — prerequisites between opportunities.
//
// Some improvements unlock others. We model those edges (only between recommendations
// that exist for this lead) and produce a stable topological order the sequencer can
// build on. If two items are independent, they keep their input order.
// ─────────────────────────────────────────────────────────────────────────────
import type { ReasonedRecommendation } from "../reasoning/types";
import type { DependencyEdge } from "./types";
import { DEPENDENCY_TEMPLATES } from "./meta";

/** Edges that apply to the recommendations actually present. */
export function buildDependencies(recommendations: ReasonedRecommendation[]): DependencyEdge[] {
  const ids = new Set(recommendations.map((r) => r.id));
  return DEPENDENCY_TEMPLATES.filter((e) => ids.has(e.from) && ids.has(e.to));
}

/** Direct prerequisites of a recommendation. */
export function prerequisitesOf(recommendationId: string, edges: DependencyEdge[]): string[] {
  return edges.filter((e) => e.to === recommendationId).map((e) => e.from);
}

/**
 * Stable topological order. Recommendations with unmet prerequisites come after
 * them; independent items keep their given order. Any cycle is broken deterministically
 * by falling back to input order (we never fabricate an ordering we can't justify).
 */
export function topologicalOrder(recommendations: ReasonedRecommendation[], edges: DependencyEdge[]): ReasonedRecommendation[] {
  const byId = new Map(recommendations.map((r) => [r.id, r]));
  const indeg = new Map<string, number>();
  recommendations.forEach((r) => indeg.set(r.id, 0));
  for (const e of edges) if (byId.has(e.from) && byId.has(e.to)) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);

  const order: ReasonedRecommendation[] = [];
  const remaining = [...recommendations];
  const placed = new Set<string>();

  while (remaining.length) {
    // First item (in input order) whose prerequisites are all already placed.
    const idx = remaining.findIndex((r) => prerequisitesOf(r.id, edges).every((p) => placed.has(p) || !byId.has(p)));
    const pick = idx >= 0 ? remaining.splice(idx, 1)[0] : remaining.shift()!; // cycle fallback: input order
    order.push(pick);
    placed.add(pick.id);
  }
  return order;
}
