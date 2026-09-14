// READ-ONLY inspection of the existing research/OBSERVED lead set for the PROVEN-DEPTH
// YIELD PASS. Traces every lead's problem-reality verdict (from note), pipeline stage,
// plan state, and contact metadata. No writes. Resolves DB via the public proxy so it
// works both under `railway run` (DATABASE_PUBLIC_URL) and with a local PROXY_DATABASE_URL.
if (process.env.DATABASE_PUBLIC_URL) process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
if (process.env.PROXY_DATABASE_URL) process.env.DATABASE_URL = process.env.PROXY_DATABASE_URL;
if ((process.env.DATABASE_URL ?? "").includes("railway.internal")) {
  console.error("refusing: DATABASE_URL points at internal host (unreachable). Run via `railway run` or set PROXY_DATABASE_URL.");
  process.exit(1);
}

import { listLeads, allPlans } from "../src/lib/repo";
import { listOffers } from "../src/lib/quick-fix/store";

const verdictOf = (note?: string | null) => {
  const m = (note ?? "").match(/problem-reality:\s*([A-Z_]+)/i);
  return m ? m[1].toUpperCase() : null;
};

async function main() {
  const leads = await listLeads();
  let plans: any[] = [];
  let offers: any[] = [];
  try { plans = await allPlans(); } catch (e: any) { console.error("allPlans err", e?.message); }
  try { offers = await listOffers(); } catch (e: any) { console.error("listOffers err", e?.message); }

  const plansByLead = new Map<string, any[]>();
  for (const p of plans) { const a = plansByLead.get(p.leadId) ?? []; a.push(p); plansByLead.set(p.leadId, a); }
  const offersByLead = new Map<string, any[]>();
  for (const o of offers) { const a = offersByLead.get(o.leadId) ?? []; a.push(o); offersByLead.set(o.leadId, a); }

  console.log(`==== LEAD INVENTORY (${leads.length} leads) ====`);
  const byVerdict: Record<string, number> = {};
  const research: any[] = [];
  for (const l of leads as any[]) {
    const v = verdictOf(l.note);
    const key = v ?? "(none)";
    byVerdict[key] = (byVerdict[key] ?? 0) + 1;
    const lp = plansByLead.get(l.id) ?? [];
    const lo = offersByLead.get(l.id) ?? [];
    const planStates = lp.map((p) => `${p.approvalStatus}/${p.status}`).join(",") || "-";
    const offerStates = lo.map((o) => `${o.outreachState ?? "?"}${o.purchasedAt ? "+purchased" : ""}`).join(",") || "-";
    const line = `[${key}] ${l.id} "${l.businessName}" (${l.city},${l.state}) ${l.industry ?? "?"} | stage=${l.pipelineStage ?? "?"} | email=${l.publicEmail ?? "-"} form=${l.contactFormUrl ?? "-"} phone=${l.phone ?? "-"} | plans=${planStates} offers=${offerStates} | site=${l.website ?? "-"}`;
    // Research set = OBSERVED / NEEDS_MORE_EVIDENCE / anything not terminal-rejected, not a customer.
    if (v && v !== "DISPROVEN" && v !== "NO_MATERIAL_PROBLEM") research.push({ l, v, line });
    console.log(line);
  }

  console.log(`\n==== VERDICT COUNTS ====`);
  console.log(JSON.stringify(byVerdict, null, 2));

  console.log(`\n==== RESEARCH SET (retest candidates: OBSERVED / NEEDS_MORE_EVIDENCE) ====`);
  for (const r of research) console.log("  " + r.line);
  console.log(`\nresearch retest candidates: ${research.length}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
