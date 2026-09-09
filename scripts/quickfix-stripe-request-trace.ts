// ─────────────────────────────────────────────────────────────────────────────
// QUICK-FIX STRIPE REQUEST TRACE — read-only root-cause diagnostic. Creates NO
// charge, mutates NOTHING, prints NO secret. It (1) dumps the exact outgoing
// Checkout field list, (2) reproduces the sandbox error and captures the STRUCTURED
// Stripe error + request-id + the API version Stripe echoes, (3) fingerprints
// whether STRIPE_TEST_KEY and STRIPE_SECRET_KEY are the same Stripe account (acct_…
// ids only). Keys / Authorization / secrets are never printed.
//
//   railway run --service outreach-web -- npx tsx scripts/quickfix-stripe-request-trace.ts
// ─────────────────────────────────────────────────────────────────────────────
import { buildFixScanCheckoutParams } from "../src/lib/quick-fix/fix-scan-commerce";
import { toStripeForm } from "../src/lib/quick-fix/stripe-commerce";

const API_BASE = process.env.STRIPE_API_BASE ?? "https://api.stripe.com";
const encodeForm = (p: Record<string, string>) => Object.entries(p).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

const PROBES = [
  "managed_payments", "managed_payments[enabled]", "automatic_tax", "automatic_tax[enabled]",
  "payment_method_configuration", "adaptive_pricing", "tax_id_collection", "payment_intent_data",
  "line_items[0][price_data][product_data][tax_code]", "mode",
];

async function main() {
  // ── 1. EXACT OUTGOING FIELDS (no network, no secret) ──────────────────────
  const params = buildFixScanCheckoutParams({ leadId: "trace", companyName: "Trace Co", baseUrl: "https://outreach.artifexlabs.tech" });
  const form = toStripeForm(params);
  console.log(`\n════════ 1. EXACT OUTGOING CHECKOUT FIELDS (field names + safe values) ════════`);
  for (const k of Object.keys(form).sort()) console.log(`   ${k} = ${form[k]}`);
  console.log(`\n   PRESENCE CHECK:`);
  for (const p of PROBES) console.log(`     ${p.padEnd(52)} : ${Object.prototype.hasOwnProperty.call(form, p) ? `PRESENT (${form[p]})` : "ABSENT"}`);
  console.log(`   HEADERS SENT: Authorization=[REDACTED], Content-Type=application/x-www-form-urlencoded, Idempotency-Key=<key>. No Stripe-Version, no beta/preview, no Stripe-Account header.`);

  const testKey = process.env.STRIPE_TEST_KEY;
  const liveKey = process.env.STRIPE_SECRET_KEY;

  // ── 2. REPRODUCE THE SANDBOX ERROR (test key; no charge) ──────────────────
  console.log(`\n════════ 2. LIVE SANDBOX RESPONSE (test key; no charge) ════════`);
  if (!testKey) { console.log("   STRIPE_TEST_KEY absent in this environment — run via railway run to capture."); }
  else {
    const res = await fetch(`${API_BASE}/v1/checkout/sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${testKey}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": `trace-${params.idempotencyKey}` },
      body: encodeForm(form),
    });
    console.log(`   HTTP status:      ${res.status}`);
    console.log(`   request-id:       ${res.headers.get("request-id") ?? res.headers.get("x-request-id") ?? "n/a"}`);
    console.log(`   Stripe-Version:   ${res.headers.get("stripe-version") ?? "(not echoed)"}  ← API version Stripe used`);
    const j = (await res.json().catch(() => ({}))) as any;
    if (j.error) {
      console.log(`   error.type:       ${j.error.type ?? ""}`);
      console.log(`   error.code:       ${j.error.code ?? ""}`);
      console.log(`   error.param:      ${j.error.param ?? ""}`);
      console.log(`   error.message:    ${String(j.error.message ?? "").slice(0, 300)}`);
    } else if (j.id) {
      console.log(`   ✓ session created: ${j.id} (${String(j.id).startsWith("cs_test_") ? "TEST" : "?"}) — no tax/managed error`);
    }
  }

  // ── 3. ACCOUNT FINGERPRINTS (are test & live the SAME account?) ───────────
  console.log(`\n════════ 3. ACCOUNT FINGERPRINT (acct_… ids only) ════════`);
  async function acct(label: string, key: string | undefined) {
    if (!key) { console.log(`   ${label}: key absent`); return null; }
    const r = await fetch(`${API_BASE}/v1/account`, { headers: { Authorization: `Bearer ${key}` } });
    const j = (await r.json().catch(() => ({}))) as any;
    if (j.error) { console.log(`   ${label}: error ${j.error.code ?? j.error.type}`); return null; }
    const managedKeys = Object.keys(j).filter((k) => /managed|controller/i.test(k));
    console.log(`   ${label}: id=${j.id ?? "?"} object=${j.object ?? "?"} country=${j.country ?? "?"}${managedKeys.length ? ` managed/controller-keys=${managedKeys.join(",")}` : ""}`);
    return j.id ?? null;
  }
  const [tId, lId] = [await acct("test key (STRIPE_TEST_KEY)", testKey), await acct("live key (STRIPE_SECRET_KEY)", liveKey)];
  if (tId && lId) console.log(`   SAME ACCOUNT? ${tId === lId ? "YES — same acct (test+live modes of one account)" : "NO — DIFFERENT accounts (test key is a separate sandbox)"}`);

  console.log(`\n════════ TRACE COMPLETE — 0 charges · 0 mutations · 0 secrets printed ════════\n`);
}
main().catch((e) => { console.error(`error: ${e instanceof Error ? e.message : "unknown"}`); process.exit(1); });
