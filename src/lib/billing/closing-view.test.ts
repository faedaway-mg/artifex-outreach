import { describe, it, expect } from "vitest";
import { buildClosingView } from "./closing-view";
import { makeAgreement, makePayment } from "../agreement/test-fixtures";
import type { Invoice, Agreement } from "../types";

function invoice(over: Partial<Invoice>): Invoice {
  return {
    id: "inv1", leadId: "lead_1", agreementId: "agr_1", agreementVersion: 1, issuerId: "artifex-systems",
    milestoneKey: "deposit", milestoneLabel: "Deposit", amountCents: 725_000, currency: "usd", state: "draft",
    idempotencyKey: "k", provider: "stripe", providerInvoiceId: null, hostedInvoiceUrl: null, issuedAt: null,
    paidAt: null, failedAt: null, voidedAt: null, refundedAt: null, disputedAt: null, amountRefundedCents: 0,
    createdAt: "", updatedAt: "", ...over,
  };
}

describe("closing view-model", () => {
  it("surfaces the CURRENT issuer entity and signature status", () => {
    const v = buildClosingView({ agreement: makeAgreement({ status: "signed" }), invoices: [], payments: [], sendingEnabled: false });
    expect(v.entity.legalEntity).toBe("Artifex Labs Systems LLC");
    expect(v.agreement.signed).toBe(true);
    expect(v.mode).toBe("test");
    expect(v.payoutCaveat).toMatch(/not verified/);
  });

  it("next action walks the journey: sign → prepare deposit → issue → await → milestone", () => {
    const base = { payments: [], sendingEnabled: false };
    // unsigned
    expect(buildClosingView({ ...base, agreement: makeAgreement({ status: "approved" }), invoices: [] }).nextAction.label).toMatch(/Awaiting signature/);
    // signed, no deposit invoice
    const signed = makeAgreement({ status: "signed" });
    expect(buildClosingView({ ...base, agreement: signed, invoices: [] }).nextAction).toMatchObject({ label: /Prepare the deposit/, kind: "draft" } as never);
    // deposit draft → issue (move-money)
    expect(buildClosingView({ ...base, agreement: signed, invoices: [invoice({ state: "draft" })] }).nextAction).toMatchObject({ kind: "move-money" });
    // deposit issued → await
    expect(buildClosingView({ ...base, agreement: signed, invoices: [invoice({ state: "issued" })] }).nextAction.kind).toBe("await-external");
  });

  it("marks a deposit already paid via Checkout as such (coexistence, no re-invoice)", () => {
    const signed = makeAgreement({ status: "signed" });
    const v = buildClosingView({
      agreement: signed, invoices: [],
      payments: [makePayment({ type: "deposit", status: "paid" })],
      sendingEnabled: false,
    });
    const deposit = v.schedule.find((s) => s.key === "deposit")!;
    expect(deposit.invoiceState).toBe("paid-via-checkout");
  });

  it("after deposit paid, the balance is shown but not yet eligible until accepted", () => {
    const signed = makeAgreement({ status: "signed" });
    const v = buildClosingView({
      agreement: signed,
      invoices: [invoice({ milestoneKey: "deposit", state: "paid" })],
      payments: [], sendingEnabled: false, acceptedKeys: [],
    });
    const balance = v.schedule.find((s) => s.key === "balance")!;
    expect(balance.eligible).toBe(false);
    expect(v.nextAction.label).toMatch(/Record acceptance for Final balance/);
  });

  it("reports live mode when sending is enabled", () => {
    const v = buildClosingView({ agreement: makeAgreement({ status: "signed" }) as Agreement, invoices: [], payments: [], sendingEnabled: true });
    expect(v.mode).toBe("live");
  });
});
