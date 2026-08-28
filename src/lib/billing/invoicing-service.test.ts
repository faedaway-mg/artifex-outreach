import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __resetStoreForTests } from "../store";
import { insertAgreement, insertPayment, invoicesForAgreement } from "../repo";
import { makeAgreement } from "../agreement/test-fixtures";
import { prepareMilestoneInvoice, issueMilestoneInvoice } from "./invoicing-service";
import type { FetchImpl } from "../payments/stripe-invoice";

function fakeStripe(): FetchImpl {
  return async (url) => {
    let body: Record<string, unknown> = {};
    if (url.endsWith("/v1/customers")) body = { id: "cus_1" };
    else if (url.endsWith("/v1/invoiceitems")) body = { id: "ii_1" };
    else if (url.endsWith("/v1/invoices")) body = { id: "in_1" };
    else if (url.includes("/finalize")) body = { id: "in_1", hosted_invoice_url: "https://invoice.stripe.com/i/x", status: "open" };
    return new Response(JSON.stringify(body), { status: 200 });
  };
}

async function signedAgreement(over = {}) {
  const a = makeAgreement({ status: "signed", ...over });
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = a;
  return insertAgreement(rest);
}

const ORIG = { ...process.env };
beforeEach(() => __resetStoreForTests());
afterEach(() => { process.env = { ...ORIG }; });

describe("prepareMilestoneInvoice", () => {
  it("creates a draft deposit invoice bound to the exact version + issuer, idempotently", async () => {
    const ag = await signedAgreement();
    const r = await prepareMilestoneInvoice(ag.id, "deposit", { actor: "jordan", actorRole: "founder" });
    expect(r.ok).toBe(true);
    expect(r.inserted).toBe(true);
    expect(r.invoice?.state).toBe("draft");
    expect(r.invoice?.issuerId).toBe("artifex-systems");
    expect(r.invoice?.amountCents).toBe(ag.contentSnapshot.depositAmountCents);
    expect(r.invoice?.agreementVersion).toBe(ag.version);
    // idempotent
    const again = await prepareMilestoneInvoice(ag.id, "deposit", { actor: "jordan", actorRole: "founder" });
    expect(again.inserted).toBe(false);
    expect(await invoicesForAgreement(ag.id)).toHaveLength(1);
  });

  it("refuses a milestone before it is eligible; allows it once acceptance is recorded", async () => {
    const ag = await signedAgreement();
    const blocked = await prepareMilestoneInvoice(ag.id, "balance", { actor: "jordan", actorRole: "founder" });
    expect(blocked.ok).toBe(false);
    expect(blocked.blocked).toBe(true);
    const ok = await prepareMilestoneInvoice(ag.id, "balance", { actor: "jordan", actorRole: "founder", acceptedKeys: ["balance"] });
    expect(ok.ok).toBe(true);
    expect(ok.invoice?.milestoneKey).toBe("balance");
  });

  it("denies an unauthorized role (server-side RBAC) even on a signed agreement", async () => {
    const ag = await signedAgreement();
    const r = await prepareMilestoneInvoice(ag.id, "deposit", { actor: "alex", actorRole: "operator" });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.reason).toMatch(/not authorized/);
    expect(await invoicesForAgreement(ag.id)).toHaveLength(0);
  });

  it("refuses when the agreement is not signed", async () => {
    const ag = await signedAgreement({ status: "approved" });
    const r = await prepareMilestoneInvoice(ag.id, "deposit", { actor: "jordan", actorRole: "founder" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not signed/);
  });

  it("does not double-bill a deposit already paid via Checkout (coexistence)", async () => {
    const ag = await signedAgreement();
    await insertPayment({
      leadId: ag.leadId, agreementId: ag.id, type: "deposit", amountCents: ag.contentSnapshot.depositAmountCents,
      currency: "usd", status: "paid", stripePaymentLinkUrl: null, stripeSessionId: "cs_1", sentAt: null, paidAt: "2026-07-11T00:00:00.000Z",
    });
    const r = await prepareMilestoneInvoice(ag.id, "deposit", { actor: "jordan", actorRole: "founder" });
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
    expect(await invoicesForAgreement(ag.id)).toHaveLength(0);
  });
});

describe("issueMilestoneInvoice (external, gated)", () => {
  it("issues in test mode: finalizes and stores the hosted invoice URL", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_ok";
    const ag = await signedAgreement();
    const prep = await prepareMilestoneInvoice(ag.id, "deposit", { actor: "jordan", actorRole: "founder" });
    const issued = await issueMilestoneInvoice(prep.invoice!.id, { actor: "jordan", actorRole: "founder", requireTestMode: true, fetchImpl: fakeStripe() });
    expect(issued.ok).toBe(true);
    expect(issued.invoice?.state).toBe("issued");
    expect(issued.invoice?.providerInvoiceId).toBe("in_1");
    expect(issued.invoice?.hostedInvoiceUrl).toBe("https://invoice.stripe.com/i/x");
  });

  it("refuses to issue live when sending is disabled", async () => {
    const ag = await signedAgreement();
    const prep = await prepareMilestoneInvoice(ag.id, "deposit", { actor: "jordan", actorRole: "founder" });
    const r = await issueMilestoneInvoice(prep.invoice!.id, { actor: "jordan", actorRole: "founder", requireTestMode: false });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.reason).toMatch(/disabled/);
  });
});
