import { NextRequest, NextResponse } from "next/server";
import { handleStripeWebhook } from "@/lib/payments/stripe-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stripe deposit-payment webhook. Raw body required for signature verification.
// Self-authenticating (allowlisted in middleware). Marks a deposit paid only on a
// verified checkout.session.completed event.
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const result = await handleStripeWebhook({
    rawBody,
    signature: req.headers.get("stripe-signature"),
    secret: process.env.STRIPE_WEBHOOK_SECRET ?? null,
    isProduction: process.env.NODE_ENV === "production",
  });
  return NextResponse.json({ ok: result.ok, kind: result.kind, result: result.result }, { status: result.status });
}
