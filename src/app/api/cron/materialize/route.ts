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

    // Deepen the EMAIL reservoir ahead of consumption: run the existing website analysis on a
    // few qualified leads that have a site but no email yet, so they harvest a same-domain
    // address and become email-first. Bounded per tick (cost-safe); read-only crawl, never
    // contact; no send. Then reconcile again so newly-email leads get their review task.
    // Gated OFF by default — a background bulk crawl is a decision, not a deploy side effect.
    let prep: unknown = null;
    if (!dryRun && process.env.EMAIL_PREP_ENABLED === "1") {
      const { prepareEmailInventory } = await import("@/lib/outreach/inventory-prep");
      const { runWebsiteAnalysisAction } = await import("@/lib/actions");
      const { listLeads, allBusinessIntelligence, getLead } = await import("@/lib/repo");
      const [leads, bi] = await Promise.all([listLeads(), allBusinessIntelligence()]);
      prep = await prepareEmailInventory({
        leads,
        analyzedLeadIds: new Set(bi.map((b) => b.leadId)),
        analyze: (id) => runWebsiteAnalysisAction(id),
        getEmailAfter: async (id) => (await getLead(id))?.publicEmail ?? null,
        max: Number(process.env.EMAIL_PREP_PER_TICK ?? 8),
      });
      await materializeRouting(); // surface review tasks for any newly email-first leads
    }

    const summary = await materializeDueSteps({ apply: !dryRun, horizon });

    // ── Inventory diagnostic (read-only) ──────────────────────────────────────
    // Answers "why is the email reservoir only N?" from live data, without a second analytics
    // system: a queue-state breakdown (who owns each off-board business) + the email-prep
    // eligibility count + prepared-vs-send-capacity. Computed on dryRun (safe, no writes) so an
    // operator can curl this and SEE where inventory is constrained instead of guessing.
    let inventory: unknown = null;
    if (dryRun) {
      const { listLeads, allTasks, allBusinessIntelligence, getSettings } = await import("@/lib/repo");
      const { auditQueue } = await import("@/lib/outreach/inventory-prep");
      const { emailInventory } = await import("@/lib/work-queue");
      const { isValidEmail } = await import("@/lib/outreach/contact-strategy");
      const [dLeads, dTasks, dBi, dSettings] = await Promise.all([listLeads(), allTasks(), allBusinessIntelligence(), getSettings()]);
      const analyzedLeadIds = new Set(dBi.map((b) => b.leadId));
      const openTasks = dTasks.filter((t) => t.status === "open");
      const audit = auditQueue({ leads: dLeads, tasks: openTasks, analyzedLeadIds });
      const inv = emailInventory({ leads: dLeads, tasks: openTasks, emailsSentToday: 0, sendTarget: dSettings.prospecting.emailDailyTarget ?? 10 });
      const TERMINAL = new Set(["Won", "Lost", "Disqualified"]);
      const prepEligible = dLeads.filter(
        (l) => !TERMINAL.has(l.pipelineStage) && l.acquisitionStrategy !== "Do Not Contact" &&
               !!l.website && !isValidEmail(l.publicEmail) && !analyzedLeadIds.has(l.id),
      ).length;
      inventory = {
        totals: { leads: dLeads.length, openTasks: openTasks.length, analyzed: analyzedLeadIds.size },
        email: { prepared: inv.prepared, sendCapacity: inv.sendCapacity, readyToday: inv.readyToday, beyondToday: inv.beyondToday },
        emailPrepEligible: prepEligible, // leads with a site + no email, not yet analyzed → prep can harvest an email
        queueByReason: audit.byReason,
        queueByOwner: audit.byOwner, // software-research / defect self-heal; human = genuine exceptions
      };
    }

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
      emailPrep: prep, // bounded email-inventory preparation (null unless EMAIL_PREP_ENABLED=1)
      inventory, // read-only reservoir + queue-state diagnostic (dryRun only) — why is readyToday what it is

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
