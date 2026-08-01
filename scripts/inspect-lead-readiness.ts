// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY readiness inspection for a single lead.
//
// Answers "could the operator send this today, and what would happen if they
// did?" without sending, approving, or writing anything. Every statement below
// is a SELECT. It prints no message bodies, no recipient addresses in full, and
// no secrets — only the gate facts.
//
//   railway run --service Postgres -- ./node_modules/.bin/tsx scripts/inspect-lead-readiness.ts "wilshire"
// ─────────────────────────────────────────────────────────────────────────────
import "./loadEnv";

if (process.env.DATABASE_PUBLIC_URL && process.env.DATABASE_URL?.includes(".railway.internal")) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
}

const NEEDLE = (process.argv[2] ?? "wilshire").toLowerCase();

/** Show enough of an address to confirm it is the right one; never the whole thing. */
const maskEmail = (e: string | null | undefined) => {
  if (!e) return "(none)";
  const [u, d] = e.split("@");
  return `${u.slice(0, 2)}${"•".repeat(Math.max(1, u.length - 2))}@${d ?? "?"}`;
};

async function main() {
  const {
    listLeads, allTasks, allPlans, allSteps, getSettings, isSuppressed,
    contactsForLead, getBusinessIntelligence, emailSendsForLead,
  } = await import("../src/lib/repo");
  const { checkPlanCompliance } = await import("../src/lib/acquisition/compliance");

  const leads = await listLeads();
  const matches = leads.filter((l) => l.businessName.toLowerCase().includes(NEEDLE));
  if (!matches.length) {
    console.log(`No lead matching "${NEEDLE}".`);
    return;
  }

  const [tasks, plans, steps, settings] = await Promise.all([allTasks(), allPlans(), allSteps(), getSettings()]);

  console.log("\n== SENDER-SIDE COMPLIANCE CONFIG (shared by every lead) ==");
  console.log(`reply/sender email configured ... ${settings.contactEmail ? "yes" : "NO"}`);
  console.log(`postal business address ......... ${settings.businessAddress?.trim() ? "yes" : "NO — blocks every email approval"}`);

  for (const lead of matches) {
    console.log(`\n${"─".repeat(70)}\n== ${lead.businessName} (${lead.id}) ==`);
    console.log(`industry ........................ ${lead.industry}`);
    console.log(`pipeline stage .................. ${lead.pipelineStage}`);
    console.log(`business status ................. ${lead.businessStatus ?? "(unset)"}`);
    console.log(`lead score ...................... ${lead.leadScore ?? "NULL — blocks approval"}`);
    console.log(`acquisition strategy ............ ${lead.acquisitionStrategy ?? "(none)"}`);
    console.log(`email on file ................... ${maskEmail(lead.publicEmail)}`);

    const suppressed = await isSuppressed({ email: lead.publicEmail, domain: lead.websiteDomain, phone: lead.phone });
    console.log(`suppressed / opted out .......... ${suppressed ? "YES — blocks sending" : "no"}`);

    const bi = await getBusinessIntelligence(lead.id);
    console.log(`business technology review ...... ${bi?.profile?.businessProfile ? "present" : "MISSING — blocks sending"}`);

    const contacts = await contactsForLead(lead.id);
    console.log(`contacts on file ................ ${contacts.length}`);

    const sends = await emailSendsForLead(lead.id);
    console.log(`email_sends rows ................ ${sends.length} (sent: ${sends.filter((s) => s.sentAt).length})`);

    const myTasks = tasks.filter((t) => t.leadId === lead.id);
    console.log(`\ntasks (${myTasks.length}):`);
    if (!myTasks.length) console.log("  none");
    for (const t of myTasks) {
      console.log(`  [${t.status}] ${t.type} due=${t.dueAt} sourceStepId=${t.sourceStepId ?? "-"} id=${t.id}`);
    }
    const openByType = new Map<string, number>();
    for (const t of myTasks.filter((t) => t.status === "open")) openByType.set(t.type, (openByType.get(t.type) ?? 0) + 1);
    const dupTypes = [...openByType.entries()].filter(([, n]) => n > 1);
    console.log(`duplicate open tasks of a type .. ${dupTypes.length ? dupTypes.map(([k, n]) => `${k}×${n}`).join(", ") : "none"}`);

    const myPlans = plans.filter((p) => p.leadId === lead.id);
    console.log(`\nacquisition plans (${myPlans.length}):`);
    if (!myPlans.length) console.log("  none — the first send creates one");
    for (const p of myPlans) {
      const ps = steps.filter((s) => s.planId === p.id).sort((a, b) => a.stepNumber - b.stepNumber);
      console.log(`  plan=${p.id} status=${p.status} approval=${p.approvalStatus} strategy=${p.strategy} steps=${ps.length}`);
      for (const s of ps) {
        console.log(`    step#${s.stepNumber} ${s.channel} approval=${s.approvalStatus} scheduledAt=${s.scheduledAt ?? "-"} sentAt=${s.sentAt ?? "-"} stoppedAt=${s.stoppedAt ?? "-"}`);
      }
      const c = checkPlanCompliance(lead, p, ps, settings, { suppressed });
      console.log(`    compliance: ${c.ok ? "PASSES" : "BLOCKED"}${c.blockers.length ? " — " + c.blockers.join(" | ") : ""}`);
    }
  }

  console.log(`\nrows written by this script: 0`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
