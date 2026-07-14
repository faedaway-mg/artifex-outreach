"use server";
// ─────────────────────────────────────────────────────────────────────────────
// Tiered acquisition — server actions. Strategy assignment, plan preparation, and
// APPROVAL with compliance gates. No email is sent here (sending is deferred to a
// wired Resend adapter). Personal plans cannot be batch-approved.
// ─────────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import {
  getLead, updateLead, findingsForLead, getSettings, isSuppressed, addSuppression,
  plansForLead, getPlan, insertPlan, updatePlan, stepsForPlan, insertStep, updateStep, appendAudit,
} from "./repo";
import { computeAcquisitionStrategy } from "./acquisition/strategy";
import { policyFor, ASSISTED_BATCH_MAX } from "./acquisition/policy";
import { buildSequence } from "./acquisition/sequences";
import { checkPlanCompliance } from "./acquisition/compliance";
import { stopPlansForLead } from "./acquisition/stop";
import type { AcquisitionStrategy } from "./types";

async function audit(action: string, targetId: string, meta?: Record<string, unknown>) {
  let ip: string | null = null;
  try { ip = headers().get("x-forwarded-for")?.split(",")[0]?.trim() ?? null; } catch {}
  await appendAudit({ action, actor: "jordan", targetType: "acquisition", targetId, meta: meta ?? null, ip });
}
const touch = (leadId: string) => { revalidatePath(`/leads/${leadId}`); revalidatePath("/approvals"); revalidatePath("/"); };

async function suppressedFor(lead: { publicEmail: string | null; websiteDomain: string | null; phone: string | null }): Promise<boolean> {
  return isSuppressed({ email: lead.publicEmail, domain: lead.websiteDomain, phone: lead.phone });
}

export async function assignStrategyAction(leadId: string): Promise<void> {
  const lead = await getLead(leadId);
  if (!lead) return;
  const suppressed = await suppressedFor(lead);
  const hasApprovedFindings = (await findingsForLead(leadId)).some((f) => f.approved);
  const r = computeAcquisitionStrategy(lead, { suppressed, optedOut: suppressed, hasApprovedFindings });
  await updateLead(leadId, { acquisitionStrategy: r.strategy, acquisitionScore: r.score, acquisitionReason: r.reason, acquisitionScoreBreakdown: r.breakdown, acquisitionOverride: false });
  await audit("acq.assign_strategy", leadId, { strategy: r.strategy, score: r.score });
  touch(leadId);
}

export async function overrideStrategyAction(leadId: string, strategy: AcquisitionStrategy, reason: string): Promise<void> {
  const lead = await getLead(leadId);
  if (!lead) return;
  const original = lead.acquisitionStrategy;
  await updateLead(leadId, { acquisitionStrategy: strategy, acquisitionOverride: true, acquisitionReason: `Override: ${reason || "Jordan's judgment"} (was ${original ?? "unset"}).` });
  await audit("acq.override_strategy", leadId, { original, override: strategy, reason, user: "jordan", at: new Date().toISOString() });
  touch(leadId);
}

export async function prepareAcquisitionPlanAction(leadId: string): Promise<void> {
  const lead = await getLead(leadId);
  if (!lead || !lead.acquisitionStrategy) return;
  const strategy = lead.acquisitionStrategy;
  const policy = policyFor(strategy);
  const settings = await getSettings();

  // Manual Review / Do Not Contact: a tracking plan with no channel + no steps.
  const observation = lead.opportunitySummary ?? (await findingsForLead(leadId)).find((f) => f.approved)?.modernizationDirection ?? "there are a few clear opportunities to modernize the customer experience.";
  const plan = await insertPlan({
    leadId, strategy, objective: policy.objective, assetPackage: policy.assetPackage,
    primaryChannel: policy.primaryChannel, secondaryChannel: policy.secondaryChannel,
    status: "prepared", approvalStatus: policy.automated ? "pending" : "draft",
    currentStep: 0, maxTouches: policy.maxTouches, nextScheduledAt: null, replyState: null,
    approvedBy: null, approvedAt: null, startedAt: null, pausedAt: null, completedAt: null,
    pauseReason: null, stopReason: null, estimatedCost: policy.estimatedCost, owner: "jordan",
  });
  if (policy.automated) {
    for (const s of buildSequence(strategy, lead, settings, observation)) {
      await insertStep({ planId: plan.id, stepNumber: s.stepNumber, channel: s.channel, delayDays: s.delayDays, subject: s.subject, content: s.content, approvalRequired: s.approvalRequired, approvalStatus: "pending", scheduledAt: null, sentAt: null, providerMessageId: null, deliveryStatus: null, stoppedAt: null, stopReason: null });
    }
  }
  await audit("acq.prepare_plan", plan.id, { leadId, strategy, steps: policy.maxTouches, estimatedCost: policy.estimatedCost });
  touch(leadId);
}

async function tryApprove(planId: string): Promise<{ ok: boolean; blockers: string[] }> {
  const plan = await getPlan(planId);
  if (!plan) return { ok: false, blockers: ["plan not found"] };
  const lead = await getLead(plan.leadId);
  if (!lead) return { ok: false, blockers: ["lead not found"] };
  const steps = await stepsForPlan(planId);
  const settings = await getSettings();
  const suppressed = await suppressedFor(lead);
  const compliance = checkPlanCompliance(lead, plan, steps, settings, { suppressed });
  if (!compliance.ok) return { ok: false, blockers: compliance.blockers };

  const now = new Date();
  await updatePlan(planId, { approvalStatus: "approved", approvedBy: "jordan", approvedAt: now.toISOString(), status: "active", currentStep: 1, startedAt: now.toISOString() });
  // Schedule (do NOT send) each step relative to now; approve step gate.
  for (const step of steps) {
    const when = new Date(now.getTime() + step.delayDays * 86_400_000).toISOString();
    await updateStep(step.id, { approvalStatus: "approved", scheduledAt: when });
  }
  const first = steps[0];
  if (first) await updatePlan(planId, { nextScheduledAt: first.scheduledAt ?? now.toISOString() });
  return { ok: true, blockers: [] };
}

export async function approvePlanAction(planId: string): Promise<void> {
  const plan = await getPlan(planId);
  if (!plan) return;
  const r = await tryApprove(planId);
  await audit(r.ok ? "acq.plan_approved" : "acq.plan_approve_blocked", planId, { blockers: r.blockers });
  touch(plan.leadId);
}

export async function approveBatchAction(planIds: string[]): Promise<void> {
  let approved = 0;
  for (const id of planIds.slice(0, ASSISTED_BATCH_MAX)) {
    const plan = await getPlan(id);
    if (!plan) continue;
    if (policyFor(plan.strategy).requiresIndividualApproval) continue; // Personal/Manual/DNC never batch
    const r = await tryApprove(id);
    if (r.ok) approved += 1;
  }
  await audit("acq.batch_approved", "batch", { requested: planIds.length, approved, cap: ASSISTED_BATCH_MAX });
  revalidatePath("/approvals");
  revalidatePath("/");
}

export async function holdPlanAction(planId: string): Promise<void> {
  const plan = await getPlan(planId);
  if (!plan) return;
  await updatePlan(planId, { approvalStatus: "held" });
  await audit("acq.plan_held", planId);
  touch(plan.leadId);
}
export async function rejectPlanAction(planId: string): Promise<void> {
  const plan = await getPlan(planId);
  if (!plan) return;
  await updatePlan(planId, { approvalStatus: "rejected", status: "stopped", stopReason: "Rejected by Jordan" });
  await audit("acq.plan_rejected", planId);
  touch(plan.leadId);
}

export async function markDoNotContactAction(leadId: string): Promise<void> {
  const lead = await getLead(leadId);
  if (!lead) return;
  await updateLead(leadId, { acquisitionStrategy: "Do Not Contact", acquisitionOverride: true });
  await stopPlansForLead(leadId, "Marked Do Not Contact");
  await addSuppression({ email: lead.publicEmail, domain: lead.websiteDomain, phone: lead.phone, reason: "Do Not Contact" });
  await audit("acq.do_not_contact", leadId);
  touch(leadId);
}

export async function promoteStrategyAction(leadId: string, toStrategy: AcquisitionStrategy): Promise<void> {
  const lead = await getLead(leadId);
  if (!lead) return;
  await updateLead(leadId, { acquisitionStrategy: toStrategy, acquisitionOverride: true, acquisitionReason: `Promoted to ${toStrategy} on engagement (Jordan approved).` });
  await audit("acq.promote", leadId, { from: lead.acquisitionStrategy, to: toStrategy });
  touch(leadId);
}
