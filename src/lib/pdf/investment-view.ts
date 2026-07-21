/**
 * Investment → client-facing view model.
 * ------------------------------------------------------------------
 * Pure, dependency-free helpers that TRANSLATE the stored InvestmentModel
 * into the strings the redesigned PDF displays. This layer only reads and
 * formats the stored model — it never recomputes pricing, re-derives effort,
 * or duplicates the allocation logic that lives in src/lib/investment.ts.
 * Keeping it JSX-free lets QC and unit tests exercise the exact display
 * contract deterministically.
 */
import type { InvestmentModel, InvestmentLineItem, InvestmentOngoingCost, ArtifexService } from "@/lib/types";

const ENDASH = "–";

/** Consistent USD formatting used everywhere money is shown. */
export function formatUSD(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** A low–high money range in the model's own house style ("$8,000–$18,000"). */
export function formatMoneyRange(low: number, high: number): string {
  return low === high ? formatUSD(low) : `${formatUSD(low)}${ENDASH}${formatUSD(high)}`;
}

/**
 * Customer-facing engagement label. The internal ArtifexService names are a
 * productized SKU menu; a prospect should see the OUTCOME we propose. Shared by
 * the brief body and the investment section so they never drift.
 */
export function engagementLabel(service: ArtifexService | string): string {
  switch (service) {
    case "Launch Website":
    case "Business Website System":
      return "A stronger customer-facing experience";
    case "AI Operations System":
    case "Automation Sprint":
      return "Streamlined day-to-day operations";
    case "Product or MVP Build":
      return "A focused product build";
    case "Visual Asset System":
      return "A cohesive visual system";
    case "Product Strategy Engagement":
      return "Product strategy & roadmap";
    default:
      return String(service);
  }
}

/** How the total is billed, in client language. */
export function cadenceLabel(billing: InvestmentModel["billing"]): string {
  return billing === "monthly" ? "Monthly engagement" : "One-time implementation";
}

/**
 * Compact effort phrasing for a line — weeks + hours, no rate math. The stored
 * summary carries a "≈" the embedded mono font can't draw, so we strip it for
 * the PDF and let "about" ride on the words instead.
 */
export function effortLabel(item: InvestmentLineItem): string {
  const hrs = item.effort.lowHours === item.effort.highHours
    ? `${item.effort.lowHours} hrs`
    : `${item.effort.lowHours}${ENDASH}${item.effort.highHours} hrs`;
  const summary = item.effort.summary.replace(/≈\s*/g, "").trim();
  return `${summary} · ${hrs}`;
}

/** Sum of effort hours across the model (read-only aggregate for the range note). */
export function totalEffortHours(model: InvestmentModel): { low: number; high: number } {
  return model.lineItems.reduce(
    (a, l) => ({ low: a.low + l.effort.lowHours, high: a.high + l.effort.highHours }),
    { low: 0, high: 0 },
  );
}

/**
 * A concise, client-facing title for a line item. The stored model has no
 * title field, so we present the recommendation (the action) as the component
 * name — trimmed to a single clause and de-punctuated.
 */
export function lineTitle(item: InvestmentLineItem): string {
  const first = (item.recommendation || "").split(/(?<=[a-z])\.\s|(?: — | – )/)[0].trim();
  const t = (first || item.recommendation || "Recommended work").replace(/\.$/, "").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Read (never recompute) the reconciliation between the line items and the
 * displayed total. `ok` mirrors what the QC pricing-consistency check enforces.
 */
export function investmentReconciliation(model: InvestmentModel): {
  componentsLow: number;
  componentsHigh: number;
  totalLow: number;
  totalHigh: number;
  rangeLabel: string;
  count: number;
  ok: boolean;
} {
  const componentsLow = model.lineItems.reduce((a, l) => a + l.investmentLow, 0);
  const componentsHigh = model.lineItems.reduce((a, l) => a + l.investmentHigh, 0);
  const ok = componentsLow === model.totalLow && componentsHigh === model.totalHigh;
  return {
    componentsLow,
    componentsHigh,
    totalLow: model.totalLow,
    totalHigh: model.totalHigh,
    rangeLabel: model.rangeLabel,
    count: model.lineItems.length,
    ok,
  };
}

/** Honest, model-driven copy for "what determines the lower vs upper end." */
export function rangeDeterminants(model: InvestmentModel): { lower: string; upper: string } {
  const hasInvolved = model.lineItems.some((l) => l.effort.complexity === "Involved");
  return {
    lower: "A focused build of each item — the leaner scope, with fewer integrations and edge cases to handle.",
    upper: hasInvolved
      ? "The more involved scope, where deeper integrations, additional states, and thorough testing add effort."
      : "Additional polish, testing, and refinement layered onto each item where it adds real value.",
  };
}

/** Third-party costs only — the ones that must stay visually separate from Artifex fees. */
export function thirdPartyCosts(model: InvestmentModel): InvestmentOngoingCost[] {
  return (model.ongoingCosts ?? []).filter((c) => c.paidTo === "third-party");
}

/** Recurring Artifex-billed costs declared on the model (rare; distinct from third-party). */
export function artifexOngoingCosts(model: InvestmentModel): InvestmentOngoingCost[] {
  return (model.ongoingCosts ?? []).filter((c) => c.paidTo === "artifex");
}

/**
 * The prospect only sees the explained model when a range has been approved for
 * sharing (investmentRange != null) AND a model exists behind it.
 */
export function sharesInvestmentModel(path: {
  investmentRange: string | null;
  investmentModel?: InvestmentModel | null;
}): path is { investmentRange: string; investmentModel: InvestmentModel } {
  return !!path.investmentRange && !!path.investmentModel && path.investmentModel.lineItems.length > 0;
}

export type { InvestmentModel, InvestmentLineItem, ArtifexService };
