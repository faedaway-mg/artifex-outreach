// ─────────────────────────────────────────────────────────────────────────────
// EVIDENCE GATE — the anti-fabrication guardrail.
//
// Acquisition OS must NEVER invent a deficiency to sell a fix. Every offer traces
// to a real finding with real provenance. A finding is graded OBSERVED / INFERRED
// / UNKNOWN and the language we may use is constrained accordingly. Below a
// confidence threshold we do not present the problem as fact — we soften to a
// diagnostic CTA or decline. No revenue/traffic/conversion/impact numbers are
// ever asserted from public evidence.
// ─────────────────────────────────────────────────────────────────────────────
import type { EvidenceGrade, OfferFinding } from "./types";

/** Map the BI confidence label onto the three public evidence grades. */
export function gradeOf(finding: Pick<OfferFinding, "confidenceLabel" | "confidenceScore" | "basis">): EvidenceGrade {
  const label = finding.confidenceLabel;
  const hasBasis = (finding.basis ?? []).length > 0;
  if (!hasBasis) return "UNKNOWN"; // no provenance → cannot claim it as fact
  if (label === "Observed") return "OBSERVED";
  if (label === "Reported" || label === "Likely") return "INFERRED";
  if (label === "Inferred") return "INFERRED";
  return "UNKNOWN";
}

/** Confidence floor below which we do not present a paid quick-fix offer. */
export const MIN_OFFER_CONFIDENCE = 0.6;

// Language the engine must never emit — unsupported quantitative business claims.
const FABRICATION_PATTERNS: RegExp[] = [
  /\$\s?\d[\d,]*\s*(\/?\s*(mo|month|year|yr|week|day))?\s*(in\s+)?(lost|losing|missed|revenue|sales)/i,
  /\blos(e|ing|t)\s+\$?\d/i,
  /\b\d+\s?%\s*(more|fewer|less|increase|decrease|conversion|traffic|revenue|sales|leads)\b/i,
  /\b\d[\d,]*\s+(customers|visitors|leads|clicks|sales)\b/i,
  /\bguarantee(d|s)?\b/i,
  /\bwill\s+(increase|double|triple|boost|grow)\b/i,
];

export function containsFabricatedClaim(text: string): boolean {
  return FABRICATION_PATTERNS.some((re) => re.test(text));
}

// Vague "opportunity" language that is NOT a concrete, pointable defect. The
// broken-thing engine rejects these — you can't sell a fix for "could be better".
const VAGUE_PATTERNS: RegExp[] = [
  /\bcould (be|use)\b/i,
  /\broom for improvement\b/i,
  /\bmay benefit\b/i,
  /\bmight (want|benefit|consider)\b/i,
  /\b(digital presence|online presence|branding|brand identity|marketing|ux|user experience)\b.*\b(improve|better|stronger|enhance)/i,
  /\bgenerally\b|\boverall\b/i,
  /\bconsider (improving|updating|refreshing)\b/i,
];

/**
 * A finding is concrete enough to sell against only if it points to a SPECIFIC
 * observable thing. We require some specificity signal (a page/element/mechanism)
 * and reject pure "opportunity" phrasing.
 */
export function isConcreteDefect(observation: string): boolean {
  const t = observation.trim();
  if (t.length < 15) return false;
  if (VAGUE_PATTERNS.some((re) => re.test(t))) return false;
  // A concrete defect names a thing or a mechanism.
  const CONCRETE = /\b(form|cta|button|link|nav|navigation|booking|schedule|mobile|viewport|responsive|contrast|alt text|heading|metadata|title|meta description|analytics|tracking|event|contact|submit|redirect|page|homepage|hero|fold|headline|value proposition|embed|dns|review|testimonial|route|routing|schema)\b/i;
  return CONCRETE.test(t);
}

export interface EvidenceAssessment {
  /** Findings that are strong enough to anchor a paid offer. */
  qualifyingFindings: OfferFinding[];
  /** The strongest grade present among qualifying findings. */
  grade: EvidenceGrade;
  /** De-duped rolled-up confidence (0..1) — weakest-link aware, never inflated. */
  confidence: number;
  /** True when we may present a paid offer at all. */
  sufficientForOffer: boolean;
  /** What to do when not sufficient. */
  recommendation: "OFFER" | "SOFT_DIAGNOSTIC" | "DECLINE";
  reason: string;
}

/**
 * Assess a lead's findings. Uses ONLY OBSERVED/INFERRED findings with provenance;
 * confidence is the max qualifying score (a single strong observation is enough),
 * but scope-uncertainty downstream still keys off whether the anchor is OBSERVED.
 */
export function assessEvidence(findings: OfferFinding[]): EvidenceAssessment {
  const graded = findings.map((f) => ({ f, grade: gradeOf(f) }));
  // Qualify only findings that are (a) evidence-backed AND (b) a CONCRETE defect —
  // a vague "opportunity" is never sellable in the broken-thing engine.
  const qualifying = graded.filter((g) => g.grade !== "UNKNOWN" && g.f.confidenceScore > 0 && isConcreteDefect(g.f.observation)).map((g) => g.f);

  if (qualifying.length === 0) {
    const hadVague = graded.some((g) => g.grade !== "UNKNOWN" && !isConcreteDefect(g.f.observation));
    return {
      qualifyingFindings: [],
      grade: "UNKNOWN",
      confidence: 0,
      sufficientForOffer: false,
      recommendation: "DECLINE",
      reason: hadVague ? "findings are too vague — no concrete, pointable defect to fix" : "no finding has enough provenance to present as fact",
    };
  }

  const anyObserved = qualifying.some((f) => gradeOf(f) === "OBSERVED");
  const grade: EvidenceGrade = anyObserved ? "OBSERVED" : "INFERRED";
  const confidence = Math.max(...qualifying.map((f) => f.confidenceScore));

  if (confidence < MIN_OFFER_CONFIDENCE) {
    return {
      qualifyingFindings: qualifying,
      grade,
      confidence,
      sufficientForOffer: false,
      recommendation: "SOFT_DIAGNOSTIC",
      reason: `top confidence ${confidence.toFixed(2)} is below the ${MIN_OFFER_CONFIDENCE} offer floor — soften to a diagnostic CTA`,
    };
  }

  return {
    qualifyingFindings: qualifying,
    grade,
    confidence,
    sufficientForOffer: true,
    recommendation: "OFFER",
    reason: `${qualifying.length} evidence-backed finding(s); anchor grade ${grade}`,
  };
}

/**
 * Evidence-graded phrasing for the problem statement. OBSERVED may say "we saw";
 * INFERRED must hedge ("it looks like / appears"). Never asserts business impact.
 */
export function gradedProblemStatement(finding: OfferFinding): string {
  const grade = gradeOf(finding);
  const obs = finding.observation.replace(/\.$/, "");
  if (grade === "OBSERVED") return `While reviewing your site, we noticed ${lowerFirst(obs)}.`;
  return `While reviewing your site, it looks like ${lowerFirst(obs)}.`;
}

function lowerFirst(s: string): string {
  return s.length ? s[0].toLowerCase() + s.slice(1) : s;
}
