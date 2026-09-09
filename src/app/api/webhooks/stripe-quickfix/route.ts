import { NextRequest, NextResponse } from "next/server";
import { handleVerifiedEvent } from "@/lib/quick-fix/webhook";
import { verifyConfiguredWebhook, livemodeAgrees } from "@/lib/quick-fix/webhook-secrets";
import * as store from "@/lib/quick-fix/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Quick-fix Stripe webhook — the ONLY source of truth for "paid". A browser redirect
// never marks a job paid. Mode-aware, signature-verified, idempotent, replay-safe.
// The /api/webhooks prefix is allowlisted in middleware.
//
// SECURITY ORDER (critical): (1) read the raw body; (2) verify the signature against
// the configured secrets — the one that verifies determines TEST vs LIVE; (3) ONLY
// AFTER verification, require event.livemode to AGREE with the verifying secret's
// mode; (4) reject any mismatch. event.livemode is never trusted before verification.
// TEST verifies against STRIPE_QUICKFIX_WEBHOOK_SECRET_TEST (legacy secret is a TEST-
// only fallback); LIVE verifies against STRIPE_QUICKFIX_WEBHOOK_SECRET_LIVE and never
// falls back to a test/legacy secret. No secret value is ever logged or returned.
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const nowSec = Math.floor(new Date(req.headers.get("date") ?? Date.now()).getTime() / 1000) || Math.floor(Date.now() / 1000);

  const verified = verifyConfiguredWebhook({ payload: rawBody, header: req.headers.get("stripe-signature"), nowSec });
  if (!verified.ok || !verified.mode) return NextResponse.json({ ok: false, error: verified.reason }, { status: 400 });

  let event: any;
  try { event = JSON.parse(rawBody); } catch { return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 }); }

  // livemode is consulted ONLY now — after the signature verified which mode we're in.
  if (!livemodeAgrees(verified.mode, event.livemode)) {
    return NextResponse.json({ ok: false, error: "event mode does not match the verifying webhook secret" }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  // The fulfillment logic is centralized in the store so the route, the rehearsal,
  // and the tests all exercise exactly the same "paid → fulfil" path. Idempotent by
  // event.id; the five configured events are handled by interpretEvent
  // (checkout.session.completed → job/customer; subscription.* + invoice.payment_failed
  // → subscription state sync; anything else → safely ignored).
  const deps = await store.webhookDeps(store.fulfillmentHandlers(nowIso));
  const result = await handleVerifiedEvent(event, deps);
  return NextResponse.json({ ok: result.ok, duplicate: result.duplicate, kind: result.outcome.kind, mode: verified.mode });
}
