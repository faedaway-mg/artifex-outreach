import { describe, it, expect } from "vitest";
import { moneyView, PAYOUT_CAVEAT } from "./payout";
import { makeInvoice } from "../agreement/test-fixtures";
import type { Invoice } from "../types";

const inv = (over: Partial<Invoice>) => makeInvoice({ idempotencyKey: Math.random().toString(36), ...over });

describe("payout / money-state separation — refunds, chargebacks, open disputes are DISTINCT", () => {
  it("net collected subtracts refunds and LOST chargebacks; open disputes reported separately", () => {
    const v = moneyView([
      inv({ state: "paid", amountCents: 500_000 }),                                             // clean paid
      inv({ state: "paid", amountCents: 300_000, amountRefundedCents: 100_000 }),               // partial refund
      inv({ state: "paid", amountCents: 200_000, disputeStatus: "lost", amountDisputedCents: 200_000 }), // chargeback lost
      inv({ state: "paid", amountCents: 400_000, disputeStatus: "open", amountDisputedCents: 400_000 }), // dispute open
      inv({ state: "issued", amountCents: 250_000 }),                                           // outstanding
      inv({ state: "void", amountCents: 999_999 }),                                             // excluded
    ]);
    // collected = 500k + (300k-100k) + (200k-200k lost) + 400k(open, still held) = 1,100,000
    expect(v.collectedCents).toBe(1_100_000);
    expect(v.refundedCents).toBe(100_000);
    expect(v.chargebackLostCents).toBe(200_000);   // NOT counted as a refund
    expect(v.disputedOpenCents).toBe(400_000);     // at risk, still in collected
    expect(v.outstandingCents).toBe(250_000);
    expect(v.invoicedCents).toBe(1_650_000);       // excludes void
    // paid never implies money is in the bank
    expect(v.payoutStatus).toBe("unverified");
    expect(v.bankReceiptStatus).toBe("unverified");
  });

  it("partial refund PLUS a lost partial dispute do not double-count", () => {
    const v = moneyView([inv({ state: "paid", amountCents: 500_000, amountRefundedCents: 100_000, disputeStatus: "lost", amountDisputedCents: 150_000 })]);
    // net = 500k - 100k refund - 150k chargeback = 250k
    expect(v.collectedCents).toBe(250_000);
    expect(v.refundedCents).toBe(100_000);
    expect(v.chargebackLostCents).toBe(150_000);
  });

  it("a WON dispute withdraws nothing from collected", () => {
    const v = moneyView([inv({ state: "paid", amountCents: 500_000, disputeStatus: "won", amountDisputedCents: 500_000 })]);
    expect(v.collectedCents).toBe(500_000);
    expect(v.chargebackLostCents).toBe(0);
  });

  it("ships a caveat string", () => { expect(PAYOUT_CAVEAT).toMatch(/not verified here/); });
});
