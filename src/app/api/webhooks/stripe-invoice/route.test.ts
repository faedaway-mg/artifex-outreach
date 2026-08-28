// HTTP-level tests for the invoice webhook ROUTE (not just the handler function):
// exercises raw-body signature verification, malformed/unsigned/invalid/wrong-issuer
// rejection, and a successful apply — through the actual POST export.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { __resetStoreForTests } from "@/lib/store";
import { insertInvoiceIfAbsent, getInvoiceByProviderId } from "@/lib/repo";
import type { Invoice } from "@/lib/types";

const SECRET = "whsec_route_test";
const NOW = 1_800_000_000; // event.created only (occurredAt); NOT the signature time
// The route verifies the signature timestamp against REAL current time (300s
// tolerance), so sign with now — not a fixed value.
function sig(body: string, ts = Math.floor(Date.now() / 1000)) { return `t=${ts},v1=${createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex")}`; }

function req(body: string, signature: string | null) {
  const headers = new Headers({ "content-type": "application/json" });
  if (signature) headers.set("stripe-signature", signature);
  return new NextRequest("http://localhost/api/webhooks/stripe-invoice", { method: "POST", body, headers });
}
function invSeed(over: Partial<Invoice> = {}): Omit<Invoice, "id" | "createdAt" | "updatedAt"> {
  return {
    leadId: "l1", agreementId: "a1", agreementVersion: 1, issuerId: "artifex-systems", milestoneKey: "deposit",
    milestoneLabel: "Deposit", amountCents: 500_000, currency: "usd", state: "issued", idempotencyKey: "k",
    provider: "stripe", providerInvoiceId: "in_1", hostedInvoiceUrl: null, issuedAt: null, paidAt: null, failedAt: null,
    voidedAt: null, refundedAt: null, disputedAt: null, amountRefundedCents: 0, ...over,
  };
}

const ORIG = { ...process.env };
beforeEach(() => { __resetStoreForTests(); process.env.STRIPE_WEBHOOK_SECRET = SECRET; });
afterEach(() => { process.env = { ...ORIG }; });

describe("POST /api/webhooks/stripe-invoice", () => {
  it("applies a signed invoice.paid event through the route", async () => {
    const { row } = await insertInvoiceIfAbsent(invSeed());
    const body = JSON.stringify({ id: "evt1", type: "invoice.paid", created: NOW, data: { object: { id: "in_1" } } });
    const res = await POST(req(body, sig(body)));
    expect(res.status).toBe(200);
    expect((await res.json()).result).toBe("applied");
    expect((await getInvoiceByProviderId("in_1"))!.state).toBe("paid");
    void row;
  });

  it("rejects an invalid signature with 401 (retryable)", async () => {
    const body = JSON.stringify({ id: "e", type: "invoice.paid", created: NOW, data: { object: { id: "in_1" } } });
    const res = await POST(req(body, "t=1,v1=deadbeef"));
    expect(res.status).toBe(401);
  });

  it("rejects an unsigned request with 401", async () => {
    const body = JSON.stringify({ id: "e", type: "invoice.paid", created: NOW, data: { object: { id: "in_1" } } });
    const res = await POST(req(body, null));
    expect(res.status).toBe(401);
  });

  it("returns 400 on malformed JSON (validly signed)", async () => {
    const body = "{not json";
    const res = await POST(req(body, sig(body)));
    expect(res.status).toBe(400);
  });

  it("rejects an event for a different issuer's invoice with 409", async () => {
    await insertInvoiceIfAbsent(invSeed({ issuerId: "faedaway", providerInvoiceId: "in_2" }));
    const body = JSON.stringify({ id: "e2", type: "invoice.paid", created: NOW, data: { object: { id: "in_2" } } });
    const res = await POST(req(body, sig(body)));
    expect(res.status).toBe(409);
  });

  it("retains an event whose invoice does not exist yet (200 pending_unmatched)", async () => {
    const body = JSON.stringify({ id: "e3", type: "invoice.paid", created: NOW, data: { object: { id: "in_UNKNOWN" } } });
    const res = await POST(req(body, sig(body)));
    expect(res.status).toBe(200);
    expect((await res.json()).result).toBe("pending_unmatched");
  });
});
