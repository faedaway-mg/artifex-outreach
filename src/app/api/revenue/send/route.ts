import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import * as store from "@/lib/quick-fix/store";
import { legacyColdOutreachFrozen, LEGACY_FROZEN_REASON } from "@/lib/outreach/legacy-freeze";
import { outreachPausedNow } from "@/lib/outreach/outreach-pause";
import { outreachLifecycleView } from "@/lib/quick-fix/outreach-lifecycle-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// OPERATOR ONLY. Transition an APPROVED (or SCHEDULED) outreach artifact to SENT —
// and ONLY on this explicit call. Sending is NEVER a side effect of approve.
//
// CRITICAL SAFETY: outbound cold email is gated under this mandate. We respect the
// legacy-freeze (frozen by default) AND the runtime pause. When outbound is gated we
// return { sent:false, reason:"outbound gated" } WITHOUT dispatching and WITHOUT
// advancing the lifecycle. No email is ever dispatched from here in the current
// posture; the actual provider dispatch remains behind the existing compliant
// transport and is intentionally NOT wired in as a side effect of this route.
export async function POST(req: NextRequest) {
  if (!isAuthenticated()) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { offerId?: string };
  if (!body.offerId) return NextResponse.json({ ok: false, error: "offerId required" }, { status: 400 });

  const offer = await store.getOffer(body.offerId);
  if (!offer) return NextResponse.json({ ok: false, error: "offer not found" }, { status: 404 });

  // Lifecycle gate: only an approved (or scheduled) artifact is sendable.
  const state = store.effectiveOutreachState(offer);
  if (state !== "APPROVED_NOT_SENT" && state !== "SCHEDULED") {
    return NextResponse.json({ ok: false, sent: false, reason: "not sendable", detail: `outreach state is ${state}; approve first` }, { status: 409 });
  }

  // ── OUTBOUND SAFETY GATE ──────────────────────────────────────────────────────
  // Any active gate blocks the dispatch. We do NOT mark SENT and we do NOT dispatch.
  const paused = await outreachPausedNow();
  const frozen = legacyColdOutreachFrozen();
  if (frozen || paused) {
    return NextResponse.json({
      ok: true,
      sent: false,
      reason: "outbound gated",
      detail: frozen ? LEGACY_FROZEN_REASON : "automated outreach is paused",
    });
  }

  // Only reached if an operator has EXPLICITLY re-enabled the legacy path and not
  // paused — then this records the send in the lifecycle. Even here we do not dispatch
  // as a side effect of this route; the compliant transport remains the only sender.
  const now = new Date().toISOString();
  const res = await store.markOutreachSent(body.offerId, {
    actor: "operator",
    now,
    mailbox: offer.recipientEmail ? "primary" : null,
    recipient: offer.recipientEmail ?? null,
  });
  if (!res.ok) return NextResponse.json({ ok: false, sent: false, reason: res.reason ?? "could not mark sent" }, { status: 409 });

  const view = await outreachLifecycleView(body.offerId);
  return NextResponse.json({ ok: true, sent: true, offerId: body.offerId, view });
}
