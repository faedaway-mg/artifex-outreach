// POST-QUALIFICATION ENRICHMENT for the current prepared (ACTIVE) leads. Read-only unless
// --apply. Resolves a send-eligible email via the canonical enrichment stage, measures the
// contact-form fallback, and (with --apply) flips PHONE_ONLY→EMAIL_READY + regenerates hedged
// OBSERVED email copy through dispatchGate. NEVER sends. No form submissions. No calls.
if (process.env.PROXY_DATABASE_URL) process.env.DATABASE_URL = process.env.PROXY_DATABASE_URL;
if ((process.env.DATABASE_URL ?? "").includes("railway.internal")) { console.error("refusing: internal DB host"); process.exit(1); }

import { allPlans, getLead, updateLead, stepsForPlan, updateStep } from "../src/lib/repo";
import { enrichContact, shouldEnrich } from "../src/lib/acquisition/enrichment";
import { dispatchGate } from "../src/lib/outreach/copy-gate";

const APPLY = process.argv.includes("--apply");
const ACTIVE_APPROVAL = new Set(["approved", "pending", "prepared"]);
const TERMINAL = new Set(["retired", "archived", "lost", "cancelled", "done", "rejected"]);
const isValidEmail = (e?: string | null) => !!e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const verdictOf = (note: string) => /problem-reality:\s*PROVEN/i.test(note) ? "PROVEN" : /problem-reality:\s*OBSERVED/i.test(note) ? "OBSERVED" : "?";

function hedgedEmail(biz: string) {
  return {
    subject: `One thing on ${biz}'s site`,
    body: `Hi there,\n\nI was looking through ${biz}'s website earlier and wasn't sure whether new patients can book online, or if that's intentional on your end. From the outside I genuinely can't tell.\n\nHappy to send over exactly what I noticed — no pressure either way.\n\n— Jordan, Artifex Labs`,
  };
}

async function main() {
  const plans = (await allPlans() as any[]).filter((p) => ACTIVE_APPROVAL.has(p.approvalStatus) && !TERMINAL.has(p.status));
  console.log(`==== POST-QUALIFICATION ENRICHMENT — ${plans.length} prepared plan(s) · apply=${APPLY} ====`);
  const agg = { attempted: 0, resolved: 0, validated: 0, unresolved: 0, invalid: 0, formAvail: 0, formUnavail: 0, captcha: 0, emailReady: 0, formReady: 0, phoneOnly: 0, gatePass: 0, gateSuppressed: 0, costUsd: 0 };

  for (const p of plans) {
    const lead: any = await getLead(p.leadId);
    if (!lead) continue;
    const verdict = verdictOf(String(lead.note ?? ""));
    const hasEmail = isValidEmail(lead.publicEmail);
    const gate = shouldEnrich({ verdict, hasSendApprovedEmail: hasEmail });

    console.log(`\n• ${lead.businessName}  [${verdict}] originalContact=${hasEmail ? "email" : lead.phone ? "phone" : "none"}`);
    if (!gate) { console.log(`  enrich skipped (${hasEmail ? "already has send-approved email" : "not a qualified verdict"})`); if (hasEmail) agg.emailReady++; continue; }

    agg.attempted++;
    const enr = await enrichContact(lead);
    agg.costUsd += enr.costUsd;
    console.log(`  email=${enr.email ?? "—"} · confidence=${enr.confidenceState} · sendEligible=${enr.sendEligible} · provenance=${enr.provenance}/${enr.method}`);
    console.log(`  contactForm=${enr.contactFormAvailable ? (enr.contactFormUrl ?? "yes") : "none"} · captcha=${enr.captchaPresent} · phoneRetained=${enr.phoneRetained}`);

    if (enr.email) agg.resolved++;
    if (enr.sendEligible) agg.validated++;
    else if (!enr.email) agg.unresolved++;
    else agg.invalid++; // resolved but not send-eligible (LOW_CONFIDENCE/CATCH_ALL/UNVERIFIED)
    if (enr.contactFormAvailable) agg.formAvail++; else agg.formUnavail++;
    if (enr.captchaPresent) agg.captcha++;

    // classify queue state
    if (enr.sendEligible) agg.emailReady++;
    else if (enr.contactFormAvailable) agg.formReady++;
    else agg.phoneOnly++;

    if (!APPLY) continue;

    if (enr.sendEligible && enr.email) {
      // PHONE_ONLY → EMAIL_READY: attach email, regenerate hedged copy, re-gate. Verdict/evidence/route unchanged.
      await updateLead(lead.id, { publicEmail: enr.email } as any);
      const { subject, body } = hedgedEmail(lead.businessName);
      const g = dispatchGate({ subject, body, businessName: lead.businessName, observation: lead.opportunitySummary ?? "", problemRealityStatus: verdict } as any);
      if (g.block) { agg.gateSuppressed++; console.log(`  ⚠ regenerated email copy SUPPRESSED by gate: ${g.reason}`); continue; }
      agg.gatePass++;
      const steps = (await stepsForPlan(p.id).catch(() => [])) as any[];
      const step1 = steps.find((s) => s.stepNumber === 1) ?? steps[0];
      if (step1) await updateStep(step1.id, { subject, content: body } as any);
      console.log(`  ✅ EMAIL_READY — email attached, hedged copy re-gated (${g.verdict}), NOT sent`);
    }
  }

  console.log(`\n==== ENRICHMENT SUMMARY ====`);
  console.log(JSON.stringify(agg, null, 2));
  const rate = agg.attempted ? (agg.validated / agg.attempted * 100).toFixed(0) : "0";
  console.log(`success rate (validated/attempted): ${rate}% · total cost: $${agg.costUsd.toFixed(2)} · cost/validated: $${agg.validated ? (agg.costUsd / agg.validated).toFixed(2) : "n/a"}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
