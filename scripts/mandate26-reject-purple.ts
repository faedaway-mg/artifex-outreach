// MANDATE 26 §3 — reject "Purple – Santa Monica Place" via the canonical Reject / Stop-future-outreach
// workflow (NOT deletion, NOT suppression). Dry-run by default: lists every Purple match with its pre-state
// (canonical stage, scheduled binding, contact/receipt) so the exact Santa Monica Place identity is confirmed
// before any mutation. --apply performs exactly ONE active→Rejected transition with reason "outside-target-size"
// and the operator note, only when the target is unambiguous.
//
//   railway run --service Postgres -- ./node_modules/.bin/tsx scripts/mandate26-reject-purple.ts            (dry-run)
//   railway run --service Postgres -- ./node_modules/.bin/tsx scripts/mandate26-reject-purple.ts --apply     (execute)
import "./loadEnv";
if (process.env.DATABASE_PUBLIC_URL && process.env.DATABASE_URL?.includes(".railway.internal")) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
}
const APPLY = process.argv.includes("--apply");
const NAME_MATCH = /purple/i;
const SMP_MATCH = /santa\s*monica\s*place/i;
const REASON = "outside-target-size";
const NOTE = "National enterprise / location outside current small-business ICP.";

async function main() {
  const repo = await import("../src/lib/repo");
  const { listLeads } = repo;
  const { latestProspectPackage } = await import("../src/lib/outreach/prospect-package-store");
  const { latestRejection } = await import("../src/lib/outreach/rejection");

  const leads = await listLeads();
  const purple = leads.filter((l) => NAME_MATCH.test(l.businessName || "") || NAME_MATCH.test((l as any).city ?? ""));
  console.log(`Purple matches: ${purple.length}`);
  for (const l of purple) {
    const pkg = await latestProspectPackage(l.id).catch(() => null);
    const rej = await latestRejection(l.id).catch(() => null);
    console.log(
      `  • ${l.businessName} · id=${l.id} · stage=${l.pipelineStage} · city=${(l as any).city ?? "—"}, ${(l as any).state ?? "—"} ` +
      `· pkg=${pkg?.state ?? "none"}${pkg ? `(v${pkg.packageVersion})` : ""} ` +
      `· lastContact=${(l as any).lastContactAt ? "yes" : "no"} · alreadyRejected=${rej ? "YES" : "no"}`,
    );
  }

  const smp = purple.filter((l) => SMP_MATCH.test(l.businessName || "") || SMP_MATCH.test((l as any).city ?? "") || SMP_MATCH.test((l as any).address ?? ""));
  const target = smp.length === 1 ? smp[0] : (purple.length === 1 ? purple[0] : null);
  if (!target) {
    console.log(smp.length > 1 ? `AMBIGUOUS: ${smp.length} Santa Monica Place matches — resolve manually, no mutation.` : `NO UNAMBIGUOUS TARGET (${purple.length} purple / ${smp.length} SMP) — no mutation.`);
    return;
  }
  console.log(`\nTARGET: ${target.businessName} (id=${target.id}) — reason="${REASON}" note="${NOTE}"`);

  // Read-only verification of the CURRENT disposition (idempotency check before any mutation).
  const { listAudit, isSuppressed } = await import("../src/lib/repo");
  const { latestRejection: latestRej2 } = await import("../src/lib/outreach/rejection");
  const rejEvents = (await listAudit(5000)).filter((a: any) => a.action === "lead.rejected" && a.targetId === target.id);
  const suppEvents = (await listAudit(5000)).filter((a: any) => /suppress|unsubscribe/i.test(a.action) && (a.meta?.leadId === target.id || a.targetId === target.id));
  const cur = await latestRej2(target.id).catch(() => null);
  const supp = await isSuppressed({ email: (target as any).publicEmail ?? null, domain: null, phone: null }).catch(() => false);
  console.log(`CURRENT DISPOSITION: stage=${target.pipelineStage} · lead.rejected events=${rejEvents.length} · reason=${(cur as any)?.reason ?? "—"} · note=${(cur as any)?.note ?? "—"} · suppression events=${suppEvents.length} · suppressed=${supp}`);

  if (target.pipelineStage === "Rejected" && rejEvents.length >= 1) {
    console.log("ALREADY CANONICALLY REJECTED — terminal, no binding, idempotent. No mutation needed" + (APPLY ? " (skipping --apply no-op)." : "."));
    return;
  }
  if (!APPLY) { console.log("(dry-run — add --apply to reject)"); return; }

  const { rejectLead } = await import("../src/lib/outreach/rejection");
  const res = await rejectLead({ leadId: target.id, reason: REASON, note: NOTE, actor: "operator:mandate-26" });
  console.log("REJECT RESULT:", JSON.stringify(res));

  // Post-verify: exactly one lead.rejected event, no suppression, terminal stage.
  const { getLead } = await import("../src/lib/repo");
  const eventsAfter = (await listAudit(5000)).filter((a: any) => a.action === "lead.rejected" && a.targetId === target.id);
  const after = await getLead(target.id);
  console.log(`VERIFY: stage=${after?.pipelineStage} · lead.rejected events=${eventsAfter.length} · suppression events=${suppEvents.length}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
