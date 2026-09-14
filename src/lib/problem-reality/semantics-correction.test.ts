import { describe, it, expect } from "vitest";
import { decideVerdict, type ProbeSignal } from "./verdict";
import { executeCounterTest, type BrowserLike } from "./counter-test";
import { coldOutreachDecision } from "../outreach/cold-outreach-policy";
import type { ProblemHypothesis } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// PROBLEM-REALITY SEMANTICS CORRECTION (§11).
// An alternate path can REDUCE the impact of a defect. It does NOT make a
// reproducible defect disappear. Counter-testing answers "does the SPECIFIC
// hypothesized defect actually occur?", not "can the customer reach the goal by
// any other means?". PROVEN still requires a real, reproducible, material defect.
// ─────────────────────────────────────────────────────────────────────────────

const H = (over: Partial<ProblemHypothesis> = {}): ProblemHypothesis => ({
  id: "h1", claim: "No usable online booking path for a customer", primaryCustomerAction: "booking",
  browserDependent: true, url: "https://example.com", ...over,
});

describe("decideVerdict — defect first, alternate path = mitigation", () => {
  it("broken booking + phone fallback ⇒ PROVEN + mitigation (NOT DISPROVEN)", () => {
    const d = decideVerdict(H({ primaryCustomerAction: "booking" }), [
      { loaded: true, deadPath: { family: "broken-booking", detail: "Book Now → /book HTTP 404" }, phonePath: true },
      { loaded: true, deadPath: { family: "broken-booking", detail: "Book Now → /book HTTP 404" }, phonePath: true },
    ]);
    expect(d.verdict).toBe("PROVEN");
    expect(d.mitigation).toBe("STRONG");     // phone still reaches the goal
    expect(d.severity).toBe("LOW");          // strongly mitigated
    expect(d.materiality).toBe("PASS");      // booking is a material function
    expect(d.defect?.family).toBe("broken-booking");
  });

  it("broken contact form path + mailto fallback ⇒ PROVEN + mitigation", () => {
    const d = decideVerdict(H({ primaryCustomerAction: "contact", claim: "No usable contact path" }), [
      { loaded: true, deadPath: { family: "broken-cta", detail: "Contact → /contact HTTP 500" }, emailPath: true },
    ]);
    expect(d.verdict).toBe("PROVEN");
    expect(["PARTIAL", "STRONG"]).toContain(d.mitigation);
    expect(d.materiality).toBe("PASS");
  });

  it("working form + phone fallback (no defect) ⇒ DISPROVEN", () => {
    const d = decideVerdict(H({ primaryCustomerAction: "contact" }), [
      { loaded: true, formPath: true, phonePath: true },
    ]);
    expect(d.verdict).toBe("DISPROVEN");
  });

  it("missing online booking + phone only (no defect) ⇒ OBSERVED, NOT PROVEN", () => {
    const d = decideVerdict(H({ primaryCustomerAction: "booking" }), [
      { loaded: true, phonePath: true },
    ]);
    expect(d.verdict).toBe("OBSERVED");
  });

  it("minor cosmetic defect ⇒ PROVEN technical fact but MATERIALITY FAIL", () => {
    const d = decideVerdict(H({ primaryCustomerAction: "non-interactive", claim: "cosmetic" }), [
      { loaded: true, deadPath: { family: "cosmetic", detail: "footer icon 404" }, cosmetic: true, phonePath: true },
    ]);
    expect(d.verdict).toBe("PROVEN");
    expect(d.materiality).toBe("FAIL");
  });

  it("material broken CTA, no fallback ⇒ PROVEN + MATERIALITY PASS + HIGH severity", () => {
    const d = decideVerdict(H({ primaryCustomerAction: "cta-availability", claim: "primary CTA dead" }), [
      { loaded: true, deadPath: { family: "broken-cta", detail: "Get Started → /start HTTP 404" } },
    ]);
    expect(d.verdict).toBe("PROVEN");
    expect(d.materiality).toBe("PASS");
    expect(d.mitigation).toBe("NONE");
    expect(d.severity).toBe("HIGH");
  });

  it("a usable online path still ⇒ DISPROVEN (the surface works)", () => {
    expect(decideVerdict(H(), [{ loaded: true, widget: true }]).verdict).toBe("DISPROVEN");
  });
});

// A fake browser whose click-through destination 404s, proving the executor turns a
// dead primary-action link into a PROVEN defect end-to-end (not DISPROVEN/OBSERVED).
function fakeBrowserDeadLink(): BrowserLike {
  const probe = {
    title: "Example", overlaysDismissed: [], links: [{ text: "book now", href: "https://example.com/dead-book" }],
    buttons: [], iframes: [], tel: ["tel:+18645551234"], mailto: [], forms: 0, openedMenu: false, bodyText: "book now",
  };
  const makePage = () => ({
    goto: async (url: string) => ({ status: () => (String(url).includes("/dead-book") ? 404 : 200) }),
    url: () => "https://example.com/",
    title: async () => "Example",
    evaluate: async () => probe,
    content: async () => "",
    close: async () => {},
  });
  const ctx = { newPage: async () => makePage(), close: async () => {} };
  return { newContext: async () => ctx, close: async () => {} } as unknown as BrowserLike;
}

describe("executeCounterTest — dead booking link ⇒ PROVEN defect", () => {
  it("a reproducibly 404ing Book Now link is PROVEN (phone only mitigates)", async () => {
    const ex = await executeCounterTest(H({ primaryCustomerAction: "booking" }), { launch: async () => fakeBrowserDeadLink() });
    expect(ex.executed).toBe(true);
    expect(ex.verdict).toBe("PROVEN");
    expect(ex.defect?.family).toBe("broken-booking");
    expect(ex.mitigation).toBe("STRONG");   // valid phone present
    expect(ex.materiality).toBe("PASS");
    expect(ex.nonDisruptive).toBe(true);
  });
});

describe("channel policy — materiality gate", () => {
  it("PROVEN + materiality FAIL + email ⇒ NOT_MATERIAL, ineligible", () => {
    expect(coldOutreachDecision({ verdict: "PROVEN", sendEligibleEmail: true, contactFormUsable: true, materiality: "FAIL" }))
      .toMatchObject({ eligible: false, classification: "NOT_MATERIAL" });
  });
  it("PROVEN + materiality PASS + email ⇒ EMAIL_READY", () => {
    expect(coldOutreachDecision({ verdict: "PROVEN", sendEligibleEmail: true, contactFormUsable: false, materiality: "PASS" }))
      .toMatchObject({ eligible: true, classification: "EMAIL_READY" });
  });
});
