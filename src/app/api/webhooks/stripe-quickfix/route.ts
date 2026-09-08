import { NextRequest, NextResponse } from "next/server";
import {
  verifyStripeSignature,
  handleVerifiedEvent,
  type WebhookOutcome,
} from "@/lib/quick-fix/webhook";
import * as store from "@/lib/quick-fix/store";
import { initialJobStateAfterPayment, needsIntake } from "@/lib/quick-fix/fulfillment";
import { onVerifiedPurchase } from "@/lib/quick-fix/lifecycle";

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
  const deps = await store.webhookDeps({
    async applyPaid(o: Extract<WebhookOutcome, { kind: "payment_succeeded" }>) {
      const offer = await store.getOffer(o.offerId);
      if (!offer) return; // unknown offer → ignore safely
      const intake = needsIntake(offer);
      await store.upsertJob({
        offerId: o.offerId,
        leadId: o.leadId || offer.leadId,
        state: initialJobStateAfterPayment(intake),
        purchasedAt: nowIso,
        requirementsReceivedAt: null,
        fulfillmentClockStartedAt: null,
        targetDeliveryAt: null,
        subscriptionId: o.subscriptionId,
        updatedAt: nowIso,
      });
      const existing = await store.getCustomer(offer.leadId);
      const { record } = onVerifiedPurchase(existing, {
        leadId: offer.leadId, email: offer.recipientEmail ?? "", offerId: o.offerId,
        amountCents: offer.priceCents, at: nowIso, maintenancePlanKey: offer.maintenance?.planKey ?? null,
      });
      await store.upsertCustomer(record);
    },
    async applySubscription(o: Extract<WebhookOutcome, { kind: "subscription_changed" }>) {
      const job = await store.getJob(o.offerId);
      if (job) await store.upsertJob({ ...job, subscriptionId: o.subscriptionId });
    },
  });

  const result = await handleVerifiedEvent(event, deps);
  return NextResponse.json({ ok: result.ok, duplicate: result.duplicate, kind: result.outcome.kind });
}
