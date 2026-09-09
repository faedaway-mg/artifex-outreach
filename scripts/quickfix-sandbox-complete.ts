// ─────────────────────────────────────────────────────────────────────────────
// QUICK-FIX SANDBOX FULL PROOF — same-account TEST mode, end-to-end, no live charge.
// (1) confirm test & live keys are the SAME account; (2) create a $99 Fix Scan TEST
// Checkout Session; (3) confirm the deployed status is NOT paid pre-webhook; (4)
// complete the hosted checkout with Stripe's test card via headless Chromium; (5)
// poll the DEPLOYED status until the VERIFIED webhook created the job. Prints only
// safe ids (acct_/cs_test_/req_) — never a key/secret/card.
//
//   railway run --service outreach-web -- npx tsx scripts/quickfix-sandbox-complete.ts
// ─────────────────────────────────────────────────────────────────────────────
import { chromium } from "playwright";
import { resolveQuickFixStripeKey } from "../src/lib/quick-fix/stripe-mode";
import { liveStripeCheckoutClient } from "../src/lib/quick-fix/stripe-commerce";
import { buildFixScanCheckoutParams, fixScanOfferId } from "../src/lib/quick-fix/fix-scan-commerce";

const API_BASE = process.env.STRIPE_API_BASE ?? "https://api.stripe.com";
const BASE = process.env.PUBLIC_BASE_URL || "https://outreach.artifexlabs.tech";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function acctId(key: string): Promise<string | null> {
  const r = await fetch(`${API_BASE}/v1/account`, { headers: { Authorization: `Bearer ${key}` } });
  const j = (await r.json().catch(() => ({}))) as any;
  return j.id ?? null;
}
async function status(offerId: string): Promise<string> {
  const r = await fetch(`${BASE}/api/offer/${offerId}/status`, { cache: "no-store" } as any);
  const j = (await r.json().catch(() => ({}))) as any;
  return j.status ?? `http_${r.status}`;
}

async function main() {
  let pass = 0, fail = 0;
  const check = (label: string, ok: boolean, detail = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`); };

  const test = resolveQuickFixStripeKey(process.env, "test");
  const live = resolveQuickFixStripeKey(process.env, "live");
  if (!test.ok || !test.key) { console.error("REFUSED: test key not configured/resolved"); process.exit(1); }

  console.log(`\n════════ QUICK-FIX SANDBOX FULL PROOF (TEST mode · no live charge) ════════`);
  const [tAcct, lAcct] = [await acctId(test.key), live.ok && live.key ? await acctId(live.key) : null];
  check("test & live keys are the SAME Stripe account", !!tAcct && tAcct === lAcct, `test=${tAcct} live=${lAcct}`);

  const stamp = process.env.SANDBOX_STAMP ?? `${Date.now()}`;
  const leadId = `sandbox-e2e-${stamp}`;
  const offerId = fixScanOfferId(leadId);
  const params = buildFixScanCheckoutParams({ leadId, companyName: "Sandbox E2E Co", baseUrl: BASE, customerEmail: "sandbox@artifexlabs.tech" });
  check("no Managed Payments opt-in / no tax_code in params", !params.lineItems[0].taxCode && !("managed_payments" in (params as any)), `taxCode=${params.lineItems[0].taxCode ?? "(none)"}`);

  const created = await liveStripeCheckoutClient(test.key).create(params);
  check("Fix Scan TEST Checkout Session created", created.ok && !!created.url && String(created.id).startsWith("cs_test_"), created.id ?? created.error);
  if (!created.url) { console.log(`\n════════ ${pass} passed / ${fail} failed ════════\n`); process.exit(1); }

  check("pre-webhook: deployed status is NOT paid (redirect can't mark paid)", ["PAYMENT_NOT_CONFIRMED", "PAYMENT_CONFIRMING"].includes(await status(offerId)));

  // Complete the hosted checkout with Stripe's standard test card via Chromium.
  console.log(`  … completing hosted checkout with test card 4242 (headless)…`);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(created.url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(4000);
    // Modern Stripe Checkout = Payment Element. Ensure the card method is selected.
    const cardBtn = page.locator('[data-testid="card-accordion-item-button"]').first();
    if (await cardBtn.count()) await cardBtn.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const topFill = async (sel: string, val: string) => { const el = page.locator(sel).first(); if (await el.count()) { await el.fill(val).catch(() => {}); } };
    // Card fields live inside Stripe's secure iframe(s); locate by input name across frames.
    const frameFill = async (name: string, val: string) => {
      for (const f of page.frames()) {
        if (!/js\.stripe\.com/.test(f.url())) continue;
        const el = f.locator(`input[name="${name}"]`).first();
        if (await el.count().catch(() => 0)) { await el.fill(val).catch(async () => { await el.type(val, { delay: 25 }).catch(() => {}); }); return true; }
      }
      return false;
    };
    await topFill('input[name="email"]', "sandbox@artifexlabs.tech");
    await frameFill("number", "4242424242424242");
    await frameFill("expiry", "1234");
    await frameFill("cvc", "123");
    await frameFill("postalCode", "42424");
    await topFill('input[name="billingName"]', "Sandbox Tester");
    await topFill('input[name="billingPostalCode"]', "42424");
    const country = page.locator('select[name="billingCountry"]').first();
    if (await country.count()) await country.selectOption("US").catch(() => {});
    // Canonical Stripe Checkout submit button.
    const submit = page.locator('[data-testid="hosted-payment-submit-button"], button.SubmitButton, button[type="submit"]').first();
    await submit.click({ timeout: 20000 }).catch(() => {});
    await page.waitForURL(/\/offer\/.+\/success/, { timeout: 90000 }).catch(() => {});
    if (!/\/success/.test(page.url())) {
      // Retry the submit once (Stripe sometimes needs a second confirm after validation).
      await page.locator('[data-testid="hosted-payment-submit-button"], button.SubmitButton').first().click({ timeout: 10000 }).catch(() => {});
      await page.waitForURL(/\/offer\/.+\/success/, { timeout: 60000 }).catch(() => {});
    }
    check("hosted checkout submitted + redirected to success page", /\/success/.test(page.url()), page.url().slice(0, 70));
  } catch (e) {
    check("hosted checkout automation", false, e instanceof Error ? e.message.slice(0, 90) : "err");
  } finally { await browser.close(); }

  // Poll the DEPLOYED status until the VERIFIED webhook created the job.
  let final = "";
  for (let i = 0; i < 20; i++) { final = await status(offerId); if (final === "INTAKE_REQUIRED" || final === "READY_FOR_FULFILLMENT" || final === "PAID") break; await sleep(3000); }
  check("VERIFIED webhook created the Fix Scan job (status advanced)", ["INTAKE_REQUIRED", "READY_FOR_FULFILLMENT", "PAID"].includes(final), final);

  console.log(`\n  offerId=${offerId} · finalStatus=${final}`);
  console.log(`════════ ${pass} passed / ${fail} failed · 0 live charges · 0 prospect emails ════════\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
