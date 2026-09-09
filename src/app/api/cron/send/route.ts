import { NextRequest, NextResponse } from "next/server";
import { runDueSends } from "@/lib/comms/scheduler";
import { getEmailProvider } from "@/lib/comms/provider";
import { appendAudit } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// UNATTENDED DELIVERY. This route dispatches real email with no operator in the
// loop. Guarded by CRON_SECRET. Safe to call repeatedly — the ledger makes sends
// idempotent — but "cannot duplicate" is not the same as "authorized to send".
//
// It is therefore behind a SECOND, explicit policy gate: COMMS_AUTOSEND_ENABLED.
// Making follow-up work visible does not require this route, and turning the
// queue on must never silently turn autonomous sending on with it. To make due
// work visible without sending, use /api/cron/materialize.
//
// `force=1` bypasses the business-hours window (for manual/testing runs); it does
// NOT bypass the policy gate.
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // DRY-RUN — authenticated, structurally cannot send. Proves the automatic follow-up runner's exact
  // selection (window → due steps → gates → cap) with ZERO sends. Safe even with prospect delivery live.
  const wantsDryRun = req.nextUrl.searchParams.get("dryRun") === "1" || req.nextUrl.searchParams.get("dry_run") === "1";
  if (wantsDryRun) {
    const { previewDueSends } = await import("@/lib/comms/scheduler");
    const { currentAllocation } = await import("@/lib/outreach/allocation-state");
    const force = req.nextUrl.searchParams.get("force") === "1";
    const [preview, allocation] = await Promise.all([previewDueSends({ force }), currentAllocation(new Date())]);
    return NextResponse.json({ ok: true, dispatched: false, dryRun: true, allocation, ...preview });
  }

  // FREEZE gate (Quick-Cash Consolidation): the legacy cold follow-up path is frozen by default.
  const { legacyColdOutreachFrozen, LEGACY_FROZEN_REASON } = await import("@/lib/outreach/legacy-freeze");
  if (legacyColdOutreachFrozen()) {
    return NextResponse.json({ ok: true, dispatched: false, sent: 0, frozen: true, reason: LEGACY_FROZEN_REASON });
  }

  if (process.env.COMMS_AUTOSEND_ENABLED !== "1") {
    return NextResponse.json({
      ok: true,
      dispatched: false,
      sent: 0,
      reason: "Unattended sending is disabled by policy (COMMS_AUTOSEND_ENABLED is not \"1\"). Set it to \"1\" to arm the automatic follow-up runner (prospect delivery already gated separately).",
    });
  }

  // Runtime pause applies to the legacy path too, so it can never bypass the shared pause control.
  const { outreachPausedNow } = await import("@/lib/outreach/outreach-pause");
  if (await outreachPausedNow()) {
    return NextResponse.json({ ok: true, dispatched: false, sent: 0, reason: "paused" });
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  try {
    const provider = getEmailProvider();
    // Follow-up allocation (mandate 1): bound this tick to the reserved-plus-borrowed follow-up slice so a
    // morning first-touch batch can never consume the whole 20-cap and starve follow-ups.
    const { currentAllocation } = await import("@/lib/outreach/allocation-state");
    const alloc = await currentAllocation(new Date());
    const summary = await runDueSends({ force, maxSends: alloc.followSendNow });

    // Audit only when work happened, so idle ticks don't flood the log.
    if (summary.sent || summary.failed || summary.retried) {
      await appendAudit({
        action: "comms.scheduler_run",
        actor: "cron",
        targetType: "comms",
        targetId: null,
        meta: { provider: provider.name, windowOpen: summary.windowOpen, considered: summary.considered, sent: summary.sent, retried: summary.retried, failed: summary.failed, deduped: summary.deduped },
        ip: null,
      });
    }

    return NextResponse.json({
      ok: true,
      dispatched: summary.sent > 0,
      provider: provider.name,
      canSend: provider.canSend,
      windowOpen: summary.windowOpen,
      allocation: { followTarget: alloc.followTarget, followSendNow: alloc.followSendNow, firstTarget: alloc.firstTarget, sentFollowToday: alloc.sentFollowToday, sentFirstToday: alloc.sentFirstToday },
      considered: summary.considered,
      sent: summary.sent,
      deduped: summary.deduped,
      retried: summary.retried,
      failed: summary.failed,
      capped: summary.capped,
      skipped: summary.skipped,
      failures: summary.failures,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "send run failed" }, { status: 500 });
  }
}
