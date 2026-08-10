import { describe, it, expect } from "vitest";
import { makeLead } from "../test-lead";
import { panelForWorkKind, isCallFirstLead } from "./call-routing";
import { WORK_KINDS } from "../work-queue";

// ─────────────────────────────────────────────────────────────────────────────
// ROUTING (tests 1-5)
//
// One kind of work, one surface. Arriving from the daily batch and arriving from
// the business page must land the operator on the same instrument.
// ─────────────────────────────────────────────────────────────────────────────
describe("where a call happens", () => {
  it("1. calling in a batch uses the call workspace — not the recommendation panel", () => {
    expect(panelForWorkKind("call")).toBe("call-workspace");
  });

  it("2. the other channel kinds keep the contact-strategy panel", () => {
    expect(panelForWorkKind("contact-form")).toBe("contact-strategy");
    expect(panelForWorkKind("instagram-dm")).toBe("contact-strategy");
  });

  it("3. email work is unchanged, and everything else still deep-links", () => {
    expect(panelForWorkKind("email")).toBe("email-decision");
    expect(panelForWorkKind("follow-up")).toBe("email-decision");
    expect(panelForWorkKind("video")).toBe("video-script");
    expect(panelForWorkKind("report")).toBe("deep-link");
    expect(panelForWorkKind("discovery")).toBe("deep-link");
    expect(panelForWorkKind("understand")).toBe("deep-link");
    // Every kind of work resolves to exactly one surface — no kind falls through.
    for (const k of WORK_KINDS) expect(panelForWorkKind(k)).toBeTruthy();
  });

  // A non-gatekeeper (owner-accessible) business, so no-email → call-first holds. Gatekeeper
  // dental/legal routing is covered in contact-strategy.test.
  const ownerAccessible = (over: Parameters<typeof makeLead>[0] = {}) => makeLead({ industry: "Auto repair", normalizedCategory: "auto-repair", ...over });

  it("4. a business with no send route is call-first", () => {
    const lead = ownerAccessible({ publicEmail: null, phone: "(213) 555-0100" });
    expect(isCallFirstLead(lead)).toBe(true);

    // With a real public inbox, it is not — the email flow owns it.
    expect(isCallFirstLead(ownerAccessible({ publicEmail: "hello@x.com", phone: "(213) 555-0100" }))).toBe(false);
  });

  it("5. a blank or malformed address is not a send route and never ends the call workflow", () => {
    for (const bad of ["", "   ", "info@", "@x.com", "not an email", "info@localhost"]) {
      expect(isCallFirstLead(ownerAccessible({ publicEmail: bad, phone: "(213) 555-0100" })), `"${bad}" treated as a send route`).toBe(true);
    }
  });

  it("5b. a business we cannot actually call is not call-first either", () => {
    // No dialable number → the only honest next action is finding a contact route.
    expect(isCallFirstLead(makeLead({ publicEmail: null, phone: null, website: null, socialLinks: [] }))).toBe(false);
  });
});
