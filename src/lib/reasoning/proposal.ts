// ─────────────────────────────────────────────────────────────────────────────
// Proposal intelligence — recommendations that reason.
//
// A proposal shouldn't list features; it should explain why, from what we've learned.
// Each reasoned recommendation carries its evidence (the memories), the inference it
// rests on, the impact we've actually observed, the outcome we'd expect, what it
// depends on, and an honest effort read — with measured confidence. This is the
// reasoning object a consultant would assemble after weeks of engagement. Rendering
// it into the Business Technology Review document remains the existing PDF pipeline.
// ─────────────────────────────────────────────────────────────────────────────
import type { RelationshipMemoryItem } from "../types";
import type { ReasonedRecommendation, Inference } from "./types";
import { scoreConfidence, isActive } from "./confidence";

// Each inference kind that maps to an actionable recommendation, with its framing.
const FROM_INFERENCE: Record<string, { title: string; observedImpact: string; suggestedOutcome: string; dependencies: string[]; effort: ReasonedRecommendation["effort"] }> = {
  "manual-scheduling": {
    title: "Take the pressure off the front desk's booking flow",
    observedImpact: "Manual coordination is absorbing staff time and putting calls at risk during busy stretches.",
    suggestedOutcome: "The desk spends less time playing switchboard, and fewer would-be appointments slip away.",
    dependencies: ["Confirm how bookings actually move today", "Keep whatever already works for them"],
    effort: "Moderate",
  },
  "capacity-bound-growth": {
    title: "Lift the capacity ceiling before adding demand",
    observedImpact: "The team is already stretched, so growth plans are bounded by throughput, not interest.",
    suggestedOutcome: "The same team handles more without the day getting heavier.",
    dependencies: ["Understand where the day actually snags", "Sequence this before any demand-generation work"],
    effort: "Substantial",
  },
  "integration-over-replacement": {
    title: "Connect the tools they already trust",
    observedImpact: "Several systems are in daily use; the friction is between them, not within any one.",
    suggestedOutcome: "Information stops being re-entered by hand, and nothing they rely on gets torn out.",
    dependencies: ["Map what each tool owns today", "Respect the systems they've chosen"],
    effort: "Light",
  },
};

export function reasonedRecommendations(memories: RelationshipMemoryItem[], inferences: Inference[], now: number): ReasonedRecommendation[] {
  const active = memories.filter(isActive);
  const out: ReasonedRecommendation[] = [];
  for (const inf of inferences) {
    const spec = FROM_INFERENCE[inf.id];
    if (!spec) continue;
    out.push({
      id: `rec_${inf.id}`,
      title: spec.title,
      rationale: inf.claim,
      evidenceMemoryIds: inf.memoryIds,
      relatedInferenceIds: [inf.id],
      observedImpact: spec.observedImpact,
      suggestedOutcome: spec.suggestedOutcome,
      dependencies: spec.dependencies,
      effort: spec.effort,
      confidence: scoreConfidence(active.filter((m) => inf.memoryIds.includes(m.id)), now),
    });
  }
  return out.sort((a, b) => b.confidence.score - a.confidence.score);
}
