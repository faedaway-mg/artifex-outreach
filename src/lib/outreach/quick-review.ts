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
import { selectReviewFindings, reviewStatus, startHere, displayUrl, type ReviewFinding, type ReviewStatus } from "./review-evidence";

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
  /** Evidence-backed findings (0–3), strongest first. THE canonical content of the review. */
  findings: ReviewFinding[];
  /** The single recommended starting point — demonstrates prioritization. Null when no findings. */
  start: { label: string; why: string } | null;
  /** Sendability: SENDABLE (≥2 strong) · NEEDS_REVIEW (1) · INSUFFICIENT_EVIDENCE (0). */
  status: ReviewStatus;
  /** Back-compat views derived from findings (older consumers/tests). */
  observations: string[];
  whyItMatters: string;
  recommendations: string[];
  /** False only when there is NO evidence-backed finding — a speculative-only BI can never attach. */
  ready: boolean;
}

const MIN_LOGO_CONFIDENCE = 0.75;

/**
 * Build the deterministic Quick Review from stored lead + BI. Evidence-first: only findings we can
 * point to public evidence for survive (see review-evidence.ts); speculative/inferred/internal
 * claims are dropped. A speculative-only profile yields status=INSUFFICIENT_EVIDENCE and ready=false
 * — it can never silently become a sendable attachment.
 */
export function buildQuickReview(lead: Lead, profile: BusinessProfile | null, brand: ResolvedBrand | null): QuickReview {
  const findings = selectReviewFindings(profile?.opportunities ?? [], 3);
  const status = reviewStatus(findings);
  return {
    businessName: lead.businessName,
    industryLabel: deslug(lead.industry) || "",
    location: [lead.city, lead.state].filter(Boolean).join(", "),
    website: displayUrl(lead.website),
    brand,
    findings,
    start: startHere(findings),
    status,
    observations: findings.map((f) => f.observation),
    whyItMatters: findings[0]?.whyItMatters || profile?.executiveSummary || "",
    recommendations: findings.map((f) => f.whatWedDo).filter(Boolean),
    ready: status !== "INSUFFICIENT_EVIDENCE",
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
