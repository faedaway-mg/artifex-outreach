// READ-ONLY census of every ACTIVE follow-up — proves nothing was lost when the manual follow-up UI was
// removed. No writes, no sends. Run: railway run --service Postgres bash -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" npx tsx scripts/followup-census.ts'
import { listLeads, allPlans, allSteps, allEmailSends, allTasks, allInbound, isSuppressed } from "../src/lib/repo";

async function main() {
  const now = new Date().toISOString();
  const [leads, plans, steps, sends, tasks, inbound] = await Promise.all([
    listLeads(), allPlans(), allSteps(), allEmailSends(), allTasks(), allInbound(),
  ]);
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const planById = new Map(plans.map((p) => [p.id, p]));
  const stepsByPlan = new Map<string, typeof steps>();
  for (const s of steps) { const a = stepsByPlan.get(s.planId) ?? []; a.push(s); stepsByPlan.set(s.planId, a); }
  const repliedLeads = new Set(inbound.map((m) => m.leadId));

  const emailFollowups = steps.filter((s) => s.channel === "email" && s.stepNumber >= 2 && !s.sentAt && !s.stoppedAt);
  const buckets = { dueNow: [] as any[], future: [] as any[], noPriorSent: [] as any[], planNotActive: [] as any[], planNotApproved: [] as any[], stepNotApproved: [] as any[], repliedShouldStop: [] as any[] };

  for (const s of emailFollowups) {
    const plan = planById.get(s.planId); const lead = plan ? leadById.get(plan.leadId) : undefined;
    const label = { stepId: s.id, leadId: lead?.id, business: lead?.businessName, step: s.stepNumber, scheduledAt: s.scheduledAt };
    if (!plan || plan.status !== "active") { buckets.planNotActive.push(label); continue; }
    if (plan.approvalStatus !== "approved") { buckets.planNotApproved.push(label); continue; }
    if (s.approvalStatus !== "approved") { buckets.stepNotApproved.push(label); continue; }
    const prior = (stepsByPlan.get(s.planId) ?? []).filter((p) => p.channel === "email" && p.stepNumber < s.stepNumber);
    const priorSent = prior.some((p) => p.sentAt);
    if (!priorSent) { buckets.noPriorSent.push(label); continue; }
    if (lead && repliedLeads.has(lead.id)) { buckets.repliedShouldStop.push(label); continue; }
    if (s.scheduledAt && s.scheduledAt <= now) buckets.dueNow.push(label); else buckets.future.push(label);
  }

  const openFollowupTasks = tasks.filter((t) => t.type === "follow_up" && t.status === "open");
  console.log("\n===== FOLLOW-UP CENSUS (read-only) =====");
  console.log("total email follow-up steps (>=2, unsent, unstopped):", emailFollowups.length);
  console.log("  DUE NOW (approved, prior initial sent, not replied):", buckets.dueNow.length);
  console.log("  future-scheduled:", buckets.future.length);
  console.log("  blocked-no-prior-initial-sent:", buckets.noPriorSent.length);
  console.log("  plan-not-active:", buckets.planNotActive.length, "| plan-not-approved:", buckets.planNotApproved.length, "| step-not-approved:", buckets.stepNotApproved.length);
  console.log("  REPLIED → must stop (should not send):", buckets.repliedShouldStop.length, buckets.repliedShouldStop.map((x) => x.business));
  console.log("open follow_up TASKS still in DB (manual projection):", openFollowupTasks.length);
  console.log("\nDUE-NOW detail:");
  for (const d of buckets.dueNow) console.log("  ", d.business, "| step", d.step, "| due", d.scheduledAt);
  // Wilshire guard
  const wilshire = leads.filter((l) => /wilshire/i.test(l.businessName));
  for (const w of wilshire) {
    const wp = plans.filter((p) => p.leadId === w.id);
    console.log(`\nWilshire "${w.businessName}": plans=[${wp.map((p) => p.status).join(",")}] — must be stopped/none.`);
  }
  console.log("\ncensus complete (read-only).\n");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e?.stack || e); process.exit(1); });
