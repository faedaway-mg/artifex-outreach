// ─────────────────────────────────────────────────────────────────────────────
// UNIT ECONOMICS + MARGIN GUARDRAIL — internal only.
//
// The engine optimizes REVENUE PER OPERATOR HOUR. Every candidate is scored on
// effective hourly revenue, delivery risk, and support burden, and must clear a
// configurable minimum-economics threshold. Economically stupid offers are
// rejected or escalated, never sent. None of this is ever shown to a prospect.
// ─────────────────────────────────────────────────────────────────────────────
import type { OfferEconomics } from "./types";

export interface EconomicsThreshold {
  /** Minimum acceptable effective hourly revenue, in cents. Default $100/hr. */
  minEffectiveHourlyCents: number;
  /** Reject if third-party cost consumes more than this fraction of price. */
  maxExternalCostRatio: number;
  /** Disallow high delivery risk for a fixed-price quick fix. */
  allowHighRisk: boolean;
  /** Disallow high support burden for a low-ticket plan. */
  allowHighSupport: boolean;
}

export const DEFAULT_THRESHOLD: EconomicsThreshold = {
  minEffectiveHourlyCents: 9000, // $90/hr — a $495/5h fix ($99/hr) clears; a $250/3h+ ($83/hr) does not
  maxExternalCostRatio: 0.4,
  allowHighRisk: false,
  allowHighSupport: false,
};

export interface EconomicsInput {
  priceCents: number;
  estimatedHours: number;
  externalCostCents: number;
  deliveryRisk: "low" | "medium" | "high";
  supportBurden: "low" | "medium" | "high";
}

export function computeEconomics(input: EconomicsInput, threshold: EconomicsThreshold = DEFAULT_THRESHOLD): OfferEconomics {
  const hours = Math.max(0.25, input.estimatedHours); // never divide by zero
  const grossContributionCents = input.priceCents - input.externalCostCents;
  const effectiveHourlyCents = Math.round(grossContributionCents / hours);

  const reasons: string[] = [];
  if (effectiveHourlyCents < threshold.minEffectiveHourlyCents) {
    reasons.push(`effective $${(effectiveHourlyCents / 100).toFixed(0)}/hr is below the $${(threshold.minEffectiveHourlyCents / 100).toFixed(0)}/hr floor`);
  }
  if (input.priceCents > 0 && input.externalCostCents / input.priceCents > threshold.maxExternalCostRatio) {
    reasons.push("third-party cost consumes too much of the price");
  }
  if (input.deliveryRisk === "high" && !threshold.allowHighRisk) {
    reasons.push("delivery risk is too high");
  }
  if (input.supportBurden === "high" && !threshold.allowHighSupport) {
    reasons.push("ongoing support burden is too high");
  }
  const clearsMarginGate = reasons.length === 0;

  return {
    priceCents: input.priceCents,
    estimatedHours: input.estimatedHours,
    externalCostCents: input.externalCostCents,
    grossContributionCents,
    effectiveHourlyCents,
    deliveryRisk: input.deliveryRisk,
    supportBurden: input.supportBurden,
    clearsMarginGate,
    marginReasons: clearsMarginGate ? ["clears the minimum-economics threshold"] : reasons,
  };
}
