// ─────────────────────────────────────────────────────────────────────────────
// Reconcile the operator queue with the authoritative email sequence.
//
// Reports (and, with --apply, repairs) the drift between acquisition steps and
// the Tasks that make them visible in Today. It NEVER sends email, never writes
// to email_sends, and never marks a sent step unsent.
//
// SAFE BY DEFAULT: dry-run prints what it WOULD do. Pass --apply to write.
//   railway run --service Postgres -- ./node_modules/.bin/tsx scripts/reconcile-sequence-tasks.ts [--apply] [--end-of-day]
// ─────────────────────────────────────────────────────────────────────────────
import "./loadEnv";

if (process.env.DATABASE_PUBLIC_URL && process.env.DATABASE_URL?.includes(".railway.internal")) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
}

const APPLY = process.argv.includes("--apply");
// Conservative by default: only steps already PAST their scheduled instant.
// Pass --end-of-day to match what the daily cron does (everything due today).
const HORIZON = process.argv.includes("--end-of-day") ? "end-of-day" : "now";
const INTERNAL = /internal|test send/i;

async function main() {
  const { listLeads, allTasks, allPlans, allSteps, appendAudit } = await import("../src/lib/repo");
  const { materializeDueSteps, accountSequences } = await import("../src/lib/comms/task-projection");

  const [leads, tasks, plans, steps] = await Promise.all([listLeads(), allTasks(), allPlans(), allSteps()]);
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const planById = new Map(plans.map((p) => [p.id, p]));
  const now = new Date();
  const nowIso = now.toISOString();

  const isInternal = (leadId: string | undefined) => {
    const l = leadId ? leadById.get(leadId) : undefined;
    return l ? INTERNAL.test(`${l.source} ${l.industry} ${l.businessName}`) : false;
  };

  // ── Report ────────────────────────────────────────────────────────────────
  const acct = accountSequences({ plans, steps, tasks, now });
  console.log("\n== SEQUENCE ACCOUNTING ==");
  console.log(`active plans .................... ${acct.activePlans}`);
  console.log(`plans awaiting approval ......... ${acct.plansAwaitingApproval}`);
  console.log(`future scheduled steps .......... ${acct.futureScheduledSteps}`);
  console.log(`due unsent steps ................ ${acct.dueUnsentSteps}`);
  console.log(`  of which past-due ............. ${acct.pastDueUnsentSteps}`);
  console.log(`due steps MISSING a task ........ ${acct.dueStepsMissingTask}`);
  console.log(`projected open tasks ............ ${acct.projectedOpenTasks}`);
  console.log(`stale projected tasks ........... ${acct.staleProjectedTasks}`);
  console.log(`orphan projected tasks .......... ${acct.orphanProjectedTasks}`);

  const emailSteps = steps.filter((s) => s.channel === "email");
  const internalSteps = emailSteps.filter((s) => isInternal(planById.get(s.planId)?.leadId));
  console.log(`internal/test steps (excluded) .. ${internalSteps.length}`);

  console.log("\n== SENT STEPS WITH AN OPEN TASK (stale) ==");
  const staleRows = tasks.filter((t) => {
    if (!t.sourceStepId || t.status !== "open") return false;
    const s = steps.find((x) => x.id === t.sourceStepId);
    return !s || !!s.sentAt || !!s.stoppedAt;
  });
  if (!staleRows.length) console.log("  none");
  for (const t of staleRows) console.log(`  task=${t.id} lead=${leadById.get(t.leadId)?.businessName} step=${t.sourceStepId}`);

  console.log("\n== DUE STEPS MISSING A TASK ==");
  const projected = new Set(tasks.filter((t) => t.sourceStepId && t.status === "open").map((t) => t.sourceStepId));
  const missing = emailSteps.filter((s) => {
    const p = planById.get(s.planId);
    return p && p.status === "active" && p.approvalStatus === "approved" && s.approvalStatus === "approved"
      && s.stepNumber > 1 && !s.sentAt && !s.stoppedAt && s.scheduledAt && s.scheduledAt <= nowIso && !projected.has(s.id);
  });
  if (!missing.length) console.log("  none");
  for (const s of missing) {
    const p = planById.get(s.planId)!;
    console.log(`  step=${s.id} step#${s.stepNumber} lead=${leadById.get(p.leadId)?.businessName} scheduledAt=${s.scheduledAt}`);
  }

  console.log("\n== DUPLICATE TASKS FOR ONE STEP ==");
  const perStep = new Map<string, number>();
  for (const t of tasks) if (t.sourceStepId) perStep.set(t.sourceStepId, (perStep.get(t.sourceStepId) ?? 0) + 1);
  const dupes = [...perStep.entries()].filter(([, n]) => n > 1);
  console.log(dupes.length ? dupes.map(([s, n]) => `  step=${s} tasks=${n}`).join("\n") : "  none (guaranteed by the unique index)");

  // ── Repair ────────────────────────────────────────────────────────────────
  const summary = await materializeDueSteps({ now, apply: APPLY, horizon: HORIZON });
  console.log(`\n== ${APPLY ? "APPLIED" : "DRY RUN"} (horizon: ${HORIZON}) ==`);
  console.log(`considered ...................... ${summary.considered}`);
  console.log(`tasks ${APPLY ? "created" : "that would be created"} ......... ${summary.created}`);
  console.log(`already present ................. ${summary.alreadyPresent}`);
  console.log(`stale tasks closed .............. ${summary.reconciledStale}`);
  console.log(`skipped:`, summary.skipped);
  for (const c of summary.createdTasks) console.log(`  + ${c.businessName} — step#${c.stepNumber} due ${c.dueAt}`);
  for (const c of summary.staleClosed) console.log(`  - closed task ${c.taskId} (${c.reason})`);
  console.log(`\nemails sent by this script: 0 (it cannot send)`);

  if (APPLY && (summary.created || summary.reconciledStale)) {
    await appendAudit({
      action: "comms.tasks_reconciled",
      actor: "jordan",
      targetType: "comms",
      targetId: null,
      meta: { created: summary.created, reconciledStale: summary.reconciledStale, skipped: summary.skipped },
      ip: null,
    });
  }
  if (!APPLY) console.log("(re-run with --apply to write)");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
