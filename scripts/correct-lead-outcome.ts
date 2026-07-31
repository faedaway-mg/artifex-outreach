// One-off, explicit: apply the collected→asked-to-send correction to ONE named lead.
// Read-mostly: the only writes are the documented correction transition itself.
//   railway run --service Postgres -- ./node_modules/.bin/tsx scripts/correct-lead-outcome.ts --lead="wilshire" --apply
import "./loadEnv";
if (process.env.DATABASE_PUBLIC_URL && process.env.DATABASE_URL?.includes(".railway.internal")) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
}
const leadArg = process.argv.find((a) => a.startsWith("--lead="))?.split("=")[1]?.toLowerCase();
const APPLY = process.argv.includes("--apply");

async function main() {
  if (!leadArg) { console.error("need --lead=<name fragment>"); process.exit(1); }
  const { listLeads, contactsForLead, allTasks } = await import("../src/lib/repo");
  const leads = await listLeads();
  const lead = leads.find((l) => l.businessName.toLowerCase().includes(leadArg));
  if (!lead) { console.error(`no lead matching "${leadArg}"`); process.exit(1); }
  const collected = (await contactsForLead(lead.id)).filter((c) => c.source === "conversation" && !!c.email)[0];
  console.log(`Lead: ${lead.businessName} · publicEmail=${lead.publicEmail ?? "—"} · collected=${collected?.email ?? "—"}`);
  if (!APPLY) { console.log("(dry-run — add --apply to correct)"); return; }
  const { correctToAskedToSendAction } = await import("../src/lib/outreach/call-outcome");
  const res = await correctToAskedToSendAction(lead.id);
  console.log("correction:", JSON.stringify(res));
  const open = (await allTasks()).filter((t) => t.leadId === lead.id && t.status === "open");
  console.log("open tasks after:", open.map((t) => `${t.type} p${t.priority} due=${t.dueAt.slice(0, 10)}`).join(" · ") || "none");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
