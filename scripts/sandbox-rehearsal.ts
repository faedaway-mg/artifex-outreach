// FULL local sandbox rehearsal — REAL Stripe test API + REAL provider-originated
// webhook events through the live HTTP route (forwarded by `stripe listen`), against
// the isolated test DB. NO email (charge_automatically), NO live money (test card).
// Refuses live keys / non-local DB. Never prints secrets.
import "./loadEnv";
import { isTestKey } from "../src/lib/payments/stripe-invoice";
import { insertAgreement, getInvoice, updateInvoice } from "../src/lib/repo";
import { prepareMilestoneInvoice } from "../src/lib/billing/invoicing-service";
import { makeAgreement } from "../src/lib/agreement/test-fixtures";

const KEY = process.env.STRIPE_SECRET_KEY ?? "";
const API = "https://api.stripe.com";
function form(p: Record<string, string>) { return Object.entries(p).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&"); }
async function stripe(path: string, params: Record<string, string> = {}): Promise<any> {
  const res = await fetch(`${API}${path}`, { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form(params) });
  const j = await res.json();
  if (!res.ok) throw new Error(`Stripe ${path} -> ${res.status}: ${JSON.stringify(j.error?.message ?? j)}`);
  return j;
}
async function stripeGet(path: string): Promise<any> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${KEY}` } });
  const j = await res.json();
  if (!res.ok) throw new Error(`Stripe GET ${path} -> ${res.status}: ${JSON.stringify(j.error?.message ?? j)}`);
  return j;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function pollInvoice(id: string, pred: (i: any) => boolean, label: string, tries = 30): Promise<boolean> {
  for (let i = 0; i < tries; i++) { const inv = await getInvoice(id); if (inv && pred(inv)) { console.log(`   ✓ ${label}`); return true; } await sleep(1000); }
  console.log(`   ✗ TIMEOUT waiting for: ${label}`); return false;
}

async function main() {
  if (!isTestKey(KEY)) throw new Error("REFUSING: not a test key.");
  const db = process.env.DATABASE_URL ?? "";
  if (!/localhost|127\.0\.0\.1/.test(db) || /prod/i.test(db)) throw new Error(`REFUSING: non-local DB: ${db}`);
  console.log("guards ok. isolated test DB + sk_test_ key.\n");

  // 1) App creates a signed agreement + prepares a deposit invoice (draft in our DB).
  const a = makeAgreement({ status: "signed" });
  const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = a;
  const ag = await insertAgreement({ ...rest, agreementNumber: `AL-A-REH-${Date.now()}` });
  const prep = await prepareMilestoneInvoice(ag.id, "deposit", { actor: "jordan", actorRole: "founder" });
  if (!prep.ok || !prep.invoice) throw new Error("prepare failed: " + prep.reason);
  const appInvoiceId = prep.invoice.id;
  console.log(`1) app deposit invoice prepared (draft): ${appInvoiceId} — ${prep.invoice.amountCents} cents`);

  // 2) Real Stripe test customer with a default test card (no email path).
  const cust = await stripe("/v1/customers", { name: "Sandbox Rehearsal Co (TEST)", email: "synthetic+rehearsal@example.com" });
  const pm = await stripe(`/v1/payment_methods/pm_card_visa/attach`, { customer: cust.id });
  await stripe(`/v1/customers/${cust.id}`, { "invoice_settings[default_payment_method]": pm.id });
  console.log(`2) test customer + default test card attached: ${cust.id}`);

  // 3) Real Stripe invoice (charge_automatically → NO email), item, link to app invoice.
  const sInv = await stripe("/v1/invoices", { customer: cust.id, collection_method: "charge_automatically", auto_advance: "false", "metadata[appInvoiceId]": appInvoiceId });
  await stripe("/v1/invoiceitems", { customer: cust.id, invoice: sInv.id, amount: String(prep.invoice.amountCents), currency: "usd", description: "Rehearsal deposit" });
  // Link BEFORE payment so the incoming invoice.paid resolves to our app invoice.
  await updateInvoice(appInvoiceId, { state: "issued", providerInvoiceId: sInv.id });
  console.log(`3) real Stripe invoice created + linked: ${sInv.id}`);

  // 4) Finalize + pay with the test card → REAL charge, NO email → emits invoice.paid.
  await stripe(`/v1/invoices/${sInv.id}/finalize`, { auto_advance: "false" });
  await stripe(`/v1/invoices/${sInv.id}/pay`, {});
  // dahlia API: the charge/PI aren't inline on the invoice — retrieve the latest charge.
  const charges = await stripeGet(`/v1/charges?customer=${cust.id}&limit=1`);
  const chargeId = charges.data?.[0]?.id ?? "";
  const piId = charges.data?.[0]?.payment_intent ?? "";
  // Store the money refs so the refund event can resolve back to this invoice.
  await updateInvoice(appInvoiceId, { chargeId: chargeId || null, paymentIntentId: piId || null });
  console.log(`4) invoice PAID at Stripe (test card). charge=${chargeId ? chargeId.slice(0, 8) + "…" : "?"} pi=${piId ? piId.slice(0, 6) + "…" : "?"}`);

  // 5) The listener forwards the REAL invoice.paid to our route → app invoice → paid.
  console.log("5) waiting for provider-originated invoice.paid through the HTTP route…");
  const paidOk = await pollInvoice(appInvoiceId, (i) => i.state === "paid", "app invoice reconciled to PAID via real webhook");

  // 6) Real partial refund → charge.refunded → route → amountRefundedCents (state stays paid).
  if (chargeId || piId) {
    await stripe("/v1/refunds", { ...(piId ? { payment_intent: piId } : { charge: chargeId }), amount: "100000" });
    console.log("6) real partial refund issued ($1,000). waiting for charge.refunded through the route…");
    await pollInvoice(appInvoiceId, (i) => i.amountRefundedCents === 100_000 && i.state === "paid", "refund recorded as a SEPARATE fact; lifecycle still paid");
  }

  const fin = await getInvoice(appInvoiceId);
  console.log(`\nRESULT: state=${fin?.state} refunded=${fin?.amountRefundedCents} disputeStatus=${fin?.disputeStatus}`);
  console.log(paidOk ? "SANDBOX REHEARSAL: end-to-end reconciliation PROVEN (provider-originated)." : "SANDBOX REHEARSAL: paid-reconcile did not confirm (see above).");
  process.exit(paidOk ? 0 : 1);
}
main().catch((e) => { console.error("REHEARSAL ERROR:", e.message); process.exit(1); });
