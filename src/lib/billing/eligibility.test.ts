import { describe, it, expect } from "vitest";
import { evaluateBillingEligibility, assertBillingAllowed, BillingFirewallError, stripeModeOfKey, type EligibilityContext } from "./eligibility";

// A context that is fully eligible for LIVE payment; tests knock out one field at a time.
function liveReady(over: Partial<EligibilityContext> = {}): EligibilityContext {
  return {
    esignMode: "production",
    agreementStatus: "signed",
    allRequiredSignersComplete: true,
    approvalPresentAndValid: true,
    documentMatchesApproval: true,
    recipientsMatchApproval: true,
    recipientsPolicyOk: true,
    modeConsistent: true,
    retention: "retained",
    amountMatchesApproval: true,
    lifecycleTerminatedReason: null,
    ownerLivePaymentAuthorized: true,
    alreadyPaid: false,
    ...over,
  };
}
function testReady(over: Partial<EligibilityContext> = {}): EligibilityContext {
  return liveReady({ esignMode: "test", retention: "not-required", ownerLivePaymentAuthorized: false, ...over });
}

describe("evaluateBillingEligibility", () => {
  it("production happy path → ELIGIBLE_LIVE_PAYMENT", () => {
    expect(evaluateBillingEligibility(liveReady()).state).toBe("ELIGIBLE_LIVE_PAYMENT");
  });
  it("test happy path → ELIGIBLE_TEST_PAYMENT", () => {
    expect(evaluateBillingEligibility(testReady()).state).toBe("ELIGIBLE_TEST_PAYMENT");
  });

  it("blocks each way it can be unsafe", () => {
    expect(evaluateBillingEligibility(liveReady({ alreadyPaid: true })).state).toBe("PAID");
    expect(evaluateBillingEligibility(liveReady({ lifecycleTerminatedReason: "superseded" })).state).toBe("CANCELLED");
    expect(evaluateBillingEligibility(liveReady({ modeConsistent: false })).state).toBe("BLOCKED_MODE_MISMATCH");
    expect(evaluateBillingEligibility(liveReady({ agreementStatus: "viewed" })).state).toBe("BLOCKED_UNSIGNED");
    expect(evaluateBillingEligibility(liveReady({ allRequiredSignersComplete: false })).state).toBe("BLOCKED_PARTIAL_SIGNATURE");
    expect(evaluateBillingEligibility(liveReady({ approvalPresentAndValid: false })).state).toBe("BLOCKED_APPROVAL_MISSING");
    expect(evaluateBillingEligibility(liveReady({ documentMatchesApproval: false })).state).toBe("BLOCKED_DOCUMENT_MISMATCH");
    expect(evaluateBillingEligibility(liveReady({ recipientsMatchApproval: false })).state).toBe("BLOCKED_RECIPIENT_MISMATCH");
    expect(evaluateBillingEligibility(liveReady({ amountMatchesApproval: false })).state).toBe("BLOCKED_AMOUNT_MISMATCH");
    expect(evaluateBillingEligibility(liveReady({ recipientsPolicyOk: false })).state).toBe("BLOCKED_RECIPIENT_MISMATCH");
    expect(evaluateBillingEligibility(liveReady({ retention: "pending" })).state).toBe("BLOCKED_RETENTION_PENDING");
    expect(evaluateBillingEligibility(liveReady({ retention: "failed" })).state).toBe("BLOCKED_RETENTION_FAILED");
    expect(evaluateBillingEligibility(liveReady({ retention: "not-required" })).state).toBe("BLOCKED_RETENTION_PENDING");
    expect(evaluateBillingEligibility(liveReady({ ownerLivePaymentAuthorized: false })).state).toBe("BLOCKED_LIVE_AUTH_MISSING");
  });

  it("a TEST agreement can NEVER become ELIGIBLE_LIVE_PAYMENT regardless of other flags", () => {
    const ctx = testReady({ ownerLivePaymentAuthorized: true, retention: "retained" });
    expect(evaluateBillingEligibility(ctx).state).toBe("ELIGIBLE_TEST_PAYMENT");
  });

  it("an unsigned/partial test agreement is not eligible", () => {
    expect(evaluateBillingEligibility(testReady({ agreementStatus: "viewed" })).state).toBe("BLOCKED_UNSIGNED");
    expect(evaluateBillingEligibility(testReady({ allRequiredSignersComplete: false })).state).toBe("BLOCKED_PARTIAL_SIGNATURE");
  });
});

describe("assertBillingAllowed (the firewall)", () => {
  const elig = (s: any) => ({ state: s, reason: s });

  it("permits a test agreement against a test key", () => {
    expect(assertBillingAllowed({ intendedStripeMode: "test", esignMode: "test", eligibility: elig("ELIGIBLE_TEST_PAYMENT"), boundary: "invoice" })).toEqual({ allowedMode: "test" });
  });
  it("permits a production agreement against a live key when live-eligible", () => {
    expect(assertBillingAllowed({ intendedStripeMode: "live", esignMode: "production", eligibility: elig("ELIGIBLE_LIVE_PAYMENT"), boundary: "invoice" })).toEqual({ allowedMode: "live" });
  });

  it("REFUSES a test agreement against a live key (the core guarantee)", () => {
    expect(() => assertBillingAllowed({ intendedStripeMode: "live", esignMode: "test", eligibility: elig("ELIGIBLE_TEST_PAYMENT"), boundary: "invoice" })).toThrow(BillingFirewallError);
  });
  it("REFUSES a production agreement against a test key", () => {
    expect(() => assertBillingAllowed({ intendedStripeMode: "test", esignMode: "production", eligibility: elig("ELIGIBLE_LIVE_PAYMENT"), boundary: "invoice" })).toThrow(BillingFirewallError);
  });
  it("REFUSES live payment when not live-eligible even with a live key + production mode", () => {
    expect(() => assertBillingAllowed({ intendedStripeMode: "live", esignMode: "production", eligibility: elig("BLOCKED_RETENTION_PENDING"), boundary: "invoice" })).toThrow(BillingFirewallError);
  });
  it("REFUSES a test payment when the test agreement is blocked", () => {
    expect(() => assertBillingAllowed({ intendedStripeMode: "test", esignMode: "test", eligibility: elig("BLOCKED_PARTIAL_SIGNATURE"), boundary: "deposit" })).toThrow(BillingFirewallError);
  });
});

describe("stripeModeOfKey", () => {
  it("classifies keys without logging", () => {
    expect(stripeModeOfKey("sk_test_abc")).toBe("test");
    expect(stripeModeOfKey("sk_live_abc")).toBe("live");
    expect(stripeModeOfKey("rk_test_abc")).toBe("test");
    expect(stripeModeOfKey("whatever")).toBeNull();
    expect(stripeModeOfKey(null)).toBeNull();
  });
});
