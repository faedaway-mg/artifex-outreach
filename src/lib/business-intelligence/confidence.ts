// ─────────────────────────────────────────────────────────────────────────────
// Confidence model.
//
// Every reading and every inference the Business Intelligence Engine emits carries
// BOTH a human label and a 0..1 score. The label is what an operator reads; the
// score is what the engine sorts, aggregates, and thresholds on. There is exactly
// one mapping between them, defined here, so confidence means the same thing in
// every dimension and every opportunity.
//
// The scale is honest about how we know a thing:
//   Observed  — directly seen in public data (a booking widget in the HTML).
//   Reported  — asserted by a third party (a recurring review theme).
//   Likely    — a strong inference from converging signals.
//   Inferred  — a weak inference; plausible, not established.
//   Unknown   — expected but not determinable from what we can see. NEVER a guess.
// ─────────────────────────────────────────────────────────────────────────────
import type { ObservationType } from "../positioning";
import type { EvidenceConfidence } from "../intelligence/evidence";

export const CONFIDENCE_LABELS = ["Observed", "Reported", "Likely", "Inferred", "Unknown"] as const;
export type ConfidenceLabel = (typeof CONFIDENCE_LABELS)[number];

/** The single source of truth for label → score. */
export const CONFIDENCE_SCORE: Record<ConfidenceLabel, number> = {
  Observed: 0.95,
  Reported: 0.7,
  Likely: 0.6,
  Inferred: 0.4,
  Unknown: 0.15,
};

export interface Confidence {
  label: ConfidenceLabel;
  /** 0..1, the numeric form of `label` (see CONFIDENCE_SCORE). */
  score: number;
}

/** Build a Confidence from a label. */
export function confidence(label: ConfidenceLabel): Confidence {
  return { label, score: CONFIDENCE_SCORE[label] };
}

// "Reported" is a provenance nuance (a third party said so), not a strength tier,
// so it's excluded when snapping an aggregate score back to a label — an aggregate
// should read as Observed / Likely / Inferred / Unknown, never "Reported".
const TIER_LABELS: ConfidenceLabel[] = ["Observed", "Likely", "Inferred", "Unknown"];

/** Nearest strength-tier label for an arbitrary 0..1 score — for aggregates. */
export function scoreToLabel(score: number): ConfidenceLabel {
  let best: ConfidenceLabel = "Unknown";
  let bestDist = Infinity;
  for (const label of TIER_LABELS) {
    const d = Math.abs(CONFIDENCE_SCORE[label] - score);
    if (d < bestDist) {
      bestDist = d;
      best = label;
    }
  }
  return best;
}

/** Map a normalized Evidence confidence + observation type onto our scale. */
export function fromEvidence(observationType: ObservationType, evidenceConfidence: EvidenceConfidence): Confidence {
  if (observationType === "Directly observed fact" && evidenceConfidence === "Verified") return confidence("Observed");
  if (observationType === "Directly observed fact") return confidence("Likely");
  if (observationType === "Strong inference") return confidence(evidenceConfidence === "Verified" ? "Observed" : "Likely");
  if (observationType === "Possible opportunity") return confidence("Inferred");
  return confidence("Unknown");
}

/** Map the coarse Verified/Likely/Unknown vocabulary onto our scale. */
export function fromEvidenceConfidence(c: EvidenceConfidence): Confidence {
  return confidence(c === "Verified" ? "Observed" : c === "Likely" ? "Likely" : "Inferred");
}

/**
 * Aggregate several confidences into one. We use the MEAN score (a dimension is
 * exactly as trustworthy as the readings under it, on average), then snap to the
 * nearest label. Empty input is Unknown, never a fabricated certainty.
 */
export function aggregate(confidences: Confidence[]): Confidence {
  if (!confidences.length) return confidence("Unknown");
  const mean = confidences.reduce((s, c) => s + c.score, 0) / confidences.length;
  return { label: scoreToLabel(mean), score: round(mean) };
}

/** The most cautious of several confidences — used when any weak link should govern. */
export function weakest(confidences: Confidence[]): Confidence {
  if (!confidences.length) return confidence("Unknown");
  return confidences.reduce((min, c) => (c.score < min.score ? c : min));
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
