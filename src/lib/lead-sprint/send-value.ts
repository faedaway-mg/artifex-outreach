// ─────────────────────────────────────────────────────────────────────────────
// SEND VALUE SCORE (master mandate §4, track #183) — the single 0–100 ranking key for the qualified
// pool. It is a PURE, DETERMINISTIC composite of signals the free pipeline already computes at ZERO
// paid cost (targeting components + lead opportunity breakdown + pod focus). It never triggers a paid
// call and never invents a number: every point traces to an input, with a breakdown + reasons.
//
// Axes mirror the mandate's scoring vocabulary and preserve the persona thesis — DIGITAL PAIN (strong
// business, weak digital layer) is weighted heaviest, exactly as the canonical targeting model weights
// the digital-reputation gap. Send Value ranks WHO is most worth a (future, gated) send; Production
// Confidence (separate) decides whether we can cheaply build a clean package for them.
// ─────────────────────────────────────────────────────────────────────────────
import type { PodPriority } from "./pods";

export const SEND_VALUE_MODEL_VERSION = "v1-2026-09";

export interface SendValueInput {
  leadId: string;
  // ── canonical targeting components (targeting/scoring.ts ComponentScores, already computed, bounded) ──
  reputationStrength: number;   // 0..15  → business health
  digitalReputationGap: number; // 0..25  → digital pain (core thesis)
  decisionMakerAccess: number;  // 0..10  → reachability
  customerValue: number;        // 0..10  → economic fit
  marketFit: number;            // 0..10  → market
  // ── lead opportunity breakdown (scoring.ts ScoreBreakdown, already computed, bounded) ──
  websiteOpportunity: number;   // 0..20  → digital pain (blended)
  abilityToPay: number;         // 0..15  → economic fit
  contactability: number;       // 0..10  → reachability
  // ── pod focus (pods.ts) ──
  podPriority: PodPriority | "none";
}

export type SendValueBand = "HIGH" | "MEDIUM" | "LOW";

export interface SendValueBreakdown {
  market: number;         // 0..20
  businessHealth: number; // 0..20
  economicFit: number;    // 0..20
  digitalPain: number;    // 0..25 (heaviest — the persona thesis)
  reachability: number;   // 0..15
}

export interface SendValueScore {
  version: string;
  leadId: string;
  total: number;              // 0..100
  band: SendValueBand;
  breakdown: SendValueBreakdown;
  reasons: string[];
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round = (n: number) => Math.round(n * 100) / 100;

function podBonus(p: PodPriority | "none"): number {
  return p === "priority" ? 5 : p === "expansion" ? 2 : 0;
}

/** Compute the Send Value score. Pure + deterministic — no I/O, no paid calls. */
export function scoreSendValue(i: SendValueInput): SendValueScore {
  // Market (0..20): market fit scaled up, plus a small priority-pod focus bonus (§4 initial pods).
  const market = round(clamp((i.marketFit / 10) * 15 + podBonus(i.podPriority), 0, 20));

  // Business health (0..20): reputation strength (reviews × rating × engagement × history).
  const businessHealth = round(clamp((i.reputationStrength / 15) * 20, 0, 20));

  // Economic fit (0..20): ability-to-pay proxy + per-customer commercial value.
  const economicFit = round(clamp((i.abilityToPay / 15) * 10 + i.customerValue, 0, 20));

  // Digital pain (0..25, heaviest): the verified digital-reputation gap is primary; unanalyzed website
  // opportunity contributes a minority share so a not-yet-deep-analyzed lead still ranks on cheap signal.
  const digitalPain = round(clamp(i.digitalReputationGap * 0.7 + (i.websiteOpportunity / 20) * 25 * 0.3, 0, 25));

  // Reachability (0..15): contactable channels + decision-maker access, split evenly.
  const reachability = round(clamp((i.contactability / 10) * 7.5 + (i.decisionMakerAccess / 10) * 7.5, 0, 15));

  const breakdown: SendValueBreakdown = { market, businessHealth, economicFit, digitalPain, reachability };
  const total = round(clamp(market + businessHealth + economicFit + digitalPain + reachability, 0, 100));
  const band: SendValueBand = total >= 75 ? "HIGH" : total >= 55 ? "MEDIUM" : "LOW";

  const reasons = [
    `Digital pain ${digitalPain}/25 (verified gap ${i.digitalReputationGap}/25; site opportunity ${i.websiteOpportunity}/20).`,
    `Business health ${businessHealth}/20 (reputation ${i.reputationStrength}/15).`,
    `Economic fit ${economicFit}/20 (ability-to-pay ${i.abilityToPay}/15, customer value ${i.customerValue}/10).`,
    `Reachability ${reachability}/15 (contactability ${i.contactability}/10, decision-maker access ${i.decisionMakerAccess}/10).`,
    `Market ${market}/20 (fit ${i.marketFit}/10${i.podPriority !== "none" ? `, ${i.podPriority} pod +${podBonus(i.podPriority)}` : ""}).`,
  ];

  return { version: SEND_VALUE_MODEL_VERSION, leadId: i.leadId, total, band, breakdown, reasons };
}
