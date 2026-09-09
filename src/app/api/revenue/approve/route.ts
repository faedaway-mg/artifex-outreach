import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import * as store from "@/lib/quick-fix/store";
import { outreachLifecycleView } from "@/lib/quick-fix/outreach-lifecycle-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// OPERATOR ONLY. Approve the outreach artifact: requires a selected subject, FREEZES
// that subject, and moves the artifact to APPROVED_NOT_SENT. This is a sign-off ONLY —
// it NEVER sends and NEVER schedules. Sending is a separate, explicitly-gated call.
export async function POST(req: NextRequest) {
  if (!isAuthenticated()) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { offerId?: string };
  if (!body.offerId) return NextResponse.json({ ok: false, error: "offerId required" }, { status: 400 });

  const now = new Date().toISOString();
  const res = await store.approveOutreach(body.offerId, { actor: "operator", now });
  if (!res.ok) {
    if (res.reason === "not_found") return NextResponse.json({ ok: false, error: "offer not found" }, { status: 404 });
    if (res.reason === "no_subject") return NextResponse.json({ ok: false, error: "select a subject before approving" }, { status: 422 });
    return NextResponse.json({ ok: false, error: res.reason ?? "could not approve" }, { status: 400 });
  }
  const view = await outreachLifecycleView(body.offerId);
  return NextResponse.json({ ok: true, offerId: body.offerId, view });
}
