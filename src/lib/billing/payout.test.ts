import { describe, it, expect } from "vitest";
import { moneyView, PAYOUT_CAVEAT } from "./payout";
import type { Invoice } from "../types";

function inv(state: Invoice["state"], amountCents: number, over: Partial<Invoice> = {}): Invoice {
  return {
    id: Math.random().toString(36), leadId: "l1", agreementId: "a1", agreementVersion: 1, issuerId: "artifex-systems",
    milestoneKey: "m", milestoneLabel: "M", amountCents, currency: "usd", state, idempotencyKey: Math.random().toString(36),
    provider: "stripe", providerInvoiceId: null, hostedInvoiceUrl: null, issuedAt: null, paidAt: null, failedAt: null,
    voidedAt: null, refundedAt: null, disputedAt: null, amountRefundedCents: 0, createdAt: "", updatedAt: "", ...over,
  };
}

describe("payout / money-state separation", () => {
  it("collected counts only paid invoices; payout + bank receipt stay UNVERIFIED", () => {
    const v = moneyView([
      inv("paid", 500_000),
      inv("issued", 300_000),
      inv("void", 999_999),
      inv("partially_refunded", 200_000, { amountRefundedCents: 50_000 }),
    ]);
    expect(v.collectedCents).toBe(650_000); // 500k paid + (200k - 50k refunded)
    expect(v.invoicedCents).toBe(1_000_000); // excludes void
    expect(v.outstandingCents).toBe(300_000);
    expect(v.refundedCents).toBe(50_000);
    // A paid invoice never implies money is in the bank.
    expect(v.payoutStatus).toBe("unverified");
    expect(v.bankReceiptStatus).toBe("unverified");
  });

  it("ships a caveat string for display", () => {
    expect(PAYOUT_CAVEAT).toMatch(/not verified here/);
  });
});
