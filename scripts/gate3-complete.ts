// GATE 3 (part C) — complete payment on the SAME hosted invoice with a Stripe TEST
// card, then confirm the WEBHOOK (not a redirect) reconciles the local app invoice.
// (The hosted page's client-facing RENDER was verified in the browser; automating
// Stripe's multi-iframe Payment Element accordion is a harness limitation, so the
// card is submitted via a test PaymentMethod on the same invoice — the resulting
// invoice.paid event is identical to a browser payment.) Test mode only; no email.
import "./loadEnv";
import { isTestKey } from "../src/lib/payments/stripe-invoice";
import { getInvoice } from "../src/lib/repo";

const KEY = process.env.STRIPE_SECRET_KEY ?? "";
const API = "https://api.stripe.com";
const [providerInvoiceId, appInvoiceId] = [process.argv[2], process.argv[3]];
function form(p: Record<string, string>) { return Object.entries(p).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&"); }
async function sPost(path: string, params: Record<string, string> = {}) {
  const r = await fetch(`${API}${path}`, { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form(params) });
  const j = await r.json(); if (!r.ok) throw new Error(`${path} ${r.status}: ${JSON.stringify(j.error?.message ?? j)}`); return j;
}
async function sGet(path: string) { const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${KEY}` } }); const j = await r.json(); if (!r.ok) throw new Error(`${path} ${r.status}`); return j; }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!isTestKey(KEY)) throw new Error("REFUSING: not a test key.");
  if (!providerInvoiceId || !appInvoiceId) throw new Error("usage: gate3-complete <providerInvoiceId> <appInvoiceId>");
  const inv = await sGet(`/v1/invoices/${providerInvoiceId}`);
  const customer = inv.customer;
  const pm = await sPost(`/v1/payment_methods/pm_card_visa/attach`, { customer });
  await sPost(`/v1/customers/${customer}`, { "invoice_settings[default_payment_method]": pm.id });
  const paid = await sPost(`/v1/invoices/${providerInvoiceId}/pay`, {});
  console.log(`paid the hosted invoice at Stripe (test card). invoice status=${paid.status}`);

  console.log("waiting for the WEBHOOK (invoice.paid) to reconcile the local app invoice…");
  let ok = false;
  for (let i = 0; i < 30; i++) { const a = await getInvoice(appInvoiceId); if (a?.state === "paid") { ok = true; break; } await sleep(1000); }
  const a = await getInvoice(appInvoiceId);
  console.log(`app invoice: state=${a?.state} paidAt=${a?.paidAt ? "set" : "null"}`);
  console.log(ok ? "GATE 3: webhook-driven reconciliation of the hosted-invoice payment CONFIRMED." : "GATE 3: reconciliation NOT confirmed (see above).");
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error("GATE3 COMPLETE ERROR:", e.message); process.exit(1); });
