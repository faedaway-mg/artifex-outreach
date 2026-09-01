// Acquisition OS — ROLLING READY-RESERVE refill policy (nationwide-refill mandate, §1–§3, §7).
//
// Keep enough fully-qualified DELIVERY_READY inventory on hand to feed the authorized 20/day capacity, with
// a healthy forward buffer. This module is pure policy: given the measured reserve and the observed funnel
// conversion, it decides whether to refill, how big the shortfall is, and — accounting for attrition — how
// many businesses must be DISCOVERED to replenish. It never discovers, enriches, or sends; the cron loop
// drives the real stages (existing runProspecting / enrichment / evidence / review / recipient) and calls
// back here to size and report. Deterministic + testable.

import type { FunnelCounts, RejectReason } from "./delivery-ready";
import { GLOBAL_DAILY_CAP } from "./daily-cap";

export interface RefillPolicy {
  targetReserve: number;   // 60 — the rolling ready reserve we aim to hold
  refillThreshold: number; // 40 — refill kicks in when ready inventory drops below this
  dailyTarget: number;     // 20 — scheduled per sending day
  dailyCap: number;        // 20 — absolute shared daily cap (never exceeded)
  minForwardDays: number;  // 3 — minimum weekdays of coverage to keep when inventory permits
}

export const DEFAULT_REFILL_POLICY: RefillPolicy = {
  targetReserve: 60, refillThreshold: 40, dailyTarget: 20, dailyCap: GLOBAL_DAILY_CAP, minForwardDays: 3,
};

export interface ReserveState {
  ready: number;               // current DELIVERY_READY count
  target: number;              // policy target (60)
  threshold: number;           // refill threshold (40)
  shortfallToTarget: number;   // max(0, target - ready)
  belowThreshold: boolean;     // ready < threshold → refill required
  forwardDays: number;         // whole weekdays of 20/day coverage the reserve currently provides
  meetsForwardMin: boolean;    // forwardDays >= policy.minForwardDays
}

export function assessReserve(ready: number, policy: RefillPolicy = DEFAULT_REFILL_POLICY): ReserveState {
  const shortfallToTarget = Math.max(0, policy.targetReserve - ready);
  return {
    ready,
    target: policy.targetReserve,
    threshold: policy.refillThreshold,
    shortfallToTarget,
    belowThreshold: ready < policy.refillThreshold,
    forwardDays: Math.floor(ready / Math.max(1, policy.dailyTarget)),
    meetsForwardMin: Math.floor(ready / Math.max(1, policy.dailyTarget)) >= policy.minForwardDays,
  };
}

// Stage-to-stage conversion rates observed from the funnel — used to back-calculate how many businesses
// must be DISCOVERED to net one DELIVERY_READY lead. Priors keep sizing sane before real data accrues.
export interface ConversionRates {
  websiteValid: number;      // discovered → valid website
  serviceFit: number;        // websiteValid → service fit
  evidence: number;          // serviceFit → directly-observed finding
  recipient: number;         // evidence → recipient resolved
  reviewApproved: number;    // recipient → approved sendable review
  deliveryReady: number;     // reviewApproved → fully delivery-ready
}

// Conservative priors (a business rarely becomes fully delivery-ready — most attrit at evidence/recipient).
export const PRIOR_RATES: ConversionRates = {
  websiteValid: 0.7, serviceFit: 0.6, evidence: 0.45, recipient: 0.55, reviewApproved: 0.8, deliveryReady: 0.9,
};

// Overall discovered → delivery-ready yield (product of the stage rates), floored so we never divide by ~0.
export function overallYield(rates: ConversionRates): number {
  const y = rates.websiteValid * rates.serviceFit * rates.evidence * rates.recipient * rates.reviewApproved * rates.deliveryReady;
  return Math.max(0.01, y);
}

// Blend observed funnel counts with the priors (Bayesian-ish shrinkage) so early, tiny samples don't wildly
// mis-size discovery. Each rate = (observed_success + prior*weight) / (observed_trials + weight).
export function blendRates(funnel: FunnelCounts | null, priorWeight = 20): ConversionRates {
  if (!funnel || funnel.discovered === 0) return PRIOR_RATES;
  const r = (succ: number, trials: number, prior: number) => (succ + prior * priorWeight) / (Math.max(0, trials) + priorWeight);
  return {
    websiteValid: r(funnel.websiteValid, funnel.discovered, PRIOR_RATES.websiteValid),
    serviceFit: r(funnel.serviceFit, funnel.websiteValid, PRIOR_RATES.serviceFit),
    evidence: r(funnel.evidenceSupported, funnel.serviceFit, PRIOR_RATES.evidence),
    recipient: r(funnel.recipientResolved, funnel.evidenceSupported, PRIOR_RATES.recipient),
    reviewApproved: r(funnel.reviewApproved, funnel.recipientResolved, PRIOR_RATES.reviewApproved),
    deliveryReady: r(funnel.deliveryReady, funnel.reviewApproved, PRIOR_RATES.deliveryReady),
  };
}

export interface RefillPlan {
  needed: boolean;             // should we refill this cycle?
  shortfall: number;           // ready leads still needed to reach the target
  yield: number;               // discovered → delivery-ready overall yield used
  discoverTarget: number;      // businesses to discover to net the shortfall (attrition-adjusted)
  reason: string;
}

// Decide whether to refill and how many businesses to discover to net the shortfall to target (§2/§3).
export function planRefill(reserve: ReserveState, rates: ConversionRates = PRIOR_RATES, policy: RefillPolicy = DEFAULT_REFILL_POLICY): RefillPlan {
  const needed = reserve.belowThreshold || reserve.shortfallToTarget > 0;
  const y = overallYield(rates);
  const discoverTarget = needed ? Math.ceil(reserve.shortfallToTarget / y) : 0;
  return {
    needed,
    shortfall: reserve.shortfallToTarget,
    yield: +y.toFixed(4),
    discoverTarget,
    reason: needed
      ? `reserve ${reserve.ready}/${policy.targetReserve} (${reserve.belowThreshold ? "below" : "at/above"} threshold ${policy.refillThreshold}); need ${reserve.shortfallToTarget} ready → discover ~${discoverTarget} at ${(y * 100).toFixed(1)}% yield`
      : `reserve ${reserve.ready}/${policy.targetReserve} — at target, no refill`,
  };
}

// Persisted checkpoint so a refill loop resumes where it left off (geographic rotation offset, budget spent,
// cumulative funnel). Stored on Settings (jsonb) — no migration.
export interface RefillCheckpoint {
  updatedAt: string;
  rotationOffset: number;      // where the geographic rotation resumes
  searchBudgetSpent: number;   // businesses examined so far this campaign
  searchBudgetLimit: number;   // configured ceiling for the campaign
  lastFunnel: FunnelCounts | null;
  lastReserveReady: number;
  lastRefillAt: string | null;
}

export function emptyCheckpoint(searchBudgetLimit = 2000): RefillCheckpoint {
  return { updatedAt: "", rotationOffset: 0, searchBudgetSpent: 0, searchBudgetLimit, lastFunnel: null, lastReserveReady: 0, lastRefillAt: null };
}

// Stop conditions for the cron loop (§2.10): reserve reached, budget exhausted, or no candidates left.
export function refillShouldStop(reserve: ReserveState, checkpoint: RefillCheckpoint, lastCycleAdded: number): { stop: boolean; why: string } {
  if (!reserve.belowThreshold && reserve.shortfallToTarget === 0) return { stop: true, why: "reserve reached target" };
  if (checkpoint.searchBudgetSpent >= checkpoint.searchBudgetLimit) return { stop: true, why: "search budget reached" };
  if (lastCycleAdded === 0) return { stop: true, why: "no more qualified candidates in this rotation" };
  return { stop: false, why: "continue" };
}

// ── Owner visibility (§7) ───────────────────────────────────────────────────────
export interface RefillVisibility {
  readyReserve: string;              // "current / 60"
  refillStatus: string;              // idle | refilling | at-target
  nextLocations: string[];           // next geographic segments to search
  expectedCoverageDays: number;      // forward weekdays of coverage
  tomorrowScheduled: string;         // "n / 20"
  evidenceShortfall: number;         // candidates blocked at evidence
  recipientShortfall: number;        // candidates blocked at recipient resolution
  rejectionReasons: Record<RejectReason, number>;
  funnelConversion: number;          // overall discovered → ready yield (0..1)
  lastRefillAt: string | null;
  nextRefillCheckpoint: string;      // when/where the next refill resumes
}

export function buildVisibility(input: {
  reserve: ReserveState;
  plan: RefillPlan;
  funnel: FunnelCounts | null;
  tomorrowScheduled: number;
  nextLocations: string[];
  checkpoint: RefillCheckpoint;
  policy?: RefillPolicy;
}): RefillVisibility {
  const policy = input.policy ?? DEFAULT_REFILL_POLICY;
  const rejects = input.funnel?.rejectedByReason ?? ({} as Record<RejectReason, number>);
  const status = input.reserve.shortfallToTarget === 0 ? "at-target" : input.plan.needed ? "refilling" : "idle";
  return {
    readyReserve: `${input.reserve.ready} / ${policy.targetReserve}`,
    refillStatus: status,
    nextLocations: input.nextLocations,
    expectedCoverageDays: input.reserve.forwardDays,
    tomorrowScheduled: `${input.tomorrowScheduled} / ${policy.dailyTarget}`,
    evidenceShortfall: rejects.no_observed_finding ?? 0,
    recipientShortfall: rejects.no_recipient ?? 0,
    rejectionReasons: rejects,
    funnelConversion: input.plan.yield,
    lastRefillAt: input.checkpoint.lastRefillAt,
    nextRefillCheckpoint: `rotationOffset ${input.checkpoint.rotationOffset}, budget ${input.checkpoint.searchBudgetSpent}/${input.checkpoint.searchBudgetLimit}`,
  };
}
