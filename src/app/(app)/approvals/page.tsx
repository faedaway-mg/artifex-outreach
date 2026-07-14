import { allPlans, getLead, stepsForPlan, getSettings, isSuppressed, listLeads } from "@/lib/repo";
import { checkPlanCompliance } from "@/lib/acquisition/compliance";
import { policyFor, ASSISTED_BATCH_MAX } from "@/lib/acquisition/policy";
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
    const steps = await stepsForPlan(plan.id);
    const suppressed = await isSuppressed({ email: lead.publicEmail, domain: lead.websiteDomain, phone: lead.phone });
    const compliance = checkPlanCompliance(lead, plan, steps, settings, { suppressed });
    const first = steps[0];
    items.push({
      planId: plan.id, leadId: lead.id, businessName: lead.businessName, strategy: plan.strategy,
      estValue: formatRange(lead.estimatedValueLow, lead.estimatedValueHigh), reason: lead.acquisitionReason ?? plan.objective,
      contactEmail: lead.publicEmail, channel: plan.primaryChannel, firstSubject: first?.subject ?? "—", firstBody: first?.content ?? "",
      steps: steps.length, cost: plan.estimatedCost, compliance: { ok: compliance.ok, blockers: compliance.blockers },
      suppressed, canBatch: !policyFor(plan.strategy).requiresIndividualApproval,
    });
  }
  // Personal first (need individual attention), then the rest by value.
  items.sort((a, b) => (a.strategy === "Personal" ? -1 : 1) - (b.strategy === "Personal" ? -1 : 1));

  return (
    <div className="space-y-6">
      <div>
        <p className="label">Approval Center</p>
        <h1 className="mt-1 text-2xl font-semibold text-chalk-50">Acquisition approvals</h1>
        <p className="mt-1 text-sm text-chalk-400">Review before anything is scheduled. Personal leads are individual-only; Assisted/Light can be approved in a small batch. Compliance gates block unsafe sends.</p>
      </div>
      <ApprovalCenter items={items} batchMax={ASSISTED_BATCH_MAX} />
    </div>
  );
}
