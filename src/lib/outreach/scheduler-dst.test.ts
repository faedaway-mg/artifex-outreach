import { describe, it, expect } from "vitest";
import { withinMorningWindow } from "./outreach-scheduler";
import { DEFAULT_SENDING_WINDOW } from "./sending-window";

// The application's LA gate is authoritative. The Railway cron only WAKES the runner across a UTC
// superset (*/5 12-15 * * 1-5) that covers 05:00–07:00 America/Los_Angeles in BOTH offsets:
//   PDT (UTC-7): 05:00–07:00 LA = 12:00–14:00 UTC
//   PST (UTC-8): 05:00–07:00 LA = 13:00–15:00 UTC
// These tests prove the LA gate accepts/rejects the right instants across offsets and DST transitions,
// so a cron wake OUTSIDE the LA window results in zero eligible sends.
const W = DEFAULT_SENDING_WINDOW; // 05:00–07:00 America/Los_Angeles, Mon–Fri
const inWin = (iso: string) => withinMorningWindow(new Date(iso), W.timezone, W);

describe("scheduler DST/window — America/Los_Angeles gate is authoritative across PDT/PST", () => {
  it("PDT coverage (summer, UTC-7): 05:00–06:59 LA is in-window; edges excluded", () => {
    // Monday 2026-08-31, PDT.
    expect(inWin("2026-08-31T12:00:00Z")).toBe(true);  // 05:00 LA — window open
    expect(inWin("2026-08-31T13:59:00Z")).toBe(true);  // 06:59 LA — still open
    expect(inWin("2026-08-31T11:59:00Z")).toBe(false); // 04:59 LA — before open
    expect(inWin("2026-08-31T14:00:00Z")).toBe(false); // 07:00 LA — window closed (exclusive)
  });

  it("PST coverage (winter, UTC-8): the same LA hours land one UTC hour later", () => {
    // Monday 2026-01-05, PST.
    expect(inWin("2026-01-05T13:00:00Z")).toBe(true);  // 05:00 LA
    expect(inWin("2026-01-05T14:59:00Z")).toBe(true);  // 06:59 LA
    expect(inWin("2026-01-05T12:59:00Z")).toBe(false); // 04:59 LA — before open
    expect(inWin("2026-01-05T15:00:00Z")).toBe(false); // 07:00 LA — closed
  });

  it("spring-forward transition: the offset flips PST→PDT and the window follows LA, not UTC", () => {
    // DST begins Sun 2026-03-08. Fri 2026-03-06 is PST; Mon 2026-03-09 is PDT.
    expect(inWin("2026-03-06T13:00:00Z")).toBe(true);  // Fri 05:00 LA (PST = UTC-8)
    expect(inWin("2026-03-06T12:00:00Z")).toBe(false); // Fri 04:00 LA (PST) — before open
    expect(inWin("2026-03-09T12:00:00Z")).toBe(true);  // Mon 05:00 LA (PDT = UTC-7)
    expect(inWin("2026-03-09T13:00:00Z")).toBe(true);  // Mon 06:00 LA (PDT) — still in-window
    expect(inWin("2026-03-09T14:00:00Z")).toBe(false); // Mon 07:00 LA (PDT) — window closed
  });

  it("fall-back transition: the offset flips PDT→PST and the window still tracks LA", () => {
    // DST ends Sun 2026-11-01. Fri 2026-10-30 is PDT; Mon 2026-11-02 is PST.
    expect(inWin("2026-10-30T12:00:00Z")).toBe(true);  // Fri 05:00 LA (PDT)
    expect(inWin("2026-11-02T13:00:00Z")).toBe(true);  // Mon 05:00 LA (PST)
    expect(inWin("2026-11-02T12:00:00Z")).toBe(false); // Mon 04:00 LA (PST) — before open
  });

  it("no dispatch before 05:00 LA or at/after 07:00 LA (both offsets)", () => {
    expect(inWin("2026-08-31T11:55:00Z")).toBe(false); // 04:55 LA PDT
    expect(inWin("2026-08-31T14:05:00Z")).toBe(false); // 07:05 LA PDT
    expect(inWin("2026-01-05T12:55:00Z")).toBe(false); // 04:55 LA PST
    expect(inWin("2026-01-05T15:05:00Z")).toBe(false); // 07:05 LA PST
  });

  it("weekday enforcement uses the LA calendar date", () => {
    // Saturday 06:00 LA is in the HOUR window but a weekend → excluded.
    expect(inWin("2026-08-29T13:00:00Z")).toBe(false); // Sat 06:00 LA PDT
    expect(inWin("2026-08-30T13:00:00Z")).toBe(false); // Sun 06:00 LA PDT
    expect(inWin("2026-08-31T13:00:00Z")).toBe(true);  // Mon 06:00 LA PDT
    // A cron wake at 15:30 UTC in PDT = 08:30 LA (after the window) → out, even on a weekday.
    expect(inWin("2026-08-31T15:30:00Z")).toBe(false); // Mon 08:30 LA PDT
  });

  it("the cron UTC superset 12–15 brackets the LA window in both offsets", () => {
    // At least one wake hour in {12,13,14,15}Z lands inside the LA window for each offset,
    // and the boundary wake hours fall outside — the app gate, not the cron, draws the line.
    const pdt = [12, 13, 14, 15].map((h) => inWin(`2026-08-31T${String(h).padStart(2, "0")}:00:00Z`));
    expect(pdt).toEqual([true, true, false, false]); // 05,06 in; 07,08 out (PDT)
    const pst = [12, 13, 14, 15].map((h) => inWin(`2026-01-05T${String(h).padStart(2, "0")}:00:00Z`));
    expect(pst).toEqual([false, true, true, false]); // 04 out; 05,06 in; 07 out (PST)
  });
});
