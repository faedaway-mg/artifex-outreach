// READ-ONLY: find a TEST-OWNED lead with an evidence-ready prospect (client-) video piece for the canary.
import { studioSnapshot } from "../src/lib/content-studio/store";
import { listLeads } from "../src/lib/repo";
import { isInternalLead } from "../src/lib/operators/assignment";

async function main() {
  const [snap, leads] = await Promise.all([studioSnapshot(), listLeads()]);
  const internal = new Set(leads.filter(isInternalLead).map((l) => l.id));
  const byId = new Map(leads.map((l) => [l.id, l]));
  console.log("internal/test leads:", internal.size);
  const clientPieces = snap.filter((s) => s.piece.id.startsWith("client-"));
  console.log("total client pieces:", clientPieces.length);
  for (const s of clientPieces) {
    const leadId = s.piece.id.replace("client-", "");
    const lead = byId.get(leadId);
    const testOwned = internal.has(leadId) || lead?.source === "internal-test" || /test/i.test(lead?.businessName ?? "");
    if (!testOwned) continue;
    console.log("  TEST piece:", s.piece.id, "| business:", lead?.businessName, "| source:", lead?.source, "| evidenceState:", (s.piece as any).evidenceState, "| screenshotReady:", (s.piece as any).screenshotReady, "| renderable:", (s.piece as any).renderable, "| uploads:", s.uploads.length, "| jobs:", s.jobs.length);
  }
  // Also: which internal leads exist + have a website (candidates to prepare a fresh piece)?
  console.log("\ninternal leads w/ website (prepare candidates):");
  for (const l of leads.filter((l) => internal.has(l.id) || l.source === "internal-test")) {
    console.log("  ", l.id, "|", l.businessName, "| site:", l.website ?? "none", "| stage:", l.pipelineStage);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
