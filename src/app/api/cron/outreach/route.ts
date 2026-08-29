import { NextRequest, NextResponse } from "next/server";
import { appendAudit } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Scheduled-outreach RUNNER — reads the PERSISTED scheduled batch and would dispatch each due item at
// its staggered time, but is DELIVERY-DISABLED by construction:
//   ENTRY  — requires QR_AUTOSEND_ENABLED=1 (off by default) → otherwise it only REPORTS the due count.
//   FINAL  — no business-approved delivering transport is configured, so every due item resolves to
//            "delivery-blocked" (the slot is never consumed, nothing reaches a provider).
// Activating real delivery requires a separate, explicitly-authorized transport decision.
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { dueScheduled } = await import("@/lib/outreach/scheduled-batch");
  const now = new Date();
  const due = await dueScheduled(now);

  // ENTRY gate: with automated sending off, report the real due count but dispatch nothing.
  if (process.env.QR_AUTOSEND_ENABLED !== "1") {
    return NextResponse.json({ ok: true, dispatched: false, due: due.length, sent: 0, reason: "Scheduled outreach is DISABLED (QR_AUTOSEND_ENABLED != \"1\"). Persisted batch read; nothing dispatched." });
  }

  const { outreachPausedNow } = await import("@/lib/outreach/outreach-pause");
  if (await outreachPausedNow()) {
    return NextResponse.json({ ok: true, dispatched: false, due: due.length, sent: 0, reason: "paused" });
  }

  // Flag on + not paused: re-verify + reserve, but the transport is non-delivering (no approved
  // transport). Every due item → delivery-blocked; the reserved slot is released (nothing shipped).
  const { validateScheduled } = await import("@/lib/outreach/scheduled-batch");
  const { reserveDailySlot, releaseSlot } = await import("@/lib/comms/send-quota");
  const { DAILY_CAP } = await import("@/lib/outreach/outreach-scheduler");
  const counts = { due: due.length, sent: 0, held: 0, blocked: 0 };
  for (const { leadId, binding } of due) {
    const v = await validateScheduled(leadId, binding);
    if (!v.ok) { counts.held += 1; continue; }
    const slot = await reserveDailySlot({ now, cap: DAILY_CAP, leadId });
    if (!slot.granted) { counts.held += 1; continue; }
    // FINAL boundary: no delivering transport → refuse, release the slot. Never a provider path.
    if (slot.reservationId) await releaseSlot(slot.reservationId);
    counts.blocked += 1;
  }
  await appendAudit({ action: "outreach.runner.delivery-blocked", actor: "cron", targetType: "comms", targetId: null, meta: counts, ip: null });
  return NextResponse.json({ ok: true, dispatched: false, ...counts, reason: "No business-approved delivering transport configured. Due items are delivery-blocked; nothing was sent." });
}
