import { describe, it, expect } from "vitest";
import {
  retryEligibility, resendWasContacted, describeSendState, terminalFailureReason,
  RETRYABLE_AFTER_CORRECTION, TERMINAL_FAILURE,
} from "./failure-classification";

const row = (over: Partial<Parameters<typeof retryEligibility>[0]> = {}) =>
  ({ status: "failed", lastErrorCode: null, providerMessageId: null, failedAt: "2026-09-01T01:14:12.962Z", attempts: 1, ...over }) as any;

describe("failure classification — retryable-after-correction vs genuinely terminal", () => {
  it("treats config/transient/internal failures that never reached the provider as OPERATOR-retryable", () => {
    for (const code of ["compliance_incomplete", "unconfigured", "recipient-gate", "route_refused", "route-refused", "review_not_ready", "server", "rate_limited", "network", "timeout", "auth", "internal"]) {
      const e = retryEligibility(row({ lastErrorCode: code }));
      expect(e.retryable, `${code} should be retryable`).toBe(true);
      expect(e.terminal).toBe(false);
      expect(e.resendContacted).toBe(false);
    }
  });

  it("keeps genuine recipient/provider hard-stops terminal (never retryable)", () => {
    for (const code of ["suppressed", "unsubscribed", "invalid-recipient", "validation", "client", "hard_bounce", "bounced", "complaint", "complained"]) {
      const e = retryEligibility(row({ lastErrorCode: code }));
      expect(e.retryable, `${code} must NOT be retryable`).toBe(false);
      expect(e.terminal).toBe(true);
    }
  });

  it("an AMBIGUOUS submit is terminal — the provider may already have accepted it", () => {
    const e = retryEligibility(row({ lastErrorCode: "ambiguous_submit" }));
    expect(e.retryable).toBe(false);
    expect(e.resendContacted).toBe(true); // uncertain → treat as contacted
  });

  it("a failure with a provider message id is NEVER retryable (already handed to the provider)", () => {
    const e = retryEligibility(row({ lastErrorCode: "server", providerMessageId: "resend-9" }));
    expect(e.retryable).toBe(false);
    expect(e.resendContacted).toBe(true);
  });

  it("an unknown code that never reached the provider fails OPEN toward an operator retry (nothing was delivered)", () => {
    const e = retryEligibility(row({ lastErrorCode: "something_new" }));
    expect(e.retryable).toBe(true);
    expect(e.kind).toBe("transient");
  });

  it("sent-family and non-failed rows are not applicable", () => {
    expect(retryEligibility(row({ status: "sent" })).applicable).toBe(false);
    expect(retryEligibility(row({ status: "queued" })).applicable).toBe(false);
  });

  it("resendWasContacted is true only when there's a provider id, a sent-family status, or an ambiguous fault", () => {
    expect(resendWasContacted(row({ lastErrorCode: "compliance_incomplete" }))).toBe(false);
    expect(resendWasContacted(row({ providerMessageId: "resend-1" }))).toBe(true);
    expect(resendWasContacted(row({ status: "delivered" }))).toBe(true);
    expect(resendWasContacted(row({ lastErrorCode: "ambiguous_submit" }))).toBe(true);
  });

  it("the two code sets never overlap", () => {
    for (const c of RETRYABLE_AFTER_CORRECTION) expect(TERMINAL_FAILURE.has(c)).toBe(false);
  });
});

describe("UI description — specific, honest, never the generic 'failed permanently'", () => {
  it("describes a missing-postal config failure as retryable with a concrete fix", () => {
    const v = describeSendState(row({ lastErrorCode: "compliance_incomplete", lastError: "compliance assembly failed: footer:no-postal" }))!;
    expect(v.retryAvailable).toBe(true);
    expect(v.resendContacted).toBe(false);
    expect(v.headline.toLowerCase()).toContain("not sent");
    expect(v.detail.toLowerCase()).toContain("address");
    expect(v.failedAt).toBeTruthy();
  });

  it("describes a suppression as a non-retryable hard-stop", () => {
    const v = describeSendState(row({ lastErrorCode: "suppressed" }))!;
    expect(v.retryAvailable).toBe(false);
    expect(v.headline.toLowerCase()).toContain("cannot send");
  });

  it("returns null when there is no prior failure", () => {
    expect(describeSendState(row({ status: "sent" }))).toBeNull();
    expect(describeSendState(null)).toBeNull();
  });

  it("never emits the generic 'previously failed permanently' phrase", () => {
    for (const code of [...RETRYABLE_AFTER_CORRECTION, ...TERMINAL_FAILURE]) {
      const reason = terminalFailureReason(row({ lastErrorCode: code }));
      expect(reason.toLowerCase()).not.toContain("previously failed permanently");
    }
  });
});
