import { NextRequest, NextResponse } from "next/server";
import { materializeDueSteps } from "@/lib/comms/task-projection";
import { appendAudit } from "@/lib/repo";
import { runDistribution, ensureSeedOperators } from "@/lib/operators/distribute";

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
//
// PHASE 2 — ownership maintenance. Once the day's work is visible, the same tick
// makes sure every piece of it has an accountable operator: unassigned businesses
// get one, and work whose owner cannot move it right now (away, inactive, or
// silent past the staleness horizon) is handed to someone who can. This runs in
// "maintain" mode only — it never reshuffles a healthy pipeline and never moves a
// live conversation. A deliberate rebalance is operator-triggered, not nightly.
//
// Phase 2 is behind its own policy gate, OPERATOR_DISTRIBUTION_ENABLED, for the
// same reason unattended sending is: the first time a scheduler is allowed to
// move real ownership must be a decision, not a side effect of a deploy. While
// the gate is off the distribution still RUNS — it simply stops before the
// writes, so the response reports exactly what it would have done. Preview and
// apply are the same computation; only `apply` differs.
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
    // Route understood businesses out of the "Needs attention"/understand placeholder and
    // into Calls / Emails / Videos before projecting sequence steps. Idempotent and I/O-free
    // (local task transitions only) — this is what keeps Today an execution dashboard rather
    // than a pile of "review this" chores, and it migrates pre-existing placeholders.
    const { materializeRouting } = await import("@/lib/outreach/auto-route");
    const routing = dryRun ? null : await materializeRouting();

    const summary = await materializeDueSteps({ apply: !dryRun, horizon });

    // Phase 2 runs after projection so it sees today's real workload, not
    // yesterday's. Ordering matters: distributing first would balance against a
    // backlog that is about to change.
    const distributionEnabled = process.env.OPERATOR_DISTRIBUTION_ENABLED === "1";
    if (!dryRun) await ensureSeedOperators();
    const distribution = await runDistribution({
      mode: "maintain",
      apply: !dryRun && distributionEnabled,
      actor: "system",
    });

    // Audit only when something actually changed, so idle ticks don't flood the log.
    if (summary.created || summary.reconciledStale || distribution.written.length || (routing?.processed ?? 0)) {
      await appendAudit({
        action: "comms.tasks_materialized",
        actor: "cron",
        targetType: "comms",
        targetId: null,
        meta: {
          dryRun, considered: summary.considered, created: summary.created,
          alreadyPresent: summary.alreadyPresent, reconciledStale: summary.reconciledStale,
          skipped: summary.skipped,
          reassigned: distribution.written.length,
          routed: routing ? { processed: routing.processed, ...routing.routed, needsAttention: routing.needsAttention } : null,
        },
        ip: null,
      });
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      horizon,
      sent: 0, // this route never sends — stated explicitly so monitoring can assert it
      routed: routing, // understand-placeholder → execution-stream materialization (null on dryRun)
      ranAt: summary.ranAt,
      considered: summary.considered,
      created: summary.created,
      alreadyPresent: summary.alreadyPresent,
      reconciledStale: summary.reconciledStale,
      skipped: summary.skipped,
      distribution: {
        enabled: distributionEnabled,
        considered: distribution.consideredLeads,
        planned: distribution.reassignments.length,
        reassigned: distribution.written.length,
        held: distribution.held.length,
      },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "materialize failed" }, { status: 500 });
  }
}
