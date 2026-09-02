// ─────────────────────────────────────────────────────────────────────────────
// Dispose the Wilshire Law Firm follow-up (mandate VII). Wilshire is the controlled validation lead:
// 2 emails already delivered, one follow-up done, but a stale follow_up task is still OPEN on an active
// plan (so it shows in Follow-ups Due). This stops its sequence with a recorded reason and reconciles the
// stale task closed. It PRESERVES all communication + audit history (email_sends/audit untouched); it only
// stops the plan + closes the projected task. Re-projection is prevented because task-projection never
// re-projects a stopped plan / sent step.
//
// SAFE BY DEFAULT: dry-run prints what it WOULD do. Pass --apply to write. NEVER sends email.
//   railway run --service Postgres -- ./node_modules/.bin/tsx scripts/dispose-wilshire.ts [--apply]
// ─────────────────────────────────────────────────────────────────────────────
import "./loadEnv";

if (process.env.DATABASE_PUBLIC_URL && process.env.DATABASE_URL?.includes(".railway.internal")) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
}

const APPLY = process.argv.includes("--apply");
const REASON = "Closed: controlled validation lead — outreach sequence reconciled after 2 delivered sends; no further contact. Stale follow-up removed from Follow-ups Due (mandate VII).";

async function main() {
  const { listLeads, allTasks, plansForLead, updateTask, appendAudit } = await import("../src/lib/repo");
  const { stopPlansForLead } = await import("../src/lib/acquisition/stop");

  const leads = await listLeads();
  const wil = leads.find((l) => /wilshire/i.test(l.businessName));
  if (!wil) { console.error("Wilshire lead not found."); process.exit(1); }
  const before = (await allTasks()).filter((t) => t.leadId === wil.id);
  const plans = await plansForLead(wil.id);
  console.log(`Wilshire = ${wil.id} (${wil.businessName}), stage=${wil.pipelineStage}`);
  console.log(`  plans: ${plans.map((p) => `${p.id}:${p.status}`).join(", ")}`);
  console.log(`  tasks: ${before.map((t) => `${t.type}:${t.status}`).join(", ")}`);
  const openFollowUps = before.filter((t) => t.type === "follow_up" && t.status === "open");
  console.log(`  OPEN follow-up tasks (in Follow-ups Due): ${openFollowUps.length}`);

  if (!APPLY) {
    console.log(`\nDRY RUN — would: stopPlansForLead(${wil.id}), append disposition audit, close ${openFollowUps.length} stale task(s).`);
    console.log("Re-run with --apply to write.");
    return;
  }

  const stopped = await stopPlansForLead(wil.id, REASON);
  // Close JUST Wilshire's stale open follow-up task(s) (skipped) — scoped, no global side effects. The
  // stopped plan means task-projection will never re-project it, so it cannot reappear in Follow-ups Due.
  let closed = 0;
  for (const t of openFollowUps) { await updateTask(t.id, { status: "skipped", updatedAt: new Date().toISOString() }); closed += 1; }
  await appendAudit({ action: "acquisition.sequence_closed", actor: "operator", targetType: "lead", targetId: wil.id, meta: { reason: REASON, plansStopped: stopped, tasksClosed: closed, disposition: "validation-lead-closed" } as any, ip: null });

  const after = (await allTasks()).filter((t) => t.leadId === wil.id);
  const stillOpen = after.filter((t) => t.type === "follow_up" && t.status === "open").length;
  console.log(`\nAPPLIED: plans stopped=${stopped}; disposition recorded.`);
  console.log(`  tasks now: ${after.map((t) => `${t.type}:${t.status}`).join(", ")}`);
  console.log(`  OPEN follow-up tasks remaining: ${stillOpen} ${stillOpen === 0 ? "✓ (removed from Follow-ups Due)" : "✗"}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
