// ─────────────────────────────────────────────────────────────────────────────
// Email inventory reservoir — the supply layer behind an email-first funnel.
//
// SEND capacity (10/day, human-gated) and PREPARATION capacity are different things. The operator
// should almost never open Acquisition OS and find too few excellent prepared opportunities. So the
// machine keeps a healthy BAND of fully-prepared, qualified Reviews ready ahead of consumption —
// self-regulating, cost-bounded, and NEVER manufacturing garbage to hit a number (quality always
// overrides inventory size). This module is pure policy: given how many Reviews are prepared and the
// observed email-discovery yield, it says how much preparation to do THIS tick, or to throttle.
//
// "Prepared" here means the whole reservoir (send-ready today + held behind today's send cap), i.e.
// emailInventory().prepared. It is NOT a send quota — nothing auto-sends because inventory exists.
// ─────────────────────────────────────────────────────────────────────────────

export type ReservoirBand = "critical" | "low" | "healthy" | "enough";

/** Inventory band thresholds (counts of fully-prepared Reviews). A healthy band, not a hard quota. */
export interface ReservoirBands {
  /** Below this: CRITICAL — replenish aggressively (within cost bounds). */
  lowWater: number;
  /** At/above this: HEALTHY — stop spending on expensive preparation. */
  healthy: number;
  /** At/above this: ENOUGH — comfortably full; throttle hard. */
  full: number;
  /** Replenish TOWARD this level when below healthy (mid-band, avoids oscillation). */
  refillTo: number;
}

// Defaults follow the sprint's healthy band: 0–9 critical, 10–19 low, 20–30 healthy, 31+ enough.
export const DEFAULT_BANDS: ReservoirBands = { lowWater: 10, healthy: 20, full: 31, refillTo: 25 };

export function reservoirBand(prepared: number, bands: ReservoirBands = DEFAULT_BANDS): ReservoirBand {
  if (prepared >= bands.full) return "enough";
  if (prepared >= bands.healthy) return "healthy";
  if (prepared >= bands.lowWater) return "low";
  return "critical";
}

/** Operator-facing label — supply health, never implementation jargon. */
export function reservoirLabel(band: ReservoirBand): string {
  switch (band) {
    case "critical": return "Low — replenishing";
    case "low": return "Replenishing";
    case "healthy": return "Healthy";
    case "enough": return "Full";
  }
}

export interface PrepPlanInput {
  /** Reviews already prepared (the reservoir) = emailInventory().prepared. */
  prepared: number;
  /** Businesses still eligible for email harvesting (site + no email, not yet analyzed). */
  eligible: number;
  /** Observed fraction of examined businesses that yield a valid usable email (0..1). */
  yieldRate: number;
  /** Hard ceiling on candidates examined per tick (safety backstop). */
  hardCap: number;
  /** Cost budget: max candidates we can afford to examine this tick (from $ / cost-per-examine). */
  costCap: number;
  bands?: ReservoirBands;
}

export interface PrepPlan {
  /** How many candidates to examine (run website analysis on) this tick. 0 = throttle. */
  examine: number;
  band: ReservoirBand;
  /** Reviews still needed to reach refillTo (0 when healthy+). */
  reviewsNeeded: number;
  /** Why this plan — for the audit trail / operator transparency. */
  reason: string;
}

/**
 * Reservoir-aware preparation plan. When the reservoir is at/above HEALTHY we stop spending on
 * expensive prep (throttle). Below it, we size the examine count from the REVIEW gap and the
 * observed yield — because if only, say, 40% of examined businesses produce a usable email, filling
 * 10 review slots requires examining ~25 — then bound it by eligible supply, the per-tick hard cap,
 * and the cost budget. This never fabricates work: it only examines genuinely-eligible businesses,
 * and quality gates downstream still decide what becomes a Review.
 */
export function planPreparation(input: PrepPlanInput): PrepPlan {
  const bands = input.bands ?? DEFAULT_BANDS;
  const band = reservoirBand(input.prepared, bands);
  if (input.prepared >= bands.healthy) {
    return { examine: 0, band, reviewsNeeded: 0, reason: `reservoir ${band} (${input.prepared} prepared ≥ ${bands.healthy}) — throttling prep` };
  }
  const reviewsNeeded = Math.max(0, bands.refillTo - input.prepared);
  const yieldRate = Math.min(1, Math.max(0.01, input.yieldRate)); // guard divide-by-zero / nonsense
  const wantExamine = Math.ceil(reviewsNeeded / yieldRate);
  const examine = Math.max(0, Math.min(wantExamine, input.eligible, input.hardCap, input.costCap));
  const bounded =
    examine === input.costCap && input.costCap < wantExamine ? "cost-bounded"
    : examine === input.hardCap && input.hardCap < wantExamine ? "hard-cap-bounded"
    : examine === input.eligible && input.eligible < wantExamine ? "supply-bounded (few eligible)"
    : "yield-sized";
  return {
    examine, band, reviewsNeeded,
    reason: `reservoir ${band} (${input.prepared} prepared); need ${reviewsNeeded} → examine ${examine} at ${Math.round(yieldRate * 100)}% yield [${bounded}]`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Observed email-discovery yield — measured, not assumed. Derived from accumulated prep
// summaries (examined vs. produced-a-valid-email). Used to size preparation honestly.
// ─────────────────────────────────────────────────────────────────────────────
export interface YieldSample { examined: number; adoptedEmail: number }

/** Blend prep samples into a single yield rate, with a conservative prior so a tiny sample (or none)
 *  doesn't wildly over/under-size prep. Prior = `priorRate` weighted as `priorWeight` pseudo-examines. */
export function observedYield(samples: YieldSample[], priorRate = 0.4, priorWeight = 10): number {
  let examined = priorWeight, adopted = priorRate * priorWeight;
  for (const s of samples) { examined += Math.max(0, s.examined); adopted += Math.max(0, s.adoptedEmail); }
  if (examined <= 0) return priorRate;
  return Math.min(1, Math.max(0, adopted / examined));
}
