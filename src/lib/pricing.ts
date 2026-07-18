// ─────────────────────────────────────────────────────────────────────────────
// Commercial model — engagement models + relationship-value estimation.
//
// Replaces the old assumption that every qualified lead is one ~$8,000 website.
// A lead now carries a RELATIONSHIP value (entry / 3-month / 6-month / 12-month),
// confidence-adjusted, so the pipeline reflects likely long-term value rather than
// a uniform one-time project. Nothing here is exposed to a prospect without a
// discovery conversation first.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead } from "./types";

// ── Engagement models ────────────────────────────────────────────────────────
export const ENGAGEMENT_MODELS = [
  {
    key: "focused-improvement",
    name: "Focused Improvement",
    summary: "A tightly scoped, high-impact correction or implementation.",
    examples: [
      "Fix a broken conversion path",
      "Improve intake or scheduling",
      "Connect a small workflow",
      "Build a focused dashboard",
      "Prototype a business idea",
      "Configure and integrate an existing platform",
    ],
    billing: "one-time" as const,
    low: 1000,
    high: 3000,
  },
  {
    key: "phased-modernization",
    name: "Phased Modernization",
    summary: "Several connected improvements delivered over a defined period, tied to an agreed roadmap.",
    examples: ["Three- or six-month engagement", "Milestone-based implementation", "Monthly investment against a roadmap"],
    billing: "monthly" as const,
    low: 2000,
    high: 4000,
  },
  {
    key: "ongoing-partnership",
    name: "Ongoing Technology Partnership",
    summary: "Continuous prioritization, implementation, optimization, and guidance.",
    examples: ["Monthly implementation capacity", "Priority roadmap delivery", "Advisory + hands-on work"],
    billing: "monthly" as const,
    low: 1000,
    high: 4000,
  },
] as const;
export type EngagementModelKey = (typeof ENGAGEMENT_MODELS)[number]["key"];

export function engagementModel(key: EngagementModelKey) {
  return ENGAGEMENT_MODELS.find((m) => m.key === key)!;
}

// ── Retainer boundaries ──────────────────────────────────────────────────────
// A retainer is a defined amount of implementation capacity — never unlimited
// labor. These defaults are what a Phased/Ongoing engagement communicates.
export const RETAINER_BOUNDARIES = {
  monthlyImplementationHours: 40,
  priorityRule: "Work is delivered against the agreed roadmap, highest-impact first.",
  responseExpectation: "One business day for advisory questions.",
  advisoryVsImplementation: "Advisory (recommendations, prioritization) is included; net-new implementation draws from monthly capacity.",
  separateApproval: "Initiatives beyond monthly capacity are estimated and approved separately.",
  unusedCapacity: "Unused capacity does not roll over; it keeps scope honest.",
  thirdPartyCosts: "Third-party costs (hosting, licenses, APIs) are passed through at cost.",
} as const;

// ── Relationship value ───────────────────────────────────────────────────────
export interface RelationshipValue {
  /** Entry engagement (the realistic first project or first month). */
  entry: number;
  /** Cumulative expected value at 3 / 6 / 12 months of relationship. */
  threeMonth: number;
  sixMonth: number;
  twelveMonth: number;
  /** 12-month value discounted by confidence in the opportunity (0..1). */
  confidenceAdjustedTwelveMonth: number;
  /** 0..1 — how likely this becomes a recurring partnership vs one-off. */
  partnershipLikelihood: number;
  /** Recommended entry engagement model. */
  recommendedEntry: EngagementModelKey;
  /** Human explanation. */
  rationale: string;
}

/**
 * Estimate relationship value from a lead's opportunity signals. Deterministic
 * and transparent. Uses the lead's estimatedValue range as the immediate-project
 * anchor, then models expansion into phased / ongoing work.
 */
export function estimateRelationshipValue(
  lead: Lead,
  opts: { confidence?: number } = {},
): RelationshipValue {
  const estLow = lead.estimatedValueLow ?? 0;
  const estHigh = lead.estimatedValueHigh ?? 0;
  const estMid = estLow && estHigh ? Math.round((estLow + estHigh) / 2) : estHigh || estLow;

  // Confidence in the opportunity (public evidence only). Defaults to a modest
  // 0.5 so cold pipeline is never overstated.
  const confidence = clamp01(opts.confidence ?? confidenceFromLead(lead));

  // Signals that a lead expands beyond a first project into a partnership.
  const multiLocation = (lead.locationsCount ?? 1) > 1;
  const established = (lead.reviewCount ?? 0) >= 80 && (lead.rating ?? 0) >= 4.2;
  const operationalDepth = (lead.scoreBreakdown?.automationOpportunity ?? 0) >= 12;

  let partnershipLikelihood = 0.3;
  if (multiLocation) partnershipLikelihood += 0.2;
  if (established) partnershipLikelihood += 0.15;
  if (operationalDepth) partnershipLikelihood += 0.15;
  partnershipLikelihood = clamp01(partnershipLikelihood);

  // Entry: prefer a smaller, honest first step. A big estimate does NOT force a
  // big first project — the highest-impact focused improvement is preferred.
  const recommendedEntry: EngagementModelKey =
    estHigh >= 12000 && partnershipLikelihood >= 0.55
      ? "phased-modernization"
      : partnershipLikelihood >= 0.5
        ? "ongoing-partnership"
        : "focused-improvement";

  const entry =
    recommendedEntry === "focused-improvement"
      ? clampRange(estMid || 2000, 1000, 6000)
      : recommendedEntry === "phased-modernization"
        ? 3000 // first month of a phased engagement
        : 2000; // first month of an ongoing partnership

  // Monthly recurring potential once in a relationship.
  const monthly = recommendedEntry === "focused-improvement" ? (partnershipLikelihood >= 0.4 ? 1500 : 0) : entry;

  // Cumulative expected value across the relationship horizon.
  const threeMonth = entry + monthly * 2;
  const sixMonth = entry + monthly * 5 + (estMid ? Math.round(estMid * 0.3) : 0);
  const twelveMonth = entry + monthly * 11 + (estMid ? Math.round(estMid * 0.5) : 0);
  const confidenceAdjustedTwelveMonth = Math.round(twelveMonth * confidence);

  const rationale = buildRationale(recommendedEntry, partnershipLikelihood, confidence);

  return {
    entry,
    threeMonth,
    sixMonth,
    twelveMonth,
    confidenceAdjustedTwelveMonth,
    partnershipLikelihood: round2(partnershipLikelihood),
    recommendedEntry,
    rationale,
  };
}

function confidenceFromLead(lead: Lead): number {
  // More public evidence → more confidence, but capped: we cannot see internal ops.
  let c = 0.35;
  if (lead.scoreBreakdown) c += 0.15; // has been analyzed
  if ((lead.reviewCount ?? 0) >= 40) c += 0.1;
  if (lead.website) c += 0.05;
  if (lead.publicEmail || lead.phone) c += 0.05;
  return clamp01(c);
}

function buildRationale(entry: EngagementModelKey, partnership: number, confidence: number): string {
  const model = engagementModel(entry);
  const partnerText =
    partnership >= 0.55
      ? "signals point to a business that could expand into an ongoing relationship"
      : partnership >= 0.4
        ? "there is moderate potential to expand beyond a first project"
        : "this looks like a focused first project rather than an immediate partnership";
  return `Recommended entry: ${model.name}. Based on public evidence, ${partnerText}. Twelve-month value is shown confidence-adjusted (${Math.round(confidence * 100)}%) because internal operations cannot be seen from the outside.`;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
function clampRange(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
