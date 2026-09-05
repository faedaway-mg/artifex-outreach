import { describe, it, expect } from "vitest";
import { allocateDailyCap } from "./daily-allocation";

const alloc = (firstDemand: number, followDemand: number, sentFirstToday = 0, sentFollowToday = 0) =>
  allocateDailyCap({ firstDemand, followDemand, sentFirstToday, sentFollowToday });

describe("allocateDailyCap — 10/10 reserve with cross-transfer, cap 20 (mandate 1)", () => {
  it("8 first + 28 follow → 8 initial + 12 follow-ups", () => {
    const a = alloc(8, 28);
    expect(a.firstTarget).toBe(8);
    expect(a.followTarget).toBe(12);
    expect(a.firstSendNow).toBe(8);
    expect(a.followSendNow).toBe(12);
    expect(a.firstSendNow + a.followSendNow).toBeLessThanOrEqual(20);
  });

  it("15 first + 28 follow → 10 initial + 10 follow-ups", () => {
    const a = alloc(15, 28);
    expect(a.firstTarget).toBe(10);
    expect(a.followTarget).toBe(10);
  });

  it("20 first + 0 follow → 20 initial", () => {
    const a = alloc(20, 0);
    expect(a.firstTarget).toBe(20);
    expect(a.followTarget).toBe(0);
  });

  it("0 first + 28 follow → 20 follow-ups", () => {
    const a = alloc(0, 28);
    expect(a.firstTarget).toBe(0);
    expect(a.followTarget).toBe(20);
  });

  it("never exceeds the cap and subtracts already-sent per group", () => {
    const a = alloc(20, 20, 6, 4); // 10 already sent today (6 first, 4 follow)
    expect(a.firstSendNow + a.followSendNow).toBeLessThanOrEqual(a.remainingTotal);
    expect(a.remainingTotal).toBe(10);
    expect(a.firstSendNow + a.followSendNow).toBeLessThanOrEqual(10);
  });

  it("low mutual demand is never padded to the reserve", () => {
    const a = alloc(3, 4);
    expect(a.firstTarget).toBe(3);
    expect(a.followTarget).toBe(4);
  });
});

// ── Mandate 14: starvation-proof two-lane guarantees (pure allocator layer) ──────────────────────────
describe("allocateDailyCap — starvation-proof lanes (mandate 14)", () => {
  it("(1) 20 due follow + 10 due first → first-touch NOT starved (keeps its full 10 reserve)", () => {
    const a = alloc(10, 20);
    expect(a.firstTarget).toBe(10);
    expect(a.followTarget).toBe(10);
    expect(a.borrowedByFollow).toBe(0); // follow cannot take first's reserve while first has demand
  });
  it("(2) 20 due first + 10 due follow → follow-up NOT starved (keeps its full 10 reserve)", () => {
    const a = alloc(20, 10);
    expect(a.followTarget).toBe(10);
    expect(a.firstTarget).toBe(10);
    expect(a.borrowedByFirst).toBe(0);
  });
  it("(3) a 10/10 eligible backlog selects EXACTLY 20", () => {
    const a = alloc(10, 10);
    expect(a.firstTarget).toBe(10);
    expect(a.followTarget).toBe(10);
    expect(a.firstTarget + a.followTarget).toBe(20);
  });
  it("(4) unused first-touch capacity CAN be borrowed by follow-ups", () => {
    const a = alloc(3, 20);
    expect(a.firstTarget).toBe(3);
    expect(a.followTarget).toBe(17);
    expect(a.borrowedByFollow).toBe(7);
  });
  it("(5) unused follow-up capacity CAN be borrowed by first-touches", () => {
    const a = alloc(20, 3);
    expect(a.firstTarget).toBe(17);
    expect(a.followTarget).toBe(3);
    expect(a.borrowedByFirst).toBe(7);
  });
  it("(6) borrowing does NOT happen while eligible reserved-lane work remains", () => {
    const a = alloc(10, 20); // first has a full reserve of demand → follow may not borrow it
    expect(a.borrowedByFollow).toBe(0);
    expect(a.followTarget).toBe(10);
  });
  it("(12) re-running the allocator is deterministic (idempotent decisions)", () => {
    const input = { firstDemand: 13, followDemand: 18, sentFirstToday: 2, sentFollowToday: 5 };
    expect(allocateDailyCap(input)).toEqual(allocateDailyCap(input));
  });
  it("reserves are clamped so a mis-set policy can never exceed the cap", () => {
    const a = allocateDailyCap({ firstDemand: 30, followDemand: 30, sentFirstToday: 0, sentFollowToday: 0, cap: 20, reserveFirst: 15, reserveFollow: 15 });
    expect(a.firstTarget + a.followTarget).toBeLessThanOrEqual(20);
  });
  it("never lets the two lanes jointly exceed the cap across ticks (already-sent subtracted)", () => {
    const a = alloc(20, 20, 6, 4); // 10 already sent
    expect(a.firstSendNow + a.followSendNow).toBeLessThanOrEqual(a.remainingTotal);
    expect(a.remainingTotal).toBe(10);
  });
});
