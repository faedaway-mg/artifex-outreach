// ─────────────────────────────────────────────────────────────────────────────
// Geographic pools — widen the prospect universe from "near Jordan" to the whole US,
// WITHOUT widening cost. Discovery cost is bounded by the number of CATEGORY searches
// (each category is assigned ONE territory by rotation), so adding metros does not add
// Places calls — it only diversifies WHICH market each bounded search hits. Rotation
// across runs means we never search every metro every tick.
//
// Physical proximity is no longer a prospect criterion; qualification/opportunity decide
// what advances. Geography is only a discovery/diversification dimension. US-ONLY.
// ─────────────────────────────────────────────────────────────────────────────
import type { Territory } from "./types";

export type GeoPool = "SoCal" | "California" | "West/Southwest" | "Texas/Central" | "Midwest/East/South";

export interface PoolMarket extends Territory { pool: GeoPool }

// Candidate markets, NOT quotas. Strong local coverage (SoCal) is preserved; the rest add
// national breadth. Every entry is a US market (US-only scope for this phase).
export const POOLS: Record<GeoPool, PoolMarket[]> = {
  SoCal: [
    { city: "Los Angeles", state: "CA", pool: "SoCal" }, { city: "Santa Monica", state: "CA", pool: "SoCal" },
    { city: "Beverly Hills", state: "CA", pool: "SoCal" }, { city: "Pasadena", state: "CA", pool: "SoCal" },
    { city: "Burbank", state: "CA", pool: "SoCal" }, { city: "Glendale", state: "CA", pool: "SoCal" },
    { city: "Long Beach", state: "CA", pool: "SoCal" }, { city: "Irvine", state: "CA", pool: "SoCal" },
  ],
  California: [
    { city: "San Diego", state: "CA", pool: "California" }, { city: "San Francisco", state: "CA", pool: "California" },
    { city: "San Jose", state: "CA", pool: "California" }, { city: "Oakland", state: "CA", pool: "California" },
    { city: "Sacramento", state: "CA", pool: "California" },
  ],
  "West/Southwest": [
    { city: "Phoenix", state: "AZ", pool: "West/Southwest" }, { city: "Scottsdale", state: "AZ", pool: "West/Southwest" },
    { city: "Las Vegas", state: "NV", pool: "West/Southwest" }, { city: "Denver", state: "CO", pool: "West/Southwest" },
    { city: "Seattle", state: "WA", pool: "West/Southwest" }, { city: "Portland", state: "OR", pool: "West/Southwest" },
  ],
  "Texas/Central": [
    { city: "Dallas", state: "TX", pool: "Texas/Central" }, { city: "Fort Worth", state: "TX", pool: "Texas/Central" },
    { city: "Austin", state: "TX", pool: "Texas/Central" }, { city: "Houston", state: "TX", pool: "Texas/Central" },
    { city: "San Antonio", state: "TX", pool: "Texas/Central" },
  ],
  "Midwest/East/South": [
    { city: "Chicago", state: "IL", pool: "Midwest/East/South" }, { city: "Atlanta", state: "GA", pool: "Midwest/East/South" },
    { city: "Miami", state: "FL", pool: "Midwest/East/South" }, { city: "New York", state: "NY", pool: "Midwest/East/South" },
    { city: "Nashville", state: "TN", pool: "Midwest/East/South" }, { city: "Charlotte", state: "NC", pool: "Midwest/East/South" },
  ],
};

// Valid US state codes — the US-only guard (no international markets ever enter discovery).
export const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
]);

export function isUsMarket(t: { state: string }): boolean {
  return US_STATES.has((t.state ?? "").trim().toUpperCase());
}

// Non-local pools interleaved region-by-region so a short rotating slice is regionally diverse
// (a CA metro, then a West one, then Texas, then East, then back) rather than five Texas metros.
const NON_LOCAL_ORDER: GeoPool[] = ["California", "West/Southwest", "Texas/Central", "Midwest/East/South"];
export const NATIONAL_METROS: PoolMarket[] = (() => {
  const lists = NON_LOCAL_ORDER.map((p) => POOLS[p]);
  const out: PoolMarket[] = [];
  const max = Math.max(...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return out;
})();

/** A bounded, rotating, region-diverse slice of national markets. `cursor` advances across runs
 *  (e.g. lead count) so different metros appear each cycle — never every metro every tick. */
export function rotateNationalTerritories(cursor: number, count: number): Territory[] {
  if (count <= 0 || NATIONAL_METROS.length === 0) return [];
  const start = ((cursor % NATIONAL_METROS.length) + NATIONAL_METROS.length) % NATIONAL_METROS.length;
  const out: Territory[] = [];
  for (let i = 0; i < Math.min(count, NATIONAL_METROS.length); i++) {
    const m = NATIONAL_METROS[(start + i) % NATIONAL_METROS.length];
    out.push({ city: m.city, state: m.state });
  }
  return out;
}

/**
 * The effective territories for a discovery run: the operator's local coverage PLUS a rotating,
 * region-diverse slice of national markets — deduped, US-only. Widens the search universe while
 * cost stays bounded by the category-search budget (territories only cycle across those searches).
 */
export function effectiveTerritories(configured: Territory[], cursor: number, nationalSlice = 12): Territory[] {
  const local = (configured.length ? configured : POOLS.SoCal.map((m) => ({ city: m.city, state: m.state }))).filter(isUsMarket);
  const national = rotateNationalTerritories(cursor, nationalSlice).filter(isUsMarket);
  const seen = new Set<string>();
  const out: Territory[] = [];
  for (const t of [...local, ...national]) {
    const key = `${t.city.toLowerCase()}|${t.state.toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}
