// READ-ONLY audit for Part B: does the email pipeline actually run follow-ups,
// and is that work visible to the operator in Today?
//   railway run --service Postgres -- ./node_modules/.bin/tsx scripts/email-pipeline-audit.ts [--lead="wilshire"]
import "./loadEnv";

if (process.env.DATABASE_PUBLIC_URL && process.env.DATABASE_URL?.includes(".railway.internal")) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
}

const leadArg = process.argv.find((a) => a.startsWith("--lead="))?.split("=")[1]?.toLowerCase();

async function main() {
  const { getDb, hasDb } = await import("../src/db/client");
  const t = await import("../src/db/schema");
  const { listLeads, allTasks } = await import("../src/lib/repo");

  if (!hasDb()) {
    console.log("No DB configured in this process — aborting (this script must run against production).");
    return;
  }
  const db = getDb();

  const [leads, tasks, plans, steps, sends] = await Promise.all([
    listLeads(),
    allTasks(),
    db.select().from(t.acquisitionPlans),
    db.select().from(t.acquisitionSteps),
    db.select().from(t.emailSends),
  ]);

  console.log(`\n== LEADS ==`);
  console.log(`total: ${leads.length}`);
  console.log(`with publicEmail: ${leads.filter((l) => l.publicEmail).length}`);
  console.log(`with phone only (no email): ${leads.filter((l) => l.phone && !l.publicEmail).length}`);

  console.log(`\n== PLANS (by status / strategy) ==`);
  const byStatus: Record<string, number> = {};
  const byStrategy: Record<string, number> = {};
  for (const p of plans as any[]) {
    byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
    byStrategy[p.strategy] = (byStrategy[p.strategy] ?? 0) + 1;
  }
  console.log("status:", byStatus);
  console.log("strategy:", byStrategy);
  console.log(`total plans: ${plans.length}`);

  console.log(`\n== STEPS (email channel) ==`);
  const emailSteps = (steps as any[]).filter((s) => s.channel === "email");
  const byStepNum: Record<string, { total: number; sent: number; scheduled: number; unscheduled: number }> = {};
  for (const s of emailSteps) {
    const k = String(s.stepNumber);
    byStepNum[k] ??= { total: 0, sent: 0, scheduled: 0, unscheduled: 0 };
    byStepNum[k].total++;
    if (s.sentAt) byStepNum[k].sent++;
    else if (s.scheduledAt) byStepNum[k].scheduled++;
    else byStepNum[k].unscheduled++;
  }
  console.log("by stepNumber:", byStepNum);

  const now = new Date().toISOString();
  const pastDueUnsent = emailSteps.filter((s) => s.scheduledAt && s.scheduledAt <= now && !s.sentAt && !s.stoppedAt);
  console.log(`past-due, unsent, unstopped email steps (should have gone out): ${pastDueUnsent.length}`);
  if (pastDueUnsent.length) {
    for (const s of pastDueUnsent.slice(0, 15)) {
      const plan = (plans as any[]).find((p) => p.id === s.planId);
      console.log(`  - planId=${s.planId} leadId=${plan?.leadId} step#${s.stepNumber} scheduledAt=${s.scheduledAt} approvalStatus=${s.approvalStatus} planStatus=${plan?.status} planApproval=${plan?.approvalStatus}`);
    }
  }

  console.log(`\n== EMAIL SENDS LEDGER ==`);
  console.log(`total rows: ${sends.length}`);
  const sentSends = (sends as any[]).filter((s) => s.sentAt);
  console.log(`sent: ${sentSends.length}`);
  const byStatus2: Record<string, number> = {};
  for (const s of sends as any[]) byStatus2[s.status] = (byStatus2[s.status] ?? 0) + 1;
  console.log("by status:", byStatus2);

  console.log(`\n== TASK-BASED FOLLOW-UP SYSTEM (scheduleFollowUps / follow_up Task type) ==`);
  const followUpTasks = tasks.filter((tk) => tk.type === "follow_up");
  console.log(`follow_up type tasks (any status), ever: ${followUpTasks.length}`);
  console.log(`open follow_up tasks right now: ${followUpTasks.filter((tk) => tk.status === "open").length}`);
  const withNextFollowUpAt = leads.filter((l: any) => l.nextFollowUpAt);
  console.log(`leads with nextFollowUpAt set: ${withNextFollowUpAt.length}`);

  console.log(`\n== TODAY QUEUE VISIBILITY FOR EMAIL WORK ==`);
  const reviewAndSendOpen = tasks.filter((tk) => tk.type === "review_and_send" && tk.status === "open");
  console.log(`open review_and_send tasks: ${reviewAndSendOpen.length}`);
  const openTaskLeadIds = new Set(tasks.filter((tk) => tk.status === "open").map((tk) => tk.leadId));
  const activePlansNoOpenTask = (plans as any[]).filter((p) => p.status === "active" && !openTaskLeadIds.has(p.leadId));
  console.log(`active plans (mid-sequence) whose lead has ZERO open task of any kind: ${activePlansNoOpenTask.length}`);

  if (leadArg) {
    console.log(`\n== LEAD: ${leadArg} ==`);
    const lead = leads.find((l: any) => l.businessName.toLowerCase().includes(leadArg));
    if (!lead) { console.log("not found"); return; }
    console.log({ id: lead.id, businessName: lead.businessName, stage: lead.pipelineStage, publicEmail: lead.publicEmail, acquisitionStrategy: (lead as any).acquisitionStrategy, nextFollowUpAt: (lead as any).nextFollowUpAt });
    const leadPlans = (plans as any[]).filter((p) => p.leadId === lead.id);
    for (const p of leadPlans) {
      console.log(`  plan ${p.id}: strategy=${p.strategy} status=${p.status} approvalStatus=${p.approvalStatus} currentStep=${p.currentStep} nextScheduledAt=${p.nextScheduledAt}`);
      const pSteps = (steps as any[]).filter((s) => s.planId === p.id).sort((a, b) => a.stepNumber - b.stepNumber);
      for (const s of pSteps) {
        console.log(`    step#${s.stepNumber} channel=${s.channel} approvalStatus=${s.approvalStatus} scheduledAt=${s.scheduledAt} sentAt=${s.sentAt} stoppedAt=${s.stoppedAt}`);
      }
    }
    const leadTasks = tasks.filter((tk) => tk.leadId === lead.id);
    console.log(`  tasks (${leadTasks.length}):`);
    for (const tk of leadTasks) console.log(`    [${tk.status}] ${tk.type} due=${tk.dueAt} priority=${tk.priority}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
