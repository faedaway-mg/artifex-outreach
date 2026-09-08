import { NextRequest, NextResponse } from "next/server";
import { paymentStatusView } from "@/lib/quick-fix/page-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Confirmed payment state for the success page to poll. The page NEVER decides
// payment from a redirect — it reads the internal state set only by the verified
// webhook. Returns PAYMENT_CONFIRMING while the webhook may still be in flight.
export async function GET(_req: NextRequest, { params }: { params: { offerId: string } }) {
  const view = await paymentStatusView(params.offerId);
  if (!view) return NextResponse.json({ ok: false, error: "offer not found" }, { status: 404 });
  return NextResponse.json({ ok: true, ...view });
}
