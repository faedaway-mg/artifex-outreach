import { describe, it, expect } from "vitest";
import { DEFAULT_SENDING_WINDOW, resolveSendingWindow, nextSendingDateKey, laDateKey } from "./sending-window";
import { staggeredTimes } from "./scheduled-batch";

const laHour = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "2-digit", hour12: false }).formatToParts(new Date(iso)).find((p) => p.type === "hour")!.value;
const laDow = (dateKey: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "long" }).format(new Date(dateKey + "T18:00:00Z"));

describe("sending window — Settings-driven, America/Los_Angeles, never reinterpret a wall hour as UTC", () => {
  it("the default production window is weekdays 05:00–07:00 America/Los_Angeles", () => {
    expect(DEFAULT_SENDING_WINDOW).toEqual({ timezone: "America/Los_Angeles", startHour: 5, endHour: 7, weekdays: [1, 2, 3, 4, 5] });
  });

  it("resolveSendingWindow honors a valid Settings window and falls back to the default otherwise", () => {
    const custom = { timezone: "America/Los_Angeles", startHour: 6, endHour: 9, weekdays: [1, 3, 5] };
    expect(resolveSendingWindow({ sendingWindow: custom } as any)).toEqual(custom);
    expect(resolveSendingWindow(null)).toEqual(DEFAULT_SENDING_WINDOW);
    expect(resolveSendingWindow({ sendingWindow: undefined } as any)).toEqual(DEFAULT_SENDING_WINDOW);
    // invalid (end <= start, empty weekdays, out-of-range) → default
    expect(resolveSendingWindow({ sendingWindow: { timezone: "America/Los_Angeles", startHour: 9, endHour: 9, weekdays: [1] } } as any)).toEqual(DEFAULT_SENDING_WINDOW);
    expect(resolveSendingWindow({ sendingWindow: { timezone: "America/Los_Angeles", startHour: 5, endHour: 7, weekdays: [] } } as any)).toEqual(DEFAULT_SENDING_WINDOW);
  });

  it("staggeredTimes places 05:00–07:00 in LA (PDT), NOT 05:00 UTC — the 'not reinterpreted as UTC' guarantee", () => {
    // 2026-08-31 is Monday, PDT (UTC-7). A 5 AM LA start must render as hour 05 in LA, i.e. 12:00 UTC.
    const times = staggeredTimes("2026-08-31", 3, { tz: "America/Los_Angeles", startHour: 5, endHour: 7 });
    expect(times).toHaveLength(3);
    expect(laHour(times[0])).toBe("05");            // first slot at the LA start hour
    expect(new Date(times[0]).toISOString()).toBe("2026-08-31T12:00:00.000Z"); // 05:00 LA (PDT) = 12:00 UTC
    for (const t of times) expect(Number(laHour(t))).toBeGreaterThanOrEqual(5); // all within [05,07) LA
    for (const t of times) expect(Number(laHour(t))).toBeLessThan(7);
  });

  describe("nextSendingDateKey — the next REAL LA sending day (replaces the hardcoded MONDAY_TARGET)", () => {
    const W = DEFAULT_SENDING_WINDOW;
    it("uses TODAY when today is a weekday and the LA clock is before the window close", () => {
      // Monday 2026-08-31 04:00 LA (PDT) = 11:00 UTC — before 07:00 close.
      expect(nextSendingDateKey(new Date("2026-08-31T11:00:00Z"), W)).toBe("2026-08-31");
    });
    it("rolls to the next weekday once TODAY's window has closed", () => {
      // Monday 2026-08-31 09:00 LA = 16:00 UTC — past the 07:00 close → Tuesday.
      const k = nextSendingDateKey(new Date("2026-08-31T16:00:00Z"), W);
      expect(k).toBe("2026-09-01");
      expect(laDow(k)).toBe("Tuesday");
    });
    it("skips the weekend: Friday-after-close, Saturday, and Sunday all resolve to Monday", () => {
      const friAfter = nextSendingDateKey(new Date("2026-09-04T16:00:00Z"), W); // Fri 09:00 LA, past close
      const sat = nextSendingDateKey(new Date("2026-09-05T18:00:00Z"), W);
      const sun = nextSendingDateKey(new Date("2026-09-06T18:00:00Z"), W);
      for (const k of [friAfter, sat, sun]) expect(laDow(k)).toBe("Monday");
      expect(sat).toBe("2026-09-07");
    });

    // ── Mandate V boundary cases: midnight, Friday night, weekends, PDT, PST ──
    it("MIDNIGHT LA on a weekday still resolves to that same weekday (before the 07:00 close)", () => {
      // Monday 2026-08-31 00:30 LA (PDT) = 07:30 UTC — a weekday, LA hour 0 < 7 → today.
      const k = nextSendingDateKey(new Date("2026-08-31T07:30:00Z"), W);
      expect(k).toBe("2026-08-31");
      expect(laDow(k)).toBe("Monday");
    });
    it("FRIDAY NIGHT (LA, past close) rolls across the weekend to Monday", () => {
      // Friday 2026-09-04 22:00 LA (PDT) = Saturday 05:00 UTC — Friday hour 22 ≥ close → Monday.
      const k = nextSendingDateKey(new Date("2026-09-05T05:00:00Z"), W);
      expect(k).toBe("2026-09-07");
      expect(laDow(k)).toBe("Monday");
    });
    it("PST (winter, UTC-8): a weekday before close resolves to that day", () => {
      // Monday 2026-01-05 04:00 LA (PST) = 12:00 UTC — weekday, hour 4 < 7 → today.
      const k = nextSendingDateKey(new Date("2026-01-05T12:00:00Z"), W);
      expect(k).toBe("2026-01-05");
      expect(laDow(k)).toBe("Monday");
    });
    it("PST (winter, UTC-8): Friday night past close rolls to the following Monday", () => {
      // Friday 2026-01-02 22:00 LA (PST) = Saturday 06:00 UTC → next Monday 2026-01-05.
      const k = nextSendingDateKey(new Date("2026-01-03T06:00:00Z"), W);
      expect(k).toBe("2026-01-05");
      expect(laDow(k)).toBe("Monday");
    });
  });

  it("laDateKey returns the LA calendar day even across the UTC midnight boundary", () => {
    // Monday 2026-08-31 22:00 LA = Tuesday 05:00 UTC — LA day is still the 31st.
    expect(laDateKey(new Date("2026-09-01T05:00:00Z"))).toBe("2026-08-31");
  });
});
