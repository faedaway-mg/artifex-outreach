// READ-ONLY reconciliation of the "being reanalyzed" bucket (mandate part 2). Reproduces the OLD detection
// (INCOMPLETE draft + template + failing narration gate — regardless of eligibility) to enumerate the
// companies that were shown as "being reanalyzed", then applies the CANONICAL selector to each and reports
// the corrected classification + count. Also prints the NEW snapshot counts. Writes nothing.
import { listLeads, allBusinessIntelligence, allEmailSends, isSuppressed, listAudit } from "../src/lib/repo";
import { isInternalLead } from "../src/lib/operators/assignment";
import { validEmail } from "../src/lib/acquisition/compliance";
import { listScheduledBindings } from "../src/lib/outreach/scheduled-batch";
import { listTemplateIds, loadTemplate } from "../src/lib/content-studio/store";
import { buildQuickReview } from "../src/lib/outreach/quick-review";
import { quickReviewApproved } from "../src/lib/outreach/review-approval";
import { gateNarration } from "../src/lib/content-studio/narration-quality-gate";
import { reanalysisEligibility, classifyPrep } from "../src/lib/outreach/reanalysis-eligibility";
import { PROSPECT_PACKAGE_ACTION } from "../src/lib/outreach/prospect-package-store";
import { buildCompanySnapshot } from "../src/lib/outreach/company-snapshot";

const TERMINAL = new Set(["Won", "Lost", "Disqualified", "Nurture"]);

async function main() {
  const [leads, bi, sends, bindings, audit, tidList] = await Promise.all([
    listLeads(), allBusinessIntelligence(), allEmailSends(), listScheduledBindings(), listAudit(5000), listTemplateIds().catch(() => [] as string[]),
  ]);
  const templateIds = new Set(tidList);
  const biByLead = new Map(bi.map((b) => [b.leadId, b]));
  const contacted = new Set(sends.filter((e) => e.leadId).map((e) => e.leadId as string));
  const scheduled = new Set(bindings.map((b) => b.leadId));
  const pkgByLead = new Map<string, any>();
  for (const a of audit as any[]) { if (a.action !== PROSPECT_PACKAGE_ACTION) continue; const pkg = a.meta?.pkg; if (pkg?.leadId && !pkgByLead.has(pkg.leadId)) pkgByLead.set(pkg.leadId, pkg); }

  const rows: string[] = [];
  let oldReanalyzing = 0, stillEligible = 0;
  const byClass: Record<string, number> = {};

  for (const lead of leads) {
    if (isInternalLead(lead) || TERMINAL.has(lead.pipelineStage)) continue;
    const pieceId = `client-${lead.id}`;
    const pkg = pkgByLead.get(lead.id);
    const hasTemplate = templateIds.has(pieceId);
    if (!pkg || pkg.state !== "INCOMPLETE" || !hasTemplate) continue; // only the section-4 path can be "reanalyzing"

    const profile = (biByLead.get(lead.id)?.profile as any)?.businessProfile ?? null;
    const review = buildQuickReview(lead, profile, null, { approved: await quickReviewApproved(lead.id) });
    const t = await loadTemplate(pieceId).catch(() => null);
    const evidence = ((biByLead.get(lead.id)?.profile as any)?.evidence) ?? [];
    const cta = evidence.find((e: any) => e.field === "primaryCTA")?.value;
    const verdict = gateNarration({ narration: t?.narration ?? [], finding: { key: String(review.findings?.[0]?.id ?? ""), observation: review.findings?.[0]?.observation ?? null }, domFacts: { primaryCta: cta != null ? String(cta) : null }, businessName: lead.businessName, url: lead.website, reviewCount: lead.reviewCount ?? null });
    if (verdict.ok) continue; // would be voiceover-ready, not reanalyzing

    // This lead WAS shown as "being reanalyzed" under the old rule.
    oldReanalyzing += 1;
    const suppressed = await isSuppressed({ email: lead.publicEmail, domain: lead.websiteDomain, phone: lead.phone });
    const elig = reanalysisEligibility({
      internal: false, pipelineStage: lead.pipelineStage, terminal: TERMINAL.has(lead.pipelineStage),
      contacted: contacted.has(lead.id), scheduled: scheduled.has(lead.id), suppressed,
      hasWebsite: !!lead.website, recipientValid: validEmail(lead.publicEmail), packageState: pkg.state,
    });
    const cls = classifyPrep(elig);
    byClass[cls] = (byClass[cls] ?? 0) + 1;
    if (elig.eligible) stillEligible += 1;
    rows.push(`  • ${lead.businessName} (${lead.id}) — gate=FAIL[${verdict.reasons.join(",")}] contacted=${contacted.has(lead.id)} scheduled=${scheduled.has(lead.id)} pkg=${pkg.state} → ${cls}`);
  }

  console.log("\n=== RECONCILE THE NINE (read-only) ===");
  console.log(`OLD 'being reanalyzed' (INCOMPLETE+template+failing gate): ${oldReanalyzing}`);
  console.log(rows.join("\n"));
  console.log(`\nCorrected reanalysis count (still ELIGIBLE per canonical selector): ${stillEligible}`);
  console.log("Reclassification tally:"); for (const [k, v] of Object.entries(byClass)) console.log(`  ${v} → ${k}`);

  const snap = await buildCompanySnapshot();
  console.log("\n=== NEW SNAPSHOT COUNTS (post-fix code) ===");
  console.log(JSON.stringify(snap.counts, null, 0));
  console.log("reanalyzing leads:", snap.reanalyzing.map((r) => r.business));
  process.exit(0);
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
