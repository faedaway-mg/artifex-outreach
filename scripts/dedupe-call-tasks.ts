// One-off repair: a lead must have at most ONE open call task. Keeps the newest,
// supersedes the rest (prevention now lives in saveCallOutcomeAction).
//   railway run --service Postgres -- ./node_modules/.bin/tsx scripts/dedupe-call-tasks.ts --apply
import "./loadEnv";
if (process.env.DATABASE_PUBLIC_URL && process.env.DATABASE_URL?.includes(".railway.internal")) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
}
const APPLY = process.argv.includes("--apply");
async function main() {
  const { allTasks, updateTask, listLeads } = await import("../src/lib/repo");
  const leads = new Map((await listLeads()).map((l) => [l.id, l.businessName]));
  const open = (await allTasks()).filter((t) => t.status === "open" && t.type === "call");
  const byLead = new Map<string, typeof open>();
  for (const t of open) byLead.set(t.leadId, [...(byLead.get(t.leadId) ?? []), t]);
  let superseded = 0;
  for (const [leadId, ts] of byLead) {
    if (ts.length <= 1) continue;
    const sorted = [...ts].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    for (const dupe of sorted.slice(1)) {
      console.log(`${APPLY ? "SUPERSEDE" : "would supersede"}: ${leads.get(leadId)} · "${dupe.title}" (${dupe.id})`);
      if (APPLY) await updateTask(dupe.id, { status: "done" });
      superseded++;
    }
  }
  console.log(`${APPLY ? "Superseded" : "Would supersede"} ${superseded} duplicate call task(s).`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
