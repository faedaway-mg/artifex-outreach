// ─────────────────────────────────────────────────────────────────────────────
// The consulting dossier — the complete, provenance-carrying view of every
// recommendation. This is the intelligence layer the Business Technology Review and
// the living proposal both read from.
//
// Each recommendation is assembled with its full chain: the verified memories behind
// it, the reasoning that connected them, the opportunity chain, its roadmap placement
// and implementation status, the expected outcome and success metric, any recorded
// outcome evidence, and cross-engagement knowledge support — with measured confidence.
// A recommendation NEVER appears without traceable evidence.
// ─────────────────────────────────────────────────────────────────────────────
import type { EngagementContext } from "./types";
import type { ConfidenceRead } from "../reasoning";
import type { KnowledgePattern } from "../outcomes";
import { hasObservation } from "../outcomes";

export interface DossierMemory {
  id: string;
  title: string;
  value: string;
  status: string;
  source: string;
  confidence: string;
}

export interface DossierRecommendation {
  recommendationId: string;
  title: string;
  rationale: string;
  confidence: ConfidenceRead;
  memories: DossierMemory[];
  reasoning: { claim: string; because: string } | null;
  opportunityChain: { title: string; nodes: Array<{ label: string; observed: boolean }> } | null;
  roadmap: { phase: string; status: string; why: string } | null;
  expectedOutcome: string;
  successMetric: { looksLike: string; measuredBy: string; reviewWhen: string } | null;
  outcome: { status: string; observed: string; evidence: string } | null;
  knowledgeSupport: { engagements: number; summary: string } | null;
}

export interface ConsultingDossier {
  businessName: string;
  narrativeOpening: string;
  verifiedMemoryCount: number;
  totalMemoryCount: number;
  recommendations: DossierRecommendation[];
  /** Recommendations excluded because they lacked traceable evidence. */
  omittedForNoEvidence: number;
}

export function buildConsultingDossier(ctx: EngagementContext, patterns: KnowledgePattern[] = []): ConsultingDossier {
  const active = ctx.memory.filter((m) => m.status !== "Superseded" && m.status !== "Resolved");
  const memById = new Map(ctx.memory.map((m) => [m.id, m]));
  const allItems = [...ctx.plan.items, ...ctx.plan.completed];
  const itemByRec = new Map(allItems.map((i) => [i.recommendationId, i]));
  const infByRec = new Map(ctx.reasoning.inferences.map((i) => [i.id.startsWith("rec_") ? i.id : `rec_${i.id}`, i]));
  const chainByRec = new Map(ctx.reasoning.opportunityChains.map((c) => [c.id.replace("chain_", "rec_"), c]));
  const reviewByRec = new Map(ctx.reviews.map((r) => [r.recommendationId, r]));
  const patternByRec = new Map(patterns.map((p) => [p.recommendationId, p]));

  let omitted = 0;
  const recommendations: DossierRecommendation[] = [];

  for (const rec of ctx.reasoning.recommendations) {
    const memories: DossierMemory[] = rec.evidenceMemoryIds
      .map((id) => memById.get(id))
      .filter((m): m is NonNullable<typeof m> => Boolean(m))
      .map((m) => ({ id: m.id, title: m.title, value: m.value, status: m.status, source: m.source, confidence: m.confidence }));

    // Nothing appears without traceable evidence.
    if (memories.length === 0) { omitted += 1; continue; }

    const item = itemByRec.get(rec.id);
    const inf = infByRec.get(rec.id);
    const chain = chainByRec.get(rec.id);
    const review = reviewByRec.get(rec.id);
    const pattern = patternByRec.get(rec.id);

    recommendations.push({
      recommendationId: rec.id,
      title: rec.title,
      rationale: rec.rationale,
      confidence: rec.confidence,
      memories,
      reasoning: inf ? { claim: inf.claim, because: inf.because } : null,
      opportunityChain: chain ? { title: chain.title, nodes: chain.nodes.map((n) => ({ label: n.label, observed: n.observed })) } : null,
      roadmap: item ? { phase: item.phase, status: item.status, why: item.why } : null,
      expectedOutcome: item?.successMetric.looksLike ?? rec.suggestedOutcome,
      successMetric: item ? item.successMetric : null,
      outcome: review && review.status !== "Awaiting Review" && hasObservation(review)
        ? { status: review.status, observed: review.observedOutcome, evidence: review.evidence }
        : null,
      knowledgeSupport: pattern ? { engagements: pattern.supportedCount, summary: pattern.summary } : null,
    });
  }

  return {
    businessName: ctx.lead.businessName,
    narrativeOpening: ctx.reasoning.narrative.opening,
    verifiedMemoryCount: active.filter((m) => m.status === "Verified").length,
    totalMemoryCount: active.length,
    recommendations,
    omittedForNoEvidence: omitted,
  };
}
