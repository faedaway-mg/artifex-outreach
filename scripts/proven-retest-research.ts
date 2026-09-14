// PROVEN-DEPTH YIELD PASS — STEP 1: deep live counter-test of the EXISTING research set.
// Read-only measurement (NO writes, NO promotion, NO contact). Runs each research lead
// through the ONE canonical qualifier (live Playwright counter-test) and records the
// verdict + auditable evidence. We do NOT inherit the prior OBSERVED as proof; we try to
// FALSIFY. 2-pass budget: pass 1 standard; pass 2 only if pass 1 is NEEDS_MORE_EVIDENCE
// (a concrete unresolved hypothesis). Whatever survives is the truth.
if (process.env.DATABASE_PUBLIC_URL) process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
if (process.env.PROXY_DATABASE_URL) process.env.DATABASE_URL = process.env.PROXY_DATABASE_URL;
if ((process.env.DATABASE_URL ?? "").includes("railway.internal")) { console.error("refusing: internal DB host"); process.exit(1); }

import { listLeads } from "../src/lib/repo";
import { qualifyThroughFunnel } from "../src/lib/acquisition/qualification-funnel";
import { inlineRunner } from "../src/lib/problem-reality/runner";

const verdictOf = (note?: string | null) => (note ?? "").match(/problem-reality:\s*([A-Z_]+)/i)?.[1]?.toUpperCase() ?? null;

async function testOnce(cand: any) {
  return qualifyThroughFunnel(cand, inlineRunner);
}

async function main() {
  const leads = (await listLeads()) as any[];
  // The research set: any lead carrying a non-terminal problem-reality verdict
  // (OBSERVED / NEEDS_MORE_EVIDENCE). Today that is the 4 reclassified dentists.
  const research = leads.filter((l) => { const v = verdictOf(l.note); return v && v !== "DISPROVEN" && v !== "NO_MATERIAL_PROBLEM"; });
  console.log(`==== DEEP RE-TEST: existing research set (${research.length}) ====\n`);

  const results: any[] = [];
  for (const l of research) {
    const cand = { id: l.id, businessName: l.businessName, industry: l.industry ?? "dentist", city: l.city, state: l.state, website: l.website, businessStatus: l.businessStatus ?? "OPERATIONAL", locationsCount: l.locationsCount ?? null, normalizedName: l.normalizedName ?? (l.businessName ?? "").toLowerCase() };
    const prior = verdictOf(l.note);
    console.log(`── ${l.businessName} (${l.city},${l.state}) — prior=${prior}\n   site: ${l.website}`);

    let fr = await testOnce(cand);
    let passes = 1;
    if ((fr.verdict ?? "") === "NEEDS_MORE_EVIDENCE") {
      console.log(`   pass1 NEEDS_MORE_EVIDENCE → pass2 (focused re-verification)`);
      fr = await testOnce(cand);
      passes = 2;
    }

    const ex = fr.execution;
    console.log(`   → VERDICT: ${fr.verdict}  (decision=${fr.decision}, stage=${fr.stageReached}, passes=${passes})`);
    if (fr.verdict === "PROVEN") console.log(`   dimensions: severity=${ex?.severity} mitigation=${ex?.mitigation} materiality=${ex?.materiality} defect=${ex?.defect?.family} — ${ex?.defect?.detail ?? ""}`);
    console.log(`   hypothesis: ${fr.hypothesis?.claim} [action=${fr.hypothesis?.primaryCustomerAction}]`);
    console.log(`   rationale: ${fr.reason}`);
    if (ex) {
      console.log(`   executed=${ex.executed} pagesVisited=${ex.pagesVisited?.length ?? 0}`);
      console.log(`   states: ${(ex.statesObserved ?? []).join(" | ")}`);
      console.log(`   alternates: ${(ex.alternatePathsFound ?? []).map((a: any) => `${a.kind}:${a.detail}`).join(" ; ") || "none"}`);
      const clicks = (ex.actionsAttempted ?? []).filter((a: any) => a.step === "click" || a.step === "goto" || a.step === "detect-widget");
      for (const c of clicks) console.log(`      · ${c.step}${c.viewport ? `[${c.viewport}]` : ""}: ${c.observation}`);
      if (ex.error) console.log(`   error: ${ex.error}`);
    }
    console.log("");
    results.push({ leadId: l.id, name: l.businessName, prior, verdict: fr.verdict, decision: fr.decision, passes, severity: ex?.severity, mitigation: ex?.mitigation, materiality: ex?.materiality, defect: ex?.defect?.family, rationale: fr.reason, url: l.website });
  }

  const tally: Record<string, number> = {};
  for (const r of results) tally[r.verdict ?? "?"] = (tally[r.verdict ?? "?"] ?? 0) + 1;
  console.log(`==== RE-TEST TALLY ====`);
  console.log(JSON.stringify(tally, null, 2));
  const proven = results.filter((r) => r.verdict === "PROVEN");
  console.log(`\nPROVEN from existing research: ${proven.length}`);
  for (const p of proven) console.log(`  ✅ ${p.name} — ${p.url}`);
  console.log(`\n(machine)`, JSON.stringify(results));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
