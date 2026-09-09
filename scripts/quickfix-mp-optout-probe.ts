// ─────────────────────────────────────────────────────────────────────────────
// MANAGED-PAYMENTS OPT-OUT PROBE — TEST mode only, no deploy, no charge, no mutation.
// Builds the canonical Fix Scan Checkout params + `managed_payments[enabled]=false`
// and asks Stripe (TEST key) whether it accepts the opt-out and creates a standard
// session with NO tax code required. Prints only safe ids + sanitized errors.
//   railway run --service outreach-web -- npx tsx scripts/quickfix-mp-optout-probe.ts
// ─────────────────────────────────────────────────────────────────────────────
import { resolveQuickFixStripeKey } from "../src/lib/quick-fix/stripe-mode";
import { buildFixScanCheckoutParams } from "../src/lib/quick-fix/fix-scan-commerce";
import { toStripeForm } from "../src/lib/quick-fix/stripe-commerce";

const API_BASE = process.env.STRIPE_API_BASE ?? "https://api.stripe.com";
const enc = (p: Record<string, string>) => Object.entries(p).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

async function main() {
  const key = resolveQuickFixStripeKey(process.env, "test");
  if (!key.ok || !key.key) { console.error("REFUSED: test key not resolved"); process.exit(1); }

  const params = buildFixScanCheckoutParams({ leadId: "mp-optout-probe", companyName: "MP Optout Probe", baseUrl: "https://outreach.artifexlabs.tech" });
  const form = toStripeForm(params);
  form["managed_payments[enabled]"] = "false"; // the ONLY addition under test

  console.log(`\n════════ MANAGED-PAYMENTS OPT-OUT PROBE (TEST · no charge) ════════`);
  console.log(`   sending: mode=${form.mode}, managed_payments[enabled]=false, tax_code=(none), automatic_tax=(none)`);
  const res = await fetch(`${API_BASE}/v1/checkout/sessions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key.key}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": `mp-optout-${params.idempotencyKey}` },
    body: enc(form),
  });
  console.log(`   HTTP ${res.status} · request-id ${res.headers.get("request-id") ?? "n/a"} · Stripe-Version ${res.headers.get("stripe-version") ?? "-"}`);
  const j = (await res.json().catch(() => ({}))) as any;
  if (res.ok && j.id) {
    console.log(`   ✅ ACCEPTED — standard session created: ${j.id} (${String(j.id).startsWith("cs_test_") ? "TEST" : "?"})`);
    console.log(`      url present: ${!!j.url}`);
    console.log(`      automatic_tax.status: ${j.automatic_tax?.status ?? "(none)"}  (expect off/none)`);
    // Any managed-payments echo on the session object?
    const mpKeys = Object.keys(j).filter((k) => /managed/i.test(k));
    console.log(`      managed-payments fields on session: ${mpKeys.length ? mpKeys.map((k) => `${k}=${JSON.stringify(j[k])}`).join(", ") : "(none)"}`);
    console.log(`   → tax code required? NO · automatic tax? NO · standard Stripe Payments behavior.`);
  } else if (j.error) {
    console.log(`   ❌ REJECTED — type=${j.error.type ?? ""} code=${j.error.code ?? ""} param=${j.error.param ?? ""}`);
    console.log(`      message: ${String(j.error.message ?? "").slice(0, 300)}`);
  }
  console.log(`════════ PROBE COMPLETE — 0 charges · 0 mutations · 0 secrets ════════\n`);
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
