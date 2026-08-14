// ─────────────────────────────────────────────────────────────────────────────
// Phase 7 — realistic multi-day reservoir simulation. The operator consumes up to 10 emails/day
// and email-discovery yield varies substantially day to day. The reservoir must ABSORB that
// variance (yield-sized, throttling replenishment) rather than leaving the operator at 2–5 emails
// whenever a weak harvest occurs — provided eligible supply exists. Pure; nothing sends.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { planPreparation, reservoirBand, DEFAULT_BANDS } from "./reservoir";

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
