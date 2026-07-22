/**
 * Production backfill: recompute persisted lead intelligence with the current
 * engine so existing leads reflect the deployed logic.
 *
 * What it does (idempotent, no outbound email, no external sends):
 *   1. Business Intelligence profile — regenerated + upserted for every real
 *      lead (deterministic; AI in prod is mocked). Upsert = safe to re-run.
 *   2. Deliverables — for DRAFT briefs only, the content is regenerated and the
 *      explainable investment model + QC report are refreshed, updated IN PLACE
 *      (same deliverable id, preserves created_at/history). Approved/sent
 *      deliverables are never touched.
 *
 * It never inserts duplicate deliverables and never sends outreach. Internal
 * test leads are skipped.
 *
 * Run against production via the public DB proxy in .env.local, matching prod
 * providers exactly:
 *   AI_PROVIDER=mock STORAGE_PROVIDER=mock pnpm exec tsx scripts/backfill-intelligence.ts
 * Add `--dry` to report intended work without writing.
 */
import "./loadEnv";
import { listLeads, findingsForLead, screenshotsForLead, deliverablesForLead, updateDeliverable, getSettings } from "../src/lib/repo";
import { generateAndStoreBI } from "../src/lib/intelligence-actions";
import { generateBrief } from "../src/lib/providers/ai";
import { runQcWithRepair } from "../src/lib/qc/pipeline";
import type { QcContext } from "../src/lib/qc/pipeline";

const DRY = process.argv.includes("--dry");

function isInternal(lead: { industry?: string | null; normalizedCategory?: string | null; categoryGroup?: string | null }): boolean {
  const v = `${lead.industry ?? ""} ${lead.normalizedCategory ?? ""} ${lead.categoryGroup ?? ""}`.toLowerCase();
  return v.includes("internal");
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set — refusing to run.");
  const settings = await getSettings();
  const leads = await listLeads();
  const real = leads.filter((l) => !isInternal(l as any));
  console.log(`Leads total=${leads.length} real=${real.length} internal-skipped=${leads.length - real.length} dry=${DRY}`);

  let biOk = 0, briefOk = 0, briefSkipped = 0;

  for (const lead of real) {
    // 1) Business Intelligence — idempotent upsert.
    if (DRY) {
      console.log(`[BI]   would regenerate  ${lead.id}  ${lead.businessName}`);
    } else {
      const stored = await generateAndStoreBI(lead);
      biOk++;
      console.log(`[BI]   ok conf=${stored.profile ? (stored as any).evidenceConfidence ?? "?" : "?"}  ${lead.id}  ${lead.businessName}`);
    }

    // 2) Deliverables — regenerate DRAFT briefs in place.
    const delivs = await deliverablesForLead(lead.id);
    for (const d of delivs) {
      if (d.status !== "draft") {
        briefSkipped++;
        console.log(`[BRIEF] skip status=${d.status}  ${d.id}  ${lead.businessName}`);
        continue;
      }
      if (DRY) {
        console.log(`[BRIEF] would regenerate  ${d.id}  ${lead.businessName}`);
        continue;
      }
      const service = lead.recommendedService ?? "Launch Website";
      const findings = await findingsForLead(lead.id);
      const { content, meta } = await generateBrief(lead, findings, settings, d.type, service as any, false);
      const screenshots = await screenshotsForLead(lead.id);
      const ctx: QcContext = { lead, settings, type: d.type, screenshots };
      const { content: qcedContent, report } = runQcWithRepair(content, ctx);
      const qc = { ...report, ranAt: new Date().toISOString() };
      // Reset any stale rendered PDF so the next fetch re-renders from new content.
      await updateDeliverable(d.id, { content: qcedContent, qc, aiMeta: meta, pdfKey: null, pdfUrl: null } as any);
      briefOk++;
      console.log(`[BRIEF] ok qcPassed=${report.passed} qcScore=${report.score}  ${d.id}  ${lead.businessName}`);
    }
  }

  console.log(`\nDone. BI regenerated=${biOk}  briefs regenerated=${briefOk}  briefs skipped(non-draft)=${briefSkipped}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
