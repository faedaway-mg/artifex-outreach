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
  compareForCalling, endOfDayIn, stateFromAddress, knownClosedNow, nextOpenAt, DEFAULT_ZONE,
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

// A real production address, verbatim: the state column is empty on this row
// while the address plainly reads "OH". Before the fix, all four Middletown
// businesses were labelled Pacific — a three-hour error on every call window,
// in the one state the mandate named.
const OHIO = "321 N Breiel Blvd, Middletown, OH 45042, USA";

describe("the empty state column found in production", () => {
  it("reads the state out of the address line when the column is empty", () => {
    const l = biz({ state: "", address: OHIO, latitude: 39.5184316, longitude: -84.353532 });
    const z = inferZone(l);
    expect(z.zone).toBe("America/New_York");
    expect(z.confidence).toBe("state");
    expect(z.because).toMatch(/state column is empty/);
  });

  it("no longer silently calls an Ohio business Pacific", () => {
    const l = biz({ state: "", address: OHIO });
    expect(inferZone(l).zone).not.toBe(DEFAULT_ZONE);
  });

  it("still prefers the column when it has a value", () => {
    // The address is a fallback, never an override — a corrected column wins.
    const l = biz({ state: "CA", address: OHIO });
    expect(inferZone(l).zone).toBe("America/Los_Angeles");
    expect(inferZone(l).because).not.toMatch(/address line/);
  });

  it("anchors on the ZIP so a street name cannot be mistaken for a state", () => {
    expect(stateFromAddress("100 OH Ave, Los Angeles, CA 90014, USA")).toBe("CA");
    expect(stateFromAddress("12 Mount St, Somewhere, USA")).toBeNull();
    expect(stateFromAddress("")).toBeNull();
    expect(stateFromAddress(null)).toBeNull();
    expect(stateFromAddress(undefined)).toBeNull();
  });

  it("supports ZIP+4 and still falls back honestly when there is nothing to read", () => {
    expect(stateFromAddress("1 A St, Middletown, OH 45042-1234, USA")).toBe("OH");
    const nothing = inferZone(biz({ state: "", address: "" }));
    expect(nothing.zone).toBe(DEFAULT_ZONE);
    expect(nothing.confidence).toBe("default");
  });

  it("routes an address-derived split state through the longitude rule too", () => {
    // Tennessee is split; the address gives the state, the pin gives the side.
    const memphis = biz({ state: "", address: "1 Beale St, Memphis, TN 38103, USA", longitude: -90.05 });
    expect(inferZone(memphis).zone).toBe("America/Chicago");
    const knoxville = biz({ state: "", address: "1 Gay St, Knoxville, TN 37902, USA", longitude: -83.92 });
    expect(inferZone(knoxville).zone).toBe("America/New_York");
  });
});

describe("split states where the odd half is the EASTERN half", () => {
  // The bug these defend against: an earlier table had only "dominant" and
  // "west", which assumed the less-populous half of a split state is always the
  // western one. Tennessee and Oregon are both counterexamples, and both were
  // inverted — Memphis read as Eastern, Knoxville as Central.
  it("puts Memphis in Central and Knoxville in Eastern, not the reverse", () => {
    expect(inferZone(biz({ state: "TN", longitude: -90.05 })).zone).toBe("America/Chicago");
    expect(inferZone(biz({ state: "TN", longitude: -83.92 })).zone).toBe("America/New_York");
  });

  it("puts Portland in Pacific and Malheur County in Mountain", () => {
    expect(inferZone(biz({ state: "OR", longitude: -122.68 })).zone).toBe("America/Los_Angeles");
    expect(inferZone(biz({ state: "OR", longitude: -117.02 })).zone).toBe("America/Boise");
  });

  it("assumes where most people live when there is no pin, which is a different question", () => {
    // Tennessee's eastern half is Eastern time, but most Tennesseans are Central.
    expect(inferZone(biz({ state: "TN", longitude: null })).zone).toBe("America/Chicago");
    expect(inferZone(biz({ state: "OR", longitude: null })).zone).toBe("America/Los_Angeles");
    expect(inferZone(biz({ state: "TN", longitude: null })).confidence).toBe("state-approximate");
  });

  it("keeps every other split state pointing the way it always did", () => {
    expect(inferZone(biz({ state: "FL", longitude: -87.2 })).zone).toBe("America/Chicago");   // Pensacola
    expect(inferZone(biz({ state: "FL", longitude: -80.19 })).zone).toBe("America/New_York"); // Miami
    expect(inferZone(biz({ state: "TX", longitude: -106.49 })).zone).toBe("America/Denver");  // El Paso
    expect(inferZone(biz({ state: "TX", longitude: -95.37 })).zone).toBe("America/Chicago");  // Houston
    expect(inferZone(biz({ state: "KY", longitude: -88.6 })).zone).toBe("America/Chicago");   // Paducah
    expect(inferZone(biz({ state: "KY", longitude: -84.5 })).zone).toBe("America/New_York");  // Lexington
    expect(inferZone(biz({ state: "IN", longitude: -86.16 })).zone).toBe("America/Indiana/Indianapolis");
    expect(inferZone(biz({ state: "MI", longitude: -83.05 })).zone).toBe("America/Detroit");
  });

  it("gives the Ohio businesses a correct call window, not a three-hour lie", () => {
    // 10:00 Eastern on a Wednesday: open in Ohio, still shut in California.
    const when = at("2026-08-05T14:00:00.000Z");
    const ohio = callWindow(biz({ state: "", address: OHIO }), when);
    expect(ohio.zone).toBe("America/New_York");
    expect(ohio.localClock).toMatch(/10:00/);
    expect(ohio.state).toBe("open");

    const cal = callWindow(biz({ state: "CA" }), when);
    expect(cal.localClock).toMatch(/7:00/);
    expect(cal.state).toBe("opens-later");
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
  it("states its assumption when the lead carries none — Mon–Fri 9–5, weekends closed", () => {
    const h = businessHours({ hours: null });
    expect(h.source).toBe("assumed");
    expect(h.days[1]).toEqual({ open: 540, close: 1020 }); // Monday 9–5
    expect(h.days[0]).toBeNull(); // Sunday closed
    expect(h.days[6]).toBeNull(); // Saturday closed
  });

  it("reads a one-line day+time range when something finally populates it", () => {
    const h = businessHours({ hours: "Mon–Fri 9–5" });
    expect(h.source).toBe("lead");
    expect(h.days[1]).toEqual({ open: 540, close: 1020 });
    expect(h.days[5]).toEqual({ open: 540, close: 1020 });
    expect(h.days[6]).toBeNull();
  });

  it("keeps a weekend-open business open on the weekend — the hotel case", () => {
    // The old parser forced Mon–Fri onto every parsed row, which would have
    // wrongly reported a Sunday-open business as closed on Sunday.
    const daily = businessHours({ hours: "Daily 11–21" });
    expect(daily.source).toBe("lead");
    expect(daily.days[0]).toEqual({ open: 660, close: 1260 }); // Sunday open
    expect(daily.days[6]).toEqual({ open: 660, close: 1260 }); // Saturday open
  });

  it("recognizes 24/7 as open every day, around the clock", () => {
    const h = businessHours({ hours: "24/7" });
    expect(h.source).toBe("lead");
    for (let d = 0; d < 7; d++) expect(h.days[d]).toEqual({ open: 0, close: 1440 });
  });

  it("parses Google weekday_text, per day, including a closed day", () => {
    const h = businessHours({
      hours: [
        "Monday: 8:00 AM – 5:00 PM",
        "Tuesday: 8:00 AM – 5:00 PM",
        "Sunday: Closed",
        "Saturday: 9:00 AM – 1:00 PM",
      ].join("\n"),
    });
    expect(h.source).toBe("lead");
    expect(h.days[1]).toEqual({ open: 480, close: 1020 }); // Mon 8–5
    expect(h.days[0]).toBeNull(); // Sun closed
    expect(h.days[6]).toEqual({ open: 540, close: 780 }); // Sat 9–1
  });

  it("keeps overnight hours as a close-before-open window", () => {
    const h = businessHours({ hours: "Fri 9pm–2am" });
    expect(h.days[5]).toEqual({ open: 1260, close: 120 }); // 21:00 → 02:00 next day
  });

  it("falls back to the assumption rather than trusting a shape it cannot read", () => {
    expect(businessHours({ hours: "by appointment" }).source).toBe("assumed");
    expect(businessHours({ hours: "call for hours" }).source).toBe("assumed");
  });
});

describe("withholding known-closed businesses from the call queue", () => {
  // Sunday 2026-08-09, ~10am Pacific.
  const SUN_10AM_PT = at("2026-08-09T17:00:00Z");

  it("withholds a business whose RELIABLE hours prove it is shut today", () => {
    const dentist = biz({ state: "CA", hours: "Mon–Fri 8–5" });
    expect(knownClosedNow(dentist, SUN_10AM_PT)).toBe(true);
  });

  it("never withholds on an ASSUMPTION — unknown hours stay callable", () => {
    // Same Sunday, but no hours on file: the assumption says Mon–Fri, yet we must
    // not suppress a business we simply lack data for.
    const unknown = biz({ state: "CA", hours: null });
    expect(callWindow(unknown, SUN_10AM_PT).hoursSource).toBe("assumed");
    expect(knownClosedNow(unknown, SUN_10AM_PT)).toBe(false);
  });

  it("does not withhold a business that is open right now", () => {
    const hotel = biz({ state: "CA", hours: "24/7" });
    expect(knownClosedNow(hotel, SUN_10AM_PT)).toBe(false);
    const sundayRestaurant = biz({ state: "CA", hours: "Daily 9–17" });
    expect(knownClosedNow(sundayRestaurant, SUN_10AM_PT)).toBe(false);
  });

  it("does not withhold a business that merely opens later today", () => {
    const early = biz({ state: "CA", hours: "Daily 9–17" });
    const sunday7am = at("2026-08-09T14:00:00Z"); // 7am PT Sunday, opens at 9
    expect(callWindow(early, sunday7am).state).toBe("opens-later");
    expect(knownClosedNow(early, sunday7am)).toBe(false);
  });
});

describe("when a closed business becomes callable again", () => {
  it("reschedules a Sunday-closed dentist to Monday morning open", () => {
    const dentist = biz({ state: "CA", hours: "Mon–Fri 8–5" });
    const sunday = at("2026-08-09T17:00:00Z"); // Sun 10am PT
    const next = nextOpenAt(dentist, sunday)!;
    expect(next).not.toBeNull();
    const parts = zonedParts(next, "America/Los_Angeles");
    expect(parts.weekday).toBe(1); // Monday
    expect(parts.hour).toBe(8); // opens at 8am local
    expect(parts.minute).toBe(0);
    expect(+next).toBeGreaterThan(+sunday);
  });

  it("returns today's opening when the business simply hasn't opened yet", () => {
    const shop = biz({ state: "CA", hours: "Daily 9–17" });
    const sunday7am = at("2026-08-09T14:00:00Z"); // 7am PT, opens 9
    const next = nextOpenAt(shop, sunday7am)!;
    const parts = zonedParts(next, "America/Los_Angeles");
    expect(parts.weekday).toBe(0); // still Sunday
    expect(parts.hour).toBe(9);
  });

  it("falls back to the assumed Mon–Fri opening when hours are unknown", () => {
    const unknown = biz({ state: "CA", hours: null });
    const saturday = at("2026-08-08T20:00:00Z"); // Sat 1pm PT
    const next = nextOpenAt(unknown, saturday)!;
    const parts = zonedParts(next, "America/Los_Angeles");
    expect(parts.weekday).toBe(1); // Monday
    expect(parts.hour).toBe(9);
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
