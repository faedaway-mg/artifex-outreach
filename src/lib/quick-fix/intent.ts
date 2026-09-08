// ─────────────────────────────────────────────────────────────────────────────
// PURCHASE INTENT — distinct from Fixability.
//   FIXABILITY = is this a strong problem to sell?  (property of the offer)
//   INTENT     = is THIS prospect showing buying behavior?  (property of activity)
//
// Scored only from MEASURABLE funnel events (lifecycle.FUNNEL_EVENTS). Stronger
// actions score strictly higher. No signal is assumed — an event counts only if
// it was actually recorded.
// ─────────────────────────────────────────────────────────────────────────────
import { FUNNEL_EVENTS } from "./lifecycle";

// Ranked weights — checkout behavior dominates a mere email open.
const WEIGHT: Record<string, number> = {
  [FUNNEL_EVENTS.checkoutStarted]: 40,
  [FUNNEL_EVENTS.termsAccepted]: 28,
  [FUNNEL_EVENTS.checkoutClicked]: 20,
  [FUNNEL_EVENTS.callBooked]: 30,
  [FUNNEL_EVENTS.trustVideoCompleted]: 12,
  [FUNNEL_EVENTS.trustVideoStarted]: 6,
  [FUNNEL_EVENTS.offerPageViewed]: 8,
  [FUNNEL_EVENTS.diagnosticVideoViewed]: 6,
  [FUNNEL_EVENTS.pdfViewed]: 4,
  [FUNNEL_EVENTS.emailOpened]: 2,
};

// Repeat offer-page views add intent (bounded).
const REPEAT_OFFER_VIEW_BONUS = 6;

export interface IntentInput {
  /** Recorded funnel events for this prospect/offer (may repeat). */
  events: string[];
  /** Whether checkout was started but no verified payment followed. */
  checkoutAbandoned?: boolean;
}

export interface IntentResult {
  score: number; // 0..100
  strongestSignal: string | null;
  checkoutAbandoned: boolean;
  recommendedNextStep: string;
  contributions: Array<{ event: string; weight: number; count: number }>;
}

export function scoreIntent(input: IntentInput): IntentResult {
  const counts = new Map<string, number>();
  for (const e of input.events) counts.set(e, (counts.get(e) ?? 0) + 1);

  const contributions: IntentResult["contributions"] = [];
  let raw = 0;
  let strongest: { event: string; weight: number } | null = null;
  for (const [event, count] of counts) {
    const w = WEIGHT[event] ?? 0;
    if (w === 0) continue;
    raw += w; // count once for the base weight
    if (event === FUNNEL_EVENTS.offerPageViewed && count > 1) raw += Math.min(REPEAT_OFFER_VIEW_BONUS, (count - 1) * 3);
    contributions.push({ event, weight: w, count });
    if (!strongest || w > strongest.weight) strongest = { event, weight: w };
  }
  const score = Math.max(0, Math.min(100, raw));
  const abandoned = !!input.checkoutAbandoned;

  let recommendedNextStep = "no action yet";
  if (abandoned) recommendedNextStep = "checkout abandoned → SKU-specific reminder after a cooldown";
  else if (strongest?.event === FUNNEL_EVENTS.checkoutStarted) recommendedNextStep = "checkout started → personal reply / offer help completing checkout";
  else if (strongest?.event === FUNNEL_EVENTS.termsAccepted) recommendedNextStep = "terms accepted → nudge to complete checkout";
  else if (strongest && score >= 8) recommendedNextStep = "engaged → send the SKU-specific follow-up";

  return { score, strongestSignal: strongest?.event ?? null, checkoutAbandoned: abandoned, recommendedNextStep, contributions };
}
