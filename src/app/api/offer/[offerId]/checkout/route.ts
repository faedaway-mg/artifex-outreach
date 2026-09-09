import { NextRequest, NextResponse } from "next/server";
import * as store from "@/lib/quick-fix/store";
import { validateOfferForPurchase, legalGateBlocked } from "@/lib/quick-fix/purchase-safety";
import { termsAcceptanceMatchesOffer } from "@/lib/quick-fix/terms";
import { reconcileOfferCheckout, liveStripeCheckoutClient } from "@/lib/quick-fix/stripe-commerce";
import { buildFixScanCheckoutParams, buildRepairAfterScanCheckout, fixScanOfferId } from "@/lib/quick-fix/fix-scan-commerce";
import { quickFixStripeMode, resolveQuickFixStripeKey } from "@/lib/quick-fix/stripe-mode";

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
  const baseUrl = baseUrlOf(req);

  // Explicit Stripe mode (test/live). The key that creates the session and the
  // webhook that receives its events must be the SAME mode.
  const mode = quickFixStripeMode();
  const keyRes = resolveQuickFixStripeKey(process.env, mode);

  // The legal gate governs LIVE real-customer checkout only. A clearly-isolated
  // SANDBOX/test-mode rehearsal is permitted (no live charge) without weakening the
  // production gate — LIVE checkout stays blocked until QUICKFIX_LEGAL_APPROVED=true.
  const legal = mode === "live" ? legalGateBlocked() : null;
  if (legal) return NextResponse.json({ ok: false, error: legal, legalReviewRequired: true, mode }, { status: 409 });

  if (!keyRes.ok) {
    return NextResponse.json({ ok: false, error: `Quick-Fix Stripe (${mode}) is not configured — checkout is unavailable.`, stripeConfigured: false, mode }, { status: 409 });
  }
  const client = liveStripeCheckoutClient(keyRes.key);
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
    stripeConfigured: keyRes.ok,
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
