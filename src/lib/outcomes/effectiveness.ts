// ─────────────────────────────────────────────────────────────────────────────
// Recommendation effectiveness — counts, not grades.
//
// For each recommendation type: how often it was recommended, implemented, reviewed,
// and how those reviews landed (supported / mixed / unsupported / insufficient). The
// goal is a better next recommendation, never scoring the consultant. Everything is
// counted from real journal entries and operator-entered reviews.
// ─────────────────────────────────────────────────────────────────────────────
import type { OutcomeReviewItem, RoadmapProgressItem } from "../types";
import type { EffectivenessRow } from "./types";

const DONE = new Set(["Completed", "Measured"]);

export function recommendationEffectiveness(reviews: OutcomeReviewItem[], progress: RoadmapProgressItem[]): EffectivenessRow[] {
  const ids = new Set<string>([...progress.map((p) => p.recommendationId), ...reviews.map((r) => r.recommendationId)]);
  const titleOf = (id: string) =>
    reviews.find((r) => r.recommendationId === id)?.title ?? progress.find((p) => p.recommendationId === id)?.title ?? id;

  const rows: EffectivenessRow[] = [];
  for (const id of ids) {
    const recProgress = progress.filter((p) => p.recommendationId === id);
    const recReviews = reviews.filter((r) => r.recommendationId === id);
    const distinct = (arr: { leadId: string }[]) => new Set(arr.map((x) => x.leadId)).size;

    rows.push({
      recommendationId: id,
      title: titleOf(id),
      recommended: Math.max(distinct(recProgress), distinct(recReviews)),
      implemented: distinct(recProgress.filter((p) => DONE.has(p.status))),
      reviewed: distinct(recReviews.filter((r) => r.status !== "Awaiting Review")),
      supported: recReviews.filter((r) => r.status === "Supported").length,
      mixed: recReviews.filter((r) => r.status === "Mixed").length,
      unsupported: recReviews.filter((r) => r.status === "Not Supported").length,
      insufficient: recReviews.filter((r) => r.status === "Insufficient Evidence").length,
    });
  }
  return rows.sort((a, b) => b.supported - a.supported || b.reviewed - a.reviewed);
}
