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
  // 2xx acks anything we've durably handled — including a pending_unmatched event
  // (its receipt is persisted BEFORE this returns and is replayed by reconciliation).
  // A non-2xx is a genuine REJECTION, not a "retry will fix it": 400 malformed and 401
  // bad/absent signature are permanent client errors (Stripe will still retry per its
  // schedule; that's harmless and we must not 200-ack a request we refused), and 409 is
  // an account/issuer mismatch that a retry to THIS endpoint won't resolve.
  return NextResponse.json({ ok: result.ok, kind: result.kind, result: result.result }, { status: result.status });
}
