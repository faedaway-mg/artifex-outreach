// ─────────────────────────────────────────────────────────────────────────────
// FUNNEL INSTRUMENTATION (PART P) — a deterministic roll-up of the minimum useful
// conversion funnel from the canonical FUNNEL_EVENTS already emitted to the audit
// log. It NEVER fabricates behavior: it counts only events that exist, and reports
// hasTracking=false honestly when the log is empty. Email opens are deliberately
// NOT a headline stage (privacy/tracking noise) — purchase + completion matter most.
// ─────────────────────────────────────────────────────────────────────────────
import { FUNNEL_EVENTS } from "./lifecycle";

export interface FunnelStageCount { key: string; event: string; label: string; count: number }
export interface FunnelSummary {
  stages: FunnelStageCount[];
  offersTouched: number;
  purchases: number;
  /** False when there is no funnel signal at all — reported honestly, never faked. */
  hasTracking: boolean;
}

// The stages we surface, mapped to canonical events. fulfillment_* reuse the job events.
const STAGE_DEFS: Array<{ key: string; event: string; label: string }> = [
  { key: "offer_opened", event: FUNNEL_EVENTS.offerPageViewed, label: "Offer opened" },
  { key: "evidence_viewed", event: FUNNEL_EVENTS.pdfViewed, label: "Evidence viewed" },
  { key: "video_play_started", event: FUNNEL_EVENTS.trustVideoStarted, label: "Video started" },
  { key: "video_play_completed", event: FUNNEL_EVENTS.trustVideoCompleted, label: "Video completed" },
  { key: "terms_accepted", event: FUNNEL_EVENTS.termsAccepted, label: "Terms accepted" },
  { key: "checkout_started", event: FUNNEL_EVENTS.checkoutStarted, label: "Checkout started" },
  { key: "purchase_verified", event: FUNNEL_EVENTS.purchaseCompleted, label: "Purchase verified" },
  { key: "fulfillment_started", event: FUNNEL_EVENTS.jobStarted, label: "Fulfillment started" },
  { key: "fulfillment_completed", event: FUNNEL_EVENTS.jobDelivered, label: "Fulfillment completed" },
];

export interface AuditLike { action: string; targetType?: string | null; targetId?: string | null }

/**
 * Summarize the conversion funnel from audit events. Pure + deterministic. Counts
 * are over exactly what's present — a missing stage is 0, and an empty log yields
 * hasTracking=false (do not optimize on one or two observations).
 */
export function summarizeFunnel(events: AuditLike[]): FunnelSummary {
  const counts = new Map<string, number>();
  const offers = new Set<string>();
  for (const e of events) {
    if (e.action?.startsWith("quickfix.")) counts.set(e.action, (counts.get(e.action) ?? 0) + 1);
    if (e.targetType === "quickfix_offer" && e.targetId) offers.add(e.targetId);
  }
  const stages = STAGE_DEFS.map((s) => ({ key: s.key, event: s.event, label: s.label, count: counts.get(s.event) ?? 0 }));
  const purchases = counts.get(FUNNEL_EVENTS.purchaseCompleted) ?? 0;
  const hasTracking = stages.some((s) => s.count > 0);
  return { stages, offersTouched: offers.size, purchases, hasTracking };
}
