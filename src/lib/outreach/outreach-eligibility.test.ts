import { describe, it, expect } from "vitest";
import { dispatchGate } from "./copy-gate";
import { coldOutreachDecision } from "./cold-outreach-policy";

// §8 ELIGIBILITY MATRIX. The wire (dispatchGate) refuses any non-PROVEN cold outreach;
// the channel policy allows email (primary) or contact-form (secondary) after PROVEN,
// never phone. PROVEN + phone-only ⇒ PROVEN_UNCONTACTABLE.
const goodProvenCopy = {
  subject: "A quick note about Riverbend Dental",
  body: "Hi there, I was looking through Riverbend Dental's website earlier and the booking form doesn't work on mobile. Happy to send exactly what I found — no pressure.",
  businessName: "Riverbend Dental",
};

describe("wire-level dispatch — PROVEN required", () => {
  it("PROVEN + valid, specific copy → may dispatch (not blocked)", () => {
    const g = dispatchGate({ ...goodProvenCopy, problemRealityStatus: "PROVEN" });
    expect(g.block).toBe(false);
  });

  it("every non-PROVEN verdict is hard-blocked at the wire", () => {
    for (const v of ["OBSERVED", "NEEDS_MORE_EVIDENCE", "NO_MATERIAL_PROBLEM", "DISPROVEN", "", null, undefined]) {
      const g = dispatchGate({ ...goodProvenCopy, body: "Hi there, I noticed something on Riverbend Dental's site and wasn't sure if it was intentional. Happy to share.", problemRealityStatus: v as any });
      expect(g.block).toBe(true);
      expect(g.reason).toBe("SUPPRESSED — PROBLEM NOT PROVEN");
    }
  });
});

describe("channel policy — email primary, form secondary, never phone", () => {
  it("PROVEN + valid email → EMAIL_READY", () => {
    expect(coldOutreachDecision({ verdict: "PROVEN", sendEligibleEmail: true, contactFormUsable: true }))
      .toMatchObject({ eligible: true, channel: "email", classification: "EMAIL_READY" });
  });
  it("PROVEN + no email + usable form → FORM_READY", () => {
    expect(coldOutreachDecision({ verdict: "PROVEN", sendEligibleEmail: false, contactFormUsable: true }))
      .toMatchObject({ eligible: true, channel: "contact-form", classification: "FORM_READY" });
  });
  it("PROVEN + phone only (no email, no form) → PROVEN_UNCONTACTABLE (no cold phone)", () => {
    expect(coldOutreachDecision({ verdict: "PROVEN", sendEligibleEmail: false, contactFormUsable: false }))
      .toMatchObject({ eligible: false, channel: "none", classification: "PROVEN_UNCONTACTABLE" });
  });
  it("OBSERVED + email → NOT_PROVEN (blocked, never contacted)", () => {
    expect(coldOutreachDecision({ verdict: "OBSERVED", sendEligibleEmail: true, contactFormUsable: true }))
      .toMatchObject({ eligible: false, classification: "NOT_PROVEN" });
  });
  it("OBSERVED + phone → NOT_PROVEN (blocked)", () => {
    expect(coldOutreachDecision({ verdict: "OBSERVED", sendEligibleEmail: false, contactFormUsable: false }))
      .toMatchObject({ eligible: false, classification: "NOT_PROVEN" });
  });
});
