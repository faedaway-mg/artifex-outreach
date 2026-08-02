// ─────────────────────────────────────────────────────────────────────────────
// Time decides WHEN we contact a business. These tests defend that boundary and
// the two properties that make the answer trustworthy: daylight saving is never
// arithmetic, and an inference always announces itself.
//
// The production book has businesses in California and Ohio, so those two are
// tested against real instants rather than invented ones.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { makeLead } from "./test-lead";
import {
  inferZone, zonedParts, businessHours, callWindow, callOrderWeight,
  compareForCalling, endOfDayIn, DEFAULT_ZONE,
} from "./timezone";

const at = (iso: string) => new Date(iso);

const biz = (over: Parameters<typeof makeLead>[0] = {}) => makeLead({ businessName: "B", ...over });

describe("deriving the zone from what a lead already carries", () => {
  it("answers California and Ohio — the two states actually in the book", () => {
    expect(inferZone(biz({ state: "CA" })).zone).toBe("America/Los_Angeles");
    expect(inferZone(biz({ state: "OH" })).zone).toBe("America/New_York");
  });

  it("labels a whole-state answer as derived from the state, not as a fact", () => {
    const inf = inferZone(biz({ state: "CA" }));
    expect(inf.confidence).toBe("state");
    expect(inf.because).toMatch(/CA/);
  });

  it("uses the map pin when a state spans two zones", () => {
    const west = inferZone(biz({ state: "TX", longitude: -106.4 })); // El Paso
    const east = inferZone(biz({ state: "TX", longitude: -95.4 })); // Houston
    expect(west.zone).toBe("America/Denver");
    expect(east.zone).toBe("America/Chicago");
    expect(west.confidence).toBe("coordinates");
  });

  it("says so out loud when a split state has no pin", () => {
    const inf = inferZone(biz({ state: "TX", longitude: null }));
    expect(inf.confidence).toBe("state-approximate");
    expect(inf.because).toMatch(/spans two time zones/i);
  });

  it("falls back to the workspace zone rather than guessing", () => {
    const inf = inferZone(biz({ state: "", longitude: null }));
    expect(inf.zone).toBe(DEFAULT_ZONE);
    expect(inf.confidence).toBe("default");
  });
});

describe("daylight saving is never arithmetic", () => {
  it("gives Los Angeles a different UTC offset in January and July", () => {
    const winter = zonedParts(at("2026-01-15T20:00:00Z"), "America/Los_Angeles"); // 12:00 PST
    const summer = zonedParts(at("2026-07-15T20:00:00Z"), "America/Los_Angeles"); // 13:00 PDT
    expect(winter.hour).toBe(12);
    expect(summer.hour).toBe(13);
  });

  it("leaves Arizona alone, which is the entire argument for zones over offsets", () => {
    expect(zonedParts(at("2026-01-15T20:00:00Z"), "America/Phoenix").hour).toBe(13);
    expect(zonedParts(at("2026-07-15T20:00:00Z"), "America/Phoenix").hour).toBe(13);
  });

  it("keeps California and Ohio three hours apart at the same instant", () => {
    const t = at("2026-08-05T17:00:00Z");
    expect(zonedParts(t, "America/Los_Angeles").hour).toBe(10);
    expect(zonedParts(t, "America/New_York").hour).toBe(13);
  });

  it("survives a bad zone string instead of throwing on a page render", () => {
    expect(zonedParts(at("2026-08-05T17:00:00Z"), "Mars/Olympus").hour).toBe(10);
  });
});

describe("business hours", () => {
  it("states its assumption when the lead carries none — which is every lead today", () => {
    const h = businessHours({ hours: null });
    expect(h.source).toBe("assumed");
    expect(h.openHour).toBe(9);
    expect(h.closeHour).toBe(17);
  });

  it("reads the column when something finally populates it", () => {
    const h = businessHours({ hours: "Mon–Fri 9–5" });
    expect(h.source).toBe("lead");
    expect(h.openHour).toBe(9);
    expect(h.closeHour).toBe(17);
  });

  it("falls back to the assumption rather than trusting a shape it cannot read", () => {
    expect(businessHours({ hours: "by appointment" }).source).toBe("assumed");
    expect(businessHours({ hours: "24/7" }).source).toBe("assumed");
  });
});

describe("can we call them right now", () => {
  // 2026-08-05 is a Wednesday. 17:00Z = 10am Pacific, 1pm Eastern.
  const NOON_UTC = at("2026-08-05T17:00:00Z");

  it("says open for a Californian business at 10am their time", () => {
    const w = callWindow(biz({ state: "CA" }), NOON_UTC);
    expect(w.open).toBe(true);
    expect(w.localClock).toBe("10:00 AM");
    expect(w.label).toMatch(/Open/);
  });

  it("says open for an Ohio business at 1pm their time, closing sooner", () => {
    const ca = callWindow(biz({ state: "CA" }), NOON_UTC);
    const oh = callWindow(biz({ state: "OH" }), NOON_UTC);
    expect(oh.open).toBe(true);
    expect(oh.localClock).toBe("1:00 PM");
    expect(oh.closesInMinutes!).toBeLessThan(ca.closesInMinutes!);
  });

  it("catches the 7am Pacific call that would ring a locked door", () => {
    const w = callWindow(biz({ state: "CA" }), at("2026-08-05T14:00:00Z")); // 7am PT
    expect(w.state).toBe("opens-later");
    expect(w.opensInMinutes).toBe(120);
  });

  it("knows an Ohio business is already shut while California is still working", () => {
    const t = at("2026-08-05T23:30:00Z"); // 4:30pm PT, 7:30pm ET
    expect(callWindow(biz({ state: "CA" }), t).open).toBe(true);
    expect(callWindow(biz({ state: "OH" }), t).state).toBe("closed-for-the-day");
  });

  it("knows a Saturday", () => {
    expect(callWindow(biz({ state: "CA" }), at("2026-08-08T18:00:00Z")).state).toBe("closed-today");
  });

  it("carries the derivation's confidence through, so the UI can show it", () => {
    expect(callWindow(biz({ state: "TX", longitude: null }), NOON_UTC).confidence).toBe("state-approximate");
    expect(callWindow(biz({ state: "CA" }), NOON_UTC).hoursSource).toBe("assumed");
  });
});

describe("call ordering", () => {
  const NOW = at("2026-08-05T17:00:00Z"); // 10am PT / 1pm ET

  it("puts the business about to close ahead of the one with all afternoon", () => {
    const closingSoon = biz({ state: "OH", businessName: "Ohio", hours: "Mon–Fri 9–2" });
    const wideOpen = biz({ state: "CA", businessName: "California" });
    expect(compareForCalling(closingSoon, wideOpen, NOW)).toBeLessThan(0);
  });

  it("ranks open ahead of not-yet-open ahead of closed", () => {
    const open = callOrderWeight(callWindow(biz({ state: "CA" }), NOW));
    const later = callOrderWeight(callWindow(biz({ state: "CA" }), at("2026-08-05T14:00:00Z")));
    const shut = callOrderWeight(callWindow(biz({ state: "CA" }), at("2026-08-06T04:00:00Z")));
    expect(open).toBeLessThan(later);
    expect(later).toBeLessThan(shut);
  });

  it("is total and deterministic — same inputs, same order, every time", () => {
    const rows = [
      biz({ state: "OH", businessName: "Zeta" }),
      biz({ state: "CA", businessName: "Alpha" }),
      biz({ state: "OH", businessName: "Alpha" }),
      biz({ state: "", businessName: "Nowhere" }),
    ];
    const once = [...rows].sort((a, b) => compareForCalling(a, b, NOW)).map((r) => `${r.businessName}/${r.state}`);
    const twice = [...rows].reverse().sort((a, b) => compareForCalling(a, b, NOW)).map((r) => `${r.businessName}/${r.state}`);
    expect(once).toEqual(twice);
  });
});

describe("the day boundary an operator actually lives in", () => {
  it("ends the Pacific day at Pacific midnight, not the server's", () => {
    const eod = endOfDayIn("America/Los_Angeles", at("2026-08-05T17:00:00Z"));
    // 2026-08-06 00:00 PDT is 07:00Z; the last millisecond before it is 06:59:59.999Z.
    expect(eod.toISOString()).toBe("2026-08-06T06:59:59.999Z");
  });

  it("gives an Eastern operator a different end of day than a Pacific one", () => {
    const t = at("2026-08-05T17:00:00Z");
    expect(+endOfDayIn("America/New_York", t)).toBeLessThan(+endOfDayIn("America/Los_Angeles", t));
  });
});

describe("time never decides who owns anything", () => {
  it("is not imported by the assignment engine", () => {
    // Structural, not aspirational. If someone wires timezone into ownership,
    // this test is the thing that tells them they changed the promise.
    const engine = readFileSync(new URL("./operators/assignment.ts", import.meta.url), "utf8");
    expect(engine).not.toMatch(/from\s+["'].*timezone["']/);
    expect(engine).not.toMatch(/callWindow|inferZone|zonedParts/);
  });
});
