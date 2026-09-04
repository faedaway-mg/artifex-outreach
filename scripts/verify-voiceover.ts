// READ-ONLY verification: does the recovered prospect appear on the focused voiceover screen, and what is
// its final narration? Prints snapshot counts + every needsVoiceover lead with its narration. Writes nothing.
import { buildCompanySnapshot } from "../src/lib/outreach/company-snapshot";
import { loadTemplate } from "../src/lib/content-studio/store";
import { readAllRecaptureStates } from "../src/lib/content-studio/recapture-state";

async function main() {
  const snap = await buildCompanySnapshot();
  console.log("SNAPSHOT COUNTS:", JSON.stringify(snap.counts));
  console.log(`focusQueueIds[0..3]: ${snap.focusQueueIds.slice(0, 3).join(", ")}`);
  console.log("\nVOICEOVERS READY:");
  for (const r of snap.needsVoiceover) {
    const t = await loadTemplate(`client-${r.leadId}`).catch(() => null);
    console.log(`\n• ${r.business} (${r.leadId})`);
    console.log(`  finding: ${r.finding ?? "—"}`);
    console.log(`  narration (${(t?.narration ?? []).join(" ").split(/\s+/).filter(Boolean).length}w):`);
    for (const line of t?.narration ?? []) console.log(`    ${line}`);
  }
  const states = await readAllRecaptureStates();
  const tally: Record<string, number> = {};
  for (const s of states.values()) tally[s.lastOutcome ?? "?"] = (tally[s.lastOutcome ?? "?"] ?? 0) + 1;
  console.log("\nRECAPTURE STATE TALLY:", JSON.stringify(tally));
  process.exit(0);
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
