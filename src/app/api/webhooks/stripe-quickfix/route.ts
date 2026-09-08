import { NextRequest, NextResponse } from "next/server";
import { verifyStripeSignature, handleVerifiedEvent } from "@/lib/quick-fix/webhook";
import * as store from "@/lib/quick-fix/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Quick-fix Stripe webhook — the ONLY source of truth for "paid". Signature-
// verified, idempotent, replay-safe. A verified checkout.session.completed creates
// the fulfillment job (never a browser redirect). Self-authenticating; the
// /api/webhooks prefix is allowlisted in middleware. Add this endpoint URL +
// STRIPE_QUICKFIX_WEBHOOK_SECRET in the Stripe dashboard to activate.
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const secret = process.env.STRIPE_QUICKFIX_WEBHOOK_SECRET ?? process.env.STRIPE_WEBHOOK_SECRET ?? "";
  const nowSec = Math.floor(new Date(req.headers.get("date") ?? Date.now()).getTime() / 1000) || Math.floor(Date.now() / 1000);

  const verified = verifyStripeSignature({ payload: rawBody, header: req.headers.get("stripe-signature"), secret, nowSec });
  if (!verified.ok) return NextResponse.json({ ok: false, error: verified.reason }, { status: 400 });

  let event: any;
  try { event = JSON.parse(rawBody); } catch { return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 }); }

  const nowIso = new Date().toISOString();
  // The fulfillment logic is centralized in the store so the route, the rehearsal,
  // and the tests all exercise exactly the same "paid → fulfil" path.
  const deps = await store.webhookDeps(store.fulfillmentHandlers(nowIso));
  const result = await handleVerifiedEvent(event, deps);
  return NextResponse.json({ ok: result.ok, duplicate: result.duplicate, kind: result.outcome.kind });
}
