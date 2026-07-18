import { allPlans, getSettings, listLeads, allSteps, allFindings, allDeliverables, allPreviews, allVideos, allContacts, buildSuppressionChecker, allBusinessIntelligence } from "@/lib/repo";
import { checkPlanCompliance } from "@/lib/acquisition/compliance";
import { policyFor, ASSISTED_BATCH_MAX } from "@/lib/acquisition/policy";
import { assetReadiness, ASSET_LABELS } from "@/lib/acquisition/assets";
import { contactConfidence, websiteHealthSummary, modernizationHighlights, riskFlags } from "@/lib/acquisition/summary";
import { ApprovalCenter, type ApprovalItem } from "@/components/ApprovalCenter";
import { formatRange } from "@/lib/utils";
import type { Lead, Finding, Deliverable, ConceptPreview, Video, Contact, AcquisitionStep, StoredBusinessIntelligence } from "@/lib/types";

// Map a stored BI profile into the Approval Center's reasoning shape.
function biFor(row: StoredBusinessIntelligence | undefined): ApprovalItem["bi"] {
  if (!row) return undefined;
  const p = row.profile;
  const b = p.briefing;
  return {
    whyItMatters: b.whyItMatters,
    treatment: p.improvement.treatment,
    improvementScore: p.improvement.score,
    evidenceConfidence: p.evidenceConfidence,
    bestAngle: b.bestOutreachAngle,
    recommendedEngagement: b.recommendedEngagement,
    topEvidence: p.snapshot.visibleFriction.filter((f) => f.safeForOutreach).slice(0, 3).map((f) => f.observation),
    uncertainty: b.greatestUncertainty,
    providers: p.providerCoverage.contributing,
    contradictions: p.contradictions.length,
  };
}

export const dynamic = "force-dynamic";

// Group a flat list by a key into a Map<key, T[]>, preserving order.
function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const arr = m.get(k);
    if (arr) arr.push(row);
    else m.set(k, [row]);
  }
  return m;
}

export default async function ApprovalsPage() {
  // Batch-load every dataset ONCE (constant number of queries regardless of how
  // many pending plans there are), then hydrate each card from in-memory maps.
  // This replaces the previous per-plan fan-out (N+1) and scales to thousands of
  // leads without repeated queries. Rendered output is identical.
  const [plans, settings, leads, steps, findings, deliverables, previews, videos, contacts, isSuppressed, biRows] = await Promise.all([
    allPlans(), getSettings(), listLeads(), allSteps(), allFindings(), allDeliverables(), allPreviews(), allVideos(), allContacts(), buildSuppressionChecker(), allBusinessIntelligence(),
  ]);

  const leadMap = new Map<string, Lead>(leads.map((l) => [l.id, l]));
  // Latest BI profile per lead.
  const biByLead = new Map<string, (typeof biRows)[number]>();
  for (const row of biRows) {
    const cur = biByLead.get(row.leadId);
    if (!cur || +new Date(row.generatedAt) > +new Date(cur.generatedAt)) biByLead.set(row.leadId, row);
  }
  const stepsByPlan = groupBy<AcquisitionStep>(steps, (s) => s.planId);
  const findingsByLead = groupBy<Finding>(findings, (f) => f.leadId);
  const deliverablesByLead = groupBy<Deliverable>(deliverables, (d) => d.leadId);
  const previewsByLead = groupBy<ConceptPreview>(previews, (p) => p.leadId);
  const videosByLead = groupBy<Video>(videos, (v) => v.leadId);
  const contactsByLead = groupBy<Contact>(contacts, (c) => c.leadId);

  const pending = plans.filter((p) => p.approvalStatus === "pending");

  const items: ApprovalItem[] = [];
  for (const plan of pending) {
    const lead = leadMap.get(plan.leadId);
    if (!lead) continue;
    const planSteps = (stepsByPlan.get(plan.id) ?? []).slice().sort((a, b) => a.stepNumber - b.stepNumber);
    const leadFindings = findingsByLead.get(lead.id) ?? [];
    const leadDeliverables = deliverablesByLead.get(lead.id) ?? [];
    const leadPreviews = previewsByLead.get(lead.id) ?? [];
    const leadVideos = videosByLead.get(lead.id) ?? [];
    const leadContacts = contactsByLead.get(lead.id) ?? [];

    const suppressed = isSuppressed({ email: lead.publicEmail, domain: lead.websiteDomain, phone: lead.phone });
    const compliance = checkPlanCompliance(lead, plan, planSteps, settings, { suppressed });
    const readiness = assetReadiness(plan.strategy, {
      brief: leadDeliverables.some((d) => d.status !== "draft"),
      concept: leadPreviews.some((p) => p.status !== "Not Started" && p.status !== "Archived"),
      video: leadVideos.some((v) => v.videoUrl),
      research: leadFindings.some((f) => f.approved) || Boolean(lead.opportunitySummary),
    });
    const cc = contactConfidence(lead, leadContacts.length);

    items.push({
      planId: plan.id, leadId: lead.id, businessName: lead.businessName, strategy: plan.strategy,
      estValue: formatRange(lead.estimatedValueLow, lead.estimatedValueHigh),
      opportunitySummary: lead.opportunitySummary ?? "Not yet analyzed.",
      websiteHealth: websiteHealthSummary(lead, leadFindings), highlights: modernizationHighlights(leadFindings),
      contactConfidence: cc, reason: lead.acquisitionReason ?? plan.objective,
      contactEmail: lead.publicEmail, channel: plan.primaryChannel, cost: plan.estimatedCost,
      assetPackage: plan.assetPackage, assetReady: readiness.ready, assetMissing: readiness.missing.map((a) => ASSET_LABELS[a]),
      sequence: planSteps.map((s) => ({ stepNumber: s.stepNumber, delayDays: s.delayDays, subject: s.subject, body: s.content })),
      compliance: { ok: compliance.ok, blockers: compliance.blockers, warnings: compliance.warnings },
      riskFlags: riskFlags(lead, suppressed), suppressed, canBatch: !policyFor(plan.strategy).requiresIndividualApproval,
      bi: biFor(biByLead.get(lead.id)),
    });
  }
  items.sort((a, b) => (a.strategy === "Personal" ? -1 : 1) - (b.strategy === "Personal" ? -1 : 1));

  return (
    <div className="space-y-6">
      <div>
        <p className="label">Recommendations</p>
        <h1 className="mt-1 text-2xl font-semibold text-chalk-50">Recommendations to confirm</h1>
        <p className="mt-1 text-sm text-chalk-400">What Artifex recommends for each business, with the reasoning behind it — confirm confidently in seconds. Personal outreach is individual-only; Assisted/Light can batch. Compliance gates block anything unsafe.</p>
      </div>
      <ApprovalCenter items={items} batchMax={ASSISTED_BATCH_MAX} />
    </div>
  );
}
