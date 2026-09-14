import { describe, it, expect } from "vitest";
import { evaluateFirstTouchCopy } from "./copy-gate";

// SYNTHETIC WARM-UP CONVERSATION. This is the exact generic copy observed in the
// "Hass Khan" thread, which is WARM-UP traffic (an external warm-up SaaS peer), NOT a
// real prospect. It is retained ONLY as a genericness regression — copy of this shape
// must be incapable of passing the gate. It is NOT a positive-reply / conversion signal.
const HASS_BODY = `Hello Hass Khan,

I'm surprised by how often companies use different tools for subscriber management. I'm reaching out from Jordan Jackson to connect with whoever oversees your email marketing tools. Would you be the best person to discuss how your team manages subscribers?

Phone: +1 (424) 75979180`;

describe("first-touch quality gate — generic copy cannot leak", () => {
  it("REGRESSION: the exact Hass legacy copy is SUPPRESSED", () => {
    const r = evaluateFirstTouchCopy({ subject: "Subscriber management", body: HASS_BODY, businessName: "Acme Email Co" });
    expect(r.pass).toBe(false);
    expect(r.verdict).toBe("SUPPRESSED");
    expect(r.reasons.join(" ")).toMatch(/generic|person-finding|whoever|discuss/i);
  });

  it("category-only personalization (no lead-specific reason) is SUPPRESSED", () => {
    const r = evaluateFirstTouchCopy({ subject: "Marketing", body: "Hi there, we help businesses improve their digital presence. Can we schedule 15 minutes?", businessName: "Riverbend Dental" });
    expect(r.pass).toBe(false);
    expect(r.verdict).toBe("SUPPRESSED");
  });

  it("person-finding with NO reason is SUPPRESSED", () => {
    const r = evaluateFirstTouchCopy({ subject: "Quick q", body: "Hi, are you the person responsible for marketing? Would love to learn more about your needs.", businessName: "Riverbend Dental" });
    expect(r.pass).toBe(false);
  });

  it("unsupported definite-defect claim (not PROVEN) is SUPPRESSED", () => {
    const r = evaluateFirstTouchCopy({
      subject: "Your booking", body: "Hi, I was looking at Riverbend Dental and your booking form is broken — nobody can book. Happy to send what I found.",
      businessName: "Riverbend Dental", problemRealityStatus: "DISPROVEN",
    });
    expect(r.pass).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/unsupported/i);
  });

  it("the SAME definite claim PASSES when Problem Reality is PROVEN", () => {
    const r = evaluateFirstTouchCopy({
      subject: "Riverbend booking", body: "Hi, I was looking at Riverbend Dental and the booking form doesn't work on mobile. Happy to send you exactly what I found — no pressure.",
      businessName: "Riverbend Dental", problemRealityStatus: "PROVEN",
    });
    expect(r.pass).toBe(true);
    expect(r.verdict).toBe("SEND");
  });

  it("OBSERVED (hedged) copy passes without proof; wording stays distinct from PROVEN", () => {
    const r = evaluateFirstTouchCopy({
      subject: "One thing on Riverbend's site",
      body: "Hi, I was looking through Riverbend Dental's website earlier and wasn't sure whether new patients can book online, or if that's intentional. Happy to send over what I noticed — no pressure.",
      businessName: "Riverbend Dental", problemRealityStatus: "NEEDS_MORE_EVIDENCE",
    });
    expect(r.pass).toBe(true);
    expect(r.scores.claimSafety).toBe(1);
  });

  it("strong, specific, low-friction copy is cleared to SEND", () => {
    const r = evaluateFirstTouchCopy({
      subject: "A quick note about Riverbend Dental",
      body: "Hi Dana, I was looking through Riverbend Dental's website earlier and noticed the appointment page. I could be wrong from the outside, but happy to send over the couple of things I noticed if it's useful.",
      businessName: "Riverbend Dental", observation: "appointment page has no online booking",
    });
    expect(r.pass).toBe(true);
  });

  it("a meeting-ask before establishing why is SUPPRESSED", () => {
    const r = evaluateFirstTouchCopy({ subject: "Coffee?", body: "Hi, could we hop on a 15 minute call this week about Riverbend Dental?", businessName: "Riverbend Dental" });
    expect(r.pass).toBe(false);
  });

  it("does NOT false-positive the canonical deterministic first-touch copy", () => {
    const good = `Hi there,

I was looking through Riverbend Dental's website earlier and, honestly, most of it looked good.

One thing I wasn't sure about: how a new patient gets in touch after the first visit.

I put together a quick one-page review for Riverbend Dental and attached it here.

I'm Jordan, I run Artifex Labs, a small studio here in LA. I could be wrong from the outside, so mostly I wanted to ask if that lines up with what you see.

Happy to send over the couple of things I noticed if it's useful. No pressure either way.`;
    const r = evaluateFirstTouchCopy({ subject: "A quick question about Riverbend Dental", body: good, businessName: "Riverbend Dental" });
    expect(r.pass).toBe(true);
    expect(r.verdict).toBe("SEND");
  });
});
