import { describe, it, expect } from "vitest";
import { nextEligibleLaDateKey } from "./pipeline-advance";

const LA = { tz: "America/Los_Angeles", startHour: 5, endHour: 7 };
const laDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: LA.tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const laWeekday = (key: string) => {
  // Noon UTC on that date is always the same calendar day in LA.
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: LA.tz, weekday: "short" }).format(new Date(`${key}T20:00:00Z`));
  return wd;
};

describe("nextEligibleLaDateKey (§4 scheduling lands only in a real weekday window)", () => {
  it("uses TODAY when it is a weekday and the morning window has not passed", () => {
    // 2026-09-01 is a Tuesday. 11:00 UTC = 04:00 PDT → before the 05:00–07:00 window.
    const now = new Date("2026-09-01T11:00:00Z");
    const key = nextEligibleLaDateKey(now, LA);
    expect(key).toBe("2026-09-01");
    expect(["Mon", "Tue", "Wed", "Thu", "Fri"]).toContain(laWeekday(key));
  });

  it("rolls to the NEXT weekday once today's window has passed", () => {
    // 2026-09-01 (Tue) 20:00 UTC = 13:00 PDT → window already passed → next day (Wed 09-02).
    const now = new Date("2026-09-01T20:00:00Z");
    const key = nextEligibleLaDateKey(now, LA);
    expect(key).toBe("2026-09-02");
  });

  it("skips the weekend — a Saturday resolves to the following Monday", () => {
    // 2026-09-05 is a Saturday. Any time → next weekday is Monday 2026-09-07.
    const sat = new Date("2026-09-05T18:00:00Z");
    const key = nextEligibleLaDateKey(sat, LA);
    expect(laWeekday(key)).toBe("Mon");
    expect(key).toBe("2026-09-07");
  });

  it("always returns a weekday for a full week of inputs", () => {
    for (let d = 1; d <= 7; d++) {
      const now = new Date(`2026-09-0${d}T18:00:00Z`);
      expect(["Mon", "Tue", "Wed", "Thu", "Fri"]).toContain(laWeekday(nextEligibleLaDateKey(now, LA)));
    }
  });
});
