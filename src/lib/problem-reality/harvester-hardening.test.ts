import { describe, it, expect } from "vitest";
import { decideVerdict, detectRenderedPhones, classifyIframe, normalizePhone, type ProbeSignal } from "./verdict";
import { executeCounterTest, type BrowserLike } from "./counter-test";
import type { ProblemHypothesis } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// HARVESTER HARDENING (§9 fixture + §10 test matrix).
//
// Root cause of the River Dental false-PROVEN: the harvester had incomplete
// evidence — a phone rendered as TEXT (no tel: anchor) and a contact/appointment
// form embedded in a CROSS-ORIGIN IFRAME — yet concluded "no path → PROVEN".
// The corrected doctrine: a FAILURE TO OBSERVE a path is not evidence the path
// does not exist. Improve recall (see phone-text + iframe forms) without destroying
// precision (a genuinely dead CTA is still PROVEN).
// ─────────────────────────────────────────────────────────────────────────────

const H = (over: Partial<ProblemHypothesis> = {}): ProblemHypothesis => ({
  id: "h1", claim: "No usable online booking path for a customer", primaryCustomerAction: "booking",
  browserDependent: true, url: "https://example.com/", ...over,
});

type ProbeShape = {
  title?: string; links?: Array<{ text: string; href: string }>; buttons?: Array<{ text: string; type: string }>;
  iframes?: Array<{ src: string; title: string }>; tel?: string[]; mailto?: string[]; forms?: number;
  openedMenu?: boolean; bodyText?: string; rawText?: string; overlaysDismissed?: string[];
};

const fullProbe = (p: ProbeShape) => ({
  title: "T", overlaysDismissed: [], links: [], buttons: [], iframes: [], tel: [], mailto: [],
  forms: 0, openedMenu: false, bodyText: "", rawText: "", ...p,
});

/** Fake browser that serves a different probe per URL (so site-wide crawl can be
 *  exercised). `status(url)` lets a page be a bot wall / 404. */
function fakeBrowserFor(pages: Record<string, ProbeShape>, status?: (url: string) => number): BrowserLike {
  const makePage = () => {
    let current = "";
    return {
      goto: async (url: string) => { current = url; return { status: () => (status ? status(url) : 200) }; },
      url: () => current,
      title: async () => "T",
      evaluate: async () => fullProbe(pages[current] ?? pages["*"] ?? {}),
      content: async () => "",
      close: async () => {},
    };
  };
  const ctx = { newPage: async () => makePage(), close: async () => {} };
  return { newContext: async () => ctx, close: async () => {} } as unknown as BrowserLike;
}

// ── §9 River Dental synthetic fixture (structural pattern, no live site / PII) ──
const RIVER_URL = "https://riverdental.example/fayetteville/";
const RIVER_MAIN: ProbeShape = {
  title: "River Dental | Fayetteville",
  // phone rendered as TEXT, NOT a tel: anchor (blind spot A):
  rawText: "River Dental of Fayetteville. New patients welcome. Call us at (479) 888-5119 to schedule an appointment.",
  bodyText: "river dental of fayetteville. new patients welcome. call us at (479) 888-5119 to schedule an appointment.",
  // contact/appointment form inside a CROSS-ORIGIN IFRAME (blind spot B):
  iframes: [{ src: "https://forms.variable.systems/embed?whatOffice=Fayetteville", title: "Request an Appointment" }],
  links: [{ text: "Schedule an Appointment", href: `${RIVER_URL}#book` }],
  tel: [], mailto: [], forms: 0,
};

describe("§9 River Dental fixture — the old blind spots are the exact recall gaps now closed", () => {
  it("phone existed ONLY as rendered text: an old tel:-anchor scan finds nothing; the hardened scan catches it", () => {
    expect(RIVER_MAIN.tel).toEqual([]);                                   // old harvester: no tel: anchor
    expect(detectRenderedPhones(RIVER_MAIN.rawText!)).toContain("+14798885119"); // new harvester: caught
  });
  it("form lived in a cross-origin iframe: an old document.forms scan sees zero; the classifier confirms a form path", () => {
    expect(RIVER_MAIN.forms ?? 0).toBe(0);                                // old harvester: 0 forms
    expect(classifyIframe(RIVER_MAIN.iframes![0].src)).toBe("confirmed"); // new harvester: known form provider
  });
  it("end-to-end: the hardened counter-test returns DISPROVEN (NOT a false no-path PROVEN)", async () => {
    const ex = await executeCounterTest(H({ primaryCustomerAction: "appointment", url: RIVER_URL }), { launch: async () => fakeBrowserFor({ [RIVER_URL]: RIVER_MAIN }) });
    expect(ex.executed).toBe(true);
    expect(ex.verdict).toBe("DISPROVEN");
    expect(ex.probeStatus).toBe("BROWSER_SUCCESS");
    expect(ex.nonDisruptive).toBe(true);
  });
});

// ── §10 REQUIRED TEST MATRIX (1–15) ──────────────────────────────────────────
describe("§10 harvester test matrix", () => {
  // 1) tel: phone
  it("1. tel: anchor phone is a usable path (contact ⇒ DISPROVEN)", async () => {
    const ex = await executeCounterTest(H({ primaryCustomerAction: "contact", url: "https://a.example/" }),
      { launch: async () => fakeBrowserFor({ "https://a.example/": { tel: ["tel:+14798885119"] } }) });
    expect(ex.verdict).toBe("DISPROVEN");
  });

  // 2) rendered-text phone
  it("2. rendered-text phone is detected", () => {
    expect(detectRenderedPhones("Call (479) 888-5119 today")).toEqual(["+14798885119"]);
  });

  // 3) formatted rendered-text phone variants
  it("3. all common NANP formats normalize to the same number", () => {
    for (const s of ["(479) 888-5119", "479-888-5119", "479.888.5119", "479 888 5119", "+1 479 888 5119", "1-479-888-5119"]) {
      expect(detectRenderedPhones(`ph: ${s} .`)).toEqual(["+14798885119"]);
    }
    expect(normalizePhone("14798885119")).toBe("+14798885119");
  });

  // 4) misleading number NOT classified as a phone
  it("4. dates, ZIP+4, long ids and repeated-digit placeholders are rejected", () => {
    expect(detectRenderedPhones("Open 12-31-2024 holidays")).toEqual([]);       // date
    expect(detectRenderedPhones("Ship to 12345-6789 today")).toEqual([]);        // ZIP+4
    expect(detectRenderedPhones("Order #1234567890 confirmed")).toEqual([]);     // run-together id
    expect(detectRenderedPhones("Call 000-000-0000 now")).toEqual([]);           // placeholder
    expect(detectRenderedPhones("ref 123-456-7890")).toEqual([]);                // invalid NANP area (1xx)
  });

  // 5) same-origin form
  it("5. an on-page <form> is a usable contact path ⇒ DISPROVEN", async () => {
    const ex = await executeCounterTest(H({ primaryCustomerAction: "contact", url: "https://f.example/" }),
      { launch: async () => fakeBrowserFor({ "https://f.example/": { forms: 1 } }) });
    expect(ex.verdict).toBe("DISPROVEN");
  });

  // 6) cross-origin KNOWN form iframe
  it("6. a known cross-origin form/booking iframe is confirmed ⇒ DISPROVEN", () => {
    expect(classifyIframe("https://form.jotform.com/2431")).toBe("confirmed");
    expect(classifyIframe("https://calendly.com/river-dental")).toBe("confirmed");
    const d = decideVerdict(H({ primaryCustomerAction: "appointment" }), [{ loaded: true, iframeForm: "confirmed", completeness: "COMPLETE", probeStatus: "BROWSER_SUCCESS" }]);
    expect(d.verdict).toBe("DISPROVEN");
  });

  // 7) ambiguous iframe → NEEDS_MORE, never PROVEN
  it("7. an un-inspectable form-ish cross-origin iframe ⇒ NEEDS_MORE_EVIDENCE (blocks no-path PROVEN)", async () => {
    expect(classifyIframe("https://unknown-widget.io/embed?type=contact-form")).toBe("possible");
    const ex = await executeCounterTest(H({ primaryCustomerAction: "appointment", url: "https://amb.example/" }),
      { launch: async () => fakeBrowserFor({ "https://amb.example/": { iframes: [{ src: "https://unknown-widget.io/embed?type=contact-form", title: "" }], bodyText: "welcome" } }) });
    expect(ex.verdict).toBe("NEEDS_MORE_EVIDENCE");
  });

  // 8) JS/lazy-loaded booking control (present after settle)
  it("8. a scheduler widget surfaced after settle ⇒ DISPROVEN", async () => {
    const ex = await executeCounterTest(H({ primaryCustomerAction: "booking", url: "https://lazy.example/" }),
      { launch: async () => fakeBrowserFor({ "https://lazy.example/": { iframes: [{ src: "https://squareup.com/appointments/book/river", title: "Book" }] } }) });
    expect(ex.verdict).toBe("DISPROVEN");
  });

  // 9) mobile-only signal is captured (phone visible on one viewport)
  it("9. a phone present in only one viewport still counts (booking ⇒ OBSERVED, not PROVEN)", () => {
    const d = decideVerdict(H({ primaryCustomerAction: "booking" }), [
      { loaded: true, completeness: "COMPLETE", probeStatus: "BROWSER_SUCCESS", pathIntended: true },
      { loaded: true, completeness: "COMPLETE", probeStatus: "BROWSER_SUCCESS", phoneText: true },
    ]);
    expect(d.verdict).toBe("OBSERVED");
  });

  // 10) curl/HTTP blocked in one place + browser works elsewhere ⇒ use browser evidence
  it("10. a blocked fetch never overrides a successful browser render", () => {
    const d = decideVerdict(H({ primaryCustomerAction: "contact" }), [
      { loaded: false, probeStatus: "HTTP_FETCH_BLOCKED", completeness: "BLOCKED" },
      { loaded: true, probeStatus: "BROWSER_SUCCESS", completeness: "COMPLETE", formPath: true },
    ]);
    expect(d.verdict).toBe("DISPROVEN");
  });

  // 11) browser blocked / indeterminate everywhere ⇒ NEEDS_MORE (never PROVEN)
  it("11. a bot-challenge with no successful render ⇒ NEEDS_MORE_EVIDENCE", () => {
    const d = decideVerdict(H(), [{ loaded: false, probeStatus: "BOT_CHALLENGE", completeness: "BLOCKED" }]);
    expect(d.verdict).toBe("NEEDS_MORE_EVIDENCE");
  });
  it("11b. a 403 bot wall in the live executor is not a missing path ⇒ NEEDS_MORE_EVIDENCE", async () => {
    const ex = await executeCounterTest(H({ url: "https://waf.example/" }),
      { launch: async () => fakeBrowserFor({ "https://waf.example/": {} }, () => 403) });
    expect(ex.verdict).toBe("NEEDS_MORE_EVIDENCE");
    expect(ex.probeStatus).toBe("BOT_CHALLENGE");
  });

  // 12) single page lacks contact but a site-wide destination works
  it("12. no path on the landing page, but the bounded crawl finds a working contact page ⇒ DISPROVEN", async () => {
    const ex = await executeCounterTest(H({ primaryCustomerAction: "quote", url: "https://plumber.example/" }),
      { launch: async () => fakeBrowserFor({
        "https://plumber.example/": { links: [{ text: "Contact Us", href: "https://plumber.example/contact" }], bodyText: "licensed plumber" },
        "https://plumber.example/contact": { forms: 1, bodyText: "request a quote" },
      }) });
    expect(ex.verdict).toBe("DISPROVEN");
  });

  // 13) intended CTA dead ⇒ PROVEN (precision retained)
  it("13. a reproducibly 404ing primary CTA is PROVEN (a phone elsewhere only mitigates)", async () => {
    const ex = await executeCounterTest(H({ primaryCustomerAction: "booking", url: "https://dead.example/" }),
      { launch: async () => fakeBrowserFor({
        "https://dead.example/": { links: [{ text: "Book Now", href: "https://dead.example/book" }], tel: ["tel:+14798885119"], bodyText: "book now" },
      }, (u) => (u.includes("/book") ? 404 : 200)) });
    expect(ex.verdict).toBe("PROVEN");
    expect(ex.defect?.family).toBe("broken-booking");
    expect(ex.mitigation).toBe("STRONG");
  });

  // 14) no feature AND no evidence one is intended ⇒ NOT PROVEN
  it("14. a fully-rendered empty page with no affirmative intent ⇒ OBSERVED, not PROVEN", async () => {
    const ex = await executeCounterTest(H({ primaryCustomerAction: "booking", url: "https://empty.example/" }),
      { launch: async () => fakeBrowserFor({ "https://empty.example/": {} }) });
    expect(ex.verdict).toBe("OBSERVED");
    expect(ex.harvestCompleteness).toBe("COMPLETE");
  });

  // 15) incomplete harvest cannot produce a no-path PROVEN
  it("15. PARTIAL harvest + intent + nothing found ⇒ NEEDS_MORE_EVIDENCE (fail closed)", () => {
    const d = decideVerdict(H({ primaryCustomerAction: "appointment" }), [
      { loaded: true, completeness: "PARTIAL", probeStatus: "BROWSER_SUCCESS", pathIntended: true },
    ]);
    expect(d.verdict).toBe("NEEDS_MORE_EVIDENCE");
  });
});

// ── Precision retained: a genuine "intended-but-unavailable" path is still PROVEN.
describe("recall improved WITHOUT destroying precision", () => {
  it("body says 'call to schedule' but NO phone/form/iframe anywhere ⇒ PROVEN no-path (material)", async () => {
    const ex = await executeCounterTest(H({ primaryCustomerAction: "appointment", url: "https://broken.example/" }),
      { launch: async () => fakeBrowserFor({ "https://broken.example/": { bodyText: "call our office to schedule an appointment today", rawText: "Call our office to schedule an appointment today" } }) });
    expect(ex.verdict).toBe("PROVEN");
    expect(ex.defect?.family).toBe("no-path");
    expect(ex.materiality).toBe("PASS");
    expect(ex.harvestCompleteness).toBe("COMPLETE");
  });
});
