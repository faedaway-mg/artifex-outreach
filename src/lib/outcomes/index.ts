// ─────────────────────────────────────────────────────────────────────────────
// Outcomes Intelligence — the aggregator that closes the consulting lifecycle.
//
// Observe → Understand → Remember → Reason → Plan → Implement → Measure → Learn →
// Improve. This module turns operator-entered outcome reviews (plus the journal) into
// a calm executive read, a business evolution timeline, a health narrative, an
// effectiveness rollup, and — across engagements — a knowledge graph and evidence-
// backed proposal lines. Nothing is fabricated; every output traces to a review.
// ─────────────────────────────────────────────────────────────────────────────
import type { OutcomeReviewItem, RoadmapProgressItem } from "../types";
import type { OutcomesDashboard } from "./types";
import { beforeAfter, hasObservation } from "./before-after";

export * from "./types";
export { beforeAfter, evidenceSources, hasObservation } from "./before-after";
export { recommendationEffectiveness } from "./effectiveness";
export { buildKnowledgeGraph, MIN_SUPPORTING_ENGAGEMENTS } from "./knowledge-graph";
export { proposalEvidenceLines } from "./proposal-improvement";
export { buildEvolution } from "./evolution";
export { buildHealthNarrative } from "./health-narrative";

const DONE = new Set(["Completed", "Measured"]);

/**
 * Group a lead's reviews (and its completed-but-unreviewed work) into the executive
 * dashboard lanes. `completedWithoutReview` are journal items finished but with no
 * review yet — they surface as "awaiting review" so measurement never gets skipped.
 */
export function buildOutcomesDashboard(
  reviews: OutcomeReviewItem[],
  completedProgress: RoadmapProgressItem[],
): OutcomesDashboard {
  const byRec = new Map(reviews.map((r) => [r.recommendationId, r]));

  // Completed journal items that have no review yet → synthesize an Awaiting shell view.
  const shellReviews: OutcomeReviewItem[] = completedProgress
    .filter((p) => DONE.has(p.status) && !byRec.has(p.recommendationId))
    .map((p) => ({
      id: `shell_${p.id}`, leadId: p.leadId, recommendationId: p.recommendationId, title: p.title,
      status: "Awaiting Review", expectedOutcome: "", beforeState: "", observedOutcome: "", evidence: "",
      unexpectedConsequences: "", lessonsLearned: "", confidence: "Low", reviewedAt: null, operatorNotes: null,
      createdAt: p.updatedAt, updatedAt: p.updatedAt,
    }));

  const all = [...reviews, ...shellReviews];
  const recentlyCompleted = [...all]
    .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0))
    .slice(0, 5)
    .map(beforeAfter);

  return {
    recentlyCompleted,
    awaitingReview: all.filter((r) => r.status === "Awaiting Review").map(beforeAfter),
    validated: reviews.filter((r) => r.status === "Supported").map(beforeAfter),
    mixed: reviews.filter((r) => r.status === "Mixed").map(beforeAfter),
    // Needs follow-up: reviewed but the hypothesis didn't hold, or reviewed without evidence.
    needingFollowUp: reviews
      .filter((r) => r.status === "Not Supported" || r.status === "Insufficient Evidence" || (r.status !== "Awaiting Review" && !hasObservation(r)))
      .map(beforeAfter),
  };
}
