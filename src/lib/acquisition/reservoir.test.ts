import { describe, it, expect } from "vitest";
import { reservoirBand, reservoirLabel, planPreparation, planDiscovery, observedYield, DEFAULT_BANDS } from "./reservoir";

describe("reservoir bands — a healthy inventory range, not a quota", () => {
  it("maps prepared counts to bands (0–9 critical, 10–19 low, 20–30 healthy, 31+ enough)", () => {
    expect(reservoirBand(0)).toBe("critical");
    expect(reservoirBand(9)).toBe("critical");
    expect(reservoirBand(10)).toBe("low");
    expect(reservoirBand(19)).toBe("low");
    expect(reservoirBand(20)).toBe("healthy");
    expect(reservoirBand(30)).toBe("healthy");
    expect(reservoirBand(31)).toBe("enough");
  });
  it("labels are operator-facing, no jargon", () => {
    expect(reservoirLabel("healthy")).toBe("Healthy");
    expect(reservoirLabel("enough")).toBe("Full");
    expect(reservoirLabel("low")).toBe("Replenishing");
  });
});

describe("planPreparation — reservoir-aware, yield-sized, cost-bounded", () => {
  const base = { eligible: 100, yieldRate: 0.4, hardCap: 40, costCap: 40 };

  it("THROTTLES when the reservoir is healthy (>= healthy threshold)", () => {
    const p = planPreparation({ ...base, prepared: 22 });
    expect(p.examine).toBe(0);
    expect(p.band).toBe("healthy");
    expect(p.reason).toMatch(/throttl/i);
  });

  it("THROTTLES when full", () => {
    expect(planPreparation({ ...base, prepared: 35 }).examine).toBe(0);
  });

  it("sizes examine from the REVIEW gap and observed yield when low", () => {
    // prepared 5 → need refillTo(25) − 5 = 20 reviews; at 40% yield → examine 50, but capped.
    const p = planPreparation({ ...base, prepared: 5, yieldRate: 0.4, hardCap: 60, costCap: 60 });
    expect(p.reviewsNeeded).toBe(20);
    expect(p.examine).toBe(50); // ceil(20 / 0.4)
  });

  it("replenishes AGGRESSIVELY when critical (bigger examine than when merely low)", () => {
    const critical = planPreparation({ ...base, prepared: 2, hardCap: 100, costCap: 100 });
    const low = planPreparation({ ...base, prepared: 15, hardCap: 100, costCap: 100 });
    expect(critical.examine).toBeGreaterThan(low.examine);
  });

  it("is bounded by cost, then hard cap, then eligible supply", () => {
    expect(planPreparation({ ...base, prepared: 0, costCap: 12, hardCap: 100, eligible: 100 }).examine).toBe(12); // cost
    expect(planPreparation({ ...base, prepared: 0, costCap: 100, hardCap: 8, eligible: 100 }).examine).toBe(8);  // hard cap
    expect(planPreparation({ ...base, prepared: 0, costCap: 100, hardCap: 100, eligible: 4 }).examine).toBe(4);  // supply
  });

  it("never examines when there is no eligible supply", () => {
    expect(planPreparation({ ...base, prepared: 0, eligible: 0 }).examine).toBe(0);
  });

  it("guards against a zero/degenerate yield (never divides by zero)", () => {
    const p = planPreparation({ ...base, prepared: 0, yieldRate: 0, hardCap: 1000, costCap: 1000, eligible: 1000 });
    expect(Number.isFinite(p.examine)).toBe(true);
    expect(p.examine).toBeGreaterThan(0);
  });
});

describe("planDiscovery — reservoir drives upstream supply (demand-aware), never more cost", () => {
  it("THROTTLES discovery when the reservoir is healthy (don't pay to find what we don't need)", () => {
    expect(planDiscovery({ prepared: 22 }).targetLeads).toBe(0);
    expect(planDiscovery({ prepared: 35 }).targetLeads).toBe(0);
  });
  it("replenishes when low and aggressively when critical", () => {
    const low = planDiscovery({ prepared: 15 });
    const critical = planDiscovery({ prepared: 3 });
    expect(low.targetLeads).toBeGreaterThan(0);
    expect(critical.targetLeads).toBeGreaterThan(low.targetLeads);
  });
  it("never drops below the board's own floor (never reduces existing supply)", () => {
    // Even 'healthy' honours an explicit board floor so this can't starve the queue.
    expect(planDiscovery({ prepared: 25, floorLeads: 8 }).targetLeads).toBe(8);
  });
  it("raises per-category cap only while rebuilding (anti-concentration relaxes, then restores)", () => {
    expect(planDiscovery({ prepared: 3 }).perCategoryCap).toBeGreaterThan(planDiscovery({ prepared: 25, floorLeads: 1 }).perCategoryCap);
  });
  it("scales the WEEKLY per-category cap with need but keeps it diversity-safe (bounded per category)", () => {
    const healthy = planDiscovery({ prepared: 25, floorLeads: 1 });
    const low = planDiscovery({ prepared: 15 });
    const critical = planDiscovery({ prepared: 3 });
    expect(healthy.weeklyCap).toBe(6);        // conservative when full
    expect(low.weeklyCap).toBeGreaterThan(healthy.weeklyCap);
    expect(critical.weeklyCap).toBeGreaterThan(low.weeklyCap);
    // Diversity guard: even critical stays a modest share — across ~12 categories, ≤~8%/category/week.
    expect(critical.weeklyCap).toBeLessThanOrEqual(15);
  });
});

describe("observedYield — measured from prep samples with a conservative prior", () => {
  it("returns the prior when there are no samples", () => {
    expect(observedYield([])).toBeCloseTo(0.4, 5);
  });
  it("moves toward the observed rate as samples accumulate", () => {
    const y = observedYield([{ examined: 100, adoptedEmail: 60 }], 0.4, 10);
    // (0.4*10 + 60) / (10 + 100) = 64/110 ≈ 0.58
    expect(y).toBeGreaterThan(0.5);
    expect(y).toBeLessThan(0.62);
  });
  it("a low observed yield pulls the estimate down (→ prep examines MORE to compensate)", () => {
    const y = observedYield([{ examined: 200, adoptedEmail: 20 }], 0.4, 10);
    expect(y).toBeLessThan(0.2);
    const plan = planPreparation({ prepared: 5, eligible: 500, yieldRate: y, hardCap: 500, costCap: 500 });
    expect(plan.examine).toBeGreaterThan(100); // 20 needed / ~0.11 yield
  });
});
