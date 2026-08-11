import { describe, it, expect } from "vitest";
import { makeLead } from "../test-lead";
import type { Lead } from "../types";
import { isOrdinaryColdPhoneFirst, predictablyClosedForWeekend, hasPriorContext, isHighValueCall } from "./call-priority";
import { buildWorkQueue } from "../work-queue";
import type { Task } from "../types";

// Owner-accessible, phone, no email → call-first (the phone-first case we're deprioritizing).
const coldCall = (over: Partial<Lead> = {}) =>
  makeLead({ industry: "Auto repair", normalizedCategory: "auto-repair", publicEmail: null, website: null, websiteDomain: null, phone: "(213) 555-0100", leadScore: null, tier: null, lastContactAt: null, nextFollowUpAt: null, pipelineStage: "Discovered", ...over });

// A Sunday, ~noon Pacific — a weekend for a CA business.
const SUNDAY = new Date("2026-08-09T19:00:00.000Z");
const WEEKDAY = new Date("2026-08-11T19:00:00.000Z"); // Tuesday

describe("value-first call priority — ordinary cold phone-first is deprioritized", () => {
  it("an ordinary cold, low-value, no-context phone-first lead IS deprioritized", () => {
    expect(isOrdinaryColdPhoneFirst(coldCall())).toBe(true);
  });

  it("a high-value phone-first lead is NOT deprioritized (exceptional cold call surfaces)", () => {
    expect(isOrdinaryColdPhoneFirst(coldCall({ leadScore: 78 }))).toBe(false);
    expect(isOrdinaryColdPhoneFirst(coldCall({ tier: "A" }))).toBe(false);
  });

  it("a lead with prior Artifex context (already contacted / follow-up scheduled) is NOT deprioritized", () => {
    expect(isOrdinaryColdPhoneFirst(coldCall({ lastContactAt: "2026-08-01T00:00:00Z" }))).toBe(false);
    expect(isOrdinaryColdPhoneFirst(coldCall({ nextFollowUpAt: "2026-08-20T00:00:00Z" }))).toBe(false);
  });

  it("an email-first lead is never 'cold phone-first' (it's not a call at all)", () => {
    expect(isOrdinaryColdPhoneFirst(makeLead({ publicEmail: "hi@shop.com" }))).toBe(false);
  });

  it("hasPriorContext / isHighValueCall read the honest signals", () => {
    expect(hasPriorContext(coldCall())).toBe(false);
    expect(hasPriorContext(coldCall({ pipelineStage: "Contacted" }))).toBe(true);
    expect(isHighValueCall(coldCall({ estimatedValueHigh: 25000 }))).toBe(true);
    expect(isHighValueCall(coldCall({ estimatedValueHigh: 5000 }))).toBe(false);
  });
});

describe("weekend awareness — predictably-closed professional offices are withheld on weekends", () => {
  it("a professional office (dental/legal) with no weekend-open evidence is withheld on Sunday", () => {
    const dental = makeLead({ industry: "Dental practice", normalizedCategory: "dentist", state: "CA" });
    expect(predictablyClosedForWeekend(dental, SUNDAY)).toBe(true);
  });

  it("the same office is callable on a weekday", () => {
    const dental = makeLead({ industry: "Dental practice", normalizedCategory: "dentist", state: "CA" });
    expect(predictablyClosedForWeekend(dental, WEEKDAY)).toBe(false);
  });

  it("an owner-accessible weekend business (auto shop) is NOT withheld on Sunday", () => {
    expect(predictablyClosedForWeekend(coldCall({ state: "CA" }), SUNDAY)).toBe(false);
  });

  it("a professional office with REAL Sunday hours is trusted and NOT withheld", () => {
    const openSunday = makeLead({ industry: "Accounting firm", normalizedCategory: "accountant", state: "CA", hours: "Sunday: 9:00 AM – 5:00 PM" });
    expect(predictablyClosedForWeekend(openSunday, SUNDAY)).toBe(false);
  });
});

describe("buildWorkQueue withholds ordinary cold calls from the primary board", () => {
  const task = (leadId: string): Task => ({ id: `t_${leadId}`, leadId, type: "review_and_send", title: "x", dueAt: "2026-08-11T00:00:00Z", status: "open", priority: 20, snoozedUntil: null, sourcePlanId: null, sourceStepId: null, createdAt: "2026-08-11T00:00:00Z", updatedAt: "2026-08-11T00:00:00Z" } as Task);

  it("a cold low-value phone-first lead produces NO call card; a high-value one does", () => {
    const cold = coldCall({ businessName: "Cold Co" });
    const hot = coldCall({ businessName: "Hot Co", leadScore: 80 });
    cold.id = "cold"; hot.id = "hot";
    const leads = new Map<string, Lead>([[cold.id, cold], [hot.id, hot]]);
    const q = buildWorkQueue({ tasks: [task("cold"), task("hot")], meetingsToday: [], leads, now: WEEKDAY });
    const callCard = q.find((c) => c.kind === "call");
    expect(callCard?.leadIds ?? []).toContain("hot");
    expect(callCard?.leadIds ?? []).not.toContain("cold"); // deprioritized off the board
  });
});
