import { describe, it, expect } from "vitest";
import { decideVerdict, actionMatchesText, KEYWORDS } from "./verdict";
import { classifyAction, expectedPrimaryAction, isBrowserDependent, deriveHypotheses } from "./hypothesis";
import { executeCounterTest, type BrowserLike } from "./counter-test";
import { continuesDownstream } from "./types";
import type { ProblemHypothesis } from "./types";

const H = (over: Partial<ProblemHypothesis> = {}): ProblemHypothesis => ({
  id: "h1", claim: "No usable online booking path for a customer", primaryCustomerAction: "booking",
  browserDependent: true, url: "https://example.com", ...over,
});

describe("action classification", () => {
  it("maps text to actions", () => {
    expect(classifyAction("No online booking available")).toBe("booking");
    expect(classifyAction("Cannot schedule an appointment")).toBe("appointment");
    expect(classifyAction("No way to request a quote")).toBe("quote");
    expect(classifyAction("Contact form missing")).toBe("contact");
    expect(classifyAction("Site not served over HTTPS")).toBe("non-interactive");
  });
  it("knows expected primary action by industry", () => {
    expect(expectedPrimaryAction("Med spa")).toBe("booking");
    expect(expectedPrimaryAction("Law firm")).toBe("contact");
    expect(expectedPrimaryAction("Plumbing")).toBe("quote");
  });
  it("classifies browser dependence", () => {
    expect(isBrowserDependent("booking")).toBe(true);
    expect(isBrowserDependent("non-interactive")).toBe(false);
  });
  it("derives a default hypothesis when there are no findings", () => {
    const hs = deriveHypotheses({ id: "l1", industry: "Med spa", website: "https://x.com" });
    expect(hs).toHaveLength(1);
    expect(hs[0].primaryCustomerAction).toBe("booking");
    expect(hs[0].browserDependent).toBe(true);
  });
});

describe("actionMatchesText word-boundary", () => {
  it("matches whole words only", () => {
    expect(actionMatchesText("booking", "Book Now")).toBe(true);
    expect(actionMatchesText("booking", "facebook")).toBe(false); // not a boundary match
    expect(actionMatchesText("contact", "Contact us")).toBe(true);
  });
});

describe("decideVerdict", () => {
  it("DISPROVEN when an online path exists", () => {
    expect(decideVerdict(H(), [{ loaded: true, onlinePath: true }]).verdict).toBe("DISPROVEN");
  });
  it("DISPROVEN when a scheduler widget is present", () => {
    expect(decideVerdict(H(), [{ loaded: true, widget: true }]).verdict).toBe("DISPROVEN");
  });
  it("booking + phone-only ⇒ OBSERVED (specific observable gap, not a provable defect ⇒ conversation)", () => {
    expect(decideVerdict(H({ primaryCustomerAction: "booking" }), [{ loaded: true, phonePath: true }]).verdict).toBe("OBSERVED");
  });
  it("contact + phone/email ⇒ DISPROVEN", () => {
    expect(decideVerdict(H({ primaryCustomerAction: "contact" }), [{ loaded: true, emailPath: true }]).verdict).toBe("DISPROVEN");
  });
  it("loaded, nothing found ⇒ PROVEN", () => {
    expect(decideVerdict(H(), [{ loaded: true }, { loaded: true }]).verdict).toBe("PROVEN");
  });
  it("never loaded ⇒ NEEDS_MORE_EVIDENCE", () => {
    expect(decideVerdict(H(), [{ loaded: false }]).verdict).toBe("NEEDS_MORE_EVIDENCE");
  });
  it("ambiguous candidate ⇒ NEEDS_MORE_EVIDENCE", () => {
    expect(decideVerdict(H(), [{ loaded: true, candidatePath: true }]).verdict).toBe("NEEDS_MORE_EVIDENCE");
  });
});

// ── Injected fake browser: prove EXECUTED (not planned), non-disruptive, and that
//    a real online path drives DISPROVEN through the whole executor. No playwright.
function fakeBrowser(probe: Record<string, unknown>): BrowserLike {
  const page = {
    goto: async () => ({ status: () => 200 }),
    url: () => "https://example.com/",
    title: async () => "Example",
    evaluate: async () => probe,
    content: async () => "",
    close: async () => {},
  };
  const ctx = { newPage: async () => page, close: async () => {} };
  return { newContext: async () => ctx, close: async () => {} } as unknown as BrowserLike;
}

const emptyProbe = { title: "Example", overlaysDismissed: [], links: [], buttons: [], iframes: [], tel: [], mailto: [], forms: 0, openedMenu: false, bodyText: "" };

describe("executeCounterTest (injected browser)", () => {
  it("marks executed=true and stays non-disruptive", async () => {
    const ex = await executeCounterTest(H(), { launch: async () => fakeBrowser(emptyProbe) });
    expect(ex.executed).toBe(true);
    expect(ex.nonDisruptive).toBe(true);
    expect(ex.pagesVisited.length).toBeGreaterThan(0);
  });
  it("a contact page/form ⇒ DISPROVEN", async () => {
    const probe = { ...emptyProbe, links: [{ text: "contact us", href: "https://example.com/contact" }], forms: 1 };
    const ex = await executeCounterTest(H({ primaryCustomerAction: "contact", claim: "No usable way to contact" }), { launch: async () => fakeBrowser(probe) });
    expect(ex.verdict).toBe("DISPROVEN");
  });
  it("empty site with a booking claim ⇒ PROVEN and continues downstream", async () => {
    const ex = await executeCounterTest(H(), { launch: async () => fakeBrowser(emptyProbe) });
    expect(ex.verdict).toBe("PROVEN");
    const pr = { hypothesis: H(), status: ex.verdict, execution: ex, basis: "live-counter-test" as const, decidedAt: "" };
    expect(continuesDownstream(pr)).toBe(true);
  });
  it("PLANNED never satisfies EXECUTED: a browser-dependent PROVEN needs a live basis", () => {
    const planned = { hypothesis: H(), status: "PROVEN" as const, basis: "not-executed" as const, decidedAt: "" };
    expect(continuesDownstream(planned)).toBe(false);
  });
  it("no URL ⇒ not executed", async () => {
    const ex = await executeCounterTest(H({ url: "" }));
    expect(ex.executed).toBe(false);
  });
});

describe("keyword coverage", () => {
  it("every browser-dependent action has keywords", () => {
    for (const a of ["booking", "appointment", "contact", "quote"] as const) {
      expect(KEYWORDS[a].length).toBeGreaterThan(0);
    }
  });
});
