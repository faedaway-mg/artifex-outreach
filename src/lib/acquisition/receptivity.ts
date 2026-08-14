// ─────────────────────────────────────────────────────────────────────────────
// Receptivity / timing intelligence — evidence that a qualified business may care NOW.
//
// FIT (computeScore) answers "could Artifex create value here?". RECEPTIVITY answers a DIFFERENT
// question: "is there OBSERVABLE evidence this business may currently care about solving this kind
// of problem?" We derive it ONLY from what the analysis actually observed — the BI opportunities
// carry an observation (what we saw), a category, a confidence LABEL, and basis (provenance). We
// treat only DIRECTLY-OBSERVED / REPORTED conditions (not inferred potential) as receptivity
// signals, so a signal is always backed by real evidence, never by aesthetics or a guess.
//
// Receptivity is a HYPOTHESIS, not buying intent. No signal ≠ uninterested — it is simply
// "no observed receptivity signal yet". Every signal keeps its evidence + provenance so the
// learning loop can later test which signals actually correlate with replies/meetings.
// ─────────────────────────────────────────────────────────────────────────────
import type { ModernizationOpportunity, OpportunityCategory } from "../business-intelligence/types";
import type { ConfidenceLabel } from "../business-intelligence/confidence";

export type ReceptivitySignalType =
  | "customer-friction"    // customers are visibly hitting friction now
  | "scheduling-friction"  // booking/scheduling is a current pain
  | "communication-gap"    // response/communication breakdowns
  | "system-process";      // fragmented/manual internal workflow observed

export interface ReceptivitySignal {
  type: ReceptivitySignalType;
  /** Provenance — where the evidence came from (the opportunity's basis). */
  source: string;
  /** What we literally observed — the evidence, in the business's own reality. */
  evidence: string;
  observedAt: string | null;
  confidence: ConfidenceLabel;
  /** Why this may matter now (never a claim of intent). */
  explanation: string;
  /** Current enough to matter (directly observed / reported, not stale/inferred). */
  current: boolean;
}

// Only these opportunity categories reflect a CURRENT observable condition (something happening to
// the business/its customers now) rather than latent potential; they map to a receptivity type.
const CATEGORY_SIGNAL: Partial<Record<OpportunityCategory, ReceptivitySignalType>> = {
  Scheduling: "scheduling-friction",
  Communication: "communication-gap",
  "Customer Retention": "customer-friction",
  "Brand Experience": "customer-friction",
  "Customer Acquisition": "customer-friction",
  Operations: "system-process",
  "Internal Workflow": "system-process",
};
// A signal is "current" only when the analysis directly observed or reported it (not inferred).
const CURRENT_CONFIDENCE = new Set<ConfidenceLabel>(["Observed", "Reported"]);

/** Extract receptivity signals from what the analysis actually observed. Pure. A business with no
 *  qualifying observation returns [] — that means "no observed signal yet", NOT "uninterested". */
export function receptivitySignalsFrom(input: { opportunities?: ModernizationOpportunity[]; generatedAt?: string | null }): ReceptivitySignal[] {
  const out: ReceptivitySignal[] = [];
  for (const o of input.opportunities ?? []) {
    const type = CATEGORY_SIGNAL[o.category];
    if (!type) continue; // this opportunity is latent FIT, not observed receptivity
    if (!CURRENT_CONFIDENCE.has(o.confidence.label)) continue; // inferred potential ≠ receptivity evidence
    out.push({
      type,
      source: (o.basis ?? []).join("; ") || "business intelligence",
      evidence: o.observation,
      observedAt: input.generatedAt ?? null,
      confidence: o.confidence.label,
      explanation: o.whyItMatters,
      current: true,
    });
  }
  return out;
}

const CONFIDENCE_WEIGHT: Record<ConfidenceLabel, number> = { Observed: 2, Reported: 1.5, Likely: 1, Inferred: 0.5, Unknown: 0 };

/** A bounded receptivity score (0..~8) from CURRENT signals, weighted by confidence. Distinct from
 *  fit — a high fit with no observed signal scores 0 here, and that is correct: no evidence yet. */
export function receptivityScore(signals: ReceptivitySignal[]): number {
  const s = signals.filter((x) => x.current).reduce((a, x) => a + CONFIDENCE_WEIGHT[x.confidence], 0);
  return Math.min(8, Math.round(s * 10) / 10);
}

/** Has a STRONG (directly observed) current signal — the bar for grounding outreach copy in it. */
export function hasStrongSignal(signals: ReceptivitySignal[]): boolean {
  return signals.some((x) => x.current && x.confidence === "Observed");
}

/**
 * An evidence-grounded outreach angle, or null. Only returns copy when a STRONG observed signal
 * exists, and it uses THAT signal's own evidence — never claims intent ("you're looking for
 * automation") and never over-states. If null, callers retain the existing high-quality approach.
 */
export function receptivityAngle(businessName: string, signals: ReceptivitySignal[]): string | null {
  const strong = signals.find((x) => x.current && x.confidence === "Observed");
  if (!strong) return null;
  const obs = strong.evidence.trim().replace(/\.$/, "");
  // Observation first, then why-it-matters — grounded, no fabricated urgency.
  return `We noticed ${obs.charAt(0).toLowerCase()}${obs.slice(1)}. ${strong.explanation.trim()} We put together a one-page review of how that part of the workflow currently runs.`;
}
