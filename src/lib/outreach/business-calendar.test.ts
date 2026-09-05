import { describe, it, expect } from "vitest";
import { isBusinessHoliday, nextBusinessDayKey, addDaysKey, configuredHolidays } from "./business-calendar";

describe("business-calendar — holiday guard (mandate 16)", () => {
  it("Labor Day 2026 (Mon Sep 7) is a holiday", () => {
    expect(isBusinessHoliday("2026-09-07")).toBe(true);
    expect(isBusinessHoliday("2026-09-08")).toBe(false); // Tuesday, normal
  });
  it("next business day from Sept 7 is Sept 8 (skips the holiday)", () => {
    expect(nextBusinessDayKey(addDaysKey("2026-09-07", 1))).toBe("2026-09-08");
  });
  it("skips weekends AND holidays together (Fri Jul 3 2026 holiday → next is Mon Jul 6)", () => {
    // Jul 3 2026 is Friday (observed holiday), Jul 4 Sat, Jul 5 Sun → Mon Jul 6.
    expect(nextBusinessDayKey("2026-07-03")).toBe("2026-07-06");
  });
  it("a normal Tuesday is its own next business day", () => {
    expect(nextBusinessDayKey("2026-09-08")).toBe("2026-09-08");
  });
  it("BUSINESS_HOLIDAYS env overrides the default set", () => {
    const env = { BUSINESS_HOLIDAYS: "2026-12-31" } as any;
    expect(configuredHolidays(env).has("2026-12-31")).toBe(true);
    expect(configuredHolidays(env).has("2026-09-07")).toBe(false); // default no longer applies
  });
  it("addDaysKey does calendar arithmetic", () => {
    expect(addDaysKey("2026-09-30", 1)).toBe("2026-10-01");
  });
});
