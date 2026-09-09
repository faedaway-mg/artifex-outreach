// ─────────────────────────────────────────────────────────────────────────────
// SUBJECT TRACKING (Part L) — attribute downstream outcomes to the SUBJECT that
// carried the first touch, so the curiosity-first policy is judged by RESULTS, not
// taste. Pure + deterministic. It counts only events that exist and reports the
// honest sample size; it does NOT auto-change policy.
//
// THE OPTIMIZATION TARGET IS PURCHASE PER DELIVERED — not opens (open tracking is
// privacy-noisy and easily inflated). A subject that earns opens but no purchases is
// not a winning subject. Promotion between policy versions is EXPLICIT and gated on a
// minimum sample: below MIN_PROMOTION_SAMPLE we refuse to declare a winner.
// ─────────────────────────────────────────────────────────────────────────────

/** The downstream events we attribute to a subject, in funnel order. */
export type TrackedOutcome =
  | "delivered"
  | "reply"
  | "offer_viewed"
  | "personalized_video_played"
  | "checkout_started"
  | "purchase"
  | "negative"
  | "unsubscribe";

/** A single attributed observation — one outcome, tagged with its subject context. */
export interface SubjectEvent {
  subjectText: string;
  subjectFamily: string;
  policyVersion: string;
  defectType: string;
  vertical: string | null;
  marketTier: string | null;
  outcome: TrackedOutcome;
}

/** Below this many DELIVERED sends, a cohort's rate is not trustworthy — no winner. */
export const MIN_PROMOTION_SAMPLE = 30;

/** A structured event ready to be appended to the canonical audit log by the caller. */
export interface SubjectAuditEvent {
  action: "quickfix.subject_outcome";
  targetType: "quickfix_offer";
  targetId: string;
  meta: {
    subjectText: string;
    subjectFamily: string;
    policyVersion: string;
    defectType: string;
    vertical: string | null;
    marketTier: string | null;
    outcome: TrackedOutcome;
  };
}

/**
 * Build the audit event that records a downstream outcome ASSOCIATED to the subject
 * that produced it. The caller appends this to the audit log; keeping it a pure
 * factory makes it trivially testable and never sends anything.
 */
export function subjectOutcomeEvent(
  offerId: string,
  ctx: { subjectText: string; subjectFamily: string; policyVersion: string; defectType: string; vertical?: string | null; marketTier?: string | null },
  outcome: TrackedOutcome,
): SubjectAuditEvent {
  return {
    action: "quickfix.subject_outcome",
    targetType: "quickfix_offer",
    targetId: offerId,
    meta: {
      subjectText: ctx.subjectText,
      subjectFamily: ctx.subjectFamily,
      policyVersion: ctx.policyVersion,
      defectType: ctx.defectType,
      vertical: ctx.vertical ?? null,
      marketTier: ctx.marketTier ?? null,
      outcome,
    },
  };
}

export interface CohortKey {
  subjectFamily: string;
  policyVersion: string;
}

export interface CohortStats {
  subjectFamily: string;
  policyVersion: string;
  delivered: number;
  purchases: number;
  /** purchase-per-delivered, 0..1. 0 when nothing delivered (never divide by zero). */
  purchasePerDelivered: number;
  /** True only when delivered >= MIN_PROMOTION_SAMPLE — otherwise the rate is noise. */
  sufficientSample: boolean;
}

function keyOf(k: CohortKey): string {
  return `${k.policyVersion}::${k.subjectFamily}`;
}

/**
 * Roll subject events up into per-(family, policyVersion) cohort stats, keyed on the
 * PURCHASE-PER-DELIVERED objective. Deterministic; safe on an empty input.
 */
export function summarizeSubjectCohorts(events: SubjectEvent[]): CohortStats[] {
  const byKey = new Map<string, { k: CohortKey; delivered: number; purchases: number }>();
  for (const e of events) {
    const k: CohortKey = { subjectFamily: e.subjectFamily, policyVersion: e.policyVersion };
    const cur = byKey.get(keyOf(k)) ?? { k, delivered: 0, purchases: 0 };
    if (e.outcome === "delivered") cur.delivered += 1;
    if (e.outcome === "purchase") cur.purchases += 1;
    byKey.set(keyOf(k), cur);
  }
  return [...byKey.values()].map((c) => ({
    subjectFamily: c.k.subjectFamily,
    policyVersion: c.k.policyVersion,
    delivered: c.delivered,
    purchases: c.purchases,
    purchasePerDelivered: c.delivered > 0 ? c.purchases / c.delivered : 0,
    sufficientSample: c.delivered >= MIN_PROMOTION_SAMPLE,
  }));
}

export interface PromotionDecision {
  /** True only when there is a defensible, sufficiently-sampled winner. */
  shouldPromote: boolean;
  winner: CohortStats | null;
  reason: string;
}

/**
 * Decide whether a NEW policy version has earned promotion over a baseline for a
 * family. This NEVER auto-applies — it only advises. It refuses (shouldPromote=false)
 * unless BOTH cohorts clear MIN_PROMOTION_SAMPLE and the candidate strictly beats the
 * baseline on purchase-per-delivered. Insufficient sample ⇒ never a winner.
 */
export function evaluatePromotion(
  events: SubjectEvent[],
  opts: { subjectFamily: string; baselineVersion: string; candidateVersion: string },
): PromotionDecision {
  const cohorts = summarizeSubjectCohorts(events);
  const base = cohorts.find((c) => c.subjectFamily === opts.subjectFamily && c.policyVersion === opts.baselineVersion) ?? null;
  const cand = cohorts.find((c) => c.subjectFamily === opts.subjectFamily && c.policyVersion === opts.candidateVersion) ?? null;

  if (!cand || !cand.sufficientSample) {
    return { shouldPromote: false, winner: null, reason: `candidate ${opts.candidateVersion} has insufficient delivered sample (need ${MIN_PROMOTION_SAMPLE})` };
  }
  if (!base || !base.sufficientSample) {
    return { shouldPromote: false, winner: null, reason: `baseline ${opts.baselineVersion} has insufficient delivered sample to compare against` };
  }
  if (cand.purchasePerDelivered > base.purchasePerDelivered) {
    return { shouldPromote: true, winner: cand, reason: `candidate ${cand.purchasePerDelivered.toFixed(3)} > baseline ${base.purchasePerDelivered.toFixed(3)} purchase/delivered` };
  }
  return { shouldPromote: false, winner: null, reason: `candidate did not beat baseline on purchase/delivered (${cand.purchasePerDelivered.toFixed(3)} vs ${base.purchasePerDelivered.toFixed(3)})` };
}
