import { describe, it, expect } from "vitest";
import { retainerReadiness, assertRetainerActivationBlocked, RetainerActivationBlockedError, REQUIRED_RETAINER_DECISIONS } from "./retainer";

describe("retainer readiness (draft-only, activation blocked)", () => {
  it("reports blocked + missing decisions when a monthly figure is present", () => {
    const r = retainerReadiness({ monthlyPartnershipCents: 150_000, currency: "usd" });
    expect(r.present).toBe(true);
    expect(r.monthlyAmountCents).toBe(150_000);
    expect(r.activationBlocked).toBe(true);
    expect(r.missingDecisions).toEqual([...REQUIRED_RETAINER_DECISIONS]);
  });

  it("reports nothing to draft when no monthly figure exists", () => {
    const r = retainerReadiness({ monthlyPartnershipCents: null, currency: "usd" });
    expect(r.present).toBe(false);
    expect(r.monthlyAmountCents).toBeNull();
    expect(r.activationBlocked).toBe(true);
  });

  it("activation guard always throws (no subscription can be created)", () => {
    expect(() => assertRetainerActivationBlocked()).toThrow(RetainerActivationBlockedError);
  });
});
