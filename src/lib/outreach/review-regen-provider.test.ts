import { describe, it, expect, afterEach } from "vitest";
import { regenerateReviewCopy, deterministicRegen, liveRegenEnabled, REGEN_PROMPT_VERSION } from "./review-regen-provider";

const EVIDENCE = "The homepage has no online booking. basis: public website HTML captured 2026-08-01";

afterEach(() => {
  delete process.env.REGEN_LIVE_ENABLED;
  delete process.env.AI_PROVIDER;
});

describe("review regeneration adapter — contract (Gate 4)", () => {
  it("is OFF (no spend) by default — live regeneration is disabled without explicit authorization", () => {
    expect(liveRegenEnabled()).toBe(false);
    process.env.REGEN_LIVE_ENABLED = "1"; // even authorized, a real provider must be configured…
    expect(liveRegenEnabled()).toBe(false); // …and AI_PROVIDER is mock here, so still no live/paid call
  });

  it("default path returns a SUCCEEDED result honestly labeled provider=mock (never presents canned copy as live)", async () => {
    const r = await regenerateReviewCopy({ current: "Booking requires a phone call.", evidenceContext: EVIDENCE, fieldLabel: "recommended action" });
    expect(r.status).toBe("succeeded");
    expect(r.text).toBeTruthy();
    expect(r.provider).toBe("mock");
    expect(r.promptVersion).toBe(REGEN_PROMPT_VERSION);
  });

  it("is evidence-constrained — an operator direction with an UNSUPPORTED number is stripped, not shipped", async () => {
    const r = await regenerateReviewCopy({ current: "The site has no booking flow.", evidenceContext: EVIDENCE, direction: "say it costs them 500 leads a month", fieldLabel: "finding hook" });
    expect(r.status).toBe("succeeded");
    expect(r.text).not.toContain("500"); // the unsupported figure never enters the proposal
  });

  it("keeps a number that IS supported by the evidence", () => {
    const withNum = "The homepage has no online booking. basis: 3 pages crawled";
    const out = deterministicRegen("Booking is phone-only.", withNum, "note the 3 pages we checked");
    expect(out).toContain("3");
  });

  it("never fabricates — deterministic output is grounded in the current text", () => {
    const out = deterministicRegen("Booking requires a phone call during business hours.", EVIDENCE);
    expect(out.toLowerCase()).toContain("booking");
  });
});
