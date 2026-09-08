// ─────────────────────────────────────────────────────────────────────────────
// DETERMINISTIC PRICING — PRICE DETERMINATION is fully separated from OFFER COPY.
//
// The price is a pure function of controlled, observable complexity inputs. The
// language model may personalize the offer name/description/scope wording, but it
// can NEVER choose or alter the amount charged. Adding a new approved tier is a
// one-line addition to TIERS — the classifier generalizes.
// ─────────────────────────────────────────────────────────────────────────────
import type { PricingBand } from "./types";

export interface PricingTier {
  band: PricingBand;
  priceCents: number;
  /** Focused-hours band this tier covers. */
  minHours: number;
  maxHours: number;
  /** Max number of distinct changes the tier productizes. */
  maxChanges: number;
  label: string;
}

// Customer-facing fixed anchors. ORDER MATTERS: ascending by price.
export const TIERS: PricingTier[] = [
  { band: "ENTRY", priceCents: 25000, minHours: 0, maxHours: 2, maxChanges: 1, label: "Quick Fix" },
  { band: "GROWTH", priceCents: 49500, minHours: 2, maxHours: 5, maxChanges: 4, label: "Growth Fix" },
  { band: "MINI", priceCents: 99500, minHours: 5, maxHours: 10, maxChanges: 8, label: "Mini Project" },
];

/** The ceiling above which nothing is a quick fix — it needs a conversation. */
export const QUICK_FIX_HOUR_CEILING = TIERS[TIERS.length - 1].maxHours; // 10

export const TIER_BY_BAND = new Map(TIERS.map((t) => [t.band, t]));

export function priceForBand(band: PricingBand): number {
  const t = TIER_BY_BAND.get(band);
  if (!t) throw new Error(`unknown pricing band: ${band}`);
  return t.priceCents;
}

export interface ComplexityInput {
  /** Total estimated focused hours across the bundled work. */
  estimatedHours: number;
  /** Number of distinct changes/components. */
  changeCount: number;
  /** Highest delivery risk among the bundled capabilities. */
  maxRisk: "low" | "medium" | "high";
  /** Any bundled capability requires discovery / a call to scope. */
  requiresDiscovery: boolean;
  /** Scope is uncertain (e.g. findings only INFERRED, or platform unknown). */
  scopeUncertain: boolean;
}

export interface PricingDecision {
  band: PricingBand | null;
  priceCents: number | null;
  quickFixEligible: boolean;
  reason: string;
}

/**
 * Classify complexity → the smallest tier that fully covers the work.
 * Returns quickFixEligible=false (band=null) when the work is not productizable
 * as a fixed-price quick fix — the caller then routes to a conversation.
 *
 * This is the ONLY place a quick-fix price is decided.
 */
export function classifyPricing(input: ComplexityInput): PricingDecision {
  if (input.requiresDiscovery) {
    return { band: null, priceCents: null, quickFixEligible: false, reason: "requires discovery before it can be scoped" };
  }
  if (input.scopeUncertain) {
    return { band: null, priceCents: null, quickFixEligible: false, reason: "scope is too uncertain to fix a price" };
  }
  if (input.maxRisk === "high") {
    return { band: null, priceCents: null, quickFixEligible: false, reason: "delivery risk is too high for a fixed-price quick fix" };
  }
  if (input.estimatedHours > QUICK_FIX_HOUR_CEILING) {
    return { band: null, priceCents: null, quickFixEligible: false, reason: `estimated ${input.estimatedHours}h exceeds the ${QUICK_FIX_HOUR_CEILING}h quick-fix ceiling` };
  }
  // Pick the smallest tier whose hour AND change capacity both cover the work.
  for (const tier of TIERS) {
    if (input.estimatedHours <= tier.maxHours && input.changeCount <= tier.maxChanges) {
      return { band: tier.band, priceCents: tier.priceCents, quickFixEligible: true, reason: `${input.estimatedHours}h / ${input.changeCount} change(s) → ${tier.label}` };
    }
  }
  // More changes than the largest tier productizes even if hours fit → not a quick fix.
  return { band: null, priceCents: null, quickFixEligible: false, reason: `${input.changeCount} distinct changes is beyond a productized quick fix` };
}
