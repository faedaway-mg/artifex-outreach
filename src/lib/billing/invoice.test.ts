import { describe, it, expect } from "vitest";
import { canTransition, invoiceIdempotencyKey, shouldSkipForPaidCheckoutDeposit, isSettledPositive } from "./invoice";

describe("invoice state machine", () => {
  it("collection path is forward: draft→issued→processing→paid", () => {
    expect(canTransition("draft", "issued")).toBe(true);
    expect(canTransition("issued", "processing")).toBe(true);
    expect(canTransition("processing", "paid")).toBe(true);
  });

  it("money state is NOT globally forward-only: refund/dispute reachable from paid", () => {
    expect(canTransition("paid", "refunded")).toBe(true);
    expect(canTransition("paid", "partially_refunded")).toBe(true);
    expect(canTransition("paid", "disputed")).toBe(true);
    // dispute can resolve either way without erasing that it was paid
    expect(canTransition("disputed", "paid")).toBe(true);
    expect(canTransition("disputed", "refunded")).toBe(true);
  });

  it("void is terminal; draft cannot jump straight to paid", () => {
    expect(canTransition("void", "paid")).toBe(false);
    expect(canTransition("draft", "paid")).toBe(false);
  });

  it("re-applying the same state is idempotent", () => {
    expect(canTransition("paid", "paid")).toBe(true);
  });

  it("only paid counts as settled-positive", () => {
    expect(isSettledPositive("paid")).toBe(true);
    expect(isSettledPositive("issued")).toBe(false);
    expect(isSettledPositive("refunded")).toBe(false);
  });
});

describe("idempotency key + Checkout coexistence", () => {
  it("idempotency key is stable and binds issuer/agreement/version/milestone", () => {
    const k1 = invoiceIdempotencyKey({ issuerId: "artifex-systems", agreementId: "ag1", agreementVersion: 2, milestoneKey: "deposit" });
    const k2 = invoiceIdempotencyKey({ issuerId: "artifex-systems", agreementId: "ag1", agreementVersion: 2, milestoneKey: "deposit" });
    expect(k1).toBe(k2);
    expect(k1).toContain(":ag1:v2:deposit");
    // different version → different key
    expect(invoiceIdempotencyKey({ issuerId: "artifex-systems", agreementId: "ag1", agreementVersion: 3, milestoneKey: "deposit" })).not.toBe(k1);
  });

  it("skips a deposit invoice when a Checkout deposit is already paid (no double obligation)", () => {
    expect(shouldSkipForPaidCheckoutDeposit("deposit", [{ type: "deposit", status: "paid" }])).toBe(true);
    expect(shouldSkipForPaidCheckoutDeposit("deposit", [{ type: "deposit", status: "pending" }])).toBe(false);
    expect(shouldSkipForPaidCheckoutDeposit("balance", [{ type: "deposit", status: "paid" }])).toBe(false);
  });
});
