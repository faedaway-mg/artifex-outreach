// GATE 2 — REAL provider-originated DISPUTE rehearsal (test mode), linked to an
// application invoice, driven to a terminal LOST outcome via the documented path:
//   pm_card_createDispute → pay → charge.dispute.created → force lost via
//   evidence[uncategorized_text]=losing_evidence → charge.dispute.closed (lost).
// Verifies the app books it as a CHARGEBACK, not a refund; lifecycle stays paid.
// Test mode only; no email; refuses live key / non-local DB; never prints secrets.
import "./loadEnv";
import { isTestKey } from "../src/lib/payments/stripe-invoice";
import { insertAgreement, getInvoice, updateInvoice } from "../src/lib/repo";
import { prepareMilestoneInvoice, issueMilestoneInvoice } from "../src/lib/billing/invoicing-service";
import { makeAgreement } from "../src/lib/agreement/test-fixtures";

const KEY = process.env.STRIPE_SECRET_KEY ?? "";
const API = "https://api.stripe.com";
function form(p: Record<string, string>) { return Object.entries(p).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&"); }
async function sPost(path: string, params: Record<string, string> = {}) { const r = await fetch(`${API}${path}`, { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form(params) }); const j = await r.json(); if (!r.ok) throw new Error(`${path} ${r.status}: ${JSON.stringify(j.error?.message ?? j)}`); return j; }
async function sGet(path: string) { const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${KEY}` } }); const j = await r.json(); if (!r.ok) throw new Error(`${path} ${r.status}`); return j; }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function poll(id: string, pred: (i: any) => boolean, label: string, n = 40): Promise<boolean> {
  for (let i = 0; i < n; i++) { const inv = await getInvoice(id); if (inv && pred(inv)) { console.log(`   ✓ ${label}`); return true; } await sleep(1000); }
  console.log(`   ✗ TIMEOUT: ${label}`); return false;
}

async function main() {
  if (!isTestKey(KEY)) throw new Error("REFUSING: not a test key.");
  const db = process.env.DATABASE_URL ?? ""; if (!/localhost|127\.0\.0\.1/.test(db) || /prod/i.test(db)) throw new Error("REFUSING: non-local DB");

  // 1) App issues a real invoice.
  const a = makeAgreement({ status: "signed" });
  const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = a;
  const ag = await insertAgreement({ ...rest, agreementNumber: `AL-A-D${Date.now()}` });
  const prep = await prepareMilestoneInvoice(ag.id, "deposit", { actor: "jordan", actorRole: "founder" });
  const issued = await issueMilestoneInvoice(prep.invoice!.id, { actor: "jordan", actorRole: "founder", requireTestMode: true });
  const appId = prep.invoice!.id; const inId = issued.invoice!.providerInvoiceId!;
  console.log(`1) app invoice issued: ${appId} -> ${inId}`);

  // 2) Pay with the DISPUTE test card (fraudulent → will be disputed).
  const inv = await sGet(`/v1/invoices/${inId}`); const customer = inv.customer;
  const pm = await sPost(`/v1/payment_methods/pm_card_createDispute/attach`, { customer });
  await sPost(`/v1/customers/${customer}`, { "invoice_settings[default_payment_method]": pm.id });
  await sPost(`/v1/invoices/${inId}/pay`, {});
  const charges = await sGet(`/v1/charges?customer=${customer}&limit=1`);
  const chargeId = charges.data?.[0]?.id ?? ""; const piId = charges.data?.[0]?.payment_intent ?? "";
  // Store money refs so dispute events (which carry PI/charge, not invoice) resolve here.
  await updateInvoice(appId, { chargeId: chargeId || null, paymentIntentId: piId || null });
  console.log(`2) paid with dispute card. charge=${chargeId.slice(0, 8)}… pi=${piId.slice(0, 6)}…`);
  await poll(appId, (i) => i.state === "paid", "invoice.paid reconciled (state=paid)");

  // 3) The dispute is created automatically → wait for charge.dispute.created through the route.
  console.log("3) waiting for charge.dispute.created (auto)…");
  await poll(appId, (i) => i.disputeStatus === "open", "app booked disputeStatus=OPEN (separate from refund)");

  // 4) Force terminal LOST via the documented magic evidence value.
  const disputes = await sGet(`/v1/disputes?payment_intent=${piId}`);
  const du = disputes.data?.[0]?.id;
  if (!du) throw new Error("no dispute found for the payment_intent");
  await sPost(`/v1/disputes/${du}`, { "evidence[uncategorized_text]": "losing_evidence", submit: "true" });
  console.log(`4) submitted losing_evidence on ${du} → forcing terminal LOST. waiting for charge.dispute.closed(lost)…`);
  const lostOk = await poll(appId, (i) => i.disputeStatus === "lost", "app booked disputeStatus=LOST (chargeback, NOT a refund)");

  const fin = await getInvoice(appId);
  console.log(`\nRESULT: state=${fin?.state} disputeStatus=${fin?.disputeStatus} amountDisputed=${fin?.amountDisputedCents} amountRefunded=${fin?.amountRefundedCents}`);
  const clean = fin?.state === "paid" && fin?.disputeStatus === "lost" && (fin?.amountRefundedCents ?? 0) === 0;
  console.log(clean ? "GATE 2: lost dispute booked as a chargeback, refunded=0, lifecycle still paid — CORRECT." : "GATE 2: unexpected accounting (see above).");
  process.exit(lostOk && clean ? 0 : 1);
}
main().catch((e) => { console.error("GATE2 DISPUTE ERROR:", e.message); process.exit(1); });
