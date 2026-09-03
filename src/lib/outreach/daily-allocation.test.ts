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
