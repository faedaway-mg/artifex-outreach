import { allPlans, getLead, stepsForPlan, getSettings, isSuppressed, listLeads, findingsForLead, deliverablesForLead, previewsForLead, videosForLead, contactsForLead } from "@/lib/repo";
import { checkPlanCompliance } from "@/lib/acquisition/compliance";
import { policyFor, ASSISTED_BATCH_MAX } from "@/lib/acquisition/policy";
import { assetReadiness } from "@/lib/acquisition/assets";
import { contactConfidence, websiteHealthSummary, modernizationHighlights, riskFlags } from "@/lib/acquisition/summary";
import { ApprovalCenter, type ApprovalItem } from "@/components/ApprovalCenter";
import { formatRange } from "@/lib/utils";
import type { Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const [plans, settings, leads] = await Promise.all([allPlans(), getSettings(), listLeads()]);
  const leadMap = new Map<string, Lead>(leads.map((l) => [l.id, l]));
  const pending = plans.filter((p) => p.approvalStatus === "pending");

  const items: ApprovalItem[] = [];
  for (const plan of pending) {
    const lead = leadMap.get(plan.leadId) ?? (await getLead(plan.leadId));
    if (!lead) continue;
    const [steps, findings, deliverables, previews, videos, contacts] = await Promise.all([
      stepsForPlan(plan.id), findingsForLead(lead.id), deliverablesForLead(lead.id), previewsForLead(lead.id), videosForLead(lead.id), contactsForLead(lead.id),
    ]);
    const suppressed = await isSuppressed({ email: lead.publicEmail, domain: lead.websiteDomain, phone: lead.phone });
    const compliance = checkPlanCompliance(lead, plan, steps, settings, { suppressed });
    const readiness = assetReadiness(plan.strategy, {
      brief: deliverables.some((d) => d.status !== "draft"),
      concept: previews.some((p) => p.status !== "Not Started" && p.status !== "Archived"),
      video: videos.some((v) => v.videoUrl),
      research: findings.some((f) => f.approved) || Boolean(lead.opportunitySummary),
    });
    const cc = contactConfidence(lead, contacts.length);

    items.push({
      planId: plan.id, leadId: lead.id, businessName: lead.businessName, strategy: plan.strategy,
      estValue: formatRange(lead.estimatedValueLow, lead.estimatedValueHigh),
      opportunitySummary: lead.opportunitySummary ?? "Not yet analyzed.",
      websiteHealth: websiteHealthSummary(lead, findings), highlights: modernizationHighlights(findings),
      contactConfidence: cc, reason: lead.acquisitionReason ?? plan.objective,
      contactEmail: lead.publicEmail, channel: plan.primaryChannel, cost: plan.estimatedCost,
      assetPackage: plan.assetPackage, assetReady: readiness.ready, assetMissing: readiness.missing,
      sequence: steps.map((s) => ({ stepNumber: s.stepNumber, delayDays: s.delayDays, subject: s.subject, body: s.content })),
      compliance: { ok: compliance.ok, blockers: compliance.blockers, warnings: compliance.warnings },
      riskFlags: riskFlags(lead, suppressed), suppressed, canBatch: !policyFor(plan.strategy).requiresIndividualApproval,
    });
  }
  items.sort((a, b) => (a.strategy === "Personal" ? -1 : 1) - (b.strategy === "Personal" ? -1 : 1));

  return (
    <div className="space-y-6">
      <div>
        <p className="label">Approval Center</p>
        <h1 className="mt-1 text-2xl font-semibold text-chalk-50">Acquisition command center</h1>
        <p className="mt-1 text-sm text-chalk-400">Everything you need to approve confidently in seconds. Personal is individual-only; Assisted/Light can batch. Compliance gates block unsafe sends.</p>
      </div>
      <ApprovalCenter items={items} batchMax={ASSISTED_BATCH_MAX} />
    </div>
  );
}
