// ─────────────────────────────────────────────────────────────────────────────
// The Artifex Quick Review — the one-page, business-specific artifact attached to
// every first-touch email. Its content is DETERMINISTIC: derived only from the stored
// lead + the stored Business Intelligence profile (no AI/research at send time), so what
// the operator previews is exactly what the recipient receives (WYSIWYS extends to the PDF).
//
// The business logo is resolved once via the (reused) AshMap logo-extraction algorithm and
// CACHED on the BI profile jsonb (no migration), so renders are fast, offline, and stable —
// and only a confidence-gated, validated raster logo is used. A wrong logo is worse than none.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead } from "../types";
import type { BusinessProfile } from "../business-intelligence/types";
import { deslug } from "../utils";
import { discoverLogoCandidates, type LogoSourceType } from "../brand/logo-extractor";
import { getBusinessIntelligence, upsertBusinessIntelligence } from "../repo";

export interface ResolvedBrand {
  logoUrl: string;
  sourceType: LogoSourceType;
  confidence: number;
}

export interface QuickReview {
  businessName: string;
  industryLabel: string;
  location: string;
  website: string | null;
  brand: ResolvedBrand | null;
  /** "What stood out" — real observations, strongest first (1–3). */
  observations: string[];
  /** "Why it matters" — the consequence for the business. */
  whyItMatters: string;
  /** "What we'd prioritize" — grounded impact rationales (1–3). */
  recommendations: string[];
  /** False when there is no credible observation — the review is not send-ready. */
  ready: boolean;
}

const MIN_LOGO_CONFIDENCE = 0.75;

/** Build the deterministic Quick Review from stored lead + BI. `brand` is the already-resolved
 *  (cached) logo, or null. Never invents findings — an empty BI yields ready=false. */
export function buildQuickReview(lead: Lead, profile: BusinessProfile | null, brand: ResolvedBrand | null): QuickReview {
  const opps = profile?.opportunities ?? [];
  const top = opps.slice(0, 3);
  const observations = top.map((o) => o.observation).filter(Boolean);
  const whyItMatters = top[0]?.whyItMatters || profile?.executiveSummary || "";
  const recommendations = top.map((o) => o.estimatedImpact?.rationale).filter(Boolean) as string[];
  return {
    businessName: lead.businessName,
    industryLabel: deslug(lead.industry) || "",
    location: [lead.city, lead.state].filter(Boolean).join(", "),
    website: lead.website ? lead.website.replace(/^https?:\/\//, "").replace(/\/$/, "") : null,
    brand,
    observations,
    whyItMatters,
    recommendations,
    ready: observations.length > 0,
  };
}

/** Professional attachment filename: "Villa Brasil Motel — Artifex Quick Review.pdf".
 *  No IDs; unsafe filesystem characters stripped. */
export function quickReviewFilename(businessName: string): string {
  const safe = (businessName || "Business").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s{2,}/g, " ").trim();
  return `${safe} — Artifex Quick Review.pdf`;
}

/**
 * Resolve (and cache on the BI profile) the business's logo. Returns the cached value if
 * already resolved (including a cached null), otherwise fetches candidates, picks the best
 * VALIDATED RASTER logo at/above the confidence gate, caches it, and returns it. Never throws.
 */
export async function resolveLeadBrand(lead: Pick<Lead, "id" | "website">): Promise<ResolvedBrand | null> {
  const bi = await getBusinessIntelligence(lead.id);
  const wrapper = bi?.profile; // StoredBI.profile is the BusinessIntelligence wrapper…
  const bp = wrapper?.businessProfile as (BusinessProfile & { resolvedBrand?: ResolvedBrand | null }) | undefined; // …which holds the BusinessProfile.
  if (!wrapper || !bp) return null;
  if (bp.resolvedBrand !== undefined) return bp.resolvedBrand ?? null; // cached (may be null)

  const resolved = lead.website ? await pickValidatedLogo(lead.website) : null;
  try {
    await upsertBusinessIntelligence({
      leadId: lead.id,
      profile: { ...wrapper, businessProfile: { ...bp, resolvedBrand: resolved } },
      enrichmentDelta: bi?.enrichmentDelta ?? null,
      generatedAt: bi?.generatedAt ?? null,
    });
  } catch {
    /* caching is best-effort — still return what we resolved */
  }
  return resolved;
}

/** Read the cached resolved brand WITHOUT resolving (pure read for deterministic renders). */
export function cachedBrand(profile: BusinessProfile | null): ResolvedBrand | null {
  return (((profile as (BusinessProfile & { resolvedBrand?: ResolvedBrand | null }) | null)?.resolvedBrand) ?? null) as ResolvedBrand | null;
}

// Pick the best candidate that is (a) above the confidence gate, (b) not an SVG (react-pdf
// embeds raster reliably), and (c) actually fetches as an image. Confirming the asset here
// keeps PDF rendering robust — we never point the renderer at a URL we couldn't load.
async function pickValidatedLogo(website: string): Promise<ResolvedBrand | null> {
  const candidates = (await discoverLogoCandidates(website))
    .filter((c) => c.confidence >= MIN_LOGO_CONFIDENCE && c.sourceType !== "favicon-svg" && !/\.svg(\?|$)/i.test(c.url));
  for (const c of candidates) {
    if (await isFetchableImage(c.url)) return { logoUrl: c.url, sourceType: c.sourceType, confidence: c.confidence };
  }
  return null;
}

async function isFetchableImage(url: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) return false;
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    return ct.startsWith("image/") && !ct.includes("svg");
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
