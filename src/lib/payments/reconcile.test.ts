import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { __resetStoreForTests } from "../store";
import {
  insertInvoiceIfAbsent, insertAgreement, getInvoice, updateInvoice,
  recordPaymentEventIfAbsent, paymentEventsForProviderInvoice,
} from "../repo";
import { makeAgreement, makeInvoice } from "../agreement/test-fixtures";
import { handleStripeInvoiceWebhook } from "./stripe-invoice-webhook";
import { reconcileInvoiceFromEvents } from "./reconcile";
import { prepareMilestoneInvoice, issueMilestoneInvoice } from "../billing/invoicing-service";
import type { Invoice } from "../types";
import type { FetchImpl } from "./stripe-invoice";

const SECRET = "whsec_reco";
const NOW = 1_800_000_000;
function sig(body: string, ts: number) { return `t=${ts},v1=${createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex")}`; }

async function fire(eventObj: any) {
  const body = JSON.stringify(eventObj);
  return handleStripeInvoiceWebhook({ rawBody: body, signature: sig(body, NOW), secret: SECRET, isProduction: false, expectedIssuerId: "artifex-systems", nowSec: NOW });
}
function evt(id: string, type: string, providerInvoiceId: string, created: number, extra: Record<string, unknown> = {}) {
  return { id, type, created, data: { object: { id: providerInvoiceId, invoice: providerInvoiceId, ...extra } } };
}
function invSeed(over: Partial<Invoice> = {}): Omit<Invoice, "id" | "createdAt" | "updatedAt"> {
  return makeInvoice({ leadId: "l1", agreementId: "a1", state: "issued", providerInvoiceId: "in_R", idempotencyKey: Math.random().toString(36), amountCents: 500_000, ...over });
}

beforeEach(() => __resetStoreForTests());

describe("Gate 4 — event ordering & reconciliation", () => {
  it("event that arrives BEFORE the invoice exists is retained and later absorbed (nothing lost)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    const a = makeAgreement({ status: "signed" });
    const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = a;
    const ag = await insertAgreement(rest);
    // 1) prepare draft (no provider id yet)
    const prep = await prepareMilestoneInvoice(ag.id, "deposit", { actor: "jordan", actorRole: "founder" });
    // 2) provider "paid" event races ahead, referencing the not-yet-known provider id
    expect((await fire(evt("evt_paid", "invoice.paid", "in_dep", NOW))).result).toBe("pending_unmatched");
    // the receipt is durably retained, unprocessed
    const pending = await paymentEventsForProviderInvoice("in_dep");
    expect(pending).toHaveLength(1);
    expect(pending[0].processedAt).toBeNull();
    // 3) issue links provider id "in_dep" and auto-reconciles → invoice becomes paid
    const fakeStripe: FetchImpl = async (u) => new Response(JSON.stringify(
      u.endsWith("/v1/customers") ? { id: "c" } : u.endsWith("/v1/invoiceitems") ? { id: "i" } :
      u.includes("/finalize") ? { id: "in_dep", hosted_invoice_url: "h", status: "open" } : { id: "in_dep" }), { status: 200 });
    await issueMilestoneInvoice(prep.invoice!.id, { actor: "jordan", actorRole: "founder", requireTestMode: true, fetchImpl: fakeStripe });
    expect((await getInvoice(prep.invoice!.id))!.state).toBe("paid");
    expect((await paymentEventsForProviderInvoice("in_dep"))[0].processedAt).not.toBeNull();
  });

  it("out-of-order: refund delivered before paid converges to paid + recorded refund (refund is not a state)", async () => {
    const { row } = await insertInvoiceIfAbsent(invSeed({ state: "issued" }));
    // Deliver refund FIRST (but it occurred later); paid occurred earlier but arrives second.
    await fire(evt("e_refund", "charge.refunded", "in_R", NOW + 100, { amount_refunded: 200_000 }));
    await fire(evt("e_paid", "invoice.paid", "in_R", NOW));
    // Replaying in occurredAt order (paid @NOW, refund @NOW+100): lifecycle stays paid;
    // the refund is a separate fact, so "was paid" is preserved (not overwritten).
    const res = await reconcileInvoiceFromEvents(row.id);
    expect(res!.finalState).toBe("paid");
    const after = await getInvoice(row.id);
    expect(after!.paidAt).not.toBeNull();
    expect(after!.amountRefundedCents).toBe(200_000);
  });

  it("duplicate delivery is deduped by event id (single effect)", async () => {
    await insertInvoiceIfAbsent(invSeed({ providerInvoiceId: "in_D", state: "issued" }));
    expect((await fire(evt("dup1", "invoice.paid", "in_D", NOW))).result).toBe("applied");
    expect((await fire(evt("dup1", "invoice.paid", "in_D", NOW))).result).toBe("duplicate");
    expect((await paymentEventsForProviderInvoice("in_D"))).toHaveLength(1);
  });

  it("an unprocessed (failed-apply) receipt is retried by reconciliation", async () => {
    const { row } = await insertInvoiceIfAbsent(invSeed({ providerInvoiceId: "in_F", state: "issued" }));
    // Simulate a receipt recorded but whose effect never committed (processedAt null).
    await recordPaymentEventIfAbsent({
      provider: "stripe", eventId: "e_orphan", eventType: "invoice.paid", providerInvoiceId: "in_F", invoiceId: null,
      issuerId: null, payload: evt("e_orphan", "invoice.paid", "in_F", NOW), occurredAt: new Date(NOW * 1000).toISOString(),
      receivedAt: new Date(NOW * 1000).toISOString(), processedAt: null, outcome: "pending_unmatched",
    });
    expect((await getInvoice(row.id))!.state).toBe("issued");
    await reconcileInvoiceFromEvents(row.id);
    expect((await getInvoice(row.id))!.state).toBe("paid");
    expect((await paymentEventsForProviderInvoice("in_F"))[0].processedAt).not.toBeNull();
  });

  it("older event arriving after a newer financial state does not regress", async () => {
    const { row } = await insertInvoiceIfAbsent(invSeed({ providerInvoiceId: "in_O", state: "paid", paidAt: new Date(NOW * 1000).toISOString() }));
    expect((await fire(evt("e_late", "invoice.finalized", "in_O", NOW - 100))).result).toBe("ignored");
    expect((await getInvoice(row.id))!.state).toBe("paid");
  });

  it("EQUAL timestamps converge via state semantics, not sort order (paid + refund same ts)", async () => {
    const { row } = await insertInvoiceIfAbsent(invSeed({ providerInvoiceId: "in_EQ", state: "issued" }));
    // Both events carry the SAME occurredAt — chronological sort cannot order them.
    await fire(evt("e_a", "invoice.paid", "in_EQ", NOW));
    await fire(evt("e_b", "charge.refunded", "in_EQ", NOW, { amount_refunded: 50_000 }));
    await reconcileInvoiceFromEvents(row.id);
    const after = await getInvoice(row.id);
    // Regardless of order: lifecycle=paid (a separate refund fact recorded). The reducer's
    // idempotency + separate-fact model makes the outcome order-independent.
    expect(after!.state).toBe("paid");
    expect(after!.amountRefundedCents).toBe(50_000);
  });

  it("equal-timestamp dispute created+closed converge to the resolved outcome", async () => {
    const { row } = await insertInvoiceIfAbsent(invSeed({ providerInvoiceId: "in_EQ2", state: "paid", paidAt: new Date(NOW * 1000).toISOString() }));
    await fire(evt("d_close", "charge.dispute.closed", "in_EQ2", NOW, { status: "lost", payment_intent: "pi_eq2" }));
    await fire(evt("d_open", "charge.dispute.created", "in_EQ2", NOW, { amount: 500_000, payment_intent: "pi_eq2" }));
    await reconcileInvoiceFromEvents(row.id);
    // "lost" is terminal; a same-ts create cannot reopen it → converges to lost.
    expect((await getInvoice(row.id))!.disputeStatus).toBe("lost");
  });

  it("wrong issuer/account event is rejected and marked as mismatch", async () => {
    await insertInvoiceIfAbsent(invSeed({ providerInvoiceId: "in_X", state: "issued" })); // artifex-systems
    const body = JSON.stringify(evt("e_x", "invoice.paid", "in_X", NOW));
    const r = await handleStripeInvoiceWebhook({ rawBody: body, signature: sig(body, NOW), secret: SECRET, isProduction: false, expectedIssuerId: "faedaway", nowSec: NOW });
    expect(r.status).toBe(409);
    expect((await paymentEventsForProviderInvoice("in_X"))[0].outcome).toBe("issuer_mismatch");
  });
});
