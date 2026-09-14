// BALANCED FRESH DISCOVERY — §8 of the Problem-Reality Semantics Correction.
// Walks an EXPLICIT 4 pods × 4 categories × 2 businesses matrix so no single pod or
// category can saturate the budget (the prior category-outer harness only ever
// sampled greenville-sc). Categories span diverse, objectively testable problem
// families (booking / contact / quote / appointment), not just booking availability.
//
// MEASUREMENT ONLY: runs the ONE canonical qualifier (live counter-test) under the
// CORRECTED semantics. It NEVER writes a lead, NEVER promotes, NEVER contacts, NEVER
// sends. Prints verdict + the new dimensions (severity / mitigation / materiality /
// defect family) for every business.
if (process.env.DATABASE_PUBLIC_URL) process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
if (process.env.PROXY_DATABASE_URL) process.env.DATABASE_URL = process.env.PROXY_DATABASE_URL;
if ((process.env.DATABASE_URL ?? "").includes("railway.internal")) { console.error("refusing: internal DB host"); process.exit(1); }

import { FIRST_WAVE_PODS } from "../src/lib/geo/lead-sprint";
import { searchPlaces, placesMode } from "../src/lib/providers/places";
import { qualifyThroughFunnel } from "../src/lib/acquisition/qualification-funnel";
import { inlineRunner } from "../src/lib/problem-reality/runner";
import { listLeads } from "../src/lib/repo";

const PER_CELL = Number(process.env.PER_CELL ?? 2);
const TIMEOUT_MS = Number(process.env.CANDIDATE_TIMEOUT_MS ?? 75000);
// Four categories spanning distinct expected primary actions:
//   dentist→booking · law firm→contact · hvac contractor→quote · physical therapy→appointment/booking
const CATEGORIES = (process.env.CATEGORIES ?? "dentist,law firm,hvac contractor,physical therapy").split(",").map((s) => s.trim());
const CHAIN_RX = /\b(liberty tax|h&r block|express employment|jimmy john|subway|jackson hewitt|the ups store|great clips|anytime fitness|orangetheory|massage envy|european wax|snap fitness|planet fitness|servpro|molly maid|merry maids|franchise|mall|galleria|outlets?|plaza|marketplace)\b/i;

async function main() {
  const existing = await listLeads();
  const knownDomains = new Set(existing.map((l: any) => (l.websiteDomain || "").toLowerCase()).filter(Boolean));
  const knownNames = new Set(existing.map((l: any) => (l.normalizedName || l.businessName || "").toLowerCase()));
  const seen = new Set<string>();

  // One representative city per pod → even pod coverage.
  const podCity = FIRST_WAVE_PODS.map((p) => ({ pod: p.id, city: p.cities[0], state: p.states[0] }));

  const m: any = { tested: 0, PROVEN: 0, OBSERVED: 0, DISPROVEN: 0, NO_MATERIAL_PROBLEM: 0, NEEDS_MORE_EVIDENCE: 0, promoted: 0, materialFail: 0 };
  const cells: any[] = [];
  const proven: any[] = [];

  console.log(`==== BALANCED DISCOVERY (places=${placesMode()}) — MEASUREMENT ONLY, NO WRITES/SENDS ====`);
  console.log(`matrix: ${podCity.length} pods × ${CATEGORIES.length} categories × ${PER_CELL} each = ${podCity.length * CATEGORIES.length * PER_CELL} target\n`);

  for (const { pod, city, state } of podCity) {
    for (const cat of CATEGORIES) {
      let taken = 0;
      let places: any[] = [];
      try { const r = await searchPlaces({ category: cat, city, state } as any); places = (r as any)?.results ?? (r as any) ?? []; } catch { places = []; }
      for (const p of places) {
        if (taken >= PER_CELL) break;
        const nn = (p.businessName || "").toLowerCase();
        const dom = (p.websiteDomain || (p.website || "").replace(/^https?:\/\/(www\.)?/, "").split("/")[0] || "").toLowerCase();
        if (!p.businessName || seen.has(nn)) continue;
        if (CHAIN_RX.test(p.businessName) || (p.locationsCount ?? 0) > 1) continue;
        if (!p.website) continue;
        if ((dom && knownDomains.has(dom)) || knownNames.has(nn)) continue;
        seen.add(nn);
        taken++;

        const cand = { id: p.googlePlaceId || `bd_${nn.replace(/\W+/g, "").slice(0, 12)}`, businessName: p.businessName, industry: cat, city: p.city ?? city, state: p.state ?? state, website: p.website, businessStatus: p.businessStatus ?? "OPERATIONAL", locationsCount: p.locationsCount ?? null, normalizedName: nn } as any;
        let fr: any;
        try {
          fr = await Promise.race([
            qualifyThroughFunnel(cand, inlineRunner),
            new Promise((res) => setTimeout(() => res({ decision: "reject", stageReached: "counter-test", verdict: "NEEDS_MORE_EVIDENCE", reason: "timeout" }), TIMEOUT_MS)),
          ]);
        } catch (e: any) { fr = { decision: "reject", stageReached: "counter-test", verdict: "NEEDS_MORE_EVIDENCE", reason: `err ${e?.message}` }; }

        if (fr.stageReached === "counter-test") { m.tested++; const v = fr.verdict ?? "NEEDS_MORE_EVIDENCE"; m[v] = (m[v] ?? 0) + 1; }
        if (fr.decision === "promote") m.promoted++;
        const ex = fr.execution ?? {};
        const dims = fr.verdict === "PROVEN" ? ` sev=${ex.severity ?? fr.severity ?? "?"} mit=${ex.mitigation ?? fr.mitigation ?? "?"} mat=${ex.materiality ?? fr.materiality ?? "?"} defect=${ex.defect?.family ?? "?"}` : "";
        if (fr.verdict === "PROVEN" && (ex.materiality ?? fr.materiality) === "FAIL") m.materialFail++;
        const mark = fr.decision === "promote" ? "✅" : "·";
        console.log(`  [${mark} ${fr.verdict ?? fr.stageReached}]${dims} ${p.businessName} (${cand.city},${state}) ${cat}`);
        cells.push({ pod, cat, name: p.businessName, verdict: fr.verdict, decision: fr.decision, severity: ex.severity, mitigation: ex.mitigation, materiality: ex.materiality, defect: ex.defect?.family, url: cand.website });
        if (fr.verdict === "PROVEN") proven.push({ pod, cat, name: p.businessName, materiality: ex.materiality, mitigation: ex.mitigation, severity: ex.severity, defect: ex.defect?.detail, url: cand.website });
      }
      console.log(`   — ${pod}/${cat}: ${taken} tested`);
    }
  }

  console.log(`\n==== MATRIX RESULT ====`);
  console.log(`tested=${m.tested} · PROVEN=${m.PROVEN} (materialFail=${m.materialFail}) OBSERVED=${m.OBSERVED} DISPROVEN=${m.DISPROVEN} NO_MATERIAL=${m.NO_MATERIAL_PROBLEM} NEEDS_MORE=${m.NEEDS_MORE_EVIDENCE} · promoted(material PROVEN)=${m.promoted}`);
  console.log(`\n==== PROVEN DETAIL ====`);
  for (const x of proven) console.log("  " + JSON.stringify(x));
  console.log(`\n(machine-cells)`, JSON.stringify(cells));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
