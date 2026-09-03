// Run the prospect-video preparation orchestrator against prod (writes pieces/frozen PDFs/draft packages;
// enqueues screenshots; NEVER sends). Bounded. Reports what became voiceover-ready.
import { prepareProspectVideoCandidates } from "../src/lib/content-studio/prepare-orchestrator";
async function main() {
  const max = Number(process.argv[2] ?? 20);
  const r = await prepareProspectVideoCandidates({ max });
  console.log(JSON.stringify({ considered: r.considered, prepared: r.prepared.length, skipped: r.skipped, errors: r.errors.length }, null, 0));
  for (const p of r.prepared) console.log("  PREPARED", p.business, "|", p.pieceId, "|", p.state);
  for (const e of r.errors.slice(0, 8)) console.log("  ERROR", e.leadId, "|", e.reason);
  process.exit(0);
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
