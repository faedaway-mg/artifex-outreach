import { describe, it, expect } from "vitest";
import { assessMarketGate, marketLabel } from "./market-gate";

describe("target-market gate (§10/§37/§41)", () => {
  it("accepts the four approved priority pods", () => {
    for (const loc of [
      { city: "Greenville", state: "SC" },
      { city: "Huntsville", state: "AL" },
      { city: "Chattanooga", state: "TN" },
      { city: "Bentonville", state: "AR" },
    ]) {
      const g = assessMarketGate(loc);
      expect(g.inMarket, `${loc.city} should be in-market`).toBe(true);
      expect(g.reason).toBeNull();
    }
  });

  it("REJECTS California (out of market) before analysis", () => {
    const g = assessMarketGate({ city: "Los Angeles", state: "CA" });
    expect(g.inMarket).toBe(false);
    expect(g.reason).toMatch(/outside the approved target markets/i);
    expect(g.label).toContain("CA");
  });

  it("accepts a same-state satellite town as an expansion match", () => {
    const g = assessMarketGate({ city: "Greer", state: "SC" });
    expect(g.inMarket).toBe(true);
  });

  it("marketLabel shows the city/state in-market and 'Out of market' otherwise", () => {
    expect(marketLabel({ city: "Huntsville", state: "AL" })).toBe("Huntsville, AL");
    expect(marketLabel({ city: "San Diego", state: "CA" })).toMatch(/Out of market/);
  });
});
