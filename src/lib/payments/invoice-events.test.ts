import { describe, it, expect } from "vitest";
import { applyInvoiceEvent, mapEventToState } from "./invoice-events";
import type { Invoice } from "../types";

function inv(state: Invoice["state"], over: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv1", leadId: "l1", agreementId: "a1", agreementVersion: 1, issuerId: "artifex-systems",
    milestoneKey: "deposit", milestoneLabel: "Deposit", amountCents: 500_000, currency: "usd",
    state, idempotencyKey: "k", provider: "stripe", providerInvoiceId: "in_1", hostedInvoiceUrl: null,
    issuedAt: null, paidAt: null, failedAt: null, voidedAt: null, refundedAt: null, disputedAt: null,
    amountRefundedCents: 0, createdAt: "", updatedAt: "", ...over,
  };
}
const at = "2026-08-27T00:00:00.000Z";

describe("invoice event reducer", () => {
  it("issued → paid on invoice.paid, stamps paidAt", () => {
    const r = applyInvoiceEvent(inv("issued"), { type: "invoice.paid", occurredAt: at });
    expect(r.outcome).toBe("applied");
    expect(r.patch.state).toBe("paid");
    expect(r.patch.paidAt).toBe(at);
  });

  it("issued → failed on invoice.payment_failed (still collectible)", () => {
    expect(applyInvoiceEvent(inv("issued"), { type: "invoice.payment_failed", occurredAt: at }).patch.state).toBe("failed");
  });

  it("duplicate paid event is a no-op", () => {
    expect(applyInvoiceEvent(inv("paid"), { type: "invoice.paid", occurredAt: at }).outcome).toBe("duplicate");
  });

  it("out-of-order finalize after paid is ignored (no regression, history intact)", () => {
    const r = applyInvoiceEvent(inv("paid", { paidAt: at }), { type: "invoice.finalized", occurredAt: at });
    expect(r.outcome).toBe("ignored");
    expect(r.patch).toEqual({});
  });

  it("full refund → refunded; partial refund → partially_refunded, records amount", () => {
    const full = applyInvoiceEvent(inv("paid"), { type: "charge.refunded", occurredAt: at, amountRefundedCents: 500_000 });
    expect(full.patch.state).toBe("refunded");
    expect(full.patch.amountRefundedCents).toBe(500_000);
    const partial = applyInvoiceEvent(inv("paid"), { type: "charge.refunded", occurredAt: at, amountRefundedCents: 200_000 });
    expect(partial.patch.state).toBe("partially_refunded");
    expect(partial.patch.amountRefundedCents).toBe(200_000);
  });

  it("dispute lifecycle: paid → disputed → (won) paid / (lost) refunded", () => {
    expect(applyInvoiceEvent(inv("paid"), { type: "charge.dispute.created", occurredAt: at }).patch.state).toBe("disputed");
    expect(applyInvoiceEvent(inv("disputed"), { type: "charge.dispute.closed", occurredAt: at, disputeStatus: "won" }).patch.state).toBe("paid");
    expect(applyInvoiceEvent(inv("disputed"), { type: "charge.dispute.closed", occurredAt: at, disputeStatus: "lost" }).patch.state).toBe("refunded");
  });

  it("unknown event type is unmapped", () => {
    expect(applyInvoiceEvent(inv("issued"), { type: "invoice.some_future_thing", occurredAt: at }).outcome).toBe("unmapped");
    expect(mapEventToState("nope")).toBeNull();
  });
});
