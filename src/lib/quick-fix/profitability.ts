// ─────────────────────────────────────────────────────────────────────────────
// PROFITABILITY — the North Star: GROSS PROFIT PER OPERATOR HOUR. Time is the
// scarce resource (GovCon is the primary business). Uses ACTUAL data where it
// exists and honest null where it does not — never fabricated economics.
// ─────────────────────────────────────────────────────────────────────────────

export interface OperatorTime {
  implementationMin: number;
  qaMin: number;
  commsMin: number;
  reworkMin: number;
}

export function totalOperatorMinutes(t: OperatorTime): number {
  return t.implementationMin + t.qaMin + t.commsMin + t.reworkMin;
}

export interface JobEconomicsActuals {
  priceCents: number;
  externalCostCents: number;
  refundCents: number;
  operatorMinutes: number | null; // null until tracked
  /** Optional operator labor cost assumption ($/hr in cents). */
  operatorHourlyCostCents?: number | null;
}

export interface JobProfit {
  grossContributionCents: number; // price - external - refunds
  operatorHours: number | null;
  grossContributionPerOperatorHourCents: number | null;
  grossProfitCents: number | null; // contribution - labor cost (if labor cost known)
  grossProfitPerOperatorHourCents: number | null;
}

export function jobProfit(a: JobEconomicsActuals): JobProfit {
  const grossContributionCents = a.priceCents - a.externalCostCents - a.refundCents;
  const operatorHours = a.operatorMinutes != null ? a.operatorMinutes / 60 : null;
  const perHour = operatorHours && operatorHours > 0 ? Math.round(grossContributionCents / operatorHours) : null;
  const laborKnown = a.operatorHourlyCostCents != null && operatorHours != null;
  const laborCost = laborKnown ? Math.round((a.operatorHourlyCostCents as number) * (operatorHours as number)) : null;
  const grossProfitCents = laborCost != null ? grossContributionCents - laborCost : null;
  const gpPerHour = grossProfitCents != null && operatorHours && operatorHours > 0 ? Math.round(grossProfitCents / operatorHours) : null;
  return {
    grossContributionCents,
    operatorHours,
    grossContributionPerOperatorHourCents: perHour,
    grossProfitCents,
    grossProfitPerOperatorHourCents: gpPerHour,
  };
}

// ── SKU profitability roll-up ────────────────────────────────────────────────
export type SkuVerdict = "SCALE" | "KEEP" | "REPRICE" | "NARROW" | "REVIEW" | "RETIRE";

export interface SkuProfitRow {
  skuKey: string;
  sales: number;
  revenueCents: number;
  estimatedHours: number | null;
  actualHours: number | null;
  externalCostCents: number;
  refundsCents: number;
  grossContributionCents: number;
  effectiveHourlyCents: number | null;
  conversionRate: number | null;
  repeatPurchaseRate: number | null;
  maintenanceAttachRate: number | null;
  verdict: SkuVerdict;
}

/** Minimum sales before a verdict beyond REVIEW is allowed (avoid small-sample calls). */
export const MIN_SALES_FOR_VERDICT = 5;

export function classifySku(row: Omit<SkuProfitRow, "verdict">): SkuVerdict {
  if (row.sales < MIN_SALES_FOR_VERDICT) return "REVIEW"; // insufficient data
  const hourly = row.effectiveHourlyCents;
  if (hourly == null) return "REVIEW";
  if (hourly >= 20000 && (row.conversionRate ?? 0) >= 0.05) return "SCALE";
  if (hourly < 7000) return "REPRICE";
  if (row.actualHours != null && row.estimatedHours != null && row.actualHours > row.estimatedHours * 1.5) return "NARROW";
  return "KEEP";
}

export interface NorthStar {
  revenueCents: number;
  externalCostCents: number;
  refundsCents: number;
  grossContributionCents: number;
  operatorHours: number | null;
  grossContributionPerOperatorHourCents: number | null;
}

/** Portfolio North-Star roll-up. operatorHours null when no time is tracked yet. */
export function northStar(jobs: JobEconomicsActuals[]): NorthStar {
  let revenue = 0, external = 0, refunds = 0, minutes = 0, minutesKnown = false;
  for (const j of jobs) {
    revenue += j.priceCents;
    external += j.externalCostCents;
    refunds += j.refundCents;
    if (j.operatorMinutes != null) { minutes += j.operatorMinutes; minutesKnown = true; }
  }
  const grossContributionCents = revenue - external - refunds;
  const operatorHours = minutesKnown ? minutes / 60 : null;
  const perHour = operatorHours && operatorHours > 0 ? Math.round(grossContributionCents / operatorHours) : null;
  return { revenueCents: revenue, externalCostCents: external, refundsCents: refunds, grossContributionCents, operatorHours, grossContributionPerOperatorHourCents: perHour };
}
