// ─────────────────────────────────────────────────────────────────────────────
// QUICK-FIX LIVE CONFIG VERIFY — proves LIVE checkout resolution WITHOUT charging.
// No Stripe network call, no session created, no secret printed. Booleans only.
//   railway run --service outreach-web -- npx tsx scripts/quickfix-live-config-verify.ts
// ─────────────────────────────────────────────────────────────────────────────
import { quickFixStripeMode, resolveQuickFixStripeKey, stripeKeyMode } from "../src/lib/quick-fix/stripe-mode";
import { webhookSecretPresence } from "../src/lib/quick-fix/webhook-secrets";
import { legalGateBlocked } from "../src/lib/quick-fix/purchase-safety";
import { buildFixScanCheckoutParams } from "../src/lib/quick-fix/fix-scan-commerce";
import { toStripeForm } from "../src/lib/quick-fix/stripe-commerce";

function main() {
  let pass = 0, fail = 0;
  const check = (label: string, ok: boolean, detail = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`); };

  const mode = quickFixStripeMode();
  check("Quick-Fix Stripe mode resolves to LIVE", mode === "live", `mode=${mode}`);

  const live = resolveQuickFixStripeKey(process.env, "live");
  // Never print the key — only whether it resolved and that its prefix is a live key.
  check("LIVE key path resolves (STRIPE_SECRET_KEY)", live.ok && !!live.key, live.ok ? "resolved" : (live.reason ?? "unresolved"));
  check("LIVE key prefix is a live key", !!live.key && stripeKeyMode(live.key) === "live");

  const wh = webhookSecretPresence(process.env);
  check("LIVE webhook secret configured (_LIVE)", !!wh.liveWebhookSecretConfigured);
  check("TEST webhook secret configured (_TEST)", !!wh.testWebhookSecretConfigured);
  check("legacy webhook secret is ABSENT (already removed)", !wh.legacyWebhookSecretPresent);

  const legal = legalGateBlocked({ ...process.env, NODE_ENV: "production" } as NodeJS.ProcessEnv);
  check("production legal gate is OPEN (QUICKFIX_LEGAL_APPROVED=true)", legal === null, legal ?? "open");

  // Price/SKU + managed-payments opt-out on the exact params (no session created).
  const form = toStripeForm(buildFixScanCheckoutParams({ leadId: "config-verify", companyName: "Config Verify", baseUrl: "https://outreach.artifexlabs.tech" }));
  check("Fix Scan price is the fixed $99 (server-resolved, not browser)", form["line_items[0][price_data][unit_amount]"] === "9900");
  check("managed_payments[enabled]=false is included", form["managed_payments[enabled]"] === "false");
  check("no digital-goods tax code forced", form["line_items[0][price_data][product_data][tax_code]"] === undefined);
  check("mode=payment (one-time, not subscription)", form["mode"] === "payment");

  console.log(`\n  NOTE: a browser success redirect can NEVER mark a job paid — only the verified webhook does (see /api/offer/[id]/status + webhook route).`);
  console.log(`\n════════ LIVE CONFIG: ${pass} passed / ${fail} failed · 0 charges · 0 sessions created · 0 secrets printed ════════\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main();
