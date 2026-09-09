// ─────────────────────────────────────────────────────────────────────────────
// COMMERCIAL FIT — "does a $249–$995 repair make commercial sense for THIS
// business?", NOT "can we guess their bank balance?". We cannot know a private
// company's finances and never fabricate an affordability/revenue claim. Instead we
// score OBSERVABLE business-fit proxies (active site, commercial intent, review
// footprint, multiple locations/services, established domain, whether the defect
// blocks a commercially meaningful action, price proportionality, Artifex margin,
// SKU support). Every point is backed by an actual signal; unknown signals score 0.
// ─────────────────────────────────────────────────────────────────────────────

export interface CommercialFitSignals {
  /** The site is live and operating (not parked / down). */
  hasActiveWebsite?: boolean;
  /** A commercial action exists: booking, consultation, e-commerce, quote/lead-gen. */
  hasCommercialIntent?: boolean;
  reviewCount?: number | null;
  locationsCount?: number | null;
  /** The business advertises multiple distinct services. */
  multipleServices?: boolean;
  /** Established business domain (not a brand-new / free subdomain). */
  establishedDomain?: boolean;
  /** The observed defect blocks a commercially meaningful action (e.g. broken booking CTA). */
  defectAffectsCommercialAction?: boolean;
  /** The repair price (server-owned) — used only to check proportionality, never affordability. */
  priceCents?: number | null;
  /** Artifex effective margin per hour — high implementation margin is a fit signal for us. */
  effectiveHourlyCents?: number | null;
  /** A strongly-supported SKU/platform match exists. */
  strongSkuSupport?: boolean;
}

export interface CommercialFitContribution {
  key: string;
  points: number;
  note: string;
}

export interface CommercialFit {
  score: number; // 0..100
  band: "STRONG" | "MODERATE" | "WEAK";
  contributions: CommercialFitContribution[];
  reasons: string[];
  /** Does a productized $249–$995 repair make commercial sense here? */
  makesCommercialSense: boolean;
}

const MAX = {
  activeWebsite: 15,
  commercialIntent: 20,
  reviewFootprint: 15,
  multiplePresence: 10,
  establishedDomain: 10,
  defectCommercial: 15,
  priceProportionate: 5,
  strongMargin: 5,
  skuSupport: 5,
} as const; // sums to 100

/**
 * Score commercial fit from observable proxies. Deterministic and pure. Undefined
 * signals contribute nothing — we never award points for data we don't have, and we
 * never translate any of this into a claim about the customer's revenue or ability
 * to pay.
 */
export function assessCommercialFit(sig: CommercialFitSignals): CommercialFit {
  const c: CommercialFitContribution[] = [];

  if (sig.hasActiveWebsite) c.push({ key: "activeWebsite", points: MAX.activeWebsite, note: "active operating website" });
  if (sig.hasCommercialIntent) c.push({ key: "commercialIntent", points: MAX.commercialIntent, note: "site drives a commercial action (booking / lead-gen / e-commerce)" });

  const reviews = sig.reviewCount ?? 0;
  const reviewPts = reviews >= 50 ? MAX.reviewFootprint : reviews >= 20 ? 10 : reviews >= 5 ? 5 : 0;
  if (reviewPts > 0) c.push({ key: "reviewFootprint", points: reviewPts, note: `${reviews} reviews — active customer footprint` });

  if ((sig.locationsCount ?? 0) >= 2 || sig.multipleServices) c.push({ key: "multiplePresence", points: MAX.multiplePresence, note: (sig.locationsCount ?? 0) >= 2 ? `${sig.locationsCount} locations` : "multiple advertised services" });
  if (sig.establishedDomain) c.push({ key: "establishedDomain", points: MAX.establishedDomain, note: "established business domain" });
  if (sig.defectAffectsCommercialAction) c.push({ key: "defectCommercial", points: MAX.defectCommercial, note: "the defect blocks a commercially meaningful action" });

  const price = sig.priceCents ?? 0;
  if (price >= 24900 && price <= 99500) c.push({ key: "priceProportionate", points: MAX.priceProportionate, note: "repair price sits in the productized $249–$995 band" });
  if ((sig.effectiveHourlyCents ?? 0) >= 15000) c.push({ key: "strongMargin", points: MAX.strongMargin, note: "high implementation margin for Artifex" });
  if (sig.strongSkuSupport) c.push({ key: "skuSupport", points: MAX.skuSupport, note: "strongly-supported SKU/platform match" });

  const score = Math.min(100, c.reduce((s, x) => s + x.points, 0));
  const band = score >= 65 ? "STRONG" : score >= 40 ? "MODERATE" : "WEAK";
  const reasons = c.map((x) => x.note);
  if (c.length === 0) reasons.push("no observable commercial-fit signals");

  return { score, band, contributions: c, reasons, makesCommercialSense: score >= 40 };
}
