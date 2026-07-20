import { describe, it, expect } from "vitest";
import { buildInvestmentModel, ENGAGEMENT_DELIVERABLES } from "./investment";
import { defaultSettings } from "./store";
import { makeLead } from "./test-lead";
import type { DeliverableContent, ArtifexService } from "./types";

const settings = defaultSettings();

function opps(): DeliverableContent["opportunities"] {
  return [
    { observation: "No online booking", evidence: "Phone only.", businessConsequence: "New patients drop off after hours.", modernizationDirection: "Add an online booking flow tied to the calendar." },
    { observation: "Slow mobile pages", evidence: "Large images on mobile.", businessConsequence: "Mobile visitors leave.", modernizationDirection: "Optimize page speed and images." },
  ];
}

describe("explainable investment model", () => {
  it("decomposes the engagement band into explainable line items", () => {
    const m = buildInvestmentModel(makeLead(), opps(), "Business Website System", settings);
    expect(m.lineItems.length).toBeGreaterThanOrEqual(2);
    for (const li of m.lineItems) {
      // Every line carries the full reasoning chain.
      expect(li.observation.length).toBeGreaterThan(0);
      expect(li.businessImpact.length).toBeGreaterThan(0);
      expect(li.recommendation.length).toBeGreaterThan(0);
      expect(li.deliverables.length).toBeGreaterThan(0);
      expect(li.expectedOutcome.length).toBeGreaterThan(0);
      expect(li.effort.lowHours).toBeGreaterThan(0);
      expect(li.effort.highHours).toBeGreaterThanOrEqual(li.effort.lowHours);
      expect(li.investmentHigh).toBeGreaterThanOrEqual(li.investmentLow);
      expect(li.rateBasis).toContain("$");
    }
  });

  it("reconciles exactly: line items sum to the totals and to the engagement band", () => {
    const service: ArtifexService = "Business Website System";
    const band = settings.defaultPricing[service];
    const m = buildInvestmentModel(makeLead(), opps(), service, settings);
    const sumLow = m.lineItems.reduce((a, l) => a + l.investmentLow, 0);
    const sumHigh = m.lineItems.reduce((a, l) => a + l.investmentHigh, 0);
    expect(sumLow).toBe(m.subtotalLow);
    expect(sumHigh).toBe(m.subtotalHigh);
    expect(m.subtotalLow).toBe(m.totalLow);
    expect(m.subtotalHigh).toBe(m.totalHigh);
    // Totals reconcile to the historical band so nothing downstream shifts.
    expect(m.totalLow).toBe(band.low);
    expect(m.totalHigh).toBe(band.high);
  });

  it("formats a range label consistent with the totals", () => {
    const m = buildInvestmentModel(makeLead(), opps(), "Business Website System", settings);
    expect(m.rangeLabel).toBe(`$${m.totalLow.toLocaleString()}–$${m.totalHigh.toLocaleString()}`);
    expect(m.rangeLabel).toBe("$8,000–$18,000");
  });

  it("reconciles across every service band", () => {
    for (const service of Object.keys(settings.defaultPricing) as ArtifexService[]) {
      const band = settings.defaultPricing[service];
      const m = buildInvestmentModel(makeLead(), opps(), service, settings);
      expect(m.lineItems.reduce((a, l) => a + l.investmentLow, 0)).toBe(band.low);
      expect(m.lineItems.reduce((a, l) => a + l.investmentHigh, 0)).toBe(band.high);
      expect(m.engagement).toBe(service);
      expect(m.blendedHourlyRate).toBeGreaterThan(0);
    }
  });

  it("always produces at least two lines even with no opportunities", () => {
    const m = buildInvestmentModel(makeLead(), [], "Launch Website", settings);
    expect(m.lineItems.length).toBeGreaterThanOrEqual(2);
    expect(m.lineItems.reduce((a, l) => a + l.investmentLow, 0)).toBe(settings.defaultPricing["Launch Website"].low);
  });

  it("is deterministic", () => {
    const a = buildInvestmentModel(makeLead(), opps(), "AI Operations System", settings);
    const b = buildInvestmentModel(makeLead(), opps(), "AI Operations System", settings);
    expect(a).toEqual(b);
  });

  it("caps opportunity lines so the foundation stays the largest single item", () => {
    const many = [...opps(), ...opps(), ...opps()];
    const m = buildInvestmentModel(makeLead(), many, "Business Website System", settings);
    // foundation + up to 2 opportunity lines = 3 max
    expect(m.lineItems.length).toBeLessThanOrEqual(3);
  });

  it("exposes a client-facing deliverables catalog per service", () => {
    for (const service of Object.keys(settings.defaultPricing) as ArtifexService[]) {
      expect(ENGAGEMENT_DELIVERABLES[service].length).toBeGreaterThan(0);
    }
  });
});
