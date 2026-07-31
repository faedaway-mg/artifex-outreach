// One-time repair for queue starvation: every ACTIVE lead with zero open tasks is
// invisible to Today forever (proven: 25 of 32 in production). This queues the missing
// outreach work — one review_and_send per stranded lead, which the strategy engine
// buckets to email/call/form/DM/research automatically.
//
// SAFE BY DEFAULT: dry-run prints what it WOULD do. Pass --apply to write.
// Skips: terminal stages, closed businesses, leads with ANY open task, leads already
// emailed (they're in the waiting flow, not stranded). Idempotent on re-run.
//   railway run --service Postgres -- ./node_modules/.bin/tsx scripts/replenish-queue.ts [--apply]
import "./loadEnv";

if (process.env.DATABASE_PUBLIC_URL && process.env.DATABASE_URL?.includes(".railway.internal")) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
}

const APPLY = process.argv.includes("--apply");
const TERMINAL = new Set(["Lost", "Disqualified", "Closed Won", "Closed Lost"]);

async function main() {
  const { listLeads, allTasks, insertTask, emailSendsForLead, appendAudit } = await import("../src/lib/repo");
  const [leads, tasks] = await Promise.all([listLeads(), allTasks()]);
  const openByLead = new Set(tasks.filter((t) => t.status === "open").map((t) => t.leadId));

  let queued = 0, skippedTerminal = 0, skippedEmailed = 0;
  for (const lead of leads) {
    if (openByLead.has(lead.id)) continue;
    if (TERMINAL.has(lead.pipelineStage) || lead.businessStatus === "CLOSED_PERMANENTLY") { skippedTerminal++; continue; }
    const sent = (await emailSendsForLead(lead.id)).some((s) => !!s.sentAt);
    if (sent) { skippedEmailed++; continue; }

    console.log(`${APPLY ? "QUEUE" : "would queue"}: ${lead.businessName}  (stage=${lead.pipelineStage}, email=${lead.publicEmail ? "yes" : "no"}, phone=${lead.phone ? "yes" : "no"})`);
    if (APPLY) {
      await insertTask({
        leadId: lead.id,
        type: "review_and_send",
        title: `Send personalized review — ${lead.businessName}`,
        dueAt: new Date().toISOString(),
        status: "open",
        priority: 40,
        snoozedUntil: null,
      });
    }
    queued++;
  }

  if (APPLY && queued > 0) {
    await appendAudit({
      action: "queue.replenished",
      actor: "jordan",
      targetType: null,
      targetId: null,
      meta: { queued, skippedTerminal, skippedEmailed },
      ip: null,
    });
  }
  console.log(`\n${APPLY ? "Queued" : "Would queue"} ${queued} · skipped ${skippedTerminal} terminal · ${skippedEmailed} already-emailed.${APPLY ? "" : "  (re-run with --apply to write)"}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
