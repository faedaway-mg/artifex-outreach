// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL MARKET-SELECTION POLICY (mandate 26 §4, forward-compatible with mandate 27's targeting engine).
//
// ONE versioned configuration decides WHICH U.S. markets discovery searches — no city-name conditions
// scattered across the codebase. The thesis: a personalized website-review lands best in economically active
// SECONDARY / TERTIARY markets, where a polished presentation stands out and there are fewer sophisticated
// agency pitches — NOT in saturated primary metros. So we:
//   • exclude the largest primary metros by default (one canonical list),
//   • target cities ~40k–250k population inside metros ~100k–750k,
//   • rotate across regions for diversity,
//   • track recently-searched market/category pairs and cool them down,
//   • cap leads per market per cycle,
//   • record the SOURCE + VINTAGE + resulting tier of every population classification.
//
// Populations are approximate U.S. Census figures (2020 Decennial + 2023 Vintage estimates); each market
// carries `popSource`/`popVintage` so the classification is auditable, not asserted. This is discovery
// diversification only — qualification/opportunity still decide what advances.
// ─────────────────────────────────────────────────────────────────────────────
import type { Territory } from "./types";

export const MARKET_POLICY_VERSION = "v1-2026-09";

export type USRegion = "West" | "Mountain" | "Southwest" | "Midwest" | "South" | "Northeast";
export type MarketTierSize = "primary" | "secondary" | "tertiary" | "micro" | "unknown";

export interface TargetMarket extends Territory {
  cityPop: number;     // approximate city population
  metroPop: number;    // approximate metro / regional population
  region: USRegion;
  popSource: string;   // authoritative source of the population figure
  popVintage: string;  // vintage/year of the figure
}

export interface MarketPolicyConfig {
  version: string;
  cityPopMin: number;         // default 40_000
  cityPopMax: number;         // default 250_000
  metroPopMin: number;        // default 100_000
  metroPopMax: number;        // default 750_000
  /** Canonical excluded primary metros (lowercased city names). Not scattered — the ONE source of truth. */
  excludedMajorMarkets: string[];
  /** Independent suburbs explicitly allowed even though they sit inside a large metro (distinct local market). */
  allowedIndependentSuburbs: string[];
  regionalDiversityMinRegions: number; // aim for ≥ this many distinct regions per selection
  cooldownDays: number;                // don't re-search the same market/category within N days
  maxLeadsPerMarketPerCycle: number;   // cap new leads sourced from one market per discovery cycle
  primaryMetroAllowance: number;       // max excluded-major markets permitted per run (default 0)
  popSource: string;
  popVintage: string;
}

// The largest, most sales-saturated central markets — excluded by default (mandate 27 list is the superset).
export const EXCLUDED_MAJOR_MARKETS: string[] = [
  "los angeles", "new york", "chicago", "houston", "phoenix", "philadelphia", "san antonio",
  "san diego", "dallas", "austin", "denver", "seattle", "san francisco", "miami", "boston",
  "washington", "atlanta",
  // additional saturated primaries kept out by default
  "brooklyn", "manhattan", "san jose", "santa monica", "beverly hills",
];

export const DEFAULT_MARKET_POLICY: MarketPolicyConfig = {
  version: MARKET_POLICY_VERSION,
  cityPopMin: 40_000,
  cityPopMax: 250_000,
  metroPopMin: 100_000,
  metroPopMax: 750_000,
  excludedMajorMarkets: EXCLUDED_MAJOR_MARKETS,
  allowedIndependentSuburbs: [],
  regionalDiversityMinRegions: 4,
  cooldownDays: 14,
  maxLeadsPerMarketPerCycle: 3,
  primaryMetroAllowance: 0,
  popSource: "US Census Bureau (2020 Decennial + 2023 Vintage estimates)",
  popVintage: "2020/2023",
};

const REGION_BY_STATE: Record<string, USRegion> = {
  WA: "West", OR: "West", CA: "West", NV: "West",
  ID: "Mountain", MT: "Mountain", WY: "Mountain", CO: "Mountain", UT: "Mountain",
  AZ: "Southwest", NM: "Southwest", TX: "Southwest", OK: "Southwest",
  ND: "Midwest", SD: "Midwest", NE: "Midwest", KS: "Midwest", MN: "Midwest", IA: "Midwest",
  MO: "Midwest", WI: "Midwest", IL: "Midwest", IN: "Midwest", MI: "Midwest", OH: "Midwest",
  KY: "South", TN: "South", AR: "South", LA: "South", MS: "South", AL: "South", GA: "South",
  FL: "South", SC: "South", NC: "South", VA: "South", WV: "South",
  PA: "Northeast", NY: "Northeast", NJ: "Northeast", CT: "Northeast", RI: "Northeast",
  MA: "Northeast", VT: "Northeast", NH: "Northeast", ME: "Northeast", MD: "Northeast", DE: "Northeast",
};
export function regionOfState(state: string): USRegion {
  return REGION_BY_STATE[(state ?? "").trim().toUpperCase()] ?? "Midwest";
}

const src = DEFAULT_MARKET_POLICY.popSource;
const vin = DEFAULT_MARKET_POLICY.popVintage;
const M = (city: string, state: string, cityPop: number, metroPop: number): TargetMarket => ({
  city, state, cityPop, metroPop, region: regionOfState(state), popSource: src, popVintage: vin,
});

// Curated secondary/tertiary exploration pool — economically active local markets across ≥5 regions. Seeded
// with mandate 27's named exploration cities plus comparable markets; the rotation keeps discovering more.
// These are candidates, NOT permanently privileged: selection re-derives from the policy every cycle.
export const TARGET_MARKETS: TargetMarket[] = [
  // ── Mountain / West (M27 seeds: Grand Junction, Medford, Yakima) ──
  M("Grand Junction", "CO", 65_000, 155_000), M("Fort Collins", "CO", 169_000, 360_000),
  M("Boulder", "CO", 108_000, 330_000), M("Billings", "MT", 117_000, 190_000),
  M("Bend", "OR", 99_000, 205_000), M("Medford", "OR", 86_000, 223_000),
  M("Yakima", "WA", 96_000, 256_000), M("Spokane", "WA", 229_000, 585_000),
  M("Santa Fe", "NM", 89_000, 155_000), M("Provo", "UT", 115_000, 671_000),
  // ── Southwest / Central (M27 seeds: Tyler, Waco) ──
  M("Tyler", "TX", 106_000, 235_000), M("Waco", "TX", 139_000, 270_000),
  M("Amarillo", "TX", 200_000, 268_000), M("Abilene", "TX", 125_000, 175_000),
  M("College Station", "TX", 120_000, 273_000), M("Wichita Falls", "TX", 102_000, 151_000),
  M("Killeen", "TX", 153_000, 460_000),
  // ── Midwest (M27 seed: Fort Wayne) ──
  M("Fort Wayne", "IN", 263_000, 420_000), M("Green Bay", "WI", 107_000, 328_000),
  M("Cedar Rapids", "IA", 137_000, 276_000), M("Sioux Falls", "SD", 192_000, 276_000),
  M("Springfield", "MO", 169_000, 475_000), M("Peoria", "IL", 113_000, 400_000),
  M("Rockford", "IL", 147_000, 336_000), M("Duluth", "MN", 86_000, 291_000),
  M("Ann Arbor", "MI", 123_000, 372_000), M("Topeka", "KS", 126_000, 233_000),
  M("Fargo", "ND", 125_000, 249_000),
  // ── South (M27 seeds: Chattanooga, Roanoke, Fayetteville AR, Wilmington NC, Savannah GA) ──
  M("Chattanooga", "TN", 181_000, 570_000), M("Roanoke", "VA", 100_000, 315_000),
  M("Fayetteville", "AR", 93_000, 576_000), M("Wilmington", "NC", 115_000, 301_000),
  M("Savannah", "GA", 147_000, 404_000), M("Huntsville", "AL", 215_000, 500_000),
  M("Augusta", "GA", 202_000, 611_000), M("Asheville", "NC", 94_000, 470_000),
  M("Shreveport", "LA", 187_000, 393_000), M("Lafayette", "LA", 121_000, 478_000),
  M("Montgomery", "AL", 200_000, 386_000),
  // ── Northeast / Mid-Atlantic (M27 seed: Lancaster PA) ──
  M("Lancaster", "PA", 58_000, 552_000), M("Erie", "PA", 94_000, 270_000),
  M("Scranton", "PA", 76_000, 555_000), M("Manchester", "NH", 115_000, 422_000),
  M("Portland", "ME", 68_000, 550_000), M("Harrisburg", "PA", 50_000, 591_000),
  M("Trenton", "NJ", 90_000, 387_000), M("Reading", "PA", 95_000, 428_000),
];

// The policy ranges are "approximately" bounded (mandate 27), so classification applies a ±10% tolerance at
// the edges — e.g. Fort Wayne (~263k) still classifies as an in-policy secondary market, while a true primary
// (LA-scale) never does. The tolerance is intentional and documented, not a silent widening.
const TOL = 0.1;
/** Classify a market by size against the policy ranges (±10% edge tolerance for "approximately"). */
export function classifyMarketSize(cityPop: number, metroPop: number, cfg: MarketPolicyConfig = DEFAULT_MARKET_POLICY): MarketTierSize {
  if (cityPop <= 0) return "unknown";
  if (cityPop > cfg.cityPopMax * (1 + TOL) || metroPop > cfg.metroPopMax * (1 + TOL)) return "primary";
  if (cityPop < cfg.cityPopMin * (1 - TOL) && metroPop < cfg.metroPopMin * (1 - TOL)) return "micro";
  // In-range: metro toward the top → secondary; smaller → tertiary.
  return metroPop >= (cfg.metroPopMin + cfg.metroPopMax) / 2 ? "secondary" : "tertiary";
}

/** True when a city is an excluded primary metro (unless it's an explicitly-allowed independent suburb). */
export function isExcludedMajor(city: string, cfg: MarketPolicyConfig = DEFAULT_MARKET_POLICY): boolean {
  const c = (city ?? "").trim().toLowerCase();
  if (cfg.allowedIndependentSuburbs.map((s) => s.toLowerCase()).includes(c)) return false;
  return cfg.excludedMajorMarkets.map((s) => s.toLowerCase()).includes(c);
}

/** A market is IN-POLICY when it's not an excluded primary and its size falls in the target band. */
export function isInPolicy(m: TargetMarket, cfg: MarketPolicyConfig = DEFAULT_MARKET_POLICY): boolean {
  if (isExcludedMajor(m.city, cfg)) return false;
  const tier = classifyMarketSize(m.cityPop, m.metroPop, cfg);
  return tier === "secondary" || tier === "tertiary";
}

const marketKey = (t: { city: string; state: string }) => `${t.city.toLowerCase()}|${t.state.toUpperCase()}`;
export const cooldownKey = (city: string, state: string, category: string) => `${marketKey({ city, state })}|${category.toLowerCase().trim()}`;

export interface MarketSelection {
  market: TargetMarket;
  tier: MarketTierSize;
  reasons: string[]; // human-readable "why this market" (mandate 26 §4 / mandate 27 targeting explanation)
}

export interface SelectOpts {
  cursor: number;                 // advances across runs (e.g. lead count) so different markets surface
  count: number;                  // how many markets to return
  category?: string;              // when set, cooldown is checked per market/category pair
  recent?: Set<string>;           // cooldownKey()s recently searched (skip these)
  recentMarkets?: Set<string>;    // market keys recently searched (soft-skip in the diversity pass)
  cfg?: MarketPolicyConfig;
}

/**
 * Deterministically select in-policy target markets: rotate by cursor for diversity, skip cooled-down
 * market/category pairs and excluded primaries, and greedily maximize REGIONAL diversity up to `count`.
 * Returns each pick with the reasons it qualified so the operator can understand discovery behavior.
 */
export function selectTargetMarkets(opts: SelectOpts): MarketSelection[] {
  const cfg = opts.cfg ?? DEFAULT_MARKET_POLICY;
  const recent = opts.recent ?? new Set<string>();
  const eligible = TARGET_MARKETS.filter((m) => isInPolicy(m, cfg));
  if (!eligible.length || opts.count <= 0) return [];

  // Rotate the eligible list by cursor so runs don't always start at the same market.
  const start = ((opts.cursor % eligible.length) + eligible.length) % eligible.length;
  const rotated = [...eligible.slice(start), ...eligible.slice(0, start)];

  // First pass: one market per region (regional diversity), skipping cooled-down pairs. Second pass: fill.
  const chosen: MarketSelection[] = [];
  const usedRegions = new Set<USRegion>();
  const usedKeys = new Set<string>();
  const push = (m: TargetMarket) => {
    const tier = classifyMarketSize(m.cityPop, m.metroPop, cfg);
    chosen.push({
      market: m, tier,
      reasons: [
        `${m.city}, ${m.state} is a ${tier} market (city ~${m.cityPop.toLocaleString()}, metro ~${m.metroPop.toLocaleString()}; ${m.popSource}, ${m.popVintage}).`,
        `In the target band (city ${cfg.cityPopMin.toLocaleString()}–${cfg.cityPopMax.toLocaleString()}, metro ${cfg.metroPopMin.toLocaleString()}–${cfg.metroPopMax.toLocaleString()}).`,
        `Not an excluded primary metro; ${m.region} region (rotating for regional diversity).`,
      ],
    });
    usedRegions.add(m.region); usedKeys.add(marketKey(m));
  };
  const recentMarkets = opts.recentMarkets ?? new Set<string>();
  const cooled = (m: TargetMarket) => opts.category ? recent.has(cooldownKey(m.city, m.state, opts.category)) : false;
  const recentlyUsed = (m: TargetMarket) => recentMarkets.has(marketKey(m));

  // Pass 1: regional diversity + skip cooled pairs + soft-skip recently-searched markets.
  for (const m of rotated) {
    if (chosen.length >= opts.count) break;
    if (usedKeys.has(marketKey(m)) || cooled(m) || recentlyUsed(m) || usedRegions.has(m.region)) continue;
    push(m);
  }
  // Pass 2: relax the region constraint, still skip cooled pairs + recently-searched markets.
  for (const m of rotated) {
    if (chosen.length >= opts.count) break;
    if (usedKeys.has(marketKey(m)) || cooled(m) || recentlyUsed(m)) continue;
    push(m);
  }
  // Pass 3: last resort — fill remaining slots even from recently-searched markets (never below `count`).
  for (const m of rotated) {
    if (chosen.length >= opts.count) break;
    if (usedKeys.has(marketKey(m)) || cooled(m)) continue;
    push(m);
  }
  return chosen;
}

/**
 * The effective discovery territories: the operator's LOCAL coverage (filtered so excluded primaries drop out
 * beyond the small primaryMetroAllowance) PLUS a rotating, region-diverse slice of in-policy secondary/tertiary
 * markets. Replaces the old major-metro-heavy rotation. Deduped, US-only-by-construction.
 */
export function discoveryTerritories(input: {
  configured: Territory[];
  cursor: number;
  nationalSlice?: number;
  category?: string;
  recent?: Set<string>;
  recentMarkets?: Set<string>;
  cfg?: MarketPolicyConfig;
}): { territories: Territory[]; selections: MarketSelection[] } {
  const cfg = input.cfg ?? DEFAULT_MARKET_POLICY;
  // Local: keep configured markets, but drop excluded primaries beyond the allowance so we stop concentrating
  // on LA/etc. by default while still honoring a small independent-suburb allowance.
  let primaryBudget = cfg.primaryMetroAllowance;
  const local: Territory[] = [];
  for (const t of input.configured ?? []) {
    if (isExcludedMajor(t.city, cfg)) {
      if (primaryBudget > 0) { primaryBudget--; local.push({ city: t.city, state: t.state }); }
      continue;
    }
    local.push({ city: t.city, state: t.state });
  }
  const selections = selectTargetMarkets({ cursor: input.cursor, count: input.nationalSlice ?? 12, category: input.category, recent: input.recent, recentMarkets: input.recentMarkets, cfg });
  const seen = new Set<string>();
  const territories: Territory[] = [];
  for (const t of [...local, ...selections.map((s) => ({ city: s.market.city, state: s.market.state }))]) {
    const key = marketKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    territories.push(t);
  }
  return { territories, selections };
}
