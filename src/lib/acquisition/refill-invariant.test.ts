// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE REFILL VERIFICATION (Part N) — the core invariant:
//
//   "Target sendable inventory affects the NUMBER OF BUSINESSES INSPECTED,
//    NOT the qualification thresholds."
//
// Discovery breadth is elastic; the qualification bar is fixed. Raising the target
// makes us DISCOVER MORE (discoverTarget ↑), it must never relax
// MIN_QUALIFYING_CONFIDENCE / contactability / commercial-fit / fixability / margin /
// jurisdiction, and it must never authorize sending. Market bias steers WHERE we look
// (secondary/tertiary favored, excluded metros dropped by default) but an excellent
// major-metro lead is still ELIGIBLE at qualification — bias ≠ hard exclusion.
//
// Pure dry-run only: NO live discovery, NO provider calls, NO sends.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { planDiscovery, DEFAULT_QUALIFIED_INVENTORY_TARGET, discoveryShouldStop } from "../quick-fix/discovery-objective";
import { assessReserve, planRefill, overallYield, PRIOR_RATES, DEFAULT_REFILL_POLICY } from "./refill";
import { MIN_QUALIFYING_CONFIDENCE, qualifyLead, type QualificationInput } from "../quick-fix/qualification";
import { assessContactability } from "../quick-fix/contactability";
import { assessCommercialFit } from "../quick-fix/commercial-fit";
import { assessCompetitiveOverlap } from "../quick-fix/competitive-overlap";
import { sendEligibility } from "../quick-fix/jurisdiction";
import {
  isExcludedMajor, isInPolicy, selectTargetMarkets, classifyMarketSize,
  EXCLUDED_MAJOR_MARKETS, DEFAULT_MARKET_POLICY, TARGET_MARKETS,
} from "../market-policy";
import { marketTierOf, receptivityPoints } from "../geo-market";

// A fully-passing qualification input; each test perturbs ONE gate to prove the bar is fixed.
const STRONG_FIT = assessCommercialFit({ hasActiveWebsite: true, hasCommercialIntent: true, reviewCount: 120, locationsCount: 2, establishedDomain: true, defectAffectsCommercialAction: true, priceCents: 24900, effectiveHourlyCents: 20000, strongSkuSupport: true });
function qual(over: Partial<QualificationInput> = {}): QualificationInput {
  return {
    hasWebsite: true,
    contactability: assessContactability({ email: "hello@acmedental.com", website: "https://acmedental.com" }),
    suppressed: false, businessActive: true,
    commercialFit: STRONG_FIT,
    overlap: assessCompetitiveOverlap({ industry: "Dental practice" }),
    readyToSellFix: true, matchedSku: "cta-repair",
    confidence: 0.92, hasObservedDefect: true, clearsMarginGate: true,
    jurisdiction: sendEligibility("US"),
    customerLanguageClean: true,
    ...over,
  };
}

// ── (a) raising the target raises discoverTarget/needed, thresholds unchanged ──
describe("(a) target inventory scales DISCOVERY, not the qualification bar", () => {
  it("raising the target raises discoverTarget and shortfall (more businesses inspected)", () => {
    const onHand = 20;
    const low = planDiscovery(onHand, 40);
    const high = planDiscovery(onHand, 80);
    expect(high.target).toBeGreaterThan(low.target);
    expect(high.shortfall).toBeGreaterThan(low.shortfall);
    expect(high.discoverTarget).toBeGreaterThan(low.discoverTarget);
    expect(high.expand).toBe(true);
    // The invariant markers are structurally guaranteed.
    expect(high.thresholdsUnchanged).toBe(true);
    expect(high.impliesSendAuthorization).toBe(false);
  });

  it("the qualification thresholds do NOT move with the target — same lead, same verdict at any target", () => {
    // The qualification bar is a fixed constant + fixed gates, entirely independent of the
    // discovery target. Prove each gate is unchanged by asserting an excellent lead passes and a
    // just-below-bar lead fails, regardless of how large we set the target.
    for (const target of [40, 200, 1000]) {
      const plan = planDiscovery(0, target);
      expect(plan.thresholdsUnchanged).toBe(true);

      // MIN_QUALIFYING_CONFIDENCE is a fixed module constant — a discovery target can't touch it.
      expect(MIN_QUALIFYING_CONFIDENCE).toBe(0.6);
      // confidence gate: just below the fixed floor fails; the floor never scales with target.
      expect(qualifyLead(qual({ confidence: 0.59 })).disqualifiers).toContain("WEAK_EVIDENCE");
      expect(qualifyLead(qual({ confidence: 0.6 })).readyToSell).toBe(true);
      // contactability gate: no email is still terminal.
      expect(qualifyLead(qual({ contactability: assessContactability({ email: null, website: "https://x.com" }) })).disqualifiers).toContain("NO_EMAIL");
      // commercial-fit gate: weak fit still disqualifies.
      const WEAK_FIT = assessCommercialFit({ hasActiveWebsite: false, hasCommercialIntent: false, reviewCount: 0, locationsCount: 0, establishedDomain: false, defectAffectsCommercialAction: false, priceCents: 0, effectiveHourlyCents: 0, strongSkuSupport: false });
      expect(qualifyLead(qual({ commercialFit: WEAK_FIT })).disqualifiers).toContain("WEAK_COMMERCIAL_FIT");
      // fixability gate: no ready-to-sell fix → never ready to sell.
      expect(qualifyLead(qual({ readyToSellFix: false })).readyToSell).toBe(false);
      // margin gate: not clearing margin still disqualifies.
      expect(qualifyLead(qual({ clearsMarginGate: false })).disqualifiers).toContain("THIN_MARGIN");
      // jurisdiction gate: unknown fails closed.
      expect(qualifyLead(qual({ jurisdiction: sendEligibility("") })).disqualifiers).toContain("JURISDICTION_UNKNOWN");
    }
  });
});

// ── (b) filling the target never authorizes sending; thresholds flagged unchanged ──
describe("(b) inventory objective is NOT send authorization", () => {
  it("impliesSendAuthorization===false and thresholdsUnchanged===true at every setting", () => {
    for (const [onHand, target] of [[0, 40], [39, 40], [40, 40], [1000, 40], [10, 500]]) {
      const p = planDiscovery(onHand, target);
      expect(p.impliesSendAuthorization).toBe(false);
      expect(p.thresholdsUnchanged).toBe(true);
    }
  });
});

// ── (c) secondary/tertiary bias preserved; excluded metros excluded by default ──
describe("(c) market bias — secondary/tertiary favored, excluded metros dropped by default", () => {
  it("every default-excluded major metro is excluded and not in-policy", () => {
    for (const city of EXCLUDED_MAJOR_MARKETS) {
      expect(isExcludedMajor(city)).toBe(true);
    }
    // A concrete excluded metro is not in-policy even at a plausible size.
    expect(isInPolicy({ city: "Los Angeles", state: "CA", cityPop: 3_900_000, metroPop: 13_000_000, region: "West", popSource: "x", popVintage: "y" })).toBe(false);
  });

  it("selected discovery markets are all in-policy secondary/tertiary (never excluded primaries)", () => {
    const picks = selectTargetMarkets({ cursor: 0, count: 12 });
    expect(picks.length).toBeGreaterThan(0);
    for (const s of picks) {
      expect(isExcludedMajor(s.market.city)).toBe(false);
      expect(["secondary", "tertiary"]).toContain(s.tier);
    }
    // The curated target pool itself contains no excluded primary metros.
    expect(TARGET_MARKETS.every((m) => !isExcludedMajor(m.city))).toBe(true);
  });

  it("geo-market receptivity favors established regional (non-primary) leads — bias, not exclusion", () => {
    // A saturated primary metro gets NO receptivity bonus.
    expect(marketTierOf({ city: "Los Angeles", state: "CA" })).toBe("primary");
    expect(receptivityPoints({ city: "Los Angeles", state: "CA", reviewCount: 300, locationsCount: 5 })).toBe(0);
    // An established regional business gets the small tie-breaker.
    expect(receptivityPoints({ city: "Dayton", state: "OH", reviewCount: 300, locationsCount: 5 })).toBeGreaterThan(0);
  });
});

// ── (d) an excellent MAJOR-metro lead is still ELIGIBLE at qualification ──
describe("(d) discovery bias away from majors does NOT hard-exclude a major-metro lead from qualification", () => {
  it("an excellent LA lead still qualifies as ready-to-sell (bias steers discovery, not the bar)", () => {
    // Qualification consumes signals, not the market policy — an LA lead with a real defect,
    // strong fit, US jurisdiction and a clean offer is READY_TO_SELL. Nothing in the funnel
    // encodes a metro exclusion.
    const q = qualifyLead(qual({ /* location is irrelevant to the funnel — no metro gate exists */ }));
    expect(q.readyToSell).toBe(true);
    expect(q.disqualifiers).toEqual([]);
    // And there is no "major metro" disqualifier concept in the funnel at all.
    expect(q.disqualifiers.join(",")).not.toMatch(/METRO|MAJOR|MARKET/i);
  });
});

// ── (e) with on-hand below 40, planDiscovery.expand===true and discoverTarget>0 ──
describe("(e) below-target inventory expands discovery", () => {
  it("on-hand below the default target → expand and a positive discoverTarget", () => {
    const p = planDiscovery(33, DEFAULT_QUALIFIED_INVENTORY_TARGET);
    expect(DEFAULT_QUALIFIED_INVENTORY_TARGET).toBe(40);
    expect(p.expand).toBe(true);
    expect(p.discoverTarget).toBeGreaterThan(0);
    expect(p.shortfall).toBe(7);
    // Loop keeps going while short and budget/universe remain.
    expect(discoveryShouldStop(33, 40, /*budget*/ 500, /*added*/ 5).stop).toBe(false);
    // Stops when the target is reached — NOT by lowering the bar.
    expect(discoveryShouldStop(40, 40, 500, 5).stop).toBe(true);
  });

  // ── pure dry-run: the discoverTarget needed to reach 40 from 33 at PRIOR_RATES ──
  it("dry-run: discoverTarget to reach 40 from 33 on-hand at PRIOR_RATES = 94", () => {
    const y = overallYield(PRIOR_RATES);
    // yield = 0.7*0.6*0.45*0.55*0.8*0.9 ≈ 0.074844 (7.5%)
    expect(y).toBeCloseTo(0.074844, 5);
    const shortfall = DEFAULT_QUALIFIED_INVENTORY_TARGET - 33; // 7
    const expected = Math.ceil(shortfall / y);
    expect(expected).toBe(94);
    // planDiscovery agrees with the hand calculation.
    expect(planDiscovery(33, 40, PRIOR_RATES).discoverTarget).toBe(94);
    // And the refill module sizes the same way from a reserve view (shortfall drives discovery).
    const reserve = assessReserve(33, { ...DEFAULT_REFILL_POLICY, targetReserve: 40, refillThreshold: 40 });
    const plan = planRefill(reserve, PRIOR_RATES, { ...DEFAULT_REFILL_POLICY, targetReserve: 40, refillThreshold: 40 });
    expect(plan.discoverTarget).toBe(94);
    expect(plan.needed).toBe(true);
  });
});

// ── classifyMarketSize sanity: a true primary never classifies in-band ──
describe("classifyMarketSize keeps primaries out of the target band", () => {
  it("LA-scale is 'primary'; a curated secondary is secondary/tertiary", () => {
    expect(classifyMarketSize(3_900_000, 13_000_000)).toBe("primary");
    const spokane = TARGET_MARKETS.find((m) => m.city === "Spokane")!;
    expect(["secondary", "tertiary"]).toContain(classifyMarketSize(spokane.cityPop, spokane.metroPop));
  });
});
