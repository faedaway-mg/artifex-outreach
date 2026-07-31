import { NextRequest, NextResponse } from "next/server";
import { materializeDueSteps } from "@/lib/comms/task-projection";
import { appendAudit } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Queue materialization — makes due sequence work VISIBLE. Sends nothing.
//
// This is deliberately a separate route from /api/cron/send. That route
// dispatches real email; this one only projects due acquisition steps into
// operator-visible Tasks. Keeping them separate means the schedule that keeps
// Today honest can run safely without ever authorizing unattended delivery.
//
// Guarded by CRON_SECRET. Safe to call repeatedly and concurrently — the unique
// index on tasks.source_step_id makes duplicate creation impossible.
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";
  // Match the Today queue's own window so a single morning tick covers the whole
  // day. Pass ?horizon=now to restrict this to steps already past their instant.
  const horizon = req.nextUrl.searchParams.get("horizon") === "now" ? "now" : "end-of-day";
  try {
    const summary = await materializeDueSteps({ apply: !dryRun, horizon });

    // Audit only when something actually changed, so idle ticks don't flood the log.
    if (summary.created || summary.reconciledStale) {
      await appendAudit({
        action: "comms.tasks_materialized",
        actor: "cron",
        targetType: "comms",
        targetId: null,
        meta: {
          dryRun, considered: summary.considered, created: summary.created,
          alreadyPresent: summary.alreadyPresent, reconciledStale: summary.reconciledStale,
          skipped: summary.skipped,
        },
        ip: null,
      });
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      horizon,
      sent: 0, // this route never sends — stated explicitly so monitoring can assert it
      ranAt: summary.ranAt,
      considered: summary.considered,
      created: summary.created,
      alreadyPresent: summary.alreadyPresent,
      reconciledStale: summary.reconciledStale,
      skipped: summary.skipped,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "materialize failed" }, { status: 500 });
  }
}
