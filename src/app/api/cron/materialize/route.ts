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

    // Deepen the EMAIL reservoir ahead of consumption: run the existing website analysis on
    // qualified leads that have a site but no email yet, so they harvest a same-domain address and
    // become email-first. This is now RESERVOIR-AWARE and yield-sized: we examine only as many as
    // the review gap needs (given the observed email yield), throttling to ZERO once the reservoir
    // is healthy so we never bulk-crawl for no reason. Read-only crawl, never contact, no send.
    // Then reconcile so newly-email leads get their review task. Gated OFF by default.
    let prep: unknown = null;
    if (!dryRun && process.env.EMAIL_PREP_ENABLED === "1") {
      const { prepareEmailInventory } = await import("@/lib/outreach/inventory-prep");
      const { runWebsiteAnalysisAction } = await import("@/lib/actions");
      const { listLeads, allBusinessIntelligence, getLead, getSettings, listAudit, allTasks } = await import("@/lib/repo");
      const { emailInventory } = await import("@/lib/work-queue");
      const { isValidEmail } = await import("@/lib/outreach/contact-strategy");
      const { planPreparation, observedYield, DEFAULT_BANDS } = await import("@/lib/acquisition/reservoir");
      const [pLeads, pBi, pSettings, audit, pTasks] = await Promise.all([listLeads(), allBusinessIntelligence(), getSettings(), listAudit(200), allTasks()]);
      const analyzedIds = new Set(pBi.map((b) => b.leadId));
      const openForPrep = pTasks.filter((t) => t.status === "open");
      const preparedNow = emailInventory({ leads: pLeads, tasks: openForPrep, emailsSentToday: 0, sendTarget: pSettings.prospecting.emailDailyTarget ?? 10 }).prepared;
      const TERMINAL = new Set(["Won", "Lost", "Disqualified"]);
      const eligibleNow = pLeads.filter((l) => !TERMINAL.has(l.pipelineStage) && l.acquisitionStrategy !== "Do Not Contact" && !!l.website && !isValidEmail(l.publicEmail) && !analyzedIds.has(l.id)).length;
      // Observed yield from prior prep samples (conservative prior when thin), so we size honestly.
      const samples = audit.filter((a) => a.action === "email.prep.sample" && a.meta && typeof a.meta === "object")
        .map((a) => ({ examined: Number((a.meta as any).examined ?? 0), adoptedEmail: Number((a.meta as any).adoptedEmail ?? 0) }));
      const yieldRate = observedYield(samples);
      // Hard per-tick ceiling (env-tunable). Prep's marginal paid cost is the per-lead AI scoring
      // calls; the ceiling + reservoir throttling keep that bounded. Website crawl / harvest / BI /
      // Review render are all local/free. costCap == hardCap here (operator tunes the ceiling).
      // Default raised 24→32 so a single run can build DEPTH (a reserve) when eligible supply allows;
      // it stays supply-bounded and throttles to 0 once the reservoir is healthy.
      const hardCap = Math.max(0, Number(process.env.EMAIL_PREP_MAX ?? 32));
      const plan = planPreparation({ prepared: preparedNow, eligible: eligibleNow, yieldRate, hardCap, costCap: hardCap, bands: DEFAULT_BANDS });
      if (plan.examine > 0) {
        const summary = await prepareEmailInventory({
          leads: pLeads,
          analyzedLeadIds: analyzedIds,
          analyze: (id) => runWebsiteAnalysisAction(id),
          getEmailAfter: async (id) => (await getLead(id))?.publicEmail ?? null,
          max: plan.examine,
        });
        await materializeRouting(); // surface review tasks for any newly email-first leads
        await appendAudit({ action: "email.prep.sample", actor: "cron", targetType: "comms", targetId: null, meta: { examined: summary.analyzed, adoptedEmail: summary.adoptedEmail, eligible: summary.eligible, plan: plan.reason, band: plan.band, yieldRate: Math.round(yieldRate * 100) / 100 }, ip: null });
        prep = { ...summary, plan: plan.reason, band: plan.band, yieldRate: Math.round(yieldRate * 100) / 100, examined: summary.analyzed };
      } else {
        prep = { skipped: true, plan: plan.reason, band: plan.band, prepared: preparedNow, yieldRate: Math.round(yieldRate * 100) / 100 };
      }
    }

    const summary = await materializeDueSteps({ apply: !dryRun, horizon });

    // ── Inventory diagnostic (read-only) ──────────────────────────────────────
    // Answers "why is the email reservoir only N?" from live data, without a second analytics
    // system: a queue-state breakdown (who owns each off-board business) + the email-prep
    // eligibility count + prepared-vs-send-capacity. Computed on dryRun (safe, no writes) so an
    // operator can curl this and SEE where inventory is constrained instead of guessing.
    let inventory: unknown = null;
    if (dryRun) {
      const { listLeads, allTasks, allBusinessIntelligence, getSettings, allEmailSends, allInbound } = await import("@/lib/repo");
      const { auditQueue } = await import("@/lib/outreach/inventory-prep");
      const { emailInventory } = await import("@/lib/work-queue");
      const { isValidEmail } = await import("@/lib/outreach/contact-strategy");
      const [dLeads, dTasks, dBi, dSettings, dSends, dInbound] = await Promise.all([listLeads(), allTasks(), allBusinessIntelligence(), getSettings(), allEmailSends(), allInbound()]);
      const analyzedLeadIds = new Set(dBi.map((b) => b.leadId));
      const openTasks = dTasks.filter((t) => t.status === "open");
      const audit = auditQueue({ leads: dLeads, tasks: openTasks, analyzedLeadIds });
      const inv = emailInventory({ leads: dLeads, tasks: openTasks, emailsSentToday: 0, sendTarget: dSettings.prospecting.emailDailyTarget ?? 10 });
      const TERMINAL = new Set(["Won", "Lost", "Disqualified"]);
      const prepEligible = dLeads.filter(
        (l) => !TERMINAL.has(l.pipelineStage) && l.acquisitionStrategy !== "Do Not Contact" &&
               !!l.website && !isValidEmail(l.publicEmail) && !analyzedLeadIds.has(l.id),
      ).length;
      // Reservoir band + the prep plan that WOULD run this tick (preview; nothing is examined here).
      const { reservoirBand, reservoirLabel, planPreparation, observedYield } = await import("@/lib/acquisition/reservoir");
      const audRows = await (await import("@/lib/repo")).listAudit(200);
      const samples = audRows.filter((a) => a.action === "email.prep.sample" && a.meta && typeof a.meta === "object")
        .map((a) => ({ examined: Number((a.meta as any).examined ?? 0), adoptedEmail: Number((a.meta as any).adoptedEmail ?? 0) }));
      const yieldRate = observedYield(samples);
      const hardCap = Math.max(0, Number(process.env.EMAIL_PREP_MAX ?? 32));
      const band = reservoirBand(inv.prepared);
      const plan = planPreparation({ prepared: inv.prepared, eligible: prepEligible, yieldRate, hardCap, costCap: hardCap });
      // Email-discovery funnel (lifetime, read-only, reuses existing state — no analytics platform).
      // Answers the yield questions: of businesses with a website, how many became email-first;
      // of email-first, how many have a prepared Review; then sent → replied.
      const withWebsite = dLeads.filter((l) => !!l.website).length;
      const emailFirst = dLeads.filter((l) => isValidEmail(l.publicEmail) && !TERMINAL.has(l.pipelineStage) && l.acquisitionStrategy !== "Do Not Contact").length;
      const sentCount = dSends.filter((s) => !!s.sentAt).length;
      const repliedLeadIds = new Set(dInbound.filter((m) => (m.classification ?? "") !== "Bounce" && (m.classification ?? "") !== "Out Of Office").map((m) => m.leadId));
      inventory = {
        totals: { leads: dLeads.length, openTasks: openTasks.length, analyzed: analyzedLeadIds.size },
        email: { prepared: inv.prepared, sendCapacity: inv.sendCapacity, readyToday: inv.readyToday, beyondToday: inv.beyondToday },
        reservoir: { band, label: reservoirLabel(band), observedYield: Math.round(yieldRate * 100) / 100, wouldExamineNextTick: plan.examine, planReason: plan.reason },
        emailPrepEligible: prepEligible, // leads with a site + no email, not yet analyzed → prep can harvest an email
        // Harvest yield by source (Phase 4): homepage vs bounded contact/about page vs none. Lets us
        // measure whether the deeper crawl actually lifts email yield — from real production data.
        harvest: (() => {
          const rows = audRows.filter((a) => a.action === "lead.email.harvest" && a.meta && typeof a.meta === "object");
          const by = { homepage: 0, "contact-page": 0, none: 0 } as Record<string, number>;
          let extraPages = 0;
          for (const r of rows) { const m = r.meta as any; if (m.method in by) by[m.method] += 1; extraPages += Number(m.extraPagesFetched ?? 0); }
          const found = by.homepage + by["contact-page"];
          const total = found + by.none;
          return { sampled: total, homepage: by.homepage, contactPage: by["contact-page"], none: by.none, extraPagesFetched: extraPages, yield: total ? Math.round((found / total) * 100) / 100 : null, contactPageLift: found ? Math.round((by["contact-page"] / found) * 100) / 100 : null };
        })(),
        funnel: { leads: dLeads.length, withWebsite, analyzed: analyzedLeadIds.size, emailFirst, preparedReviews: inv.prepared, sent: sentCount, replied: repliedLeadIds.size },
        // Discovery economics (read-only) — config caps + recent run funnel, so we can size supply
        // from real evidence and see whether the Places budget is actually being used.
        discovery: await (async () => {
          const { listProspectingRuns } = await import("@/lib/repo");
          const { PLACES_COST_PER_REQUEST } = await import("@/lib/prospecting");
          const pp = dSettings.prospecting;
          const runs = (await listProspectingRuns(12)).filter((r) => r.providerMode === "google");
          const costPerReq = PLACES_COST_PER_REQUEST;
          const requestCap = Math.max(1, Math.min(pp.maxCategoriesPerRun, pp.dailyRequestBudget, Math.floor(pp.maxDailyCostUsd / costPerReq)));
          return {
            config: { dailyRequestBudget: pp.dailyRequestBudget, maxNewLeadsPerRun: pp.maxNewLeadsPerRun, maxCategoriesPerRun: pp.maxCategoriesPerRun, maxDailyCostUsd: pp.maxDailyCostUsd, maxExaminedPerRun: pp.maxExaminedPerRun, placesCostPerRequest: costPerReq, effectiveRequestCap: requestCap, budgetHeadroomRequests: Math.floor(pp.maxDailyCostUsd / costPerReq) },
            recentRuns: runs.slice(0, 8).map((r: any) => ({ at: r.startedAt, trigger: r.trigger, searches: r.searchesPerformed, requests: r.placesRequests, examined: r.examined, excluded: r.excluded, dupes: r.duplicatesRemoved, added: r.addedToToday, rejectedByCap: r.rejectedByCap, estCostUsd: r.estimatedCostUsd, stopReason: r.stopReason })),
          };
        })(),
        // Recent run trail — so "what did the last cron actually do?" is answerable without DB access.
        recentRuns: audRows
          .filter((a) => a.action === "email.prep.sample" || a.action === "comms.tasks_materialized")
          .slice(0, 8)
          .map((a) => ({ at: a.createdAt, action: a.action, meta: a.meta })),
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
