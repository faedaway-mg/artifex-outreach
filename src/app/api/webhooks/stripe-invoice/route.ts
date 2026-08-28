import { NextRequest, NextResponse } from "next/server";
import { handleStripeInvoiceWebhook } from "@/lib/payments/stripe-invoice-webhook";
import { currentIssuer } from "@/lib/billing/issuer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stripe INVOICE webhook (M2/M3 billing). Distinct from the legacy Checkout-deposit
// route (/api/webhooks/stripe), which is left unchanged. POST-only; self-authenticating
// via HMAC (allowlisted in middleware like the other webhooks — no operator session).
//
// The endpoint is bound to the ACTIVE issuer and verifies with THAT issuer's own
// webhook signing secret (env var named in the issuer registry). Account isolation
// is enforced by matching our stored invoice.issuerId — it does NOT depend on a
// Stripe Connect account field, so ordinary direct-account test events are accepted.
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const issuer = currentIssuer();
  const secret = process.env[issuer.stripeWebhookSecretEnvVar] ?? null;
  const result = await handleStripeInvoiceWebhook({
    rawBody,
    signature: req.headers.get("stripe-signature"),
    secret,
    isProduction: process.env.NODE_ENV === "production",
    expectedIssuerId: issuer.id,
  });
  // 2xx = do not retry (processed/duplicate/ignored/pending). 401/409/400 = Stripe
  // will retry per its schedule, which is correct for a transient misconfiguration.
  return NextResponse.json({ ok: result.ok, kind: result.kind, result: result.result }, { status: result.status });
}
