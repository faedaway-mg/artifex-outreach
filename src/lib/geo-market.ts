// ─────────────────────────────────────────────────────────────────────────────
// Market receptivity — an EXPERIMENTAL stratification, not established fact.
//
// Hypothesis (from the founder's wholesale-real-estate experience, treated as testable, NOT
// truth): established businesses in less sales-saturated secondary/regional US markets may be
// more receptive to a value-first Business Technology Review than the same business in a
// heavily-vendored primary metro. So we classify a lead's market into primary / secondary /
// regional and give a SMALL, capped tie-breaker to established regional businesses — never enough
// to override fundamentals (quality/opportunity), and never for tiny businesses. Then we measure
// real outcomes per tier and let the data replace the assumption.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead } from "./types";

export type MarketTier = "primary" | "secondary" | "regional";

// High-saturation primary metros (heavy agency/vendor competition). Eligible, but not preferred.
const PRIMARY_CITIES = new Set([
  "los angeles", "santa monica", "beverly hills", "culver city", "west hollywood",
  "new york", "brooklyn", "manhattan", "san francisco", "san jose", "oakland", "palo alto",
  "miami", "miami beach", "seattle", "boston", "washington", "chicago",
]);
// Less-saturated regional markets to EMPHASIZE in the first receptivity test (Ohio-forward).
const REGIONAL_STATES = new Set(["OH", "IN", "KY", "TN", "MO", "KS", "WI", "MI", "IA", "NE", "OK", "AR", "MS", "AL", "SC", "NC", "WV", "ND", "SD"]);
// Mid-tier secondary markets (between).
const SECONDARY_STATES = new Set(["AZ", "NV", "CO", "TX", "GA", "FL", "PA", "MN", "OR", "UT", "NM", "VA", "MD", "CT", "WA", "MA", "IL", "NY", "CA"]);

/** Classify a business's market. Primary metros (by city) → primary; otherwise emphasized
 *  regional states → regional; known secondary states → secondary; anything else → secondary. */
export function marketTierOf(loc: Pick<Lead, "city" | "state">): MarketTier {
  const city = (loc.city ?? "").trim().toLowerCase();
  const st = (loc.state ?? "").trim().toUpperCase();
  if (PRIMARY_CITIES.has(city)) return "primary";
  if (REGIONAL_STATES.has(st)) return "regional";
  if (SECONDARY_STATES.has(st)) return "secondary";
  return "secondary";
}

// The "established regional SMB" sweet spot — enough public footprint that meaningful technology
// work makes sense. Tiny businesses get NO receptivity bonus (we don't chase small-town/small-biz).
const ESTABLISHED_REVIEWS = 50;
export function isEstablished(lead: Pick<Lead, "reviewCount" | "locationsCount">): boolean {
  return (lead.reviewCount ?? 0) >= ESTABLISHED_REVIEWS || (lead.locationsCount ?? 0) >= 2;
}

/** A SMALL capped scoring tie-breaker (max 4 of ~100) for the receptivity thesis: only an
 *  ESTABLISHED business in an emphasized REGIONAL market earns it, so fundamentals still decide and
 *  tiny businesses / primary + secondary metros get nothing. Enough to break a tie between
 *  comparable prospects, never enough to lift a weak one over a strong one. */
export function receptivityPoints(lead: Pick<Lead, "city" | "state" | "reviewCount" | "locationsCount">): number {
  return isEstablished(lead) && marketTierOf(lead) === "regional" ? 4 : 0;
}

// ── Experiment: compare outcomes by market tier (reuses existing lead location + send/reply/meeting data) ──
export interface TierOutcome { tier: MarketTier; businesses: number; emailed: number; replies: number; meetings: number }

/** Aggregate real outcomes per market tier so we can compare primary vs secondary vs regional
 *  (e.g. replies / meetings per 100 sends). Pure — no second analytics system. */
export function marketExperiment(input: {
  leads: Pick<Lead, "id" | "city" | "state">[];
  sentLeadIds: Set<string>;
  repliedLeadIds: Set<string>;
  metLeadIds: Set<string>;
}): Record<MarketTier, TierOutcome> {
  const out: Record<MarketTier, TierOutcome> = {
    primary: { tier: "primary", businesses: 0, emailed: 0, replies: 0, meetings: 0 },
    secondary: { tier: "secondary", businesses: 0, emailed: 0, replies: 0, meetings: 0 },
    regional: { tier: "regional", businesses: 0, emailed: 0, replies: 0, meetings: 0 },
  };
  for (const l of input.leads) {
    const r = out[marketTierOf(l)];
    r.businesses += 1;
    if (input.sentLeadIds.has(l.id)) r.emailed += 1;
    if (input.repliedLeadIds.has(l.id)) r.replies += 1;
    if (input.metLeadIds.has(l.id)) r.meetings += 1;
  }
  return out;
}
