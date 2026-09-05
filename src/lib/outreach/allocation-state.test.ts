import { describe, it, expect } from "vitest";
import { firstTouchDayEligible } from "./allocation-state";
import { allocateDailyCap } from "./daily-allocation";

// The starvation fix lives in the DEMAND feeding the allocator: first-touch demand is DAY-SCOPED (the whole
// window's sendable batch), not just the instant-past-due items. These pure tests prove that scoping, then
// prove that with correct day-demand the allocator holds the first-touch reserve against heavy follow-ups.
const bounds = { startIso: "2026-09-07T12:00:00.000Z", endIso: "2026-09-08T07:00:00.000Z" }; // an LA send day
const B = (scheduledAt: string, recipient = "a@x.com", status = "scheduled") => ({ binding: { status, scheduledAt, recipient } });

describe("firstTouchDayEligible — day-scoped first-touch demand (mandate 14 fix)", () => {
  it("counts ALL of today's scheduled first-touches, even ones not yet past-due (the fix)", () => {
    // 13 bindings staggered across today's window — NONE past-due at window open, all still count.
    const bindings = Array.from({ length: 13 }, (_, i) => B(`2026-09-07T13:${String(10 + i).padStart(2, "0")}:00.000Z`, `f${i}@x.com`));
    expect(firstTouchDayEligible(bindings, bounds, () => false)).toBe(13);
  });
  it("(7) excludes suppressed recipients", () => {
    const bindings = [B("2026-09-07T13:10:00.000Z", "ok@x.com"), B("2026-09-07T13:20:00.000Z", "supp@x.com")];
    expect(firstTouchDayEligible(bindings, bounds, (e) => e === "supp@x.com")).toBe(1);
  });
  it("excludes invalid recipients and non-'scheduled' status", () => {
    expect(firstTouchDayEligible([B("2026-09-07T13:10:00.000Z", "not-an-email")], bounds, () => false)).toBe(0);
    expect(firstTouchDayEligible([B("2026-09-07T13:10:00.000Z", "a@x.com", "sent")], bounds, () => false)).toBe(0);
  });
  it("(13-adjacent) bindings scheduled for a DIFFERENT day do not count toward today's demand", () => {
    const bindings = [B("2026-09-07T13:10:00.000Z", "today@x.com"), B("2026-09-10T13:10:00.000Z", "future@x.com")];
    expect(firstTouchDayEligible(bindings, bounds, () => false)).toBe(1);
  });
});

describe("day-scoped demand + allocator ⇒ 13 first-touches are not starved by 20 follow-ups", () => {
  it("with 13 first-touch day-demand, follow-ups cannot exceed their 10 reserve", () => {
    const firstDemand = 13; // day-scoped (the fix): all 13 count even before their staggered instants
    const a = allocateDailyCap({ firstDemand, followDemand: 20, sentFirstToday: 0, sentFollowToday: 0 });
    expect(a.firstTarget).toBe(10); // full first-touch reserve held (no follow-up spare to borrow)
    expect(a.followTarget).toBe(10); // follow-ups capped at their own reserve — cannot starve first-touch
    expect(a.borrowedByFollow).toBe(0); // follow-ups could NOT borrow first-touch slots
    expect(a.firstTarget + a.followTarget).toBe(20);
  });

  it("OLD (buggy) instant-due demand of 2 would have let follow-ups borrow — proving the regression is closed", () => {
    // Simulate the pre-fix demand (only 2 past-due at window open) to show it WOULD starve first-touches.
    const buggy = allocateDailyCap({ firstDemand: 2, followDemand: 20, sentFirstToday: 0, sentFollowToday: 0 });
    expect(buggy.firstTarget).toBe(2);
    expect(buggy.followTarget).toBe(18); // follow-ups eat 8 first-touch slots — the starvation we fixed
    // The fixed day-scoped demand (13) yields firstTarget 10 vs the buggy 2 — an 8-slot protection swing.
    const fixed = allocateDailyCap({ firstDemand: 13, followDemand: 20, sentFirstToday: 0, sentFollowToday: 0 });
    expect(fixed.firstTarget - buggy.firstTarget).toBe(8);
  });
});
