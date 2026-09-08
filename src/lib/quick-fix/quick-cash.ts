// ─────────────────────────────────────────────────────────────────────────────
// QUICK-CASH QUEUE — rank existing leads by how easily they convert to side
// revenue. Optimizes for EXPECTED CONVERSION × MARGIN × DELIVERY EFFICIENCY, not
// price. A $250 that sells and ships today beats a $995 that drags.
// ─────────────────────────────────────────────────────────────────────────────
import type { QuickFixOffer } from "./types";
import { assessFixability, type FixabilityState } from "./fixability";
import { skuFor } from "./catalog";
import { buildRequirements } from "./requirements";

export interface QuickCashRow {
  leadId: string;
  company: string;
  eligible: boolean;
  band: QuickFixOffer["band"] | null;
  priceCents: number;
  problem: string; // the concrete broken thing
  offerName: string;
  matchedSku: string | null;
  sla: string;
  requiredAccess: string[];
  estimatedHours: number;
  effectiveHourlyCents: number;
  confidence: number;
  matchConfidence: number;
  maintenanceMonthlyCents: number | null;
  /** 0..100 Fixability Score. Higher = closer to a transaction. */
  score: number;
  fixabilityState: FixabilityState;
  readyToSell: boolean;
  reason: string;
}

const BAND_EASE = { ENTRY: 1.0, GROWTH: 0.85, MINI: 0.65 } as const;

/**
 * Opportunity score (0..100). Rewards confidence, high effective hourly, low
 * effort, and small tiers (faster to sell + ship). Ineligible offers score 0.
 */
export function scoreQuickCash(offer: QuickFixOffer): number {
  if (!offer.quickFixEligible) return 0;
  const confidence = Math.max(0, Math.min(1, offer.confidence)); // 0..1
  // Effective hourly, normalized against a $250/hr aspiration, capped at 1.
  const hourly = Math.max(0, Math.min(1, offer.economics.effectiveHourlyCents / 25000));
  // Effort ease: fewer hours = better (10h → 0, 1h → ~0.9).
  const effort = Math.max(0, Math.min(1, 1 - offer.economics.estimatedHours / 12));
  const ease = BAND_EASE[offer.band];
  const support = offer.economics.supportBurden === "low" ? 1 : offer.economics.supportBurden === "medium" ? 0.7 : 0.4;

  const raw = 0.35 * confidence + 0.3 * hourly + 0.15 * effort + 0.1 * ease + 0.1 * support;
  return Math.round(raw * 100);
}

export function toQuickCashRow(offer: QuickFixOffer): QuickCashRow {
  const eligible = offer.quickFixEligible;
  const fix = assessFixability(offer);
  const sku = offer.capabilityKeys[0] ? skuFor(offer.capabilityKeys[0]) : null;
  const requiredAccess = eligible ? buildRequirements(offer).items.filter((i) => i.necessity === "REQUIRED_BEFORE_START").map((i) => i.key) : [];
  return {
    leadId: offer.leadId,
    company: offer.companyName,
    eligible,
    band: eligible ? offer.band : null,
    priceCents: eligible ? offer.priceCents : 0,
    problem: offer.scope.problemBeingSolved || offer.notEligibleReason || "",
    offerName: offer.scope.offerName,
    matchedSku: fix.matchedSku,
    sla: sku?.slaLabel ?? "",
    requiredAccess,
    estimatedHours: offer.economics.estimatedHours,
    effectiveHourlyCents: offer.economics.effectiveHourlyCents,
    confidence: offer.confidence,
    matchConfidence: fix.matchConfidence,
    maintenanceMonthlyCents: offer.maintenance?.monthlyCents ?? null,
    score: fix.score, // Fixability Score (0 when not READY_TO_SELL)
    fixabilityState: fix.state,
    readyToSell: fix.readyToSell,
    reason: fix.reason,
  };
}

/**
 * Rank the quick-cash queue by TRANSACTION QUALITY (Fixability Score), not
 * abstract lead value — a ready-to-sell $250 fix can outrank a vague big project.
 */
export function rankQuickCash(offers: QuickFixOffer[]): QuickCashRow[] {
  return offers
    .map(toQuickCashRow)
    .sort((a, b) => Number(b.readyToSell) - Number(a.readyToSell) || b.score - a.score || b.effectiveHourlyCents - a.effectiveHourlyCents);
}

export interface AddressableTotals {
  entry: { count: number; revenueCents: number };
  growth: { count: number; revenueCents: number };
  mini: { count: number; revenueCents: number };
  eligibleTotalCents: number;
  eligibleCount: number;
  ineligibleCount: number;
}

/** Sum immediately-addressable low-ticket opportunity across a set of offers. */
export function addressableTotals(offers: QuickFixOffer[]): AddressableTotals {
  const t: AddressableTotals = {
    entry: { count: 0, revenueCents: 0 },
    growth: { count: 0, revenueCents: 0 },
    mini: { count: 0, revenueCents: 0 },
    eligibleTotalCents: 0,
    eligibleCount: 0,
    ineligibleCount: 0,
  };
  for (const o of offers) {
    if (!o.quickFixEligible) {
      t.ineligibleCount += 1;
      continue;
    }
    t.eligibleCount += 1;
    t.eligibleTotalCents += o.priceCents;
    const bucket = o.band === "ENTRY" ? t.entry : o.band === "GROWTH" ? t.growth : t.mini;
    bucket.count += 1;
    bucket.revenueCents += o.priceCents;
  }
  return t;
}
