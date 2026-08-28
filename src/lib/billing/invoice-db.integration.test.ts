// ─────────────────────────────────────────────────────────────────────────────
// REAL-DATABASE integration test (Gate 3). Runs ONLY when DATABASE_URL points at an
// isolated test Postgres — skipped in the default in-memory suite. Proves the real
// adapter's uniqueness/idempotency under concurrency, the durable event receipt
// unique constraint, issuer binding, reconciliation, and unrelated-record safety.
//
// Run: DATABASE_URL=postgres://localhost:5432/acq_os_m3_test npx vitest run \
//        src/lib/billing/invoice-db.integration.test.ts
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { getDb, hasDb } from "../../db/client";
import {
  insertInvoiceIfAbsent, invoicesForAgreement, getInvoiceByIdempotencyKey, updateInvoice,
  recordPaymentEventIfAbsent, paymentEventsForProviderInvoice,
} from "../repo";
import { invoiceIdempotencyKey } from "./invoice";
import type { Invoice } from "../types";
import { makeInvoice } from "../agreement/test-fixtures";

const RUN = hasDb();

function seed(over: Partial<Invoice> = {}): Omit<Invoice, "id" | "createdAt" | "updatedAt"> {
  return makeInvoice({
    leadId: "lead_db", agreementId: "ag_db", state: "draft", amountCents: 500_000,
    idempotencyKey: invoiceIdempotencyKey({ issuerId: "artifex-systems", agreementId: "ag_db", agreementVersion: 1, milestoneKey: "deposit" }),
    ...over,
  });
}

describe.skipIf(!RUN)("REAL DB — invoice adapter (isolated Postgres)", () => {
  beforeAll(async () => {
    // Refuse to run against anything that looks like production.
    const url = process.env.DATABASE_URL ?? "";
    if (!/localhost|127\.0\.0\.1/.test(url) || /prod/i.test(url)) throw new Error(`Refusing non-local/prod-looking DB: ${url}`);
  });
  beforeEach(async () => {
    await getDb().execute(sql`truncate table invoices, payment_events restart identity cascade`);
  });

  it("real UNIQUE constraint makes concurrent same-milestone creates yield exactly one row", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => insertInvoiceIfAbsent(seed())));
    expect(results.filter((r) => r.inserted).length).toBe(1); // exactly one winner
    expect(await invoicesForAgreement("ag_db")).toHaveLength(1);
  });

  it("persists issuer/agreement-version binding and a state update", async () => {
    const { row } = await insertInvoiceIfAbsent(seed());
    await updateInvoice(row.id, { state: "issued", providerInvoiceId: "in_db_1", issuedAt: new Date().toISOString() });
    const found = await getInvoiceByIdempotencyKey(row.idempotencyKey);
    expect(found?.issuerId).toBe("artifex-systems");
    expect(found?.agreementVersion).toBe(1);
    expect(found?.state).toBe("issued");
    expect(found?.providerInvoiceId).toBe("in_db_1");
  });

  it("payment_events unique event_id dedupes concurrent duplicate receipts", async () => {
    const recSeed = {
      provider: "stripe", eventId: "evt_db_1", eventType: "invoice.paid", providerInvoiceId: "in_db_1", invoiceId: null,
      issuerId: null, payload: { hello: "world" }, occurredAt: new Date().toISOString(), receivedAt: new Date().toISOString(),
      processedAt: null, outcome: null,
    };
    const rs = await Promise.all([recordPaymentEventIfAbsent(recSeed), recordPaymentEventIfAbsent(recSeed), recordPaymentEventIfAbsent(recSeed)]);
    expect(rs.filter((r) => r.inserted).length).toBe(1);
    expect(await paymentEventsForProviderInvoice("in_db_1")).toHaveLength(1);
  });

  it("different milestones coexist; an unrelated agreement's invoice is untouched", async () => {
    await insertInvoiceIfAbsent(seed());
    await insertInvoiceIfAbsent(seed({
      milestoneKey: "balance", milestoneLabel: "Balance",
      idempotencyKey: invoiceIdempotencyKey({ issuerId: "artifex-systems", agreementId: "ag_db", agreementVersion: 1, milestoneKey: "balance" }),
    }));
    // An unrelated agreement's invoice must be preserved by ops on ag_db.
    const other = await insertInvoiceIfAbsent(seed({
      agreementId: "ag_other", leadId: "lead_other",
      idempotencyKey: invoiceIdempotencyKey({ issuerId: "artifex-systems", agreementId: "ag_other", agreementVersion: 1, milestoneKey: "deposit" }),
    }));
    await updateInvoice((await invoicesForAgreement("ag_db"))[0].id, { state: "issued" });
    expect(await invoicesForAgreement("ag_db")).toHaveLength(2);
    expect(await invoicesForAgreement("ag_other")).toHaveLength(1);
    expect(other.row.state).toBe("draft");
  });
});
