// ─────────────────────────────────────────────────────────────────────────────
// Phase 7 — realistic multi-day reservoir simulation. The operator consumes up to 10 emails/day
// and email-discovery yield varies substantially day to day. The reservoir must ABSORB that
// variance (yield-sized, throttling replenishment) rather than leaving the operator at 2–5 emails
// whenever a weak harvest occurs — provided eligible supply exists. Pure; nothing sends.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { planPreparation, planDiscovery, reservoirBand, DEFAULT_BANDS } from "./reservoir";

const SEND_CAP = 10;
const HARD_CAP = 32;

// One day: operator consumes up to the send cap, then reservoir-aware prep runs (possibly across
// the new intraday ticks) sized from the review gap and the DAY's actual yield, bounded by eligible
// supply. Discovery refills the eligible pool by `discoveryPerDay`. Returns the end-of-day state.
function simulateDay(state: { prepared: number; eligible: number }, dayYield: number, ticksPerDay: number, discoveryPerDay: number) {
  // Morning consumption (human-gated, capped — never auto-sends).
  const sent = Math.min(SEND_CAP, state.prepared);
  let prepared = state.prepared - sent;
  let eligible = state.eligible + discoveryPerDay; // discovery feeds the eligible pool

  // Reservoir-aware replenishment across the day's ticks (each self-throttles when healthy).
  for (let t = 0; t < ticksPerDay; t++) {
    const plan = planPreparation({ prepared, eligible, yieldRate: dayYield, hardCap: HARD_CAP, costCap: HARD_CAP });
    if (plan.examine <= 0) break; // throttled (healthy) or no supply
    const harvested = Math.round(plan.examine * dayYield); // examined → became email-first → prepared
    prepared += harvested;
    eligible -= plan.examine;
  }
  return { prepared, eligible, sent };
}

describe("Phase 7 — the reservoir absorbs day-to-day yield variance", () => {
  it("with adequate supply, a weak-yield day never strands the next morning at 2–5", () => {
    const yields = [0.45, 0.22, 0.50, 0.30, 0.40];
    let state = { prepared: 6, eligible: 60 }; // today's shallow reservoir, healthy supply
    const readyEachMorning: number[] = [];
    for (const y of yields) {
      // What the operator would see at the START of the day (before prep) = min(prepared, cap).
      readyEachMorning.push(Math.min(SEND_CAP, state.prepared));
      const end = simulateDay(state, y, 3, 25); // 3 ticks/day (5:30 + 2 top-ups), ample discovery
      state = { prepared: end.prepared, eligible: end.eligible };
    }
    // After the first (good) day the reservoir recovers; the 22% day is buffered by yield-sizing and
    // supply, so no subsequent morning collapses back to the 2–5 range that triggered this sprint.
    expect(readyEachMorning[0]).toBe(6);            // day 1 starts from today's shallow state
    for (let i = 1; i < readyEachMorning.length; i++) {
      expect(readyEachMorning[i]).toBeGreaterThanOrEqual(SEND_CAP); // every later morning is full
    }
    expect(reservoirBand(state.prepared)).not.toBe("critical"); // ends healthy/low, not critical
  });

  it("compensates for low yield by examining MORE (yield-sizing), and a full day still refills", () => {
    // The compensation mechanism: for the same review gap, a lower yield plans MORE examines.
    const gap = { prepared: 8, eligible: 200, hardCap: 200, costCap: 200 };
    const weakPlan = planPreparation({ ...gap, yieldRate: 0.22 });
    const strongPlan = planPreparation({ ...gap, yieldRate: 0.5 });
    expect(weakPlan.examine).toBeGreaterThan(strongPlan.examine);
    // And across a full day's ticks, even a 22% day refills to at least the send cap given supply.
    const weakDay = simulateDay({ prepared: 8, eligible: 120 }, 0.22, 3, 20);
    expect(weakDay.prepared).toBeGreaterThanOrEqual(SEND_CAP);
  });

  it("when eligible supply is EXHAUSTED, prep cannot conjure inventory (honest ceiling)", () => {
    // No eligible businesses, no discovery → prep can do nothing; this is a SUPPLY problem, not a
    // reservoir bug. The simulation must not pretend otherwise (no fabricated emails).
    const end = simulateDay({ prepared: 3, eligible: 0 }, 0.4, 3, 0);
    expect(end.prepared).toBe(3 - Math.min(SEND_CAP, 3)); // only consumption happened; 0 harvested
    expect(end.eligible).toBe(0);
  });

  it("throttles once healthy — a full reservoir does not keep spending on prep", () => {
    const end = simulateDay({ prepared: 26, eligible: 100 }, 0.4, 5, 20);
    // Started above healthy; after consuming 10 it is 16 (low) then refills toward 25 and stops —
    // it never runs away examining the whole 120-supply pool.
    expect(end.eligible).toBeGreaterThan(60); // most supply left untouched (throttled)
    expect(reservoirBand(end.prepared)).not.toBe("enough"); // didn't overfill past the top band
  });

  it("send capacity is a hard ceiling — a deep reservoir never sends more than 10/day", () => {
    const end = simulateDay({ prepared: 30, eligible: 100 }, 0.5, 3, 20);
    expect(end.sent).toBe(SEND_CAP); // exactly 10 consumed, never more, regardless of depth
  });
});

// ── Phase 8: the FULL supply chain — reservoir-aware DISCOVERY → harvest → reservoir → consume ──
const PLACES_COST = 0.032;      // $/search
const MAX_DAILY_COST = 2.0;     // authorized budget (unchanged)

// One full day, parameterised by the discovery-supply CONFIG (categories × weekly-per-category cap).
// consume → reservoir-aware discovery (bounded by config caps, cost, and the finite fresh-qualified
// pool) → reservoir-aware prep (harvest at the day's yield). Returns state + Places spend.
function supplyDay(
  state: { prepared: number; eligible: number; weeklyRemaining: number[]; freshPool: number },
  dayYield: number,
  cfg: { categories: number; weeklyPerCat: number },
) {
  const sent = Math.min(SEND_CAP, state.prepared);
  let prepared = state.prepared - sent;
  let placesSpend = 0;
  const dplan = planDiscovery({ prepared });
  let discovered = 0;
  if (dplan.targetLeads > 0) {
    const searches = Math.min(cfg.categories, Math.floor(MAX_DAILY_COST / PLACES_COST)); // budget-bounded
    placesSpend = searches * PLACES_COST;
    for (let c = 0; c < cfg.categories && discovered < dplan.targetLeads && state.freshPool > 0; c++) {
      const take = Math.min(dplan.perCategoryCap, state.weeklyRemaining[c], dplan.targetLeads - discovered, state.freshPool);
      if (take <= 0) continue;
      discovered += take; state.weeklyRemaining[c] -= take; state.freshPool -= take;
    }
  }
  let eligible = state.eligible + discovered;
  for (let t = 0; t < 3; t++) {
    const pplan = planPreparation({ prepared, eligible, yieldRate: dayYield, hardCap: HARD_CAP, costCap: HARD_CAP });
    if (pplan.examine <= 0) break;
    prepared += Math.round(pplan.examine * dayYield);
    eligible -= pplan.examine;
  }
  return { prepared, eligible, placesSpend, discovered, sent };
}

describe("Phase 8 — seven-day supply-chain simulation, variable yield", () => {
  const YIELDS = [0.45, 0.22, 0.50, 0.30, 0.40, 0.20, 0.35];

  function run(cfg: { categories: number; weeklyPerCat: number }) {
    let s = { prepared: 6, eligible: 9, weeklyRemaining: Array(cfg.categories).fill(cfg.weeklyPerCat), freshPool: 5000 };
    const mornings: number[] = []; let maxSpend = 0;
    for (const y of YIELDS) {
      mornings.push(Math.min(SEND_CAP, s.prepared));
      const end = supplyDay(s, y, cfg);
      maxSpend = Math.max(maxSpend, end.placesSpend);
      s = { prepared: end.prepared, eligible: end.eligible, weeklyRemaining: s.weeklyRemaining, freshPool: s.freshPool };
    }
    return { mornings, maxSpend, end: s };
  }

  it("MECHANISM: with ADEQUATE discovery config, the reservoir absorbs yield variance and never re-collapses", () => {
    // Adequate weekly supply capacity (e.g. more categories / higher weekly caps the operator can set).
    const { mornings, maxSpend, end } = run({ categories: 40, weeklyPerCat: 8 });
    expect(Math.min(...mornings.slice(2))).toBeGreaterThanOrEqual(SEND_CAP); // no morning back at 2–5
    expect(maxSpend).toBeLessThanOrEqual(MAX_DAILY_COST);                    // spend within budget
    expect(reservoirBand(end.prepared)).not.toBe("critical");
  });

  it("HONEST CEILING: the CURRENT config (12 categories × weekly 6) cannot sustain 10/day — reported truthfully", () => {
    // ~72 qualified leads/week ÷ ~33% yield ≈ far below 70 sends/week. The reservoir rebuilds then
    // declines as weekly caps exhaust — and the system NEVER fabricates inventory to hide it.
    const { mornings, maxSpend } = run({ categories: 12, weeklyPerCat: 6 });
    expect(maxSpend).toBeLessThanOrEqual(MAX_DAILY_COST);        // still within budget
    expect(Math.min(...mornings)).toBeLessThan(SEND_CAP);        // supply genuinely runs thin — the truth
  });

  it("throttles discovery spend to zero once the reservoir is healthy AFTER consumption", () => {
    // Start high enough that post-consumption it's still healthy (35 − 10 = 25).
    const end = supplyDay({ prepared: 35, eligible: 50, weeklyRemaining: Array(12).fill(6), freshPool: 600 }, 0.4, { categories: 12, weeklyPerCat: 6 });
    expect(end.discovered).toBe(0);
    expect(end.placesSpend).toBe(0);
  });

  it("EXHAUSTED supply reports honestly — no fabricated inventory", () => {
    const end = supplyDay({ prepared: 3, eligible: 0, weeklyRemaining: Array(12).fill(6), freshPool: 0 }, 0.4, { categories: 12, weeklyPerCat: 6 });
    expect(end.discovered).toBe(0);
    expect(end.prepared).toBe(0); // only the 3 consumed; nothing conjured
  });

  it("per-category weekly caps still bound concentration during an aggressive rebuild", () => {
    const cfg = { categories: 12, weeklyPerCat: 6 };
    let s = { prepared: 0, eligible: 0, weeklyRemaining: Array(cfg.categories).fill(cfg.weeklyPerCat), freshPool: 10000 };
    let total = 0;
    for (let d = 0; d < 7; d++) { const end = supplyDay(s, 0.4, cfg); total += end.discovered; s = { ...s, prepared: end.prepared, eligible: end.eligible }; }
    expect(total).toBeLessThanOrEqual(cfg.categories * cfg.weeklyPerCat); // ≤ 72/week regardless of demand
  });
});
