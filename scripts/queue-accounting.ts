// Read-only: the full queue accounting against the REAL database, plus the exact
// state of one named lead (--lead="name fragment"). Prints counts and workflow state
// only — never env values, never secrets. Run via:
//   railway run --service outreach-web -- ./node_modules/.bin/tsx scripts/queue-accounting.ts --lead="wilshire"
import "./loadEnv";

// When run OUTSIDE Railway's network (railway run from a laptop), the injected
// DATABASE_URL points at the internal hostname. Prefer the public URL when present —
// remapped in-process, never printed.
if (process.env.DATABASE_PUBLIC_URL && process.env.DATABASE_URL?.includes(".railway.internal")) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
}

const leadArg = process.argv.find((a) => a.startsWith("--lead="))?.split("=")[1]?.toLowerCase();

async function main() {
  // Import AFTER the env remap so the DB client sees the reachable URL.
  const { listLeads, allTasks, getSettings, contactsForLead } = await import("../src/lib/repo");
  const { accountQueue } = await import("../src/lib/queue-accounting");
  const [leads, tasks, settings] = await Promise.all([listLeads(), allTasks(), getSettings()]);
  const cap = settings.prospecting.dailyQueueSize;
  const a = accountQueue({ leads, tasks, cap });

  console.log("\n════════ QUEUE ACCOUNTING (read-only) ════════");
  console.log(`Daily cap (dailyQueueSize):     ${cap}`);
  console.log(`Total leads:                    ${a.totalLeads}`);
  console.log(`Open tasks:                     ${a.openTasks}`);
  console.log(`  Surfaced on Today (≤cap):     ${a.surfaced}   ${JSON.stringify(a.surfacedByKind)}`);
  console.log(`  Due today but BEYOND CAP:     ${a.beyondCap}   ${JSON.stringify(a.beyondCapByKind)}`);
  console.log(`  Waiting (future dueAt):       ${a.waitingFuture}`);
  console.log(`  Snoozed:                      ${a.snoozed}`);
  console.log(`Completed today:                ${a.completedToday}`);
  console.log(`Leads with open work:           ${a.leadsWithOpenWork}`);
  console.log(`Leads with NO open work:        ${a.leadsWithNoWork}  (terminal ${a.noWorkTerminal} · ACTIVE-but-invisible ${a.noWorkActive})`);

  // Priority spectrum of due-today tasks — proves who wins the cap and why.
  const now = new Date(); const eod = new Date(now); eod.setHours(23, 59, 59, 999);
  const due = tasks
    .filter((t) => t.status === "open" && (!t.snoozedUntil || +new Date(t.snoozedUntil) <= +now) && +new Date(t.dueAt) <= +eod)
    .sort((x, y) => y.priority - x.priority || +new Date(x.dueAt) - +new Date(y.dueAt));
  console.log(`\nTop ${Math.min(cap + 4, due.length)} due-today tasks by priority (cap line marked):`);
  due.slice(0, cap + 4).forEach((t, i) => {
    const lead = leads.find((l) => l.id === t.leadId);
    console.log(`  ${i === cap ? "── CAP ──\n  " : ""}${String(t.priority).padStart(3)}  ${t.type.padEnd(16)} ${lead?.businessName ?? t.leadId}  (due ${t.dueAt.slice(0, 10)})`);
  });

  if (leadArg) {
    const lead = leads.find((l) => l.businessName.toLowerCase().includes(leadArg));
    if (!lead) { console.log(`\n(no lead matching "${leadArg}")`); return; }
    const contacts = await contactsForLead(lead.id);
    const leadTasks = tasks.filter((t) => t.leadId === lead.id);
    console.log(`\n════════ LEAD: ${lead.businessName} (${lead.id}) ════════`);
    console.log(`stage=${lead.pipelineStage}  publicEmail=${lead.publicEmail ?? "—"}  nextFollowUpAt=${lead.nextFollowUpAt ?? "—"}  lastContactAt=${lead.lastContactAt ?? "—"}`);
    console.log(`contacts (${contacts.length}):`);
    for (const c of contacts) console.log(`  · ${c.name} <${c.email ?? "—"}> title=${c.title} source=${c.source} verified=${c.verified}`);
    console.log(`tasks (${leadTasks.length}):`);
    for (const t of leadTasks) console.log(`  · [${t.status}] ${t.type} p${t.priority} due=${t.dueAt.slice(0, 10)} "${t.title}"`);
    console.log(`note (last 6 lines):`);
    for (const line of (lead.note ?? "").split("\n").slice(0, 6)) console.log(`  ${line}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
