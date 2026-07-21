import { describe, it, expect } from "vitest";
import { buildInvestmentModel } from "@/lib/investment";
import { defaultSettings } from "@/lib/store";
import { makeLead } from "@/lib/test-lead";
import type { DeliverableContent } from "@/lib/types";
import {
  formatUSD, formatMoneyRange, cadenceLabel, engagementLabel, effortLabel,
  totalEffortHours, lineTitle, investmentReconciliation, rangeDeterminants,
  thirdPartyCosts, artifexOngoingCosts, sharesInvestmentModel,
} from "./investment-view";

const settings = defaultSettings();
const opps: DeliverableContent["opportunities"] = [
  { observation: "No online booking", evidence: "Phone only.", businessConsequence: "New patients drop off.", modernizationDirection: "Add an online booking flow tied to the calendar." },
  { observation: "Slow mobile pages", evidence: "Large images.", businessConsequence: "Mobile visitors leave.", modernizationDirection: "Optimize page speed." },
];
const model = buildInvestmentModel(makeLead(), opps, "Business Website System", settings);

describe("investment-view — formatting", () => {
  it("formats USD with thousands separators and no cents", () => {
    expect(formatUSD(8000)).toBe("$8,000");
    expect(formatUSD(18000.4)).toBe("$18,000");
  });
  it("formats a money range with an en dash, collapsing equal ends", () => {
    expect(formatMoneyRange(8000, 18000)).toBe("$8,000–$18,000");
    expect(formatMoneyRange(5000, 5000)).toBe("$5,000");
  });
  it("labels cadence and engagement in client language", () => {
    expect(cadenceLabel("one-time")).toMatch(/one-time/i);
    expect(cadenceLabel("monthly")).toMatch(/monthly/i);
    expect(engagementLabel("Business Website System")).toBe("A stronger customer-facing experience");
  });
});

describe("investment-view — reads (never recomputes) the model", () => {
  it("reports a reconciliation that matches the stored totals exactly", () => {
    const r = investmentReconciliation(model);
    expect(r.componentsLow).toBe(model.totalLow);
    expect(r.componentsHigh).toBe(model.totalHigh);
    expect(r.rangeLabel).toBe(model.rangeLabel);
    expect(r.count).toBe(model.lineItems.length);
    expect(r.ok).toBe(true);
  });
  it("detects a broken reconciliation without mutating anything", () => {
    const broken = { ...model, totalHigh: model.totalHigh + 1000 };
    expect(investmentReconciliation(broken).ok).toBe(false);
  });
  it("aggregates effort hours and produces labels", () => {
    const hrs = totalEffortHours(model);
    expect(hrs.high).toBeGreaterThanOrEqual(hrs.low);
    expect(effortLabel(model.lineItems[0])).toMatch(/hrs/);
    expect(lineTitle(model.lineItems[0]).length).toBeGreaterThan(0);
    expect(rangeDeterminants(model).lower.length).toBeGreaterThan(0);
    expect(rangeDeterminants(model).upper.length).toBeGreaterThan(0);
  });
  it("separates third-party from Artifex ongoing costs", () => {
    // Business Website System attaches a third-party hosting cost.
    expect(thirdPartyCosts(model).length).toBeGreaterThan(0);
    expect(thirdPartyCosts(model).every((c) => c.paidTo === "third-party")).toBe(true);
    expect(artifexOngoingCosts(model).every((c) => c.paidTo === "artifex")).toBe(true);
  });
});

describe("investment-view — sharing gate", () => {
  it("shares only when a range is approved AND a model with line items exists", () => {
    expect(sharesInvestmentModel({ investmentRange: null, investmentModel: model })).toBe(false);
    expect(sharesInvestmentModel({ investmentRange: model.rangeLabel, investmentModel: null })).toBe(false);
    expect(sharesInvestmentModel({ investmentRange: model.rangeLabel, investmentModel: model })).toBe(true);
    expect(sharesInvestmentModel({ investmentRange: model.rangeLabel, investmentModel: { ...model, lineItems: [] } })).toBe(false);
  });
});
