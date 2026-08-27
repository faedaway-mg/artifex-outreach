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
import { selectReviewFindings, reviewStatus, startHere, displayUrl, isAttachable, validateReviewEditorial, type ReviewFinding, type ReviewStatus, type StartingPoint } from "./review-evidence";
import { presentFindings, openingHook, type FindingPresentation } from "./review-hooks";
import { checkReview, editorialBlocks } from "./editorial-quality";

// Friendly, client-facing category labels. The raw `industry` slug (e.g. "dentist") is an internal
// key, not how a business is addressed. A short map keeps the review professional; anything unmapped
// falls back to the de-slugged label. Extend as new verticals appear.
const FRIENDLY_CATEGORY: Array<[RegExp, string]> = [
  [/dent(ist|al)/i, "Dental practice"],
  [/orthodont/i, "Orthodontic practice"],
  [/(attorney|lawyer|\blaw\b|legal|solicitor)/i, "Law firm"],
  [/(plumb|hvac)/i, "Home services company"],
  [/roof/i, "Roofing company"],
  [/electric/i, "Electrical company"],
  [/(gym|fitness|pilates|yoga|crossfit)/i, "Fitness studio"],
  [/(salon|barber|spa|beauty)/i, "Salon & spa"],
  [/restaurant|cafe|coffee|bakery|eatery/i, "Restaurant"],
  [/(chiro|physical therapy|physio)/i, "Chiropractic clinic"],
  [/(realtor|real estate|realty)/i, "Real estate practice"],
  [/(account|cpa|bookkeep)/i, "Accounting firm"],
  [/(auto|mechanic|body shop)/i, "Auto services shop"],
  [/(vet|veterinar)/i, "Veterinary practice"],
];
export function friendlyCategory(industry: string | null | undefined): string {
  const raw = deslug(industry ?? "") || "";
  for (const [re, label] of FRIENDLY_CATEGORY) if (re.test(industry ?? "") || re.test(raw)) return label;
  return raw;
}

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
  /** Per-finding presentation (text + visual hook), same order/length as findings. Evidence-derived. */
  presentations: FindingPresentation[];
  /** The primary opening curiosity hook (strongest finding's hook — not mechanically Finding 01). */
  openingHook: string | null;
  /** The single recommended starting point — demonstrates prioritization. Null when no findings.
   *  Its label, intervention, and rationale all derive from one source finding (internally coherent). */
  start: StartingPoint | null;
  /** Sendability: SENDABLE (≥2 strong) · NEEDS_REVIEW (1) · INSUFFICIENT_EVIDENCE (0). */
  status: ReviewStatus;
  /** Back-compat views derived from findings (older consumers/tests). */
  observations: string[];
  whyItMatters: string;
  recommendations: string[];
  /** ATTACHABLE gate. True only when the review may actually be attached/sent: SENDABLE always, or
   *  NEEDS_REVIEW ONLY after an explicit operator approval (opts.approved). INSUFFICIENT never. */
  ready: boolean;
}

/** Options that affect the real attachment gate. `approved` reflects an explicit, auditable operator
 *  approval of a NEEDS_REVIEW review; `observedAt` stamps evidence provenance (BI generatedAt). */
export interface BuildReviewOptions { approved?: boolean; observedAt?: string | null }

const MIN_LOGO_CONFIDENCE = 0.75;

/**
 * Build the deterministic Quick Review from stored lead + BI. Evidence-first: only findings we can
 * point to public evidence for survive (see review-evidence.ts); speculative/inferred/internal
 * claims are dropped. A speculative-only profile yields status=INSUFFICIENT_EVIDENCE and ready=false.
 * NEEDS_REVIEW (one finding) is NOT ready unless the operator has explicitly approved it — it can
 * never silently attach. Exact provenance (basis + source URL) survives into each finding.
 */
export function buildQuickReview(lead: Lead, profile: BusinessProfile | null, brand: ResolvedBrand | null, opts: BuildReviewOptions = {}): QuickReview {
  const findings = selectReviewFindings(profile?.opportunities ?? [], 3, { website: lead.website, observedAt: opts.observedAt ?? null });
  const status = reviewStatus(findings);
  const start = startHere(findings);
  const presentations = presentFindings(findings);
  const opening = openingHook(findings);
  const industryLabel = friendlyCategory(lead.industry);
  // Editorial fail-safe: a structurally-malformed artifact (duplicate titles, an impact statement
  // where an action belongs, an incoherent starting point) must never silently attach. This does not
  // loosen M2 sendability — it can only WITHHOLD attachment; the status itself is unchanged.
  const structuralOk = validateReviewEditorial(findings, start).length === 0;
  // Editorial-REDUNDANCY gate (Phase 4): avoidable duplication across customer-facing surfaces
  // (a hook copying a finding, a recommendation restating a finding) WITHHOLDS attachment. "Delivery
  // ready" must mean editorially ready, not merely rendered. Shared metrics/names never false-block.
  const editorialClean = editorialBlocks(checkReview({
    businessName: lead.businessName, website: lead.website, industryLabel,
    openingHook: opening, findings, presentations, start,
  })).length === 0;
  return {
    businessName: lead.businessName,
    industryLabel,
    location: [lead.city, lead.state].filter(Boolean).join(", "),
    website: displayUrl(lead.website),
    brand,
    findings,
    presentations,
    openingHook: opening,
    start,
    status,
    observations: findings.map((f) => f.observation),
    whyItMatters: findings[0]?.whyItMatters || profile?.executiveSummary || "",
    recommendations: findings.map((f) => f.whatWedDo).filter(Boolean),
    ready: isAttachable(status, opts.approved ?? false) && structuralOk && editorialClean,
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
