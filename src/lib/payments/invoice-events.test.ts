import { describe, it, expect } from "vitest";
import { applyInvoiceEvent, mapEventToState } from "./invoice-events";
import { makeInvoice } from "../agreement/test-fixtures";
import type { Invoice } from "../types";

const inv = (over: Partial<Invoice> = {}) => makeInvoice({ amountCents: 500_000, providerInvoiceId: "in_1", ...over });
const at = "2026-08-27T00:00:00.000Z";

describe("invoice lifecycle reducer", () => {
  it("issued → paid on invoice.paid; captures charge/PI refs", () => {
    const r = applyInvoiceEvent(inv({ state: "issued" }), { type: "invoice.paid", occurredAt: at, chargeId: "ch_1", paymentIntentId: "pi_1" });
    expect(r.outcome).toBe("applied");
    expect(r.patch.state).toBe("paid");
    expect(r.patch.paidAt).toBe(at);
    expect(r.patch.chargeId).toBe("ch_1");
    expect(r.patch.paymentIntentId).toBe("pi_1");
  });

  it("payment_intent.processing → processing (ACH pending — NOT a fake invoice.payment_processing)", () => {
    expect(applyInvoiceEvent(inv({ state: "issued" }), { type: "payment_intent.processing", occurredAt: at }).patch.state).toBe("processing");
    expect(mapEventToState("invoice.payment_processing")).toBeNull(); // that event does not exist
  });

  it("duplicate paid is a no-op; out-of-order finalize after paid is ignored", () => {
    expect(applyInvoiceEvent(inv({ state: "paid" }), { type: "invoice.paid", occurredAt: at }).outcome).toBe("duplicate");
    expect(applyInvoiceEvent(inv({ state: "paid" }), { type: "invoice.finalized", occurredAt: at }).outcome).toBe("ignored");
  });
});

describe("REFUND is distinct from lifecycle and from dispute", () => {
  it("charge.refunded records amountRefundedCents WITHOUT changing state (still paid)", () => {
    const r = applyInvoiceEvent(inv({ state: "paid" }), { type: "charge.refunded", occurredAt: at, amountRefundedCents: 200_000 });
    expect(r.outcome).toBe("applied");
    expect(r.patch.state).toBeUndefined(); // lifecycle untouched — "was paid" preserved
    expect(r.patch.amountRefundedCents).toBe(200_000);
  });

  it("amount_refunded is cumulative; a repeat with the same total is a duplicate", () => {
    expect(applyInvoiceEvent(inv({ state: "paid", amountRefundedCents: 200_000 }), { type: "charge.refunded", occurredAt: at, amountRefundedCents: 200_000 }).outcome).toBe("duplicate");
  });
});

describe("DISPUTE accounting — a lost dispute is a chargeback, NOT a refund", () => {
  it("paid → dispute opened → LOST: disputeStatus=lost, state stays paid, NOT refunded", () => {
    const opened = applyInvoiceEvent(inv({ state: "paid" }), { type: "charge.dispute.created", occurredAt: at, amountDisputedCents: 500_000 });
    expect(opened.patch.disputeStatus).toBe("open");
    expect(opened.patch.amountDisputedCents).toBe(500_000);
    const lost = applyInvoiceEvent(inv({ state: "paid", disputeStatus: "open", amountDisputedCents: 500_000 }), { type: "charge.dispute.closed", occurredAt: at, disputeStatus: "lost" });
    expect(lost.patch.disputeStatus).toBe("lost");
    expect(lost.patch.state).toBeUndefined();       // still paid
    expect(lost.patch.amountRefundedCents).toBeUndefined(); // NOT booked as a refund
  });

  it("paid → dispute opened → WON: disputeStatus=won; does not force-restore paid (never left)", () => {
    const won = applyInvoiceEvent(inv({ state: "paid", disputeStatus: "open" }), { type: "charge.dispute.closed", occurredAt: at, disputeStatus: "won" });
    expect(won.patch.disputeStatus).toBe("won");
    expect(won.patch.state).toBeUndefined();
  });

  it("won AFTER a refund keeps both facts (refund stands, dispute won)", () => {
    const won = applyInvoiceEvent(inv({ state: "paid", amountRefundedCents: 100_000, disputeStatus: "open" }), { type: "charge.dispute.closed", occurredAt: at, disputeStatus: "won" });
    expect(won.patch.disputeStatus).toBe("won");
    expect(won.patch.amountRefundedCents).toBeUndefined(); // refund untouched
  });

  it("funds_withdrawn → lost, funds_reinstated → won", () => {
    expect(applyInvoiceEvent(inv({ state: "paid", disputeStatus: "open" }), { type: "charge.dispute.funds_withdrawn", occurredAt: at }).patch.disputeStatus).toBe("lost");
    expect(applyInvoiceEvent(inv({ state: "paid", disputeStatus: "lost" }), { type: "charge.dispute.funds_reinstated", occurredAt: at }).patch.disputeStatus).toBe("won");
  });

  it("out-of-order: dispute.created after it already closed does NOT reopen", () => {
    expect(applyInvoiceEvent(inv({ state: "paid", disputeStatus: "lost" }), { type: "charge.dispute.created", occurredAt: at }).outcome).toBe("duplicate");
  });

  it("warning_closed is ignored (not a win or loss)", () => {
    expect(applyInvoiceEvent(inv({ state: "paid", disputeStatus: "open" }), { type: "charge.dispute.closed", occurredAt: at, disputeStatus: "warning_closed" }).outcome).toBe("ignored");
  });

  it("partial dispute records the disputed amount only", () => {
    const r = applyInvoiceEvent(inv({ state: "paid", amountCents: 500_000 }), { type: "charge.dispute.created", occurredAt: at, amountDisputedCents: 150_000 });
    expect(r.patch.amountDisputedCents).toBe(150_000);
  });
});
