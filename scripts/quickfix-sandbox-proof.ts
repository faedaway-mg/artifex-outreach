// ─────────────────────────────────────────────────────────────────────────────
// QUICK-FIX SANDBOX PROOF — creates ONE real Stripe TEST-mode ($99 Fix Scan)
// Checkout Session using the TEST key (no live charge), and checks the DEPLOYED
// webhook endpoint rejects an unsigned POST (a browser redirect / forged call can
// never mark paid). Completing the hosted checkout with a test card is the operator
// step; once done, Stripe delivers the signed event to the webhook and the job is
// created (verify via GET /api/offer/<offerId>/status).
//
// SECRET SAFETY: never prints the Stripe key or any webhook secret. Prints only the
// session id (cs_test_…), the hosted URL, mode, amount, and the offerId.
//
// Usage (test key injected from prod env, never printed):
//   railway run --service outreach-web -- npx tsx scripts/quickfix-sandbox-proof.ts
// ─────────────────────────────────────────────────────────────────────────────
import { resolveQuickFixStripeKey } from "../src/lib/quick-fix/stripe-mode";
import { liveStripeCheckoutClient } from "../src/lib/quick-fix/stripe-commerce";
import { buildFixScanCheckoutParams, fixScanOfferId } from "../src/lib/quick-fix/fix-scan-commerce";

const BASE = process.env.PUBLIC_BASE_URL || "https://outreach.artifexlabs.tech";

async function main() {
  const keyRes = resolveQuickFixStripeKey(process.env, "test");
  if (!keyRes.ok || !keyRes.key) { console.error(`REFUSED: ${keyRes.reason ?? "test key not configured"}`); process.exit(1); }

  const stamp = process.env.SANDBOX_STAMP ?? "manual";
  const leadId = `sandbox-proof-${stamp}`;
  const offerId = fixScanOfferId(leadId);
  const params = buildFixScanCheckoutParams({ leadId, companyName: "Sandbox Proof Co", baseUrl: BASE, customerEmail: "sandbox@artifexlabs.tech" });

  console.log(`\n════════ QUICK-FIX SANDBOX PROOF (Stripe TEST mode — no live charge) ════════`);
  const client = liveStripeCheckoutClient(keyRes.key);
  const res = await client.create(params);
  if (!res.ok) { console.error(`✗ Checkout Session creation FAILED: ${res.error}`); process.exit(1); }
  const isTest = (res.id ?? "").startsWith("cs_test_");
  console.log(`  ✓ Checkout Session created`);
  console.log(`     sessionId:  ${res.id}   (${isTest ? "TEST mode ✓" : "NOT a test session ✗"})`);
  console.log(`     amount:     $${(params.lineItems[0].unitAmountCents / 100).toFixed(2)}  purchaseType=${params.metadata.purchaseType}  sku=${params.metadata.sku}`);
  console.log(`     offerId:    ${offerId}`);
  console.log(`     hostedURL:  ${res.url}`);

  // Prove the DEPLOYED webhook rejects an unsigned event (redirect/forgery can't mark paid).
  try {
    const r = await fetch(`${BASE}/api/webhooks/stripe-quickfix`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "evt_forged", type: "checkout.session.completed", livemode: false, data: { object: { metadata: { offerId } } } }) });
    console.log(`  ${r.status === 400 ? "✓" : "✗"} deployed webhook rejects an unsigned event → HTTP ${r.status} (expect 400)`);
  } catch (e) { console.log(`  ⚠ could not reach deployed webhook: ${e instanceof Error ? e.message : "err"}`); }

  console.log(`\n  NEXT (operator, sandbox): open the hosted URL, pay with test card 4242 4242 4242 4242 (any future exp/CVC/ZIP).`);
  console.log(`  Stripe then delivers a SIGNED checkout.session.completed to the webhook (verified by the TEST secret).`);
  console.log(`  Verify the job was created by the VERIFIED webhook (not the redirect):`);
  console.log(`     curl -s ${BASE}/api/offer/${offerId}/status   → expect {"status":"INTAKE_REQUIRED"}`);
  console.log(`\n════════ SANDBOX PROOF SETUP COMPLETE — 0 live charges ════════\n`);
}

main().catch((e) => { console.error(`error: ${e instanceof Error ? e.message : "unknown"}`); process.exit(1); });
