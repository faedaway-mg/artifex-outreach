// READ-ONLY prep/recapture candidate census (mandate part 4 honesty: report the real yield + funnel losses).
// Classifies the whole book by canonical eligibility, and for ELIGIBLE leads estimates whether current
// stored evidence would compose a gate-PASSING narration (→ voiceover-ready without recapture) vs. would
// need deep recapture (fresh crawl). Writes nothing.
import { listLeads, allBusinessIntelligence, allEmailSends, isSuppressed, listAudit } from "../src/lib/repo";
import { isInternalLead } from "../src/lib/operators/assignment";
import { validEmail } from "../src/lib/acquisition/compliance";
import { listScheduledBindings } from "../src/lib/outreach/scheduled-batch";
import { buildQuickReview, cachedBrand } from "../src/lib/outreach/quick-review";
import { quickReviewApproved } from "../src/lib/outreach/review-approval";
import { composeReviewNarration, buildBusinessTemplate } from "../src/lib/content-studio/client-video";
import { gateNarration } from "../src/lib/content-studio/narration-quality-gate";
import { reanalysisEligibility } from "../src/lib/outreach/reanalysis-eligibility";
import { PROSPECT_PACKAGE_ACTION } from "../src/lib/outreach/prospect-package-store";

const TERMINAL = new Set(["Won", "Lost", "Disqualified", "Nurture"]);

async function main() {
  const [leads, bi, sends, bindings, audit] = await Promise.all([
    listLeads(), allBusinessIntelligence(), allEmailSends(), listScheduledBindings(), listAudit(5000),
  ]);
  const biByLead = new Map(bi.map((b) => [b.leadId, b]));
  const contacted = new Set(sends.filter((e) => e.leadId).map((e) => e.leadId as string));
  const scheduled = new Set(bindings.map((b) => b.leadId));
  const pkgByLead = new Map<string, any>();
  for (const a of audit as any[]) { if (a.action !== PROSPECT_PACKAGE_ACTION) continue; const pkg = a.meta?.pkg; if (pkg?.leadId && !pkgByLead.has(pkg.leadId)) pkgByLead.set(pkg.leadId, pkg); }

  const ineligible: Record<string, number> = {};
  let eligible = 0, eligibleWithEvidence = 0, wouldPassNow = 0, wouldNeedRecapture = 0, noEvidence = 0;
  const passers: string[] = [];

  for (const lead of leads) {
    if (isInternalLead(lead) || lead.source === "internal-test") continue;
    const suppressed = await isSuppressed({ email: lead.publicEmail, domain: lead.websiteDomain, phone: lead.phone });
    const v = reanalysisEligibility({
      internal: false, pipelineStage: lead.pipelineStage, terminal: TERMINAL.has(lead.pipelineStage),
      contacted: contacted.has(lead.id), scheduled: scheduled.has(lead.id), suppressed,
      hasWebsite: !!lead.website, recipientValid: validEmail(lead.publicEmail), packageState: pkgByLead.get(lead.id)?.state ?? null,
    });
    if (!v.eligible) { ineligible[v.reason!] = (ineligible[v.reason!] ?? 0) + 1; continue; }
    eligible += 1;
    const profile = (biByLead.get(lead.id)?.profile as any)?.businessProfile ?? null;
    if (!profile) { noEvidence += 1; wouldNeedRecapture += 1; continue; }
    eligibleWithEvidence += 1;
    const review = buildQuickReview(lead, profile, cachedBrand(profile), { approved: await quickReviewApproved(lead.id) });
    if (review.status !== "SENDABLE" || !review.findings?.length) { wouldNeedRecapture += 1; continue; }
    const composed = composeReviewNarration(review, lead.industry ?? null);
    const { template } = buildBusinessTemplate(review, { leadId: lead.id, allowOverride: false, composedNarration: composed });
    if (!template) { wouldNeedRecapture += 1; continue; }
    const evidence = ((biByLead.get(lead.id)?.profile as any)?.evidence) ?? [];
    const cta = evidence.find((e: any) => e.field === "primaryCTA")?.value;
    const g = gateNarration({ narration: template.narration ?? [], finding: { key: String(review.findings[0]?.id ?? ""), observation: review.findings[0]?.observation ?? null }, domFacts: { primaryCta: cta != null ? String(cta) : null }, businessName: lead.businessName, url: lead.website, reviewCount: lead.reviewCount ?? null });
    if (g.ok) { wouldPassNow += 1; passers.push(lead.businessName); } else { wouldNeedRecapture += 1; }
  }

  console.log("\n=== PREP / RECAPTURE CANDIDATE CENSUS (read-only) ===");
  console.log(`Total non-internal leads: ${leads.filter((l) => !isInternalLead(l)).length}`);
  console.log(`ELIGIBLE (canonical selector): ${eligible}`);
  console.log(`  · eligible + has stored evidence: ${eligibleWithEvidence}`);
  console.log(`  · eligible + NO stored evidence (needs first crawl): ${noEvidence}`);
  console.log(`  · would PASS the narration gate from CURRENT evidence (→ voiceover-ready now): ${wouldPassNow}`);
  console.log(`  · would NEED deep recapture (thin/contradicted/failing): ${wouldNeedRecapture}`);
  if (passers.length) console.log(`    passers: ${passers.slice(0, 25).join(", ")}`);
  console.log("INELIGIBLE breakdown:");
  for (const [k, n] of Object.entries(ineligible).sort((a, b) => b[1] - a[1])) console.log(`  ${n} → ${k}`);
  process.exit(0);
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1); });
