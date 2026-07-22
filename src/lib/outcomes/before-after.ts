// ─────────────────────────────────────────────────────────────────────────────
// Before / after intelligence — capture the state before, compare to what's observed.
//
// Everything here is read straight from the operator-entered review. We never infer
// an improvement; we only present what was recorded, alongside the evidence for it.
// ─────────────────────────────────────────────────────────────────────────────
import type { OutcomeReviewItem } from "../types";
import type { BeforeAfter } from "./types";

/** Split the evidence field into named sources for display. */
export function evidenceSources(review: OutcomeReviewItem): string[] {
  return review.evidence
    .split(/[\n;,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function beforeAfter(review: OutcomeReviewItem): BeforeAfter {
  return {
    recommendationId: review.recommendationId,
    title: review.title,
    before: review.beforeState.trim() || "Not captured.",
    implementation: review.title,
    observed: review.observedOutcome.trim() || "Not yet observed.",
    evidenceSources: evidenceSources(review),
    status: review.status,
  };
}

/** True only when there's a real observation backed by at least one evidence source. */
export function hasObservation(review: OutcomeReviewItem): boolean {
  return review.observedOutcome.trim().length > 0 && evidenceSources(review).length > 0;
}
