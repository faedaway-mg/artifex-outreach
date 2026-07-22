// ─────────────────────────────────────────────────────────────────────────────
// Adaptive proposal improvement — let accumulated outcomes inform future proposals.
//
// When a knowledge pattern exists (repeated supporting evidence), a proposal can say
// more than "we recommend this": it can note that, in similar businesses, this move
// was consistently followed by the improvement we expected — always citing how many
// engagements support it, never exaggerating certainty. No pattern → no claim.
// ─────────────────────────────────────────────────────────────────────────────
import type { KnowledgePattern, ProposalEvidenceLine } from "./types";

const lower1 = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

export function proposalEvidenceLines(patterns: KnowledgePattern[]): ProposalEvidenceLine[] {
  return patterns.map((p) => {
    const n = p.supportingLeadIds.length;
    const caveat = p.mixedCount > 0 ? " Results varied in a few cases, so we'd confirm fit before committing." : "";
    return {
      recommendationId: p.recommendationId,
      line: `In ${n} similar ${n === 1 ? "business" : "businesses"}, ${lower1(p.title)} was followed by the improvement we expected.${caveat}`,
      engagements: n,
    };
  });
}
