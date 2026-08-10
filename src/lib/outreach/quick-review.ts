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

const MAX_LOGO_BYTES = 1_500_000; // cap what we inline into the BI jsonb / the PDF

// Pick the best candidate above the confidence gate and DOWNLOAD it into a data URI, so the
// PDF never depends on a remote fetch at render time (no single point of failure, deterministic,
// fast). Only PNG/JPEG are embedded — the formats @react-pdf reliably decodes. Anything else,
// or any fetch failure, is skipped → the review falls back to a business-name treatment. A
// remote logo can therefore never blank or slow the document.
async function pickValidatedLogo(website: string): Promise<ResolvedBrand | null> {
  const candidates = (await discoverLogoCandidates(website))
    .filter((c) => c.confidence >= MIN_LOGO_CONFIDENCE && c.sourceType !== "favicon-svg" && !/\.svg(\?|$)/i.test(c.url));
  for (const c of candidates) {
    const dataUri = await fetchImageAsDataUri(c.url);
    if (dataUri) return { logoUrl: dataUri, sourceType: c.sourceType, confidence: c.confidence };
  }
  return null;
}

async function fetchImageAsDataUri(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") ?? "").toLowerCase().split(";")[0].trim();
    const mime = ct === "image/png" ? "image/png" : ct === "image/jpeg" || ct === "image/jpg" ? "image/jpeg" : null;
    if (!mime) return null; // only formats react-pdf reliably embeds
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_LOGO_BYTES) return null;
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
