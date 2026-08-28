import { describe, it, expect, beforeEach } from "vitest";
import { __resetStoreForTests } from "../store";
import { insertInvoiceIfAbsent, invoicesForAgreement, getInvoiceByIdempotencyKey, updateInvoice } from "../repo";
import { invoiceIdempotencyKey } from "./invoice";
import type { Invoice } from "../types";

function seed(over: Partial<Invoice> = {}): Omit<Invoice, "id" | "createdAt" | "updatedAt"> {
  const idempotencyKey = invoiceIdempotencyKey({ issuerId: "artifex-systems", agreementId: "ag1", agreementVersion: 1, milestoneKey: "deposit" });
  return {
    leadId: "lead1", agreementId: "ag1", agreementVersion: 1, issuerId: "artifex-systems",
    milestoneKey: "deposit", milestoneLabel: "Deposit", amountCents: 500_000, currency: "usd",
    state: "draft", idempotencyKey, provider: "stripe", providerInvoiceId: null, hostedInvoiceUrl: null,
    issuedAt: null, paidAt: null, failedAt: null, voidedAt: null, refundedAt: null, disputedAt: null,
    amountRefundedCents: 0, ...over,
  };
}

describe("insertInvoiceIfAbsent — duplicate prevention under retry/concurrency", () => {
  beforeEach(() => __resetStoreForTests());

  it("inserts once and dedupes a retried create with the same idempotency key", async () => {
    const a = await insertInvoiceIfAbsent(seed());
    expect(a.inserted).toBe(true);
    const b = await insertInvoiceIfAbsent(seed());
    expect(b.inserted).toBe(false);
    expect(b.row.id).toBe(a.row.id);
    expect(await invoicesForAgreement("ag1")).toHaveLength(1);
  });

  it("simulated concurrent creates for the same milestone yield a single row", async () => {
    const results = await Promise.all([insertInvoiceIfAbsent(seed()), insertInvoiceIfAbsent(seed()), insertInvoiceIfAbsent(seed())]);
    expect(results.filter((r) => r.inserted).length).toBeGreaterThanOrEqual(1);
    expect(await invoicesForAgreement("ag1")).toHaveLength(1);
  });

  it("different milestones for the same agreement are separate invoices", async () => {
    await insertInvoiceIfAbsent(seed());
    await insertInvoiceIfAbsent(seed({
      milestoneKey: "balance", milestoneLabel: "Balance",
      idempotencyKey: invoiceIdempotencyKey({ issuerId: "artifex-systems", agreementId: "ag1", agreementVersion: 1, milestoneKey: "balance" }),
    }));
    expect(await invoicesForAgreement("ag1")).toHaveLength(2);
  });

  it("state can be updated on the persisted row", async () => {
    const { row } = await insertInvoiceIfAbsent(seed());
    await updateInvoice(row.id, { state: "issued", issuedAt: "2026-08-27T00:00:00.000Z", providerInvoiceId: "in_1" });
    const found = await getInvoiceByIdempotencyKey(row.idempotencyKey);
    expect(found?.state).toBe("issued");
    expect(found?.providerInvoiceId).toBe("in_1");
  });
});
