// BREAKBOT PRE-SEND REHEARSAL for the prepared conversation work. Read-only. No sends.
// Validates every prepared, ACTIVE plan against the §10 checklist.
if (process.env.PROXY_DATABASE_URL) process.env.DATABASE_URL = process.env.PROXY_DATABASE_URL;
import { allPlans, getLead, stepsForPlan } from "../src/lib/repo";
import { geoGate } from "../src/lib/geo/lead-sprint";
import { dispatchGate } from "../src/lib/outreach/copy-gate";

const ACTIVE_APPROVAL = new Set(["approved", "pending", "prepared"]);
const TERMINAL = new Set(["retired", "archived", "lost", "cancelled", "done", "rejected"]);

async function main() {
  const plans = (await allPlans() as any[]).filter((p) => ACTIVE_APPROVAL.has(p.approvalStatus) && !TERMINAL.has(p.status));
  console.log(`==== BREAKBOT REHEARSAL — ${plans.length} prepared active plan(s) ====`);
  let pass = 0, fail = 0;
  for (const p of plans) {
    const lead: any = await getLead(p.leadId);
    const steps = (await stepsForPlan(p.id).catch(() => [])) as any[];
    const step1 = steps.find((s) => s.stepNumber === 1) ?? steps[0];
    const note = String(lead?.note ?? "");
    const verdict = /problem-reality:\s*PROVEN/i.test(note) ? "PROVEN" : /problem-reality:\s*OBSERVED/i.test(note) ? "OBSERVED" : "?";
    const route = verdict === "OBSERVED" ? "CONVERSATION" : verdict === "PROVEN" ? "DIRECT_FIX" : "?";
    const geo = lead ? geoGate({ city: lead.city, state: lead.state }) : { allowed: false, reason: "no lead" } as any;
    const gate = step1 ? dispatchGate({ subject: step1.subject, body: step1.content, businessName: lead?.businessName ?? "", observation: lead?.opportunitySummary ?? "", problemRealityStatus: verdict } as any) : { block: true, reason: "no step1", verdict: "SUPPRESSED" } as any;
    const contact = lead?.publicEmail ? "email" : lead?.phone ? "phone" : "none";

    const checks: Record<string, boolean> = {
      business: !!lead?.businessName,
      geography_in_pod: !!geo.allowed,
      icp_nonchain: !((lead?.locationsCount ?? 0) > 1),
      contact_channel: contact !== "none",
      current_evidence: !!lead?.opportunitySummary,
      verdict_valid: verdict === "PROVEN" || verdict === "OBSERVED",
      route_valid: verdict === "OBSERVED" ? route === "CONVERSATION" : route !== "?",
      claim_language_safe: !gate.block, // hedged copy passes; defect/causal claim would block
      subject_body_present: !!(step1?.subject && step1?.content),
      lineage: !!(p.leadId && p.id),
      dispatch_gate: !gate.block,
    };
    const ok = Object.values(checks).every(Boolean);
    ok ? pass++ : fail++;
    const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    console.log(`\n${ok ? "✅ PASS" : "❌ FAIL"}  ${lead?.businessName ?? p.leadId}  [${verdict}/${route}, contact=${contact}]`);
    console.log(`   geo=${geo.allowed ? geo.podLabel ?? "in-pod" : geo.reason} · gate=${gate.verdict} · plan=${p.id}`);
    console.log(`   subject: ${step1?.subject ?? "—"}`);
    if (failed.length) console.log(`   FAILED CHECKS: ${failed.join(", ")}`);
  }
  console.log(`\n==== BREAKBOT: ${pass} PASS · ${fail} FAIL ====`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
