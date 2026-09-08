// ─────────────────────────────────────────────────────────────────────────────
// FIXABILITY — the gate + the explainable score.
//
// FIXABILITY SCORE ≈ EVIDENCE × SKU MATCH × IMPLEMENTATION CERTAINTY × SPEED ×
//                    MARGIN × PURCHASE SIMPLICITY
// (weighted sum of normalized components, 0..100, each component explained).
//
// The gate routes a generated offer to a state: READY_TO_SELL when it's a real
// productizable fix; else NO_FIX_FOUND / NEEDS_REVIEW / CONVERSATION_REQUIRED /
// CUSTOM_SCOPE. Nothing enters the automated quick-fix funnel unless READY_TO_SELL.
// ─────────────────────────────────────────────────────────────────────────────
import type { QuickFixOffer } from "./types";
import { QUICK_FIX_HOUR_CEILING } from "./pricing";
import { skuFor } from "./catalog";

export type FixabilityState =
  | "READY_TO_SELL"
  | "NEEDS_REVIEW"
  | "CONVERSATION_REQUIRED"
  | "CUSTOM_SCOPE"
  | "NO_FIX_FOUND";

export interface FixabilityComponent {
  key: string;
  value: number; // 0..1 normalized
  weight: number;
  note: string;
}

export interface Fixability {
  state: FixabilityState;
  score: number; // 0..100 (0 when not READY_TO_SELL)
  components: FixabilityComponent[];
  matchedSku: string | null;
  matchConfidence: number; // 0..1
  readyToSell: boolean;
  reason: string;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * Classify a NON-eligible offer's reason into a routing state. Keeps no-fix leads
 * out of the automated funnel without discarding them.
 */
function routeNonEligible(offer: QuickFixOffer): { state: FixabilityState; reason: string } {
  const r = (offer.notEligibleReason ?? "").toLowerCase();
  if (r.includes("no functioning website") || r.includes("exceeds") || r.includes("beyond a productized") || r.includes("conversation")) {
    return { state: "CONVERSATION_REQUIRED", reason: offer.notEligibleReason ?? "route to a conversation" };
  }
  if (r.includes("economics") || r.includes("risk") || r.includes("uncertain")) {
    return { state: "NEEDS_REVIEW", reason: offer.notEligibleReason ?? "needs operator review" };
  }
  if (r.includes("vague")) {
    return { state: "NO_FIX_FOUND", reason: "no concrete, pointable defect to fix" };
  }
  // no capability / no evidence
  return { state: "NO_FIX_FOUND", reason: offer.notEligibleReason ?? "no matching fix found" };
}

export function assessFixability(offer: QuickFixOffer): Fixability {
  const matchedSku = offer.capabilityKeys[0] ? skuFor(offer.capabilityKeys[0])?.key ?? null : null;

  if (!offer.quickFixEligible) {
    const { state, reason } = routeNonEligible(offer);
    return { state, score: 0, components: [], matchedSku, matchConfidence: 0, readyToSell: false, reason };
  }

  const riskPenalty = { low: 0, medium: 0.35, high: 0.8 }[offer.economics.deliveryRisk];
  const supportEase = offer.economics.supportBurden === "low" ? 1 : offer.economics.supportBurden === "medium" ? 0.7 : 0.4;
  const bandEase = offer.band === "ENTRY" ? 1 : offer.band === "GROWTH" ? 0.85 : 0.65;

  const components: FixabilityComponent[] = [
    { key: "evidence", value: clamp01(offer.confidence), weight: 0.22, note: `${offer.evidenceGrade} evidence, confidence ${offer.confidence.toFixed(2)}` },
    { key: "skuMatch", value: matchedSku ? 1 : 0, weight: 0.18, note: matchedSku ? `matched SKU ${matchedSku}` : "no SKU" },
    { key: "implementationCertainty", value: clamp01(1 - riskPenalty), weight: 0.15, note: `${offer.economics.deliveryRisk} delivery risk` },
    { key: "speed", value: clamp01(1 - offer.economics.estimatedHours / QUICK_FIX_HOUR_CEILING), weight: 0.15, note: `${offer.economics.estimatedHours}h of ${QUICK_FIX_HOUR_CEILING}h ceiling` },
    { key: "margin", value: clamp01(offer.economics.effectiveHourlyCents / 25000), weight: 0.15, note: `$${Math.round(offer.economics.effectiveHourlyCents / 100)}/hr` },
    { key: "purchaseSimplicity", value: clamp01(0.5 * bandEase + 0.5 * supportEase), weight: 0.15, note: `${offer.band} tier, ${offer.economics.supportBurden} support` },
  ];
  const score = Math.round(components.reduce((s, c) => s + c.value * c.weight, 0) * 100);

  return {
    state: "READY_TO_SELL",
    score,
    components,
    matchedSku,
    matchConfidence: clamp01(offer.confidence),
    readyToSell: true,
    reason: `ready to sell — ${offer.band} $${Math.round(offer.priceCents / 100)}, score ${score}`,
  };
}
