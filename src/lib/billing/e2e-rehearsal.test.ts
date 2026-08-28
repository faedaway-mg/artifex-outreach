// ─────────────────────────────────────────────────────────────────────────────
// GATE 9 — MOCK REHEARSAL ONLY (synthetic data, in-memory store, injected fake
// Stripe). This is NOT a provider-sandbox test: no real Stripe/SignWell test
// credentials are configured in this worktree, and no operator-approved test email
// recipient exists, so a real sandbox rehearsal is BLOCKED (reported, not faked).
// This walks the whole closing journey to prove the pieces compose correctly.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { __resetStoreForTests } from "../store";
import { insertAgreement, invoicesForAgreement, getInvoice } from "../repo";
import { makeAgreement } from "../agreement/test-fixtures";
import { prepareMilestoneInvoice, issueMilestoneInvoice } from "./invoicing-service";
import { handleStripeInvoiceWebhook } from "../payments/stripe-invoice-webhook";
import { moneyView } from "./payout";
import type { FetchImpl } from "../payments/stripe-invoice";

const WH = "whsec_rehearsal";
function sig(body: string, ts: number) { return `t=${ts},v1=${createHmac("sha256", WH).update(`${ts}.${body}`).digest("hex")}`; }
const NOW = 1_800_000_000;

function fakeStripe(invoiceId: string): FetchImpl {
  return async (url) => {
    let body: Record<string, unknown> = {};
    if (url.endsWith("/v1/customers")) body = { id: "cus_reh" };
    else if (url.endsWith("/v1/invoiceitems")) body = { id: "ii_reh" };
    else if (url.endsWith("/v1/invoices")) body = { id: invoiceId };
    else if (url.includes("/finalize")) body = { id: invoiceId, hosted_invoice_url: `https://invoice.stripe.com/i/${invoiceId}`, status: "open" };
    return new Response(JSON.stringify(body), { status: 200 });
  };
}

async function webhook(providerInvoiceId: string, type: string, extra: Record<string, unknown> = {}, eventId = `${type}_${providerInvoiceId}`) {
  const event = { id: `evt_${eventId}`, type, created: NOW, data: { object: { id: providerInvoiceId, invoice: providerInvoiceId, ...extra } } };
  const raw = JSON.stringify(event);
  return handleStripeInvoiceWebhook({ rawBody: raw, signature: sig(raw, NOW), secret: WH, isProduction: false, expectedIssuerId: "artifex-systems", nowSec: NOW });
}

async function signed() {
  const a = makeAgreement({ status: "signed" });
  const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = a;
  return insertAgreement(rest);
}

const ORIG = { ...process.env };
beforeEach(() => __resetStoreForTests());
afterEach(() => { process.env = { ...ORIG }; });

describe("GATE 9 mock rehearsal — full closing journey", () => {
  it("deposit → issue → paid; balance gated then accepted → issued → failed → paid; refund; money view", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_rehearsal";
    const ag = await signed();
    const founder = { actor: "jordan", actorRole: "founder" as const };

    // 1) Deposit: prepare (draft) → issue (test-mode) → webhook paid.
    const dep = await prepareMilestoneInvoice(ag.id, "deposit", founder);
    expect(dep.invoice?.state).toBe("draft");
    const depIssued = await issueMilestoneInvoice(dep.invoice!.id, { ...founder, requireTestMode: true, fetchImpl: fakeStripe("in_dep") });
    expect(depIssued.invoice?.state).toBe("issued");
    expect((await webhook("in_dep", "invoice.paid")).result).toBe("applied");
    expect((await getInvoice(dep.invoice!.id))!.state).toBe("paid");

    // 2) Balance is NOT billable until acceptance is recorded (no all-billable-after-deposit).
    expect((await prepareMilestoneInvoice(ag.id, "balance", founder)).blocked).toBe(true);
    const bal = await prepareMilestoneInvoice(ag.id, "balance", { ...founder, acceptedKeys: ["balance"] });
    expect(bal.ok).toBe(true);
    const balIssued = await issueMilestoneInvoice(bal.invoice!.id, { ...founder, requireTestMode: true, fetchImpl: fakeStripe("in_bal") });
    expect(balIssued.invoice?.state).toBe("issued");

    // 3) Exception paths on the balance: a failed attempt, then success; duplicate is a no-op.
    expect((await webhook("in_bal", "invoice.payment_failed")).result).toBe("applied");
    expect((await getInvoice(bal.invoice!.id))!.state).toBe("failed");
    expect((await webhook("in_bal", "invoice.paid")).result).toBe("applied");
    expect((await webhook("in_bal", "invoice.paid")).result).toBe("duplicate");
    expect((await getInvoice(bal.invoice!.id))!.state).toBe("paid");

    // 4) A partial refund on the deposit — money state moves without erasing history.
    expect((await webhook("in_dep", "charge.refunded", { amount_refunded: 100_000 }, "refund")).result).toBe("applied");
    const depAfter = await getInvoice(dep.invoice!.id);
    expect(depAfter!.state).toBe("partially_refunded");
    expect(depAfter!.amountRefundedCents).toBe(100_000);

    // 5) Money view: both collected; payout + bank receipt remain UNVERIFIED.
    const invoices = await invoicesForAgreement(ag.id);
    const v = moneyView(invoices);
    // Net collected = full total minus the partial refund on the deposit.
    expect(v.collectedCents).toBe(ag.contentSnapshot.totalPriceCents - 100_000);
    expect(v.refundedCents).toBe(100_000);
    expect(v.payoutStatus).toBe("unverified");
    expect(v.bankReceiptStatus).toBe("unverified");
  });

  it("out-of-order + unauthorized are both safely rejected", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_rehearsal";
    const ag = await signed();
    const dep = await prepareMilestoneInvoice(ag.id, "deposit", { actor: "jordan", actorRole: "founder" });
    await issueMilestoneInvoice(dep.invoice!.id, { actor: "jordan", actorRole: "founder", requireTestMode: true, fetchImpl: fakeStripe("in_dep") });
    await webhook("in_dep", "invoice.paid");
    // Out-of-order: a late "finalized" after paid must not regress state.
    expect((await webhook("in_dep", "invoice.finalized")).result).toBe("ignored");
    expect((await getInvoice(dep.invoice!.id))!.state).toBe("paid");
    // Unauthorized role cannot create a further invoice.
    const denied = await prepareMilestoneInvoice(ag.id, "balance", { actor: "alex", actorRole: "operator", acceptedKeys: ["balance"] });
    expect(denied.blocked).toBe(true);
  });
});
