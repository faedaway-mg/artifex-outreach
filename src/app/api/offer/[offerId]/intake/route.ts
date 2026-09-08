import { NextRequest, NextResponse } from "next/server";
import * as store from "@/lib/quick-fix/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Customer marks the blocking requirements satisfied → the fulfillment job advances
// to READY_FOR_FULFILLMENT and the delivery clock starts (never at purchase). Access
// is granted via native invites elsewhere; this endpoint stores NO credentials.
export async function POST(req: NextRequest, { params }: { params: { offerId: string } }) {
  const offer = await store.resolveOffer(params.offerId);
  if (!offer) return NextResponse.json({ ok: false, error: "offer not found" }, { status: 404 });

  const job = await store.getJob(offer.offerId);
  if (!job) return NextResponse.json({ ok: false, error: "no paid job for this offer yet" }, { status: 409 });

  await store.recordFunnelEvent("quickfix.intake_started", { offerId: offer.offerId });
  const updated = await store.completeIntake(offer.offerId, new Date().toISOString());
  if (!updated) return NextResponse.json({ ok: false, error: "could not update job" }, { status: 500 });
  await store.recordFunnelEvent("quickfix.intake_completed", { offerId: offer.offerId, meta: { state: updated.state } });
  return NextResponse.json({ ok: true, state: updated.state, targetDeliveryAt: updated.targetDeliveryAt, clockStarted: !!updated.fulfillmentClockStartedAt });
}
