import { describe, it, expect } from "vitest";
import { marketTierOf, receptivityPoints, isEstablished, marketExperiment } from "./geo-market";
import { computeScore } from "./scoring";
import { makeLead } from "./test-lead";
import { NATIONAL_METROS, effectiveTerritories, POOLS } from "./geo-pools";
import { routeDestinationFor } from "./outreach/auto-route";
import type { Lead } from "./types";

// An established regional (Ohio) business — the emphasized sweet spot.
const ohio = (over: Partial<Lead> = {}) => makeLead({ businessName: "Buckeye Dental Group", city: "Columbus", state: "OH", industry: "Dental practice", normalizedCategory: "dentist", rating: 4.7, reviewCount: 180, ...over });
const la = (over: Partial<Lead> = {}) => makeLead({ businessName: "Wilshire Dental", city: "Los Angeles", state: "CA", rating: 4.7, reviewCount: 180, ...over });

describe("market tier classification (experimental, not fact)", () => {
  it("classifies primary metros, emphasized regional states, and secondary", () => {
    expect(marketTierOf({ city: "Los Angeles", state: "CA" })).toBe("primary");
    expect(marketTierOf({ city: "New York", state: "NY" })).toBe("primary");
    expect(marketTierOf({ city: "Columbus", state: "OH" })).toBe("regional");
    expect(marketTierOf({ city: "Louisville", state: "KY" })).toBe("regional");
    expect(marketTierOf({ city: "Dallas", state: "TX" })).toBe("secondary");
    expect(marketTierOf({ city: "Pasadena", state: "CA" })).toBe("secondary"); // CA but not a primary metro
  });
});

describe("receptivity tie-breaker — modest, established-only, never overrides fundamentals", () => {
  it("A. an established Ohio business earns the small bonus; C-primary/secondary earn none", () => {
    expect(receptivityPoints(ohio())).toBe(4);
    expect(receptivityPoints(la())).toBe(0);
    expect(receptivityPoints(makeLead({ city: "Dallas", state: "TX", reviewCount: 180 }))).toBe(0);
  });

  it("B. a TINY business gets NO preference just for being in a secondary market (sweet spot)", () => {
    expect(isEstablished(makeLead({ reviewCount: 8, locationsCount: 1 }))).toBe(false);
    expect(receptivityPoints(ohio({ reviewCount: 8, locationsCount: 1 }))).toBe(0); // tiny Ohio → no bonus
    expect(receptivityPoints(ohio({ reviewCount: 8, locationsCount: 3 }))).toBe(4); // multi-location → established
  });

  it("C. QUALITY > GEOGRAPHY: an excellent LA business still beats a weak Ohio one", () => {
    const excellentLA = la({ rating: 4.9, reviewCount: 500, website: "https://a.com" });
    const weakOhio = ohio({ rating: 3.6, reviewCount: 12, website: null });
    expect(computeScore(excellentLA).total).toBeGreaterThan(computeScore(weakOhio).total);
  });

  it("D. TIE-BREAK: between comparable established prospects, the regional one is modestly ahead", () => {
    const ohioScore = computeScore(ohio({ website: "https://b.com" })).total;
    const laScore = computeScore(la({ website: "https://b.com" })).total;
    expect(ohioScore).toBe(laScore + 4); // exactly the small bonus — a nudge, not a takeover
  });
});

describe("regional businesses use the SAME pipeline (email-first, not cold-call quota)", () => {
  it("E. an established Ohio business with an email routes email-first", () => {
    expect(routeDestinationFor(ohio({ publicEmail: "office@buckeyedental.com" }))).toBe("email");
  });
  it("F. a no-email Ohio business is preserved (needs-attention/prep), not a cold-call — gatekeeper here", () => {
    // Dental (gatekeeper) with no email → held for a route, never a cold call quota.
    expect(routeDestinationFor(ohio({ publicEmail: null, phone: "(614) 555-0100", website: null, contactFormUrl: null, socialLinks: [] }))).toBe("needs-attention");
  });
});

describe("Ohio + regional markets participate in nationwide discovery", () => {
  const SOCAL = POOLS.SoCal.map((m) => ({ city: m.city, state: m.state }));
  it("§15. Ohio (Columbus) is present in the rotating national universe", () => {
    expect(NATIONAL_METROS.some((m) => m.state === "OH")).toBe(true);
    const seen = new Set<string>();
    for (let c = 0; c < NATIONAL_METROS.length; c++) for (const t of effectiveTerritories(SOCAL, c)) seen.add(`${t.city}|${t.state}`);
    expect(seen.has("Columbus|OH")).toBe(true);
  });
  it("H. primary metros are NOT banned — New York still appears", () => {
    expect(NATIONAL_METROS.some((m) => m.state === "NY")).toBe(true);
  });
  it("regional is over-represented (the emphasis), while others remain present", () => {
    const regional = NATIONAL_METROS.filter((m) => marketTierOf(m) === "regional").length;
    expect(regional).toBeGreaterThan(NATIONAL_METROS.length / 3); // largest single bloc
    expect(NATIONAL_METROS.some((m) => m.state === "TX")).toBe(true);
  });
});

describe("marketExperiment — compare outcomes by tier (reuses existing data)", () => {
  it("aggregates businesses/emailed/replies/meetings per tier", () => {
    const leads = [
      { id: "o1", city: "Columbus", state: "OH" }, { id: "o2", city: "Dayton", state: "OH" },
      { id: "l1", city: "Los Angeles", state: "CA" }, { id: "d1", city: "Dallas", state: "TX" },
    ];
    const exp = marketExperiment({ leads, sentLeadIds: new Set(["o1", "o2", "l1"]), repliedLeadIds: new Set(["o1"]), metLeadIds: new Set(["o1"]) });
    expect(exp.regional.businesses).toBe(2);
    expect(exp.regional.emailed).toBe(2);
    expect(exp.regional.replies).toBe(1);
    expect(exp.primary.businesses).toBe(1);
    expect(exp.secondary.businesses).toBe(1); // Dallas
  });
});
