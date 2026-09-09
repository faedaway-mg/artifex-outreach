// ─────────────────────────────────────────────────────────────────────────────
// DISCOVERY OBJECTIVE — a configurable QUALIFIED-inventory target. When qualified,
// sendable inventory is below target, we EXPAND DISCOVERY BREADTH — we NEVER lower
// the qualification bar (PRINCIPLE 1). Discovery breadth is elastic; qualification
// thresholds are fixed. This is a DISCOVERY/inventory objective, NOT authorization
// to send: filling the target never changes sender caps or opens the send gate.
//
// It reuses the existing attrition math (acquisition/refill overallYield) to size
// how many businesses to inspect to NET the shortfall — inspect enough until N meet
// the bar, never "take the best N available".
// ─────────────────────────────────────────────────────────────────────────────
import { overallYield, PRIOR_RATES, type ConversionRates } from "../acquisition/refill";

/** Planning goal: genuinely-sendable opportunities to hold (≈40 = 2 mailboxes × 20/day of DISCOVERY). */
export const DEFAULT_QUALIFIED_INVENTORY_TARGET = 40;

export interface DiscoveryObjective {
  target: number;
  qualifiedOnHand: number; // current high-confidence sendable inventory (post strict funnel)
  shortfall: number;
  /** Expand discovery this cycle? Only when short AND budget/universe remain. */
  expand: boolean;
  /** Businesses to DISCOVER to net the shortfall (attrition-adjusted), capped by budget. */
  discoverTarget: number;
  /** Invariant marker: sizing changes discovery breadth, never the qualification bar. */
  thresholdsUnchanged: true;
  /** Filling the target does NOT authorize sending — caps/approvals/freeze still apply. */
  impliesSendAuthorization: false;
  reason: string;
}

/**
 * Size discovery to reach the qualified-inventory target. Pure + deterministic. If
 * fewer businesses qualify than the target, the answer is ALWAYS "discover more",
 * never "relax a gate". Bounded by a discovery budget and by the universe (a cycle
 * that adds nothing stops — see discoveryShouldStop).
 */
export function planDiscovery(qualifiedOnHand: number, target = DEFAULT_QUALIFIED_INVENTORY_TARGET, rates: ConversionRates = PRIOR_RATES, budgetRemaining = Infinity): DiscoveryObjective {
  const shortfall = Math.max(0, target - qualifiedOnHand);
  const y = overallYield(rates);
  const raw = shortfall > 0 ? Math.ceil(shortfall / y) : 0;
  const cap = budgetRemaining === Infinity ? raw : Math.max(0, Math.floor(budgetRemaining));
  const discoverTarget = Math.min(raw, cap);
  const expand = shortfall > 0 && discoverTarget > 0;
  return {
    target, qualifiedOnHand, shortfall, expand, discoverTarget,
    thresholdsUnchanged: true, impliesSendAuthorization: false,
    reason: shortfall === 0
      ? `qualified inventory ${qualifiedOnHand}/${target} — at target, no expansion`
      : `qualified inventory ${qualifiedOnHand}/${target} — expand discovery by ~${discoverTarget} at ${(y * 100).toFixed(1)}% yield (bar unchanged)`,
  };
}

/** Stop the discovery-expansion loop: target reached, budget exhausted, or universe dry. */
export function discoveryShouldStop(qualifiedOnHand: number, target: number, budgetRemaining: number, lastCycleAdded: number): { stop: boolean; why: string } {
  if (qualifiedOnHand >= target) return { stop: true, why: "qualified-inventory target reached" };
  if (budgetRemaining <= 0) return { stop: true, why: "discovery budget reached" };
  if (lastCycleAdded === 0) return { stop: true, why: "market universe exhausted for this rotation" };
  return { stop: false, why: "continue expanding discovery (bar unchanged)" };
}
