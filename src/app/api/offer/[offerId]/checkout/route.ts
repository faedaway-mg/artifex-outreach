import { NextRequest, NextResponse } from "next/server";
import * as store from "@/lib/quick-fix/store";
import { validateOfferForPurchase, legalGateBlocked } from "@/lib/quick-fix/purchase-safety";
import { termsAcceptanceMatchesOffer } from "@/lib/quick-fix/terms";
import { reconcileOfferCheckout, liveStripeCheckoutClient } from "@/lib/quick-fix/stripe-commerce";
import { buildFixScanCheckoutParams, buildRepairAfterScanCheckout, fixScanOfferId } from "@/lib/quick-fix/fix-scan-commerce";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function baseUrlOf(req: NextRequest): string {
  return process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || req.nextUrl.origin;
}

// CUSTOMER CHECKOUT — the ONLY commerce data trusted is the frozen, approved offer
// resolved server-side. Price, SKU, scope, and description are NEVER read from the
// browser. Every repair passes the central purchase-safety validator. A success
// redirect never marks a job paid — only the verified webhook does.
export async function POST(req: NextRequest, { params }: { params: { offerId: string } }) {
  const offer = await store.resolveOffer(params.offerId);
  if (!offer) return NextResponse.json({ ok: false, error: "offer not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { intent?: string; withMaintenance?: boolean; creditScanOfferId?: string; email?: string };
  const intent = body.intent === "fix_scan" ? "fix_scan" : "repair";
  const stripeConfigured = !!process.env.STRIPE_SECRET_KEY;
  const baseUrl = baseUrlOf(req);

  // Production live-purchase eligibility stays blocked until legal review completes.
  const legal = legalGateBlocked();
  if (legal) return NextResponse.json({ ok: false, error: legal, legalReviewRequired: true }, { status: 409 });

  if (!stripeConfigured) {
    return NextResponse.json({ ok: false, error: "Stripe is not configured in this environment — checkout is unavailable.", stripeConfigured: false }, { status: 409 });
  }
  const client = liveStripeCheckoutClient();
  await store.recordFunnelEvent("quickfix.checkout_clicked", { offerId: offer.offerId, meta: { intent } });

  // ── Fix Scan ($99 diagnostic) — routed when a direct repair isn't safely scoped. ──
  if (intent === "fix_scan") {
    const p = buildFixScanCheckoutParams({ leadId: offer.leadId, companyName: offer.companyName, baseUrl, customerEmail: body.email });
    const res = await client.create(p);
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 502 });
    await store.recordFunnelEvent("quickfix.fix_scan_checkout_started", { offerId: fixScanOfferId(offer.leadId) });
    return NextResponse.json({ ok: true, url: res.url, mode: "fix_scan" });
  }

  // ── Repair — full purchase-safety gate + terms acceptance required. ──
  const acc = await store.getTermsAcceptance(offer.offerId);
  if (!termsAcceptanceMatchesOffer(acc, offer)) {
    return NextResponse.json({ ok: false, error: "service terms have not been accepted for the current offer version" }, { status: 400 });
  }
  const safety = validateOfferForPurchase({
    offer,
    approved: offer.approvalStatus === "approved",
    stripeConfigured,
    superseded: offer.state === "SUPERSEDED",
    leadBlocked: false,
  });
  if (!safety.ok) return NextResponse.json({ ok: false, error: "offer failed purchase safety", reasons: safety.reasons }, { status: 400 });

  await store.recordFunnelEvent("quickfix.checkout_started", { offerId: offer.offerId });
  const now = new Date().toISOString();

  // Repair-after-scan: apply the single-use $99 credit as a controlled inline discount.
  if (body.creditScanOfferId) {
    const credit = await store.getCredit(body.creditScanOfferId);
    const { params: p, application } = buildRepairAfterScanCheckout({ offer, credit, scanOfferId: body.creditScanOfferId, baseUrl, customerEmail: body.email, nowMs: Date.now() });
    const res = await client.create(p);
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 502 });
    await store.commerceStore.put({ key: p.idempotencyKey, offerId: offer.offerId, leadId: offer.leadId, offerVersion: offer.offerVersion, kind: "one_time", priceCents: application.finalPriceCents, sessionId: res.id, url: res.url, superseded: false, createdAt: now });
    return NextResponse.json({ ok: true, url: res.url, creditAppliedCents: application.creditAppliedCents, applies: application.applies });
  }

  const kind = body.withMaintenance && offer.maintenance ? "with_maintenance" : "one_time";
  const rec = await reconcileOfferCheckout({ offer, kind, client, store: store.commerceStore, baseUrl, customerEmail: body.email, now });
  if (!rec.ok) return NextResponse.json({ ok: false, error: rec.error }, { status: 502 });
  return NextResponse.json({ ok: true, url: rec.record?.url ?? null, reused: rec.reused });
}
