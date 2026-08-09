import { describe, it, expect } from "vitest";
import { callHandoffOpener } from "./call-handoff";
import type { Contact, Lead } from "../types";

const lead = (over: Partial<Lead> = {}): Pick<Lead, "publicEmail" | "businessName"> =>
  ({ businessName: "Villa Brasil Motel", publicEmail: "reviews@villabrasil.example", ...over }) as Lead;

const contact = (over: Partial<Contact> = {}): Contact =>
  ({ id: "c", leadId: "l", name: "Marcus", title: "Front desk", email: "reviews@villabrasil.example",
     phone: null, linkedinUrl: null, source: "conversation", confidence: "Verified", verified: true,
     optedOut: false, createdAt: "", updatedAt: "", ...over } as Contact);

describe("callHandoffOpener — a phone-won email opens like a continuation of the call", () => {
  it("A. name + front-desk role + permission → the natural front-desk line", () => {
    const s = callHandoffOpener(lead(), [contact()]);
    expect(s).toBe("I spoke with Marcus at the front desk earlier today, and they let me know it was okay to send this review over.");
  });

  it("A2. owner/manager render as a person role, not a place", () => {
    expect(callHandoffOpener(lead(), [contact({ title: "Owner" })]))
      .toBe("I spoke with Marcus, the owner, earlier today, and they let me know it was okay to send this review over.");
  });

  it("B. name known, role unknown → name only", () => {
    expect(callHandoffOpener(lead(), [contact({ title: "—" })]))
      .toBe("I spoke with Marcus earlier today, and they let me know it was okay to send this review over.");
  });

  it("C. role known, name unknown (falls back to business name) → someone at the front desk", () => {
    expect(callHandoffOpener(lead(), [contact({ name: "Villa Brasil Motel" })]))
      .toBe("I spoke with someone at the front desk earlier today, and they let me know it was okay to send this review over.");
  });

  it("D. human contact + permission, no person details → generic team line", () => {
    expect(callHandoffOpener(lead(), [contact({ name: "Villa Brasil Motel", title: "—" })]))
      .toBe("I spoke with someone on your team earlier today, and they let me know it was okay to send this review over.");
  });

  it("E. public-email-first / no call contact → no fabricated conversation", () => {
    expect(callHandoffOpener(lead(), [])).toBeNull();
    // A conversation contact that is NOT the send route (collected, no permission) is not a handoff.
    expect(callHandoffOpener(lead(), [contact({ email: "someone-else@x.com" })])).toBeNull();
    // A web/enrichment contact is not a phone handoff even if the email matches.
    expect(callHandoffOpener(lead(), [contact({ source: "web" })])).toBeNull();
  });

  it("never fabricates when there is no send route", () => {
    expect(callHandoffOpener(lead({ publicEmail: null }), [contact()])).toBeNull();
  });

  it("is generic — nothing about Villa Brasil / Marcus is hard-coded", () => {
    const s = callHandoffOpener(
      { businessName: "Acme Dental", publicEmail: "front@acme.example" } as Lead,
      [contact({ name: "Dana", title: "Manager", email: "front@acme.example" })],
    );
    expect(s).toBe("I spoke with Dana, the manager, earlier today, and they let me know it was okay to send this review over.");
  });
});
