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

  if (process.env.COMMS_AUTOSEND_ENABLED !== "1") {
    return NextResponse.json({
      ok: true,
      dispatched: false,
      sent: 0,
      reason: "Unattended sending is disabled by policy (COMMS_AUTOSEND_ENABLED is not \"1\"). Due work is made visible by /api/cron/materialize and sent by the operator.",
    });
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  try {
    const provider = getEmailProvider();
    const summary = await runDueSends({ force });

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
      provider: provider.name,
      canSend: provider.canSend,
      windowOpen: summary.windowOpen,
      considered: summary.considered,
      sent: summary.sent,
      deduped: summary.deduped,
      retried: summary.retried,
      failed: summary.failed,
      skipped: summary.skipped,
      failures: summary.failures,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "send run failed" }, { status: 500 });
  }
}
