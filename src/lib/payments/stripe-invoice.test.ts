import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveStripeKeyForIssuer, isTestKey, prepareInvoice, finalizeInvoice, type FetchImpl } from "./stripe-invoice";

// A fake Stripe that records calls and returns canned JSON — no network.
function fakeStripe(): { fetchImpl: FetchImpl; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl: FetchImpl = async (url) => {
    calls.push(url);
    let body: Record<string, unknown> = {};
    if (url.endsWith("/v1/customers")) body = { id: "cus_test_1" };
    else if (url.endsWith("/v1/invoiceitems")) body = { id: "ii_test_1" };
    else if (url.endsWith("/v1/invoices")) body = { id: "in_test_1" };
    else if (url.includes("/finalize")) body = { id: "in_test_1", hosted_invoice_url: "https://invoice.stripe.com/i/test", status: "open" };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, calls };
}

const ORIG = { ...process.env };
beforeEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY_FAEDAWAY;
});
afterEach(() => {
  process.env = { ...ORIG };
});

describe("issuer→account key selection", () => {
  it("reports the missing env var by NAME (never a value) when unset", () => {
    const r = resolveStripeKeyForIssuer("artifex-systems");
    expect(r.ok).toBe(false);
    expect(r.envVar).toBe("STRIPE_SECRET_KEY");
    expect(r.error).toMatch(/Missing Stripe credential: set STRIPE_SECRET_KEY/);
  });

  it("selects the issuer-specific env var; a Faedaway record never reads the active account's key", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_active";
    // faedaway has NO key configured → refused, does not fall through to STRIPE_SECRET_KEY
    const fae = resolveStripeKeyForIssuer("faedaway");
    expect(fae.ok).toBe(false);
    expect(fae.envVar).toBe("STRIPE_SECRET_KEY_FAEDAWAY");
    // active issuer resolves its own key
    expect(resolveStripeKeyForIssuer("artifex-systems").ok).toBe(true);
  });

  it("unknown issuer is rejected", () => {
    expect(resolveStripeKeyForIssuer("nope").ok).toBe(false);
  });
});

describe("test-mode rehearsal safety", () => {
  it("isTestKey distinguishes test vs live", () => {
    expect(isTestKey("sk_test_x")).toBe(true);
    expect(isTestKey("sk_live_x")).toBe(false);
  });

  it("refuses to prepare against a LIVE key when requireTestMode is set (blocked, no charge)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_danger";
    const { fetchImpl, calls } = fakeStripe();
    const r = await prepareInvoice({
      issuerId: "artifex-systems", requireTestMode: true, fetchImpl,
      customerEmail: "synthetic@example.test", customerName: "Synthetic Co",
      amountCents: 500_000, currency: "usd", description: "Deposit", metadata: {},
    });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
    expect(calls).toHaveLength(0); // never hit the network
  });
});

describe("prepare → finalize sequence (hermetic)", () => {
  it("prepare creates customer → invoice item → draft invoice", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_ok";
    const { fetchImpl, calls } = fakeStripe();
    const r = await prepareInvoice({
      issuerId: "artifex-systems", requireTestMode: true, fetchImpl,
      customerEmail: "synthetic@example.test", customerName: "Synthetic Co",
      amountCents: 500_000, currency: "usd", description: "Deposit — AL-A-2026-001", metadata: { agreementId: "ag1", milestoneKey: "deposit" },
    });
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({ customerId: "cus_test_1", invoiceId: "in_test_1" });
    expect(calls.some((c) => c.endsWith("/v1/customers"))).toBe(true);
    expect(calls.some((c) => c.endsWith("/v1/invoiceitems"))).toBe(true);
    expect(calls.some((c) => c.endsWith("/v1/invoices"))).toBe(true);
  });

  it("finalize returns the hosted invoice URL", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_ok";
    const { fetchImpl } = fakeStripe();
    const r = await finalizeInvoice({ issuerId: "artifex-systems", requireTestMode: true, fetchImpl }, "in_test_1");
    expect(r.ok).toBe(true);
    expect(r.data?.hostedInvoiceUrl).toBe("https://invoice.stripe.com/i/test");
  });
});
