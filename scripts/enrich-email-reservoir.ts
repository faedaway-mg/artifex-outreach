/**
 * On-demand EMAIL-RESERVOIR fill (morning queue-readiness).
 *
 * Runs the EXISTING, tested website analysis (runWebsiteAnalysisAction →
 * analyzeWebsite → same-domain email harvest → promoteDiscoveredEmail) on
 * qualified leads that have a website but no email yet, flipping them from
 * cold-call-first to email-first so the 10/day email queue can fill.
 *
 * This is the manual equivalent of the materialize cron's EMAIL_PREP branch,
 * for immediate use. It REUSES prepareEmailInventory (no new logic).
 *
 *   READ-ONLY crawl of public pages. Never contacts anyone. Sends nothing.
 *
 * PRECONDITION: migration 0020 (business_intelligence.surface_package) must be
 * applied first — the BI upsert writes that column. Run db:migrate before this.
 *
 * Usage:
 *   pnpm exec tsx scripts/enrich-email-reservoir.ts            # dry-run (report only)
 *   pnpm exec tsx scripts/enrich-email-reservoir.ts --apply    # actually harvest (writes publicEmail)
 *   pnpm exec tsx scripts/enrich-email-reservoir.ts --apply --max 40
 */
import "./loadEnv";
import { listLeads, listAudit, getLead } from "../src/lib/repo";
import { prepareEmailInventory } from "../src/lib/outreach/inventory-prep";
import { isValidEmail } from "../src/lib/outreach/contact-strategy";
import { runWebsiteAnalysisAction } from "../src/lib/actions";

const APPLY = process.argv.includes("--apply");
const maxArg = process.argv.indexOf("--max");
const MAX = maxArg >= 0 ? Math.max(0, Number(process.argv[maxArg + 1] ?? 40)) : 40;

function isInternal(l: any): boolean {
  const v = `${l.industry ?? ""} ${l.normalizedCategory ?? ""} ${l.categoryGroup ?? ""}`.toLowerCase();
  return v.includes("internal");
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set — refusing to run.");
  const [leadsAll, audit] = await Promise.all([listLeads(), listAudit(5000)]);
  const leads = leadsAll.filter((l) => !isInternal(l));
  // Analyzed = derived from the audit log so this works even before migration 0020 lands
  // (the BI table's surface_package column would otherwise fail to read on an un-migrated DB).
  const ANALYZE_ACTIONS = new Set(["lead.analyze", "lead.bi_regenerate", "lead.email.harvest", "lead.email.discovered"]);
  const analyzedLeadIds = new Set(
    audit.filter((a) => ANALYZE_ACTIONS.has(a.action) && a.targetId).map((a) => a.targetId as string),
  );

  const TERMINAL = new Set(["Won", "Lost", "Disqualified"]);
  const eligible = leads.filter(
    (l) => !TERMINAL.has(l.pipelineStage) && (l as any).acquisitionStrategy !== "Do Not Contact" && !!l.website && !isValidEmail(l.publicEmail) && !analyzedLeadIds.has(l.id),
  );

  console.log(`Email-reservoir fill — ${APPLY ? "APPLY" : "DRY-RUN"} (max ${MAX})`);
  console.log(`  real leads: ${leads.length} · email-first now: ${leads.filter((l) => isValidEmail(l.publicEmail)).length}`);
  console.log(`  eligible (has site, no email, not analyzed): ${eligible.length}`);
  if (eligible.length) console.log(`  would examine: ${Math.min(eligible.length, MAX)}${eligible.length > MAX ? ` (capped; re-run for the rest)` : ""}`);

  if (!APPLY) {
    console.log("\nDry-run only. Re-run with --apply to harvest emails (read-only crawl, no sends).");
    console.log("NOTE: ensure migration 0020 is applied first (db:migrate).");
    return;
  }

  const summary = await prepareEmailInventory({
    leads,
    analyzedLeadIds,
    analyze: (id) => runWebsiteAnalysisAction(id),
    getEmailAfter: async (id) => (await getLead(id))?.publicEmail ?? null,
    max: MAX,
  });
  console.log(`\n✓ Analyzed ${summary.analyzed} · adopted same-domain email on ${summary.adoptedEmail} (${summary.analyzed ? Math.round((summary.adoptedEmail / summary.analyzed) * 100) : 0}% yield)`);
  console.log(`  Newly email-first leads now have a review-and-send task queued for operator approval.`);
  if (summary.capped) console.log(`  ${eligible.length - summary.analyzed} still eligible — re-run to continue.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
