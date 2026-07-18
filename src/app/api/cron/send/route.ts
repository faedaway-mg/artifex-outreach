import { NextRequest, NextResponse } from "next/server";
import { runDueSends } from "@/lib/comms/scheduler";
import { getEmailProvider } from "@/lib/comms/provider";
import { appendAudit } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Triggered by the Railway cron on a short interval (e.g. every 5-15 min). Guarded
// by CRON_SECRET. Executes all due, approved communication steps through the
// idempotent dispatcher. Safe to call repeatedly — sends never duplicate. `force=1`
// bypasses the business-hours window (for manual/testing runs).
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
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
