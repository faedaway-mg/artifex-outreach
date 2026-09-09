// ─────────────────────────────────────────────────────────────────────────────
// COMPETITIVE / SERVICE OVERLAP — don't do to others what we don't want done to us.
// Artifex was cold-pitched web/software work by a dev vendor; Acquisition OS must
// not cold-pitch a basic website repair to a business that itself sells that exact
// category (web dev / software / digital / CRO / IT / design studio).
//
// Guard against false positives: a single generic keyword ("design", "software")
// is NOT overlap. We require a concrete COMPOUND phrase ("web development", "digital
// agency") for a STRONG (disqualifying) verdict, or TWO independent generic terms
// for a POSSIBLE (penalize + review) verdict. Everything is evidence-based text.
// ─────────────────────────────────────────────────────────────────────────────

export type OverlapVerdict = "NONE" | "POSSIBLE" | "STRONG";

export interface OverlapSignals {
  industry?: string | null;
  category?: string | null;
  categoryGroup?: string | null;
  description?: string | null;
  services?: string[] | null;
  tags?: string[] | null;
}

export interface CompetitiveOverlap {
  verdict: OverlapVerdict;
  matched: string[];
  /** STRONG overlap disqualifies a basic Quick-Fix cold pitch (absent a concrete exception). */
  disqualifies: boolean;
  reason: string;
}

// Concrete compound phrases that, on their own, mean the business sells our category.
const STRONG_PHRASES = [
  "web design", "web designer", "web development", "web developer", "website design",
  "software development", "software company", "software consultanc", "software engineering",
  "digital agency", "digital marketing agency", "marketing agency", "creative agency",
  "advertising agency", "seo agency", "seo services", "conversion rate optimiz", "cro agency",
  "it services", "managed it", "it consult", "managed service provider", "app development",
  "mobile app develop", "design studio", "dev studio", "development studio", "ux/ui",
  "ui/ux", "wordpress developer", "shopify developer", "web agency", "webflow developer",
  "growth agency", "branding agency", "graphic design studio",
];

// Generic single terms — weak alone; two independent ones raise a POSSIBLE flag.
const GENERIC_TERMS = [
  "software", "web design", "website", "developer", "development", "digital", "agency",
  "marketing", "seo", "it support", "consulting", "design", "branding", "technology",
];

function normalize(sig: OverlapSignals): string {
  return [sig.industry, sig.category, sig.categoryGroup, sig.description, ...(sig.services ?? []), ...(sig.tags ?? [])]
    .filter(Boolean).join(" · ").toLowerCase();
}

/**
 * Detect whether a business substantially sells the category we'd be pitching.
 * Pure + deterministic. STRONG (a compound phrase) disqualifies; POSSIBLE (≥2 generic
 * terms) flags for review; a lone generic keyword never triggers overlap.
 */
export function assessCompetitiveOverlap(sig: OverlapSignals): CompetitiveOverlap {
  const text = normalize(sig);
  if (!text.trim()) return { verdict: "NONE", matched: [], disqualifies: false, reason: "no business-category text to evaluate" };

  const strong = STRONG_PHRASES.filter((p) => text.includes(p));
  if (strong.length >= 1) {
    return { verdict: "STRONG", matched: dedupe(strong), disqualifies: true, reason: `business sells our category (${dedupe(strong).slice(0, 3).join(", ")}) — do not cold-pitch a basic repair` };
  }

  const generic = dedupe(GENERIC_TERMS.filter((t) => new RegExp(`(^|[^a-z])${escapeRe(t)}([^a-z]|$)`).test(text)));
  if (generic.length >= 2) {
    return { verdict: "POSSIBLE", matched: generic, disqualifies: false, reason: `multiple service-category signals (${generic.slice(0, 3).join(", ")}) — review before pitching` };
  }

  return { verdict: "NONE", matched: generic, disqualifies: false, reason: "no substantial service overlap detected" };
}

function dedupe(a: string[]): string[] { return [...new Set(a)]; }
function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
