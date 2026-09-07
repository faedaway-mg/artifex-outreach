import { describe, it, expect } from "vitest";
import {
  DEFAULT_MARKET_POLICY, EXCLUDED_MAJOR_MARKETS, TARGET_MARKETS, MARKET_POLICY_VERSION,
  classifyMarketSize, isExcludedMajor, isInPolicy, selectTargetMarkets, discoveryTerritories, cooldownKey, regionOfState,
} from "./market-policy";

describe("mandate 26 §4 — canonical small-market policy", () => {
  it("is versioned and cites a population source + vintage", () => {
    expect(MARKET_POLICY_VERSION).toMatch(/^v\d/);
    expect(DEFAULT_MARKET_POLICY.popSource).toMatch(/census/i);
    expect(DEFAULT_MARKET_POLICY.popVintage).toBeTruthy();
    for (const m of TARGET_MARKETS) { expect(m.popSource).toBeTruthy(); expect(m.popVintage).toBeTruthy(); }
  });

  it("excludes the major primary metros by default (one canonical list, no scattered conditions)", () => {
    for (const city of ["Los Angeles", "New York", "Chicago", "Houston", "Phoenix", "Denver", "Seattle", "San Francisco", "Miami", "Boston", "Washington", "Atlanta", "Dallas", "Austin", "San Diego", "Philadelphia", "San Antonio"]) {
      expect(isExcludedMajor(city)).toBe(true);
    }
    // No target market is an excluded primary.
    for (const m of TARGET_MARKETS) expect(isExcludedMajor(m.city)).toBe(false);
    expect(EXCLUDED_MAJOR_MARKETS).toContain("denver");
  });

  it("classifies market size against the policy band; every seed market is in-policy secondary/tertiary", () => {
    expect(classifyMarketSize(65_000, 155_000)).toMatch(/secondary|tertiary/);
    expect(classifyMarketSize(4_000_000, 13_000_000)).toBe("primary"); // LA-scale
    expect(classifyMarketSize(9_000, 20_000)).toBe("micro");
    for (const m of TARGET_MARKETS) expect(isInPolicy(m)).toBe(true);
  });

  it("selects region-diverse markets and is deterministic for a given cursor", () => {
    const a = selectTargetMarkets({ cursor: 0, count: 8 });
    const b = selectTargetMarkets({ cursor: 0, count: 8 });
    expect(a.map((s) => s.market.city)).toEqual(b.map((s) => s.market.city));
    const regions = new Set(a.map((s) => s.market.region));
    expect(regions.size).toBeGreaterThanOrEqual(DEFAULT_MARKET_POLICY.regionalDiversityMinRegions);
    // every selection is in-policy + carries reasons + no excluded primary
    for (const s of a) { expect(isInPolicy(s.market)).toBe(true); expect(s.reasons.length).toBeGreaterThan(0); expect(isExcludedMajor(s.market.city)).toBe(false); }
  });

  it("different cursors surface different markets (rotation)", () => {
    const a = selectTargetMarkets({ cursor: 0, count: 6 }).map((s) => s.market.city);
    const c = selectTargetMarkets({ cursor: 17, count: 6 }).map((s) => s.market.city);
    expect(a).not.toEqual(c);
  });

  it("market/category cooldown skips recently-searched pairs", () => {
    const base = selectTargetMarkets({ cursor: 0, count: 5, category: "roofing" });
    const cooled = new Set(base.map((s) => cooldownKey(s.market.city, s.market.state, "roofing")));
    const next = selectTargetMarkets({ cursor: 0, count: 5, category: "roofing", recent: cooled });
    // none of the cooled pairs reappear
    for (const s of next) expect(cooled.has(cooldownKey(s.market.city, s.market.state, "roofing"))).toBe(false);
  });

  it("recently-searched markets are soft-skipped but never starve the slice", () => {
    const first = selectTargetMarkets({ cursor: 0, count: 6 });
    const recentMarkets = new Set(first.map((s) => `${s.market.city.toLowerCase()}|${s.market.state.toUpperCase()}`));
    const next = selectTargetMarkets({ cursor: 0, count: 6, recentMarkets });
    expect(next.length).toBe(6); // still filled
    // prefers fresh markets: overlap is reduced
    const overlap = next.filter((s) => recentMarkets.has(`${s.market.city.toLowerCase()}|${s.market.state.toUpperCase()}`)).length;
    expect(overlap).toBeLessThan(6);
  });

  it("discoveryTerritories drops excluded primaries from configured local coverage by default", () => {
    const { territories } = discoveryTerritories({
      configured: [{ city: "Los Angeles", state: "CA" }, { city: "Santa Monica", state: "CA" }, { city: "Pasadena", state: "CA" }],
      cursor: 3,
    });
    const cities = territories.map((t) => t.city.toLowerCase());
    expect(cities).not.toContain("los angeles");
    expect(cities).not.toContain("santa monica");
    expect(cities).toContain("pasadena"); // secondary suburb kept
    // and it added in-policy small markets
    expect(territories.length).toBeGreaterThan(1);
  });

  it("primaryMetroAllowance lets a limited number of primaries through when explicitly configured", () => {
    const cfg = { ...DEFAULT_MARKET_POLICY, primaryMetroAllowance: 1 };
    const { territories } = discoveryTerritories({ configured: [{ city: "Los Angeles", state: "CA" }, { city: "New York", state: "NY" }], cursor: 0, cfg });
    const primaries = territories.filter((t) => ["los angeles", "new york"].includes(t.city.toLowerCase()));
    expect(primaries.length).toBe(1);
  });

  it("regionOfState maps sensibly across the country", () => {
    expect(regionOfState("OH")).toBe("Midwest");
    expect(regionOfState("TN")).toBe("South");
    expect(regionOfState("CO")).toBe("Mountain");
    expect(regionOfState("WA")).toBe("West");
    expect(regionOfState("PA")).toBe("Northeast");
    expect(regionOfState("TX")).toBe("Southwest");
  });
});
