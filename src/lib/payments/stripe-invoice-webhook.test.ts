import { describe, it, expect, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { __resetStoreForTests } from "../store";
import { insertInvoiceIfAbsent, getInvoice } from "../repo";
import { handleStripeInvoiceWebhook } from "./stripe-invoice-webhook";
import { makeInvoice } from "../agreement/test-fixtures";
import type { Invoice } from "../types";

const SECRET = "whsec_inv_test";
function sig(body: string, ts: number): string {
  return `t=${ts},v1=${createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex")}`;
}
const NOW = 1_800_000_000;

function invSeed(over: Partial<Invoice> = {}): Omit<Invoice, "id" | "createdAt" | "updatedAt"> {
  return makeInvoice({ leadId: "l1", agreementId: "a1", state: "issued", providerInvoiceId: "in_1", amountCents: 500_000, ...over });
}

async function send(eventObj: unknown, opts: { secret?: string | null; expectedIssuerId?: string } = {}) {
  const body = JSON.stringify(eventObj);
  return handleStripeInvoiceWebhook({
    rawBody: body,
    signature: sig(body, NOW),
    secret: opts.secret === undefined ? SECRET : opts.secret,
    isProduction: false,
    expectedIssuerId: opts.expectedIssuerId ?? "artifex-systems",
    nowSec: NOW,
  });
}

beforeEach(() => __resetStoreForTests());

describe("stripe invoice webhook", () => {
  it("rejects an invalid signature", async () => {
    const body = JSON.stringify({ id: "evt_1", type: "invoice.paid", data: { object: { id: "in_1" } } });
    const r = await handleStripeInvoiceWebhook({ rawBody: body, signature: "t=1,v1=bad", secret: SECRET, isProduction: false, expectedIssuerId: "artifex-systems", nowSec: NOW });
    expect(r.status).toBe(401);
    expect(r.kind).toBe("invalid_signature");
  });

  it("applies invoice.paid to the matching invoice", async () => {
    const { row } = await insertInvoiceIfAbsent(invSeed());
    const r = await send({ id: "evt_paid", type: "invoice.paid", created: NOW, data: { object: { id: "in_1" } } });
    expect(r.result).toBe("applied");
    expect((await getInvoice(row.id))!.state).toBe("paid");
  });

  it("dedupes a duplicate delivery of the same event id", async () => {
    await insertInvoiceIfAbsent(invSeed());
    const ev = { id: "evt_paid", type: "invoice.paid", created: NOW, data: { object: { id: "in_1" } } };
    expect((await send(ev)).result).toBe("applied");
    expect((await send(ev)).result).toBe("duplicate");
  });

  it("rejects an event for a different issuer's account (isolation)", async () => {
    await insertInvoiceIfAbsent(invSeed()); // issuer artifex-systems
    const r = await send({ id: "e", type: "invoice.paid", created: NOW, data: { object: { id: "in_1" } } }, { expectedIssuerId: "faedaway" });
    expect(r.status).toBe(409);
    expect(r.result).toBe("issuer_mismatch");
  });

  it("retains an event whose invoice does not exist yet (pending_unmatched, not lost)", async () => {
    const r = await send({ id: "e", type: "invoice.paid", created: NOW, data: { object: { id: "in_UNKNOWN" } } });
    expect(r.status).toBe(200);
    expect(r.result).toBe("pending_unmatched");
  });

  it("applies a charge.refunded (partial) via object.invoice reference", async () => {
    const { row } = await insertInvoiceIfAbsent(invSeed({ state: "paid" }));
    const r = await send({ id: "evt_ref", type: "charge.refunded", created: NOW, data: { object: { invoice: "in_1", amount_refunded: 200_000 } } });
    expect(r.result).toBe("applied");
    const after = await getInvoice(row.id);
    expect(after!.state).toBe("paid"); // refund is a separate fact — lifecycle stays paid
    expect(after!.amountRefundedCents).toBe(200_000);
  });
});
