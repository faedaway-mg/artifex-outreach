// ─────────────────────────────────────────────────────────────────────────────
// Evidence-first Quick Review selection.
//
// Governing principle: if Artifex cannot point to the EXACT public evidence supporting a finding,
// the finding does not belong in the Quick Review. We never imply knowledge of internal operations
// we do not possess. So a finding is only sendable when it is:
//   • directly OBSERVED in public data, or REPORTED by third parties (reviews) — not inferred;
//   • backed by non-empty provenance (basis);
//   • about something PUBLICLY OBSERVABLE (not internal reporting/ops/analytics we can't see);
//   • written concretely — no hedging/inference language ("may", "look developing", "little sign").
//
// From the BI opportunity pool we grade candidates, drop the speculative ones, rank the survivors,
// and keep the best 2–3 (fewer when the evidence is thin). A weak review is NOT silently sendable.
// ─────────────────────────────────────────────────────────────────────────────
import type { ModernizationOpportunity, OpportunityCategory } from "../business-intelligence/types";
import type { ConfidenceLabel } from "../business-intelligence/confidence";

// Only directly-seen or third-party-reported evidence grounds a client-facing claim.
const STRONG_EVIDENCE = new Set<ConfidenceLabel>(["Observed", "Reported"]);

// Categories that describe INTERNAL state we cannot observe from public information. A public
// website cannot reveal internal reporting, dashboards, or cross-location workflow — so findings in
// these categories are inference, and inference does not go in front of a prospect as fact.
const NON_OBSERVABLE_CATEGORIES = new Set<OpportunityCategory>(["Operations", "Internal Workflow", "Reporting", "Analytics"]);

// Hedging / internal-inference language — the tells of a generic, unsupported claim.
const SPECULATIVE_RX = /\b(may|might|could|probably|likely|perhaps|possibly|seems?|appears?|look(?:s|ing)?\s+(?:developing|thin|limited|basic)|little sign|from the outside|behind the scenes|we (?:think|suspect|believe)|internal|back[\s-]?office|manual(?:ly)?|repetitive)\b/i;

/** Normalize a URL for CLIENT-FACING display: no protocol, no tracking/query, no trailing slash.
 *  The original stays intact upstream; this is only what the prospect sees on the PDF. */
export function displayUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let u = url.trim();
  try {
    const parsed = new URL(u.startsWith("http") ? u : `https://${u}`);
    u = parsed.host + (parsed.pathname === "/" ? "" : parsed.pathname); // drop protocol, query, hash, utm
  } catch {
    u = u.replace(/^https?:\/\//i, "").replace(/[?#].*$/, "");
  }
  return u.replace(/\/$/, "") || null;
}

export type ReviewStatus = "SENDABLE" | "NEEDS_REVIEW" | "INSUFFICIENT_EVIDENCE";

export type EvidenceSourceType = "website" | "google-business" | "reviews" | "listing" | "search" | "other";

/**
 * Exact provenance for a finding. Two layers: INTERNAL (basis + sourceUrl, kept for audit/debug,
 * never collapsed to a mere tag) and CLIENT-FACING (displayLabel, clean + normalized). The system
 * can always answer "where exactly did this come from?" from basis + sourceUrl.
 */
export interface FindingEvidence {
  confidence: ConfidenceLabel;
  sourceType: EvidenceSourceType;
  /** The exact underlying public source (with original path/query) — INTERNAL, never shown raw. */
  sourceUrl: string | null;
  /** Clean, human-readable source for the PDF, e.g. "urbanamericana.com · Collections". */
  displayLabel: string;
  /** The exact provenance strings the claim was formed from — INTERNAL, retained in full. */
  basis: string[];
  /** When the evidence was observed (BI generatedAt), if the architecture supplies it. */
  observedAt: string | null;
  /** A reference to a captured screenshot for this finding, when one exists (else null). */
  screenshotRef: string | null;
}

export interface ReviewFinding {
  category: OpportunityCategory;
  /** A specific, factual finding title (evidence-driven, not consulting fluff). */
  title: string;
  /** What we actually found — the concrete observation. */
  observation: string;
  /** Exact + client-facing provenance behind the finding. */
  evidence: FindingEvidence;
  /** Why it matters commercially — 1–2 sentences. */
  whyItMatters: string;
  /** The concrete Artifex intervention. */
  whatWedDo: string;
  /** Internal rank score (higher = stronger/more valuable). Not shown. */
  score: number;
}

/** The real attachment gate. A NEEDS_REVIEW review can be attached ONLY after an explicit operator
 *  approval; INSUFFICIENT_EVIDENCE can never be attached and cannot be waved through. Pure. */
export function isAttachable(status: ReviewStatus, approved: boolean): boolean {
  if (status === "SENDABLE") return true;
  if (status === "NEEDS_REVIEW") return approved === true;
  return false;
}

const CONF_WEIGHT: Record<ConfidenceLabel, number> = { Observed: 1, Reported: 0.75, Likely: 0.5, Inferred: 0.3, Unknown: 0.1 };
const IMPACT_WEIGHT: Record<string, number> = { Foundational: 1, High: 0.9, Moderate: 0.6, Incremental: 0.4 };

// A short, specific title per category — the "Finding NN" headline. Falls back to the observation.
const TITLE: Partial<Record<OpportunityCategory, string>> = {
  "Customer Acquisition": "Own more of what customers and search see",
  Scheduling: "Make it easy to book without a phone call",
  Communication: "Close the response gap on new inquiries",
  "Customer Retention": "Turn happy customers into visible proof",
  "Brand Experience": "Tighten the first impression",
};

function isSendable(o: ModernizationOpportunity): boolean {
  if (!STRONG_EVIDENCE.has(o.confidence.label)) return false;   // inferred/guessed → out
  if (!(o.basis && o.basis.length > 0)) return false;           // no provenance → out
  if (NON_OBSERVABLE_CATEGORIES.has(o.category)) return false;  // internal state we can't see → out
  if (SPECULATIVE_RX.test(o.observation)) return false;         // hedging/generic language → out
  return true;
}

/** The public source that grounds a finding — derived from its exact provenance strings. */
function sourceTypeOf(basis: string[], category: OpportunityCategory): EvidenceSourceType {
  const b = basis.join(" ").toLowerCase();
  if (/google business|gbp|listing|places/.test(b)) return "google-business";
  if (/review/.test(b)) return "reviews";
  if (/search|serp/.test(b)) return "search";
  if (/html|site|website|storefront|sitemap|page|mobile|render/.test(b)) return "website";
  if (category === "Customer Retention") return "reviews";
  return "website";
}

// A clean client-facing section label per source, so evidence reads "domain · Section".
const SECTION_LABEL: Partial<Record<OpportunityCategory, string>> = {
  "Customer Acquisition": "Catalog & navigation", Scheduling: "Booking", Communication: "Contact",
  "Customer Retention": "Reviews", "Brand Experience": "Homepage",
};

function toFinding(o: ModernizationOpportunity, ctx: { website?: string | null; observedAt?: string | null }): ReviewFinding {
  const specificity = Math.min(1, o.observation.trim().split(/\s+/).length / 18); // longer/concrete ranks higher
  const basis = o.basis ?? [];
  const sourceType = sourceTypeOf(basis, o.category);
  const domain = displayUrl(ctx.website ?? null);
  const section = sourceType === "google-business" ? "Google Business Profile"
    : sourceType === "reviews" ? "Reviews"
    : SECTION_LABEL[o.category] ?? null;
  const displayLabel = sourceType === "google-business"
    ? "Google Business Profile"
    : [domain, section].filter(Boolean).join(" · ") || "Public online presence";
  return {
    category: o.category,
    title: TITLE[o.category] ?? o.observation.replace(/\.$/, ""),
    observation: o.observation,
    evidence: {
      confidence: o.confidence.label,
      sourceType,
      sourceUrl: sourceType === "website" ? (ctx.website ?? null) : null, // exact, internal
      displayLabel,
      basis, // exact provenance retained in full
      observedAt: ctx.observedAt ?? null,
      screenshotRef: null, // structurally ready; populated when a real capture exists
    },
    whyItMatters: o.whyItMatters,
    whatWedDo: o.estimatedImpact?.rationale ?? "",
    score: CONF_WEIGHT[o.confidence.label] * (IMPACT_WEIGHT[o.estimatedImpact?.level] ?? 0.5) * (0.6 + 0.4 * specificity),
  };
}

/** Select the best evidence-backed findings (max 3), dropping speculative/unobservable/duplicate
 *  ones. Fewer findings is fine — quality over quantity, never filler. Pure + deterministic.
 *  `ctx` supplies the exact source (website URL) + observedAt so provenance survives into the model. */
export function selectReviewFindings(
  opportunities: ModernizationOpportunity[],
  max = 3,
  ctx: { website?: string | null; observedAt?: string | null } = {},
): ReviewFinding[] {
  const seenCat = new Set<OpportunityCategory>();
  const seenObs = new Set<string>();
  const findings: ReviewFinding[] = [];
  for (const o of opportunities.filter(isSendable).map((o) => toFinding(o, ctx)).sort((a, b) => b.score - a.score)) {
    const obsKey = o.observation.trim().toLowerCase().replace(/\s+/g, " ");
    if (seenCat.has(o.category) || seenObs.has(obsKey)) continue; // no duplicate/redundant findings
    seenCat.add(o.category); seenObs.add(obsKey);
    findings.push(o);
    if (findings.length >= max) break;
  }
  return findings;
}

/** The review's sendability. ≥2 strong findings = SENDABLE; exactly 1 = NEEDS_REVIEW (operator
 *  should eyeball it); 0 = INSUFFICIENT_EVIDENCE (must not silently become an attachment). */
export function reviewStatus(findings: ReviewFinding[]): ReviewStatus {
  if (findings.length >= 2) return "SENDABLE";
  if (findings.length === 1) return "NEEDS_REVIEW";
  return "INSUFFICIENT_EVIDENCE";
}

/** The single highest-leverage starting point (from the top finding), with a one-line rationale.
 *  Demonstrates prioritization rather than three unrelated asks. Null when no findings. */
export function startHere(findings: ReviewFinding[]): { label: string; why: string } | null {
  const top = findings[0];
  if (!top) return null;
  const LABEL: Partial<Record<OpportunityCategory, string>> = {
    "Customer Acquisition": "Website information-architecture pass",
    Scheduling: "Booking-flow cleanup",
    Communication: "Lead-capture & response audit",
    "Customer Retention": "Local-search & review cleanup",
    "Brand Experience": "Mobile conversion audit",
  };
  return {
    label: LABEL[top.category] ?? "Conversion QA pass",
    why: `It's the clearest thing we could point to public evidence for, and the fastest to show a result: ${top.whyItMatters.replace(/\.$/, "").toLowerCase()}.`,
  };
}
