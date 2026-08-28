import { describe, it, expect } from "vitest";
import { makeLead } from "../test-lead";
import { callWithheld } from "../work-queue";
import { isEngaged } from "./call-priority";

// Email-first, calls-only-after-engagement policy (server-side, enforced in the work queue).
const WEEKDAY = new Date("2026-08-11T19:00:00.000Z"); // Tue ~noon PT — office hours, so only ENGAGEMENT gates.

describe("email-first policy — the queue never proposes a cold or unanswered-email call", () => {
  it("a cold, never-contacted prospect is NOT surfaced for a call", () => {
    const cold = makeLead({ pipelineStage: "Qualified", publicEmail: "hi@shop.example", phone: "(213) 555-0100", state: "CA" });
    expect(isEngaged(cold)).toBe(false);
    expect(callWithheld(cold, WEEKDAY)).toBe(true);
  });

  it("a lead we merely EMAILED and heard nothing back from is NOT surfaced for a call (unanswered ≠ engaged)", () => {
    const contacted = makeLead({ pipelineStage: "Contacted", lastContactAt: "2026-08-05T00:00:00Z", publicEmail: "hi@shop.example", state: "CA" });
    expect(isEngaged(contacted)).toBe(false);
    expect(callWithheld(contacted, WEEKDAY)).toBe(true); // no cold-call chase off an unanswered email
  });

  it("a no-usable-email lead is NOT substituted with a cold call (no call-to-find-email busywork)", () => {
    const noEmail = makeLead({ pipelineStage: "Qualified", publicEmail: null, phone: "(213) 555-0100", state: "CA" });
    expect(callWithheld(noEmail, WEEKDAY)).toBe(true); // excluded from email queue elsewhere; never a call substitute
  });

  it("an opted-out / lost lead is NEVER surfaced for a call", () => {
    for (const stage of ["Lost", "Disqualified", "Nurture"] as const) {
      const out = makeLead({ pipelineStage: stage, publicEmail: "hi@shop.example", state: "CA" });
      expect(isEngaged(out)).toBe(false);
      expect(callWithheld(out, WEEKDAY)).toBe(true);
    }
  });

  it("an ENGAGED lead (booked / in conversation) MAY be surfaced for a call during office hours", () => {
    for (const stage of ["Meeting Booked", "Discovery Complete", "Proposal Sent"] as const) {
      const engaged = makeLead({ pipelineStage: stage, publicEmail: "hi@shop.example", phone: "(213) 555-0100", state: "CA", industry: "Auto repair", normalizedCategory: "auto-repair" });
      expect(isEngaged(engaged)).toBe(true);
      expect(callWithheld(engaged, WEEKDAY)).toBe(false); // engaged + open office → a call is allowed
    }
  });
});
