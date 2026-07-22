// ─────────────────────────────────────────────────────────────────────────────
// Consulting knowledge graph — wisdom earned across engagements.
//
// A pattern is recorded ONLY after repeated supporting evidence: at least two
// distinct businesses whose outcomes came back "Supported" for the same
// recommendation. One engagement is never enough — we never generalise from a single
// case. Every pattern cites the businesses that support it, so it stays auditable.
// ─────────────────────────────────────────────────────────────────────────────
import type { OutcomeReviewItem } from "../types";
import type { KnowledgePattern } from "./types";

/** Minimum distinct engagements before a pattern is allowed to exist. */
export const MIN_SUPPORTING_ENGAGEMENTS = 2;

export function buildKnowledgeGraph(reviews: OutcomeReviewItem[]): KnowledgePattern[] {
  const byRec = new Map<string, OutcomeReviewItem[]>();
  for (const r of reviews) {
    if (!byRec.has(r.recommendationId)) byRec.set(r.recommendationId, []);
    byRec.get(r.recommendationId)!.push(r);
  }

  const patterns: KnowledgePattern[] = [];
  for (const [recId, rs] of byRec) {
    const supportingLeads = [...new Set(rs.filter((r) => r.status === "Supported").map((r) => r.leadId))];
    if (supportingLeads.length < MIN_SUPPORTING_ENGAGEMENTS) continue; // never from one engagement

    const mixedCount = rs.filter((r) => r.status === "Mixed").length;
    const title = rs.find((r) => r.title)?.title ?? recId;
    patterns.push({
      recommendationId: recId,
      title,
      supportingLeadIds: supportingLeads,
      supportedCount: supportingLeads.length,
      mixedCount,
      summary:
        `Across ${supportingLeads.length} businesses, this was followed by the improvement we expected` +
        (mixedCount > 0 ? `, with ${mixedCount} mixed result${mixedCount === 1 ? "" : "s"} worth noting.` : "."),
    });
  }
  return patterns.sort((a, b) => b.supportedCount - a.supportedCount);
}
