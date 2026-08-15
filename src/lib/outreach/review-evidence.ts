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

export interface ReviewFinding {
  category: OpportunityCategory;
  /** A specific, factual finding title (evidence-driven, not consulting fluff). */
  title: string;
  /** What we actually found — the concrete observation. */
  observation: string;
  /** The public evidence behind it: where we saw it (basis) + the confidence label. */
  evidence: { source: string; confidence: ConfidenceLabel };
  /** Why it matters commercially — 1–2 sentences. */
  whyItMatters: string;
  /** The concrete Artifex intervention. */
  whatWedDo: string;
  /** Internal rank score (higher = stronger/more valuable). Not shown. */
  score: number;
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

function toFinding(o: ModernizationOpportunity): ReviewFinding {
  const specificity = Math.min(1, o.observation.trim().split(/\s+/).length / 18); // longer/concrete ranks higher
  return {
    category: o.category,
    title: TITLE[o.category] ?? o.observation.replace(/\.$/, ""),
    observation: o.observation,
    evidence: { source: (o.basis ?? []).join("; ") || "public website", confidence: o.confidence.label },
    whyItMatters: o.whyItMatters,
    whatWedDo: o.estimatedImpact?.rationale ?? "",
    score: CONF_WEIGHT[o.confidence.label] * (IMPACT_WEIGHT[o.estimatedImpact?.level] ?? 0.5) * (0.6 + 0.4 * specificity),
  };
}

/** Select the best evidence-backed findings (max 3), dropping speculative/unobservable/duplicate
 *  ones. Fewer findings is fine — quality over quantity, never filler. Pure + deterministic. */
export function selectReviewFindings(opportunities: ModernizationOpportunity[], max = 3): ReviewFinding[] {
  const seenCat = new Set<OpportunityCategory>();
  const seenObs = new Set<string>();
  const findings: ReviewFinding[] = [];
  for (const o of opportunities.filter(isSendable).map(toFinding).sort((a, b) => b.score - a.score)) {
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
