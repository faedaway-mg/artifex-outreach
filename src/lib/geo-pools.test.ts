import { describe, it, expect } from "vitest";
import { effectiveTerritories, rotateNationalTerritories, isUsMarket, NATIONAL_METROS, POOLS } from "./geo-pools";
import { makeLead } from "./test-lead";
import { computeScore } from "./scoring";
import { inferZone, knownClosedNow } from "./timezone";
import { routeDestinationFor } from "./outreach/auto-route";

const SOCAL = POOLS.SoCal.map((m) => ({ city: m.city, state: m.state }));

describe("geographic pools — widen the universe, keep cost bounded, US-only", () => {
  it("A. LOCAL preserved: effective territories always include Los Angeles", () => {
    const t = effectiveTerritories(SOCAL, 0);
    expect(t.some((x) => x.city === "Los Angeles" && x.state === "CA")).toBe(true);
  });

  it("B/C. NATIONAL: non-LA California AND out-of-state markets are reachable across rotation", () => {
    const seen = new Set<string>();
    for (let cursor = 0; cursor < NATIONAL_METROS.length; cursor++) {
      for (const t of effectiveTerritories(SOCAL, cursor)) seen.add(`${t.city}|${t.state}`);
    }
    expect(seen.has("San Diego|CA")).toBe(true); // non-LA California
    expect([...seen].some((k) => k.endsWith("|TX"))).toBe(true); // Texas
    expect([...seen].some((k) => k.endsWith("|NY"))).toBe(true); // New York
    expect([...seen].some((k) => k.endsWith("|AZ"))).toBe(true); // Southwest
  });

  it("H. COST BOUND: a run's national slice is bounded (rotation, not every metro every tick)", () => {
    expect(rotateNationalTerritories(0, 12)).toHaveLength(Math.min(12, NATIONAL_METROS.length));
    // A single run's territory set is small and finite — it never returns the whole country.
    expect(effectiveTerritories(SOCAL, 0, 12).length).toBeLessThanOrEqual(SOCAL.length + 12);
    // Different cursors rotate to different starting markets (coverage over time, bounded per tick).
    expect(rotateNationalTerritories(0, 4)).not.toEqual(rotateNationalTerritories(4, 4));
  });

  it("I. US-ONLY: every effective territory is a US market; a non-US market is rejected", () => {
    for (const t of effectiveTerritories(SOCAL, 3)) expect(isUsMarket(t)).toBe(true);
    expect(isUsMarket({ state: "ON" })).toBe(false); // Ontario, Canada
    expect(isUsMarket({ state: "" })).toBe(false);
  });

  it("D. QUALITY > DISTANCE: an excellent out-of-state business outscores a mediocre nearby one", () => {
    const nearbyMediocre = makeLead({ city: "Los Angeles", state: "CA", rating: 3.9, reviewCount: 25, website: "https://a.com" });
    const farExcellent = makeLead({ city: "Dallas", state: "TX", rating: 4.9, reviewCount: 400, website: "https://b.com" });
    // Scoring uses opportunity signals, not proximity — the Dallas business wins.
    expect(computeScore(farExcellent).total).toBeGreaterThan(computeScore(nearbyMediocre).total);
  });

  it("E/F. SAME PIPELINE: an out-of-state lead with an email routes email-first like any other", () => {
    const dallas = makeLead({ city: "Dallas", state: "TX", publicEmail: "hi@dallasbiz.com" });
    expect(routeDestinationFor(dallas)).toBe("email");
  });

  it("J. TIMEZONE: synchronous checks use BUSINESS-local time, not Pacific", () => {
    const z = (state: string) => inferZone({ state, latitude: null, longitude: null });
    expect(z("NY").zone).toBe("America/New_York");
    expect(z("TX").zone).toBe("America/Chicago");
    expect(z("CA").zone).toBe("America/Los_Angeles");
    // A New York business with known Sunday-closed hours is closed on a Sunday in EASTERN time,
    // regardless of the server clock. (Sun 2026-08-09, ~13:00 ET.)
    const nyClosed = makeLead({ state: "NY", hours: "Sunday: Closed\nMonday: 9:00 AM – 5:00 PM" });
    expect(knownClosedNow(nyClosed, new Date("2026-08-09T17:00:00.000Z"))).toBe(true);
  });
});
