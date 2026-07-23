// ─────────────────────────────────────────────────────────────────────────────
// The living proposal — always current, never duplicated.
//
// Built from the dossier and the roadmap sequence. Completed work disappears from the
// active recommendations (it moves to "delivered"), future priorities rise to the top,
// validated outcomes are cited, and knowledge-backed lines appear only where repeated
// evidence supports them. It stays a draft until the operator approves an export —
// nothing here sends or commits on its own.
// ─────────────────────────────────────────────────────────────────────────────
import type { EngagementContext } from "./types";
import type { ConsultingDossier } from "./dossier";

export interface ProposalRecommendation {
  order: number;
  recommendationId: string;
  title: string;
  rationale: string;
  expectedOutcome: string;
  measuredBy: string | null;
  confidenceLabel: string;
  evidenceCount: number;
  knowledgeLine: string | null;
}

export interface LivingProposal {
  businessName: string;
  relationshipMaturity: string;
  intro: string;
  delivered: Array<{ title: string; observed: string | null }>;
  recommendations: ProposalRecommendation[];
  validatedOutcomes: Array<{ title: string; observed: string }>;
  investment: { entry: number; twelveMonth: number };
  approvalNote: string;
  sourceCount: number;
}

const DONE = new Set(["Completed", "Measured"]);

export function buildLivingProposal(
  ctx: EngagementContext,
  dossier: ConsultingDossier,
  investment: { entry: number; twelveMonth: number },
): LivingProposal {
  const order = new Map(ctx.plan.sequence.map((s, i) => [s.recommendationId, i]));

  // Completed work leaves the active proposal — it becomes "delivered".
  const delivered = dossier.recommendations
    .filter((r) => r.roadmap && DONE.has(r.roadmap.status))
    .map((r) => ({ title: r.title, observed: r.outcome?.observed ?? null }));

  const active = dossier.recommendations
    .filter((r) => !(r.roadmap && DONE.has(r.roadmap.status)))
    .sort((a, b) => (order.get(a.recommendationId) ?? 99) - (order.get(b.recommendationId) ?? 99))
    .map((r, i): ProposalRecommendation => ({
      order: i + 1,
      recommendationId: r.recommendationId,
      title: r.title,
      rationale: r.rationale,
      expectedOutcome: r.expectedOutcome,
      measuredBy: r.successMetric?.measuredBy ?? null,
      confidenceLabel: r.confidence.label,
      evidenceCount: r.memories.length,
      knowledgeLine: r.knowledgeSupport
        ? `In ${r.knowledgeSupport.engagements} similar ${r.knowledgeSupport.engagements === 1 ? "business" : "businesses"}, this was followed by the improvement we expected.`
        : null,
    }));

  const validatedOutcomes = dossier.recommendations
    .filter((r) => r.outcome?.status === "Supported")
    .map((r) => ({ title: r.title, observed: r.outcome!.observed }));

  const reached = ctx.reasoning.health.filter((h) => h.reached).length;
  const relationshipMaturity = `${reached} of ${ctx.reasoning.health.length} relationship milestones reached`;

  const intro = delivered.length > 0
    ? `Building on work we've already delivered together, here's where we'd focus next at ${ctx.lead.businessName}.`
    : `Here's what we'd focus on first at ${ctx.lead.businessName}, drawn entirely from what we've learned together.`;

  return {
    businessName: ctx.lead.businessName,
    relationshipMaturity,
    intro,
    delivered,
    recommendations: active,
    validatedOutcomes,
    investment,
    approvalNote: "Draft — review every recommendation, then approve before exporting. Nothing here is sent automatically.",
    sourceCount: dossier.recommendations.length,
  };
}
