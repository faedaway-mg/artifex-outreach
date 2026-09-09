// ─────────────────────────────────────────────────────────────────────────────
// FUNNEL INSTRUMENTATION (PART P) — a deterministic roll-up of the minimum useful
// conversion funnel from the canonical FUNNEL_EVENTS already emitted to the audit
// log. It NEVER fabricates behavior: it counts only events that exist, and reports
// hasTracking=false honestly when the log is empty. Email opens are deliberately
// NOT a headline stage (privacy/tracking noise) — purchase + completion matter most.
// ─────────────────────────────────────────────────────────────────────────────
import { FUNNEL_EVENTS } from "./lifecycle";

// ── Expanded funnel event vocabulary (Part P+) ───────────────────────────────
// Additional canonical event names for the fuller conversion funnel the readiness /
// persuasion work introduces. These are NAMES ONLY (recorded via appendAudit action=…);
// they extend — never replace — FUNNEL_EVENTS. Where an equivalent legacy event already
// exists it is re-exported here so callers have one place to look, and summarizeFunnel
// counts BOTH the legacy and the expanded name for a stage (see STAGE_DEFS).
export const FUNNEL_EVENTS_EXT = {
  evidenceViewed: "quickfix.evidence_viewed",
  livePageVerifyClicked: "quickfix.live_page_verify_clicked",
  personalizedVideoStarted: "quickfix.personalized_video_started",
  personalizedVideoWatched: "quickfix.personalized_video_watched",
  pdfOpened: "quickfix.pdf_opened",
  packageSectionReached: "quickfix.package_section_reached",
  priceSectionReached: "quickfix.price_section_reached",
  checkoutStarted: "quickfix.checkout_started",     // == FUNNEL_EVENTS.checkoutStarted
  purchaseVerified: "quickfix.purchase_verified",
} as const;

export type FunnelEventExt = (typeof FUNNEL_EVENTS_EXT)[keyof typeof FUNNEL_EVENTS_EXT];

/**
 * Attribution stamped onto EVERY recorded funnel event so conversion can be sliced by
 * the exact policies + defect class that produced the artifact. All fields optional —
 * an event with no attribution simply carries none (never fabricated).
 */
export interface FunnelAttribution {
  /** The persuasion-policy version the offer was prepared under (Part U). */
  persuasionPolicyVersion?: string | null;
  /** The subject-engine policy version that produced/validated the subject. */
  subjectPolicyVersion?: string | null;
  /** The coarse observed-defect class (subject family) for attribution. */
  defectType?: string | null;
}

/**
 * Build the audit `meta` payload for a funnel event, merging caller meta with the
 * attribution stamps. Pure: returns a plain object; performs no writes. The store's
 * recordFunnelEvent passes this straight through to appendAudit(meta).
 */
export function funnelEventMeta(
  attribution: FunnelAttribution = {},
  extra: Record<string, unknown> | null = null,
): Record<string, unknown> {
  const meta: Record<string, unknown> = { ...(extra ?? {}) };
  if (attribution.persuasionPolicyVersion != null) meta.persuasionPolicyVersion = attribution.persuasionPolicyVersion;
  if (attribution.subjectPolicyVersion != null) meta.subjectPolicyVersion = attribution.subjectPolicyVersion;
  if (attribution.defectType != null) meta.defectType = attribution.defectType;
  return meta;
}

export interface FunnelStageCount { key: string; event: string; label: string; count: number }
export interface FunnelSummary {
  stages: FunnelStageCount[];
  offersTouched: number;
  purchases: number;
  /** False when there is no funnel signal at all — reported honestly, never faked. */
  hasTracking: boolean;
}

// The stages we surface, mapped to canonical events. fulfillment_* reuse the job events.
// A stage may map to SEVERAL event names (legacy + expanded); its count sums them, so
// adding the expanded vocabulary never double-drops a stage or breaks the roll-up.
// `event` (singular, first name) is preserved on the output for back-compat.
const STAGE_DEFS: Array<{ key: string; events: string[]; label: string }> = [
  { key: "offer_opened", events: [FUNNEL_EVENTS.offerPageViewed], label: "Offer opened" },
  { key: "evidence_viewed", events: [FUNNEL_EVENTS_EXT.evidenceViewed, FUNNEL_EVENTS.pdfViewed], label: "Evidence viewed" },
  { key: "live_page_verified", events: [FUNNEL_EVENTS_EXT.livePageVerifyClicked], label: "Live page verified" },
  { key: "pdf_opened", events: [FUNNEL_EVENTS_EXT.pdfOpened, FUNNEL_EVENTS.pdfViewed], label: "Diagnostic PDF opened" },
  { key: "personalized_video_started", events: [FUNNEL_EVENTS_EXT.personalizedVideoStarted], label: "Personalized video started" },
  { key: "personalized_video_watched", events: [FUNNEL_EVENTS_EXT.personalizedVideoWatched], label: "Personalized video watched" },
  { key: "video_play_started", events: [FUNNEL_EVENTS.trustVideoStarted], label: "Video started" },
  { key: "video_play_completed", events: [FUNNEL_EVENTS.trustVideoCompleted], label: "Video completed" },
  { key: "package_section_reached", events: [FUNNEL_EVENTS_EXT.packageSectionReached], label: "Package section reached" },
  { key: "price_section_reached", events: [FUNNEL_EVENTS_EXT.priceSectionReached], label: "Price section reached" },
  { key: "terms_accepted", events: [FUNNEL_EVENTS.termsAccepted], label: "Terms accepted" },
  { key: "checkout_started", events: [FUNNEL_EVENTS_EXT.checkoutStarted, FUNNEL_EVENTS.checkoutStarted], label: "Checkout started" },
  { key: "purchase_verified", events: [FUNNEL_EVENTS_EXT.purchaseVerified, FUNNEL_EVENTS.purchaseCompleted], label: "Purchase verified" },
  { key: "fulfillment_started", events: [FUNNEL_EVENTS.jobStarted], label: "Fulfillment started" },
  { key: "fulfillment_completed", events: [FUNNEL_EVENTS.jobDelivered], label: "Fulfillment completed" },
];

export interface AuditLike { action: string; targetType?: string | null; targetId?: string | null; meta?: Record<string, unknown> | null }

/**
 * Summarize the conversion funnel from audit events. Pure + deterministic. Counts
 * are over exactly what's present — a missing stage is 0, and an empty log yields
 * hasTracking=false (do not optimize on one or two observations). A stage that maps to
 * multiple event names sums them (legacy + expanded), never double-counting the same
 * event, so introducing the expanded vocabulary is additive.
 */
export function summarizeFunnel(events: AuditLike[]): FunnelSummary {
  const counts = new Map<string, number>();
  const offers = new Set<string>();
  for (const e of events) {
    if (e.action?.startsWith("quickfix.")) counts.set(e.action, (counts.get(e.action) ?? 0) + 1);
    if (e.targetType === "quickfix_offer" && e.targetId) offers.add(e.targetId);
  }
  const stageCount = (names: string[]) => names.reduce((sum, n) => sum + (counts.get(n) ?? 0), 0);
  const stages = STAGE_DEFS.map((s) => ({ key: s.key, event: s.events[0], label: s.label, count: stageCount(s.events) }));
  const purchases = stageCount([FUNNEL_EVENTS_EXT.purchaseVerified, FUNNEL_EVENTS.purchaseCompleted]);
  const hasTracking = stages.some((s) => s.count > 0);
  return { stages, offersTouched: offers.size, purchases, hasTracking };
}

/** One attribution slice of the funnel — a count of events carrying a given key=value. */
export interface AttributionCount { key: string; value: string; count: number }

/**
 * Roll up how many recorded funnel events carry each attribution value, for the three
 * attribution dimensions. Pure: reads event.meta only, never fabricates a value. Events
 * with no attribution are simply not counted for that dimension. Useful for slicing
 * conversion by persuasion/subject policy version or defect type.
 */
export function attributionBreakdown(events: AuditLike[]): {
  persuasionPolicyVersion: AttributionCount[];
  subjectPolicyVersion: AttributionCount[];
  defectType: AttributionCount[];
} {
  const dims: Record<string, Map<string, number>> = {
    persuasionPolicyVersion: new Map(),
    subjectPolicyVersion: new Map(),
    defectType: new Map(),
  };
  for (const e of events) {
    if (!e.action?.startsWith("quickfix.")) continue;
    const meta = e.meta ?? {};
    for (const dim of Object.keys(dims)) {
      const v = (meta as Record<string, unknown>)[dim];
      if (typeof v === "string" && v) dims[dim].set(v, (dims[dim].get(v) ?? 0) + 1);
    }
  }
  const toRows = (key: string, m: Map<string, number>): AttributionCount[] =>
    [...m.entries()].map(([value, count]) => ({ key, value, count })).sort((a, b) => a.value.localeCompare(b.value));
  return {
    persuasionPolicyVersion: toRows("persuasionPolicyVersion", dims.persuasionPolicyVersion),
    subjectPolicyVersion: toRows("subjectPolicyVersion", dims.subjectPolicyVersion),
    defectType: toRows("defectType", dims.defectType),
  };
}
