// ─────────────────────────────────────────────────────────────────────────────
// Business evolution timeline — real change, not activity.
//
// Two kinds of event, both recorded by the operator: work that was implemented (a
// journal item reaching completion) and change that was observed (a review with a
// real observation and evidence). Each event links back to its recommendation and its
// evidence. We never invent a change that wasn't recorded.
// ─────────────────────────────────────────────────────────────────────────────
import type { OutcomeReviewItem, RoadmapProgressItem } from "../types";
import type { EvolutionEvent } from "./types";
import { hasObservation } from "./before-after";

const DONE = new Set(["Completed", "Measured"]);

export function buildEvolution(reviews: OutcomeReviewItem[], progress: RoadmapProgressItem[]): EvolutionEvent[] {
  const events: EvolutionEvent[] = [];

  for (const p of progress) {
    if (!DONE.has(p.status)) continue;
    events.push({
      at: p.updatedAt,
      title: p.title,
      detail: `Implemented — marked ${p.status.toLowerCase()}.`,
      kind: "implemented",
      recommendationId: p.recommendationId,
      evidence: "Implementation journal.",
    });
  }

  for (const r of reviews) {
    if (!hasObservation(r)) continue;
    events.push({
      at: r.reviewedAt || r.updatedAt,
      title: r.title,
      detail: r.observedOutcome.trim(),
      kind: "observed",
      recommendationId: r.recommendationId,
      evidence: r.evidence.trim() || "Operator observation.",
    });
  }

  return events.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
}
