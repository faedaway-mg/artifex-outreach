// ─────────────────────────────────────────────────────────────────────────────
// PRICING VERSIONS — infrastructure so approved future price tests are clean,
// versioned, auditable, and measurable. $250/$495/$995 are STARTING prices, not
// sacred. But: no experiment runs automatically in this mandate, and the LLM can
// NEVER vary a price. A historical purchase keeps the exact version it was sold at.
// ─────────────────────────────────────────────────────────────────────────────
import type { PricingBand } from "./types";
import { TIERS } from "./pricing";

export interface PriceVersion {
  id: string;
  band: PricingBand;
  priceCents: number;
  active: boolean;
  createdAt: string;
}

// Retired price versions preserved for historical correctness — a purchase made at
// $250 stays approved even though the active ENTRY price is now $249. Never active,
// never assigned to new offers; kept so re-validating a historical offer succeeds.
export const RETIRED_PRICE_VERSIONS: Array<Omit<PriceVersion, "createdAt">> = [
  { id: "pv-entry-legacy-250", band: "ENTRY", priceCents: 25000, active: false },
];

/** The approved price versions — active anchors + retired historical prices. */
export function baselinePriceVersions(createdAt: string): PriceVersion[] {
  const active: PriceVersion[] = TIERS.map((t) => ({ id: `pv-${t.band.toLowerCase()}-baseline`, band: t.band, priceCents: t.priceCents, active: true, createdAt }));
  const retired: PriceVersion[] = RETIRED_PRICE_VERSIONS.map((v) => ({ ...v, createdAt }));
  return [...active, ...retired];
}

/** The active price version for a band. Defaults to the baseline (no experiment). */
export function activePriceVersion(versions: PriceVersion[], band: PricingBand): PriceVersion | null {
  const forBand = versions.filter((v) => v.band === band && v.active);
  return forBand[0] ?? null;
}

/**
 * Deterministically assign a price version to an offer (stable per offerId). With
 * only the baseline active this always returns the baseline — experiments are opt
 * in and explicitly configured, never automatic, never LLM-driven.
 */
export function assignPriceVersion(offerId: string, band: PricingBand, versions: PriceVersion[]): PriceVersion | null {
  const active = versions.filter((v) => v.band === band && v.active);
  if (active.length <= 1) return active[0] ?? null;
  // Stable bucketing by a simple hash of the offerId — deterministic, auditable.
  let h = 0;
  for (const ch of offerId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return active[h % active.length];
}

/** A price is valid only if it matches an approved version for its band. */
export function isApprovedPrice(band: PricingBand, priceCents: number, versions: PriceVersion[]): boolean {
  return versions.some((v) => v.band === band && v.priceCents === priceCents);
}
