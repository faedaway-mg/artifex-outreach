import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import * as store from "@/lib/quick-fix/store";
import { outreachLifecycleView } from "@/lib/quick-fix/outreach-lifecycle-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// OPERATOR ONLY. Schedule (or reschedule) an approved outreach artifact for an
// explicit date/time + timezone → SCHEDULED. Passing scheduledAt:null CANCELS the
// schedule and returns to APPROVED_NOT_SENT. Scheduling NEVER dispatches — the send
// still happens only via the explicitly-gated send path.
export async function POST(req: NextRequest) {
  if (!isAuthenticated()) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { offerId?: string; scheduledAt?: string | null; tz?: string | null };
  if (!body.offerId) return NextResponse.json({ ok: false, error: "offerId required" }, { status: 400 });

  // Validate a concrete schedule request (unless this is an explicit cancel).
  const isCancel = body.scheduledAt === null;
  if (!isCancel) {
    if (typeof body.scheduledAt !== "string" || !body.scheduledAt) {
      return NextResponse.json({ ok: false, error: "scheduledAt (ISO datetime) or null to cancel required" }, { status: 400 });
    }
    const when = Date.parse(body.scheduledAt);
    if (Number.isNaN(when)) return NextResponse.json({ ok: false, error: "scheduledAt is not a valid datetime" }, { status: 400 });
    if (typeof body.tz !== "string" || !body.tz) {
      return NextResponse.json({ ok: false, error: "tz required when scheduling" }, { status: 400 });
    }
  }

  const now = new Date().toISOString();
  const res = await store.scheduleOutreach(body.offerId, {
    scheduledAt: isCancel ? null : (body.scheduledAt as string),
    tz: isCancel ? null : (body.tz as string),
    actor: "operator",
    now,
  });
  if (!res.ok) {
    if (res.reason === "not_found") return NextResponse.json({ ok: false, error: "offer not found" }, { status: 404 });
    if (res.reason === "not_approved") return NextResponse.json({ ok: false, error: "approve the outreach before scheduling" }, { status: 409 });
    return NextResponse.json({ ok: false, error: res.reason ?? "could not schedule" }, { status: 400 });
  }
  const view = await outreachLifecycleView(body.offerId);
  return NextResponse.json({ ok: true, offerId: body.offerId, canceled: isCancel, view });
}
