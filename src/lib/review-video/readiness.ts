// ─────────────────────────────────────────────────────────────────────────────
// Review Video readiness (Batch Pilot M1) — an explicit eligibility gate so a lead is NOT put into the
// video batch just because it exists. It reuses the accepted Quick Review + hook signals (no new
// scoring engine): a video candidate wants a SENDABLE review with 2–3 evidence-backed findings and
// enough visual/quantitative hooks to make a personalized video. NEEDS_REVIEW (one finding) is not in
// the default batch (operator override only); INSUFFICIENT is never eligible. Pure + deterministic.
// ─────────────────────────────────────────────────────────────────────────────
import type { QuickReview } from "../outreach/quick-review";

export type Readiness = "STRONG" | "READY" | "NEEDS_REVIEW" | "NOT_ENOUGH_EVIDENCE";

export interface ReviewVideoReadiness {
  eligible: boolean;            // eligible for the DEFAULT batch (override can still force NEEDS_REVIEW)
  overridable: boolean;         // an operator may force it in (NEEDS_REVIEW only)
  readiness: Readiness;
  reviewStatus: QuickReview["status"];
  findingCount: number;
  visualEvidenceCount: number;  // findings whose visual hook is a real surface/number (not TEXT_ONLY)
  quantitativeHookCount: number;// STAT / STRUCTURE / COMPARISON
  hookStrength: number;         // 0..1 rough communicative strength
  blockers: string[];
}

const QUANT = new Set(["STAT", "STRUCTURE", "COMPARISON"]);
const VISUAL = new Set(["STAT", "STRUCTURE", "COMPARISON", "SCREENSHOT", "EXCERPT"]);

/** Assess a finished Quick Review for video candidacy. Pure — reads only the review. */
export function reviewVideoReadiness(review: QuickReview): ReviewVideoReadiness {
  const findingCount = review.findings.length;
  const presentations = review.presentations ?? [];
  const visualEvidenceCount = presentations.filter((p) => VISUAL.has(p.visualHook.type)).length;
  const quantitativeHookCount = presentations.filter((p) => QUANT.has(p.visualHook.type)).length;
  const hasOpeningHook = !!review.openingHook;
  const hookStrength = Math.min(1, (quantitativeHookCount * 0.34) + (visualEvidenceCount * 0.12) + (hasOpeningHook ? 0.2 : 0));

  const blockers: string[] = [];
  if (review.status === "INSUFFICIENT_EVIDENCE") blockers.push("no evidence-backed findings");
  if (review.status === "NEEDS_REVIEW") blockers.push("only one finding — below the video threshold");
  if (findingCount < 2 && review.status === "SENDABLE") blockers.push("fewer than two findings"); // defensive
  if (!hasOpeningHook) blockers.push("no primary hook");

  let readiness: Readiness;
  let eligible = false;
  let overridable = false;
  if (review.status === "INSUFFICIENT_EVIDENCE") {
    readiness = "NOT_ENOUGH_EVIDENCE";
  } else if (review.status === "NEEDS_REVIEW") {
    readiness = "NEEDS_REVIEW";
    overridable = true; // the existing approval model can wave a NEEDS_REVIEW review through
  } else {
    // SENDABLE: STRONG when it has ≥3 findings OR ≥2 quantitative/visual hooks; else READY.
    const strong = findingCount >= 3 || quantitativeHookCount >= 2 || visualEvidenceCount >= 2;
    readiness = strong ? "STRONG" : "READY";
    eligible = true;
  }

  return { eligible, overridable, readiness, reviewStatus: review.status, findingCount, visualEvidenceCount, quantitativeHookCount, hookStrength: Math.round(hookStrength * 100) / 100, blockers };
}

/** Rank candidates strongest-first for a pilot (operator picks from the top). Stable, deterministic. */
export function rankCandidates<T extends { readiness: ReviewVideoReadiness }>(items: T[]): T[] {
  const order: Record<Readiness, number> = { STRONG: 0, READY: 1, NEEDS_REVIEW: 2, NOT_ENOUGH_EVIDENCE: 3 };
  return [...items].sort((a, b) => (order[a.readiness.readiness] - order[b.readiness.readiness]) || (b.readiness.hookStrength - a.readiness.hookStrength));
}
