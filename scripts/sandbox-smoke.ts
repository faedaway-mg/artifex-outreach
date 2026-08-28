// Real Stripe TEST-MODE create-smoke. Proves the saved sk_test_ key + the adapter
// reach the Stripe sandbox for the OUTBOUND path. Creates a synthetic customer +
// DRAFT invoice ONLY — it does NOT finalize or send, so no email leaves. Refuses to
// run against a live key or a non-local database. Never prints the key.
import "./loadEnv";
import { prepareInvoice, isTestKey } from "../src/lib/payments/stripe-invoice";

async function main() {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (!key) throw new Error("STRIPE_SECRET_KEY not set in .env.local");
  if (!isTestKey(key)) throw new Error("REFUSING: STRIPE_SECRET_KEY is not a test key (must be sk_test_).");
  const db = process.env.DATABASE_URL ?? "";
  if (!/localhost|127\.0\.0\.1/.test(db) || /prod/i.test(db)) throw new Error(`REFUSING: DATABASE_URL is not local/test: ${db}`);
  console.log("guards passed: test key + local DB. Calling REAL Stripe test API (draft only)…");

  const r = await prepareInvoice({
    issuerId: "artifex-systems",
    requireTestMode: true, // adapter refuses a live key here
    customerEmail: "synthetic+sandbox@example.com", // synthetic; draft => no send
    customerName: "Synthetic Sandbox Co (TEST)",
    amountCents: 725_000,
    currency: "usd",
    description: "SANDBOX SMOKE — Deposit — AL-A-TEST-001 (draft, not sent)",
    metadata: { rehearsal: "sandbox-smoke", milestoneKey: "deposit" },
  });

  if (!r.ok) {
    console.error("Stripe create FAILED:", r.blocked ? "[blocked] " : "", r.error);
    process.exit(1);
  }
  console.log("REAL Stripe test objects created (draft invoice, not finalized/sent):");
  console.log("  customerId:", r.data!.customerId);
  console.log("  invoiceId :", r.data!.invoiceId, "(status: draft)");
  console.log("Provider-originated CREATE path verified against the sandbox. No email sent, no charge.");
}
main().catch((e) => { console.error(e.message); process.exit(1); });
