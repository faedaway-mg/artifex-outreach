// ─────────────────────────────────────────────────────────────────────────────
// Business transformation timeline — where the business is in its journey.
//
// Discovery → Understanding → Proposal → Implementation → Optimization → Ongoing
// Partnership. Stages are monotonic: reaching a later one implies the earlier ones.
// Each stage is either reached or not, always with a one-line reason from real
// signals — never a guess about the future.
// ─────────────────────────────────────────────────────────────────────────────
import type { TransformationStage, TransformationStageKey } from "./types";

export interface TransformationSignals {
  memories: number;
  categories: number;
  inferences: number;
  meetingsHeld: number;
  proposalsDiscussed: number;
  approvedOrInProgress: number;
  completedOrMeasured: number;
  measured: number;
  acceptedProposals: number;
}

export function buildTransformation(s: TransformationSignals): TransformationStage[] {
  const reached: Record<TransformationStageKey, boolean> = {
    Discovery: s.memories > 0 || s.meetingsHeld > 0,
    Understanding: s.inferences > 0 || (s.memories >= 3 && s.categories >= 2),
    Proposal: s.proposalsDiscussed > 0 || s.approvedOrInProgress > 0,
    Implementation: s.approvedOrInProgress > 0,
    Optimization: s.completedOrMeasured > 0,
    "Ongoing Partnership": s.measured > 0 && s.acceptedProposals > 0,
  };
  const evidence: Record<TransformationStageKey, string> = {
    Discovery: reached.Discovery ? `We've begun learning how they operate (${s.memories} captured).` : "No conversations captured yet.",
    Understanding: reached.Understanding ? "The pieces connect into a coherent picture." : "Still gathering — the picture isn't whole yet.",
    Proposal: reached.Proposal ? "A recommendation has been put forward for their decision." : "Nothing has been proposed yet.",
    Implementation: reached.Implementation ? "Approved work is moving." : "No work approved or under way.",
    Optimization: reached.Optimization ? "Delivered work is being reviewed against what success looked like." : "Nothing delivered to optimise yet.",
    "Ongoing Partnership": reached["Ongoing Partnership"] ? "Measured results and accepted work point to a lasting relationship." : "Not yet an ongoing partnership.",
  };

  // Enforce monotonicity and mark the current (furthest reached) stage.
  const keys = Object.keys(reached) as TransformationStageKey[];
  let highest = -1;
  const mono = keys.map((k, i) => {
    const r = reached[k];
    if (r) highest = i;
    return r;
  });
  // Backfill: any reached stage implies all earlier stages.
  for (let i = highest; i >= 0; i--) mono[i] = true;

  return keys.map((key, i) => ({
    key,
    reached: mono[i],
    current: i === highest,
    evidence: evidence[key],
  }));
}
