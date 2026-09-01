import { describe, it, expect } from "vitest";
import { assessDeliveryReadiness, tallyFunnel, type DeliveryContext } from "./delivery-ready";
import { capState, admitOneSend, laAccountingDate, GLOBAL_DAILY_CAP } from "./daily-cap";
import { selectDailyBatch, nextRecipientSlot, resolveTimezone, RECIPIENT_WINDOW } from "./materialize-batch";
import { assessReserve, planRefill, blendRates, overallYield, refillShouldStop, emptyCheckpoint, buildVisibility, DEFAULT_REFILL_POLICY } from "./refill";

const readyCtx = (over: Partial<DeliveryContext> = {}): DeliveryContext => ({
  leadId: "lead_1", businessName: "Biz", website: "https://biz.example", websiteDomain: "biz.example",
  serviceFit: true, recipientEmail: "hi@biz.example", recipientEmailValid: true, hasObservedFinding: true,
  reviewApproved: true, reviewSendable: true, attachmentSha: "abc123", footerReady: true,
  suppressed: false, unsubscribed: false, bounced: false, duplicate: false, priorContact: false,
  recipientTimezone: "America/New_York", score: 0.8, city: "NYC", state: "NY", ...over,
});

describe("DELIVERY_READY gate (§1/§6 fail-closed)", () => {
  it("passes only when every precondition holds", () => {
    expect(assessDeliveryReadiness(readyCtx()).ready).toBe(true);
  });
  it("rejects each missing precondition with a specific reason", () => {
    expect(assessDeliveryReadiness(readyCtx({ website: null })).firstReason).toBe("missing_website");
    expect(assessDeliveryReadiness(readyCtx({ hasObservedFinding: false })).firstReason).toBe("no_observed_finding");
    expect(assessDeliveryReadiness(readyCtx({ recipientEmail: null })).firstReason).toBe("no_recipient");
    expect(assessDeliveryReadiness(readyCtx({ reviewApproved: false })).firstReason).toBe("review_not_approved");
    expect(assessDeliveryReadiness(readyCtx({ attachmentSha: null })).firstReason).toBe("attachment_missing");
    expect(assessDeliveryReadiness(readyCtx({ suppressed: true })).firstReason).toBe("suppressed");
    expect(assessDeliveryReadiness(readyCtx({ priorContact: true })).firstReason).toBe("prior_contact");
    expect(assessDeliveryReadiness(readyCtx({ recipientTimezone: null })).firstReason).toBe("no_timezone");
  });
  it("never counts a needs-evidence lead as ready", () => {
    expect(assessDeliveryReadiness(readyCtx({ hasObservedFinding: false })).ready).toBe(false);
  });
  it("tallies the funnel + rejections by reason", () => {
    const set = [readyCtx(), readyCtx({ leadId: "l2", hasObservedFinding: false }), readyCtx({ leadId: "l3", recipientEmail: null })];
    const f = tallyFunnel(set.map((ctx) => ({ ctx, verdict: assessDeliveryReadiness(ctx) })));
    expect(f.discovered).toBe(3);
    expect(f.deliveryReady).toBe(1);
    expect(f.rejectedByReason.no_observed_finding).toBe(1);
    expect(f.rejectedByReason.no_recipient).toBe(1);
  });
});

describe("global daily cap (§5)", () => {
  it("uses one America/Los_Angeles accounting date across timezones", () => {
    // 2026-09-02 02:00 ET == 2026-09-01 23:00 PT → same LA cap date 2026-09-01
    const etEarly = new Date("2026-09-02T06:00:00Z"); // 02:00 ET / 23:00 PT prev day
    expect(laAccountingDate(etEarly)).toBe("2026-09-01");
  });
  it("caps at 20 and blocks the 21st", () => {
    const now = new Date("2026-09-01T20:00:00Z");
    expect(capState(now, 0).remaining).toBe(20);
    expect(capState(now, 19).remaining).toBe(1);
    expect(capState(now, 20).atCap).toBe(true);
    expect(admitOneSend(now, 19).admit).toBe(true);
    expect(admitOneSend(now, 20).admit).toBe(false);
    expect(GLOBAL_DAILY_CAP).toBe(20);
  });
});

describe("daily materialization (§4)", () => {
  it("schedules inside the recipient-local 08:00–10:00 weekday window", () => {
    const now = new Date("2026-09-01T00:00:00Z"); // Tuesday
    for (const tz of ["America/New_York", "America/Chicago", "America/Los_Angeles"]) {
      const slot = nextRecipientSlot(now, tz, 3);
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hour12: false, weekday: "short" }).formatToParts(slot);
      const hour = +parts.find((p) => p.type === "hour")!.value % 24;
      const wd = parts.find((p) => p.type === "weekday")!.value;
      expect(hour).toBeGreaterThanOrEqual(RECIPIENT_WINDOW.startHour);
      expect(hour).toBeLessThan(RECIPIENT_WINDOW.endHour);
      expect(["Mon", "Tue", "Wed", "Thu", "Fri"]).toContain(wd);
      expect(slot.getTime()).toBeGreaterThanOrEqual(now.getTime());
    }
  });
  it("never exceeds the smaller of daily target and cap-remaining", () => {
    const ready = Array.from({ length: 30 }, (_, i) => readyCtx({ leadId: `l${i}`, state: i % 2 ? "NY" : "CA", score: 1 - i / 100 }));
    const plan = selectDailyBatch(ready, { now: new Date("2026-09-01T00:00:00Z"), dailyTarget: 20, capRemaining: 12 });
    expect(plan.selected).toBe(12);
    expect(plan.picks.length).toBe(12);
  });
  it("preserves geographic diversity (round-robin across states)", () => {
    const ready = [
      ...Array.from({ length: 10 }, (_, i) => readyCtx({ leadId: `ny${i}`, state: "NY", score: 0.9 - i / 100 })),
      ...Array.from({ length: 2 }, (_, i) => readyCtx({ leadId: `tx${i}`, state: "TX", score: 0.5 - i / 100 })),
    ];
    const plan = selectDailyBatch(ready, { now: new Date("2026-09-01T00:00:00Z"), dailyTarget: 4, capRemaining: 20 });
    // With round-robin, the 2 TX leads are reached before NY monopolizes all 4 slots.
    expect(plan.byState.TX).toBeGreaterThanOrEqual(1);
    expect(plan.selected).toBe(4);
  });
  it("maps state → timezone", () => {
    expect(resolveTimezone("NY")).toBe("America/New_York");
    expect(resolveTimezone("tx")).toBe("America/Chicago");
    expect(resolveTimezone(null)).toBeNull();
  });
});

describe("refill policy (§1–§3)", () => {
  it("target 60 / threshold 40 / daily 20", () => {
    expect(DEFAULT_REFILL_POLICY).toMatchObject({ targetReserve: 60, refillThreshold: 40, dailyTarget: 20, dailyCap: 20, minForwardDays: 3 });
  });
  it("flags below-threshold and computes forward coverage", () => {
    const r = assessReserve(30);
    expect(r.belowThreshold).toBe(true);
    expect(r.shortfallToTarget).toBe(30);
    expect(r.forwardDays).toBe(1); // 30 / 20
    expect(assessReserve(60).belowThreshold).toBe(false);
    expect(assessReserve(60).shortfallToTarget).toBe(0);
  });
  it("sizes discovery from attrition (shortfall / yield)", () => {
    const reserve = assessReserve(20);              // shortfall 40
    const plan = planRefill(reserve);
    expect(plan.needed).toBe(true);
    const y = overallYield({ ...blendRates(null) });
    expect(plan.discoverTarget).toBe(Math.ceil(40 / y));
    expect(plan.discoverTarget).toBeGreaterThan(40); // attrition means we must discover many more than 40
  });
  it("no refill when at target", () => {
    expect(planRefill(assessReserve(60)).needed).toBe(false);
    expect(planRefill(assessReserve(60)).discoverTarget).toBe(0);
  });
  it("§5 autonomous hysteresis: hold at/above 40, discover below 40", () => {
    // The autonomous cron gates discovery on belowThreshold (reserve < 40), NOT on shortfall-to-60.
    const autoGate = (ready: number) => assessReserve(ready).belowThreshold;
    expect(autoGate(40)).toBe(false); // exactly at threshold → hold (no-op)
    expect(autoGate(45)).toBe(false); // above → hold even though shortfall to 60 exists
    expect(autoGate(39)).toBe(true);  // below → discover, then top up all the way to 60
    // Manual mode still fills any shortfall to target (proves the two modes differ).
    expect(planRefill(assessReserve(45)).needed).toBe(true);
  });
  it("stops on reserve reached / budget spent / no candidates", () => {
    expect(refillShouldStop(assessReserve(60), emptyCheckpoint(), 5).stop).toBe(true);
    expect(refillShouldStop(assessReserve(10), { ...emptyCheckpoint(100), searchBudgetSpent: 100 }, 5).stop).toBe(true);
    expect(refillShouldStop(assessReserve(10), emptyCheckpoint(), 0).stop).toBe(true);
    expect(refillShouldStop(assessReserve(10), emptyCheckpoint(), 5).stop).toBe(false);
  });
  it("builds an owner-visibility snapshot", () => {
    const reserve = assessReserve(28);
    const plan = planRefill(reserve);
    const funnel = tallyFunnel([{ ctx: readyCtx({ hasObservedFinding: false }), verdict: assessDeliveryReadiness(readyCtx({ hasObservedFinding: false })) }]);
    const v = buildVisibility({ reserve, plan, funnel, tomorrowScheduled: 20, nextLocations: ["Austin, TX", "Denver, CO"], checkpoint: emptyCheckpoint() });
    expect(v.readyReserve).toBe("28 / 60");
    expect(v.tomorrowScheduled).toBe("20 / 20");
    expect(v.refillStatus).toBe("refilling");
    expect(v.nextLocations).toContain("Austin, TX");
  });
});
