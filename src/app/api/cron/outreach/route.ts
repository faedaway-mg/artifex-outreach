import { NextRequest, NextResponse } from "next/server";
import { appendAudit } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Scheduled-outreach RUNNER — reads the PERSISTED scheduled batch and dispatches each due item at its
// staggered time through the ONE canonical compliant transport (sendCompliantOutreach → Graph MIME
// only: CAN-SPAM footer + hardened one-click unsubscribe + permanent-suppression rechecks). It is
// DORMANT by construction — nothing can reach a prospect until every gate is explicitly opened:
//   ENTRY     — requires QR_AUTOSEND_ENABLED=1 (off by default) → otherwise it only REPORTS the due count.
//   PAUSE     — the DB/env pause halts the tick before any per-lead work.
//   TRANSPORT — with Microsoft Graph unconfigured (no GRAPH_* env), there is no delivering transport,
//               so every due item is delivery-blocked (the slot is never consumed).
//   RECIPIENT — even once Graph IS configured, the transport's allowlist refuses every address except
//               COMMS_TEST_RECIPIENT until the owner sets COMMS_PROSPECT_DELIVERY_ENABLED=1.
// The runner re-authorizes + re-verifies (fingerprint, suppression, window, quota) at the final
// boundary; the transport fails closed (no postal/secret → no message). No Resend path exists here.
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { dueScheduled } = await import("@/lib/outreach/scheduled-batch");
  const { resolveSendingWindow } = await import("@/lib/outreach/sending-window");
  const { getSettings } = await import("@/lib/repo");
  const now = new Date();
  const activeWindow = resolveSendingWindow(await getSettings());

  // DRY-RUN — authenticated, structurally incapable of sending. Runs the exact production selection +
  // every dispatch-time check and returns what WOULD happen. Never imports the transport, never
  // reserves/consumes a slot, never writes a receipt, never mutates a scheduled step. Safe even with
  // all live flags on. Requested via ?dryRun=1 (or ?dry_run=1). Short-circuits before any send path.
  const wantsDryRun = req.nextUrl.searchParams.get("dryRun") === "1" || req.nextUrl.searchParams.get("dry_run") === "1";
  if (wantsDryRun) {
    const { evaluateScheduledDryRun } = await import("@/lib/outreach/scheduler-dryrun");
    const result = await evaluateScheduledDryRun(now, activeWindow);
    return NextResponse.json({ ok: true, dispatched: false, ...result });
  }

  const due = await dueScheduled(now);

  // FREEZE gate (Quick-Cash Consolidation): the legacy cold-outreach path is frozen by default.
  // Report the real due count but dispatch nothing. Scheduled bindings are preserved (inert).
  const { legacyColdOutreachFrozen, LEGACY_FROZEN_REASON } = await import("@/lib/outreach/legacy-freeze");
  if (legacyColdOutreachFrozen()) {
    return NextResponse.json({ ok: true, dispatched: false, due: due.length, sent: 0, frozen: true, reason: LEGACY_FROZEN_REASON });
  }

  // ENTRY gate: with automated sending off, report the real due count but dispatch nothing.
  if (process.env.QR_AUTOSEND_ENABLED !== "1") {
    return NextResponse.json({ ok: true, dispatched: false, due: due.length, sent: 0, reason: "Scheduled outreach is DISABLED (QR_AUTOSEND_ENABLED != \"1\"). Persisted batch read; nothing dispatched." });
  }

  const { outreachPausedNow } = await import("@/lib/outreach/outreach-pause");
  if (await outreachPausedNow()) {
    return NextResponse.json({ ok: true, dispatched: false, due: due.length, sent: 0, reason: "paused" });
  }

  // TRANSPORT gate: with Resend unconfigured there is no delivering transport. Re-verify + reserve to
  // prove the pipeline, then release every slot (nothing reaches a provider).
  if (!process.env.RESEND_API_KEY) {
    const { validateScheduled } = await import("@/lib/outreach/scheduled-batch");
    const { reserveDailySlot, releaseSlot } = await import("@/lib/comms/send-quota");
    const { DAILY_CAP } = await import("@/lib/outreach/outreach-scheduler");
    const counts = { due: due.length, sent: 0, held: 0, blocked: 0 };
    for (const { leadId, binding } of due) {
      const v = await validateScheduled(leadId, binding);
      if (!v.ok) { counts.held += 1; continue; }
      const slot = await reserveDailySlot({ now, cap: DAILY_CAP, leadId });
      if (!slot.granted) { counts.held += 1; continue; }
      if (slot.reservationId) await releaseSlot(slot.reservationId);
      counts.blocked += 1;
    }
    await appendAudit({ action: "outreach.runner.delivery-blocked", actor: "cron", targetType: "comms", targetId: null, meta: counts, ip: null });
    return NextResponse.json({ ok: true, dispatched: false, ...counts, reason: "No delivering transport configured (RESEND_API_KEY missing). Due items are delivery-blocked; nothing was sent." });
  }

  // Transport configured → run the canonical compliant transport. The runner enforces window/quota/pause
  // + re-authorization; the transport enforces compliance (footer + signed unsubscribe + suppression) and
  // the recipient gate (prospects still refused unless COMMS_PROSPECT_DELIVERY_ENABLED=1). Resend only.
  const { runScheduledOutreach } = await import("@/lib/outreach/outreach-scheduler");
  const { sendCompliantOutreach } = await import("@/lib/comms/outreach-transport");
  const { currentAllocation } = await import("@/lib/outreach/allocation-state");
  const campaignId = due[0]?.binding.batchId ?? "scheduled-outreach";
  // First-touch allocation (mandate 1): bound this tick to the reserved-plus-borrowed first-touch slice so
  // the morning batch leaves the follow-up reserve intact for the later in-window ticks.
  const alloc = await currentAllocation(now);
  const summary = await runScheduledOutreach(due.map((d) => d.leadId), {
    now, campaignId, window: activeWindow, maxThisTick: alloc.firstSendNow, // owner-configured LA window (default 05:00–07:00)
    send: ({ leadId, auth }) => sendCompliantOutreach({ leadId, auth }),
  });
  await appendAudit({ action: "outreach.runner.dispatched", actor: "cron", targetType: "comms", targetId: null, meta: { laDay: summary.laDay, sent: summary.sent, quotaRemaining: summary.quotaRemaining, firstAllocated: alloc.firstSendNow }, ip: null });
  return NextResponse.json({ ok: true, dispatched: true, due: due.length, sent: summary.sent, quotaRemaining: summary.quotaRemaining, allocation: { firstTarget: alloc.firstTarget, firstSendNow: alloc.firstSendNow, followTarget: alloc.followTarget }, outcomes: summary.outcomes });
}
