"use server";
// ─────────────────────────────────────────────────────────────────────────────
// Real review-and-send for the v2 introduction.
//
// This is NOT a parallel sender. It reuses the existing production pipeline:
//   prepareAcquisitionPlanAction → inject the approved v2 email into the step →
//   approvePlanAction (compliance + scheduling) → dispatchStep (real Resend send,
//   idempotent via the email_sends ledger, provider-acceptance-gated).
// A step is never marked sent unless the provider accepts it. Repeated clicks,
// refreshes, and retries collapse onto one send by the ledger's step-key idempotency.
// ─────────────────────────────────────────────────────────────────────────────
import { getLead, getBusinessIntelligence, getSettings, contactsForLead, plansForLead, stepsForPlan, getPlan, updateStep } from "../repo";
import { prepareAcquisitionPlanAction, approvePlanAction } from "../acquisition-actions";
import { dispatchStep } from "../comms/dispatch";
import { buildOutreachKit } from "./kit";
import { renderEmailHtml, renderEmailText } from "./email-render";
import type { VeedVideo, IntroSendResult } from "./types";

export async function sendIntroductionAction(leadId: string, veed?: VeedVideo | null): Promise<IntroSendResult> {
  const lead = await getLead(leadId);
  if (!lead) return { outcome: "blocked", reason: "Lead not found." };
  if (!lead.publicEmail) return { outcome: "blocked", reason: "No email address on file — use the phone guide to find a route first." };

  const stored = await getBusinessIntelligence(leadId);
  const profile = stored?.profile?.businessProfile ?? null;
  if (!profile) return { outcome: "blocked", reason: "No Business Technology Review yet — generate it before sending." };

  const [settings, contacts] = await Promise.all([getSettings(), contactsForLead(leadId)]);
  const kit = buildOutreachKit({ lead, profile, settings, contacts });

  // Render the exact approved version. The {{unsubscribe}} token is replaced by
  // dispatch, keeping the compliance/unsubscribe path unchanged.
  const renderInput = { email: kit.email, settings, veed: veed ?? null, unsubscribeUrl: "{{unsubscribe}}" as string | null };
  const html = renderEmailHtml(renderInput);
  const text = renderEmailText(renderInput);

  // Reuse the real plan/step pipeline. prepareAcquisitionPlanAction is idempotent.
  await prepareAcquisitionPlanAction(leadId);
  const plans = await plansForLead(leadId);
  const plan = plans.find((p) => p.status === "prepared" || p.status === "active") ?? plans[0];
  if (!plan) return { outcome: "failed", reason: "Could not prepare an outreach plan." };

  const steps = await stepsForPlan(plan.id);
  const step = steps.find((s) => s.channel === "email" && !s.sentAt) ?? steps[0];
  if (!step) return { outcome: "failed", reason: "No email step to send." };

  // Store the exact approved version on the step (subject + plaintext + HTML).
  await updateStep(step.id, { subject: kit.email.subject, content: text, html });

  // Approve through the real compliance gate, then dispatch immediately.
  await approvePlanAction(plan.id);
  const approved = await getPlan(plan.id);
  if (!approved || approved.approvalStatus !== "approved") {
    return { outcome: "blocked", reason: approved?.pauseReason || approved?.stopReason || "Held by the compliance gate before sending.", stepId: step.id };
  }

  const res = await dispatchStep(step.id);
  switch (res.outcome) {
    case "sent":
    case "deduped":
      return { outcome: "sent", providerMessageId: res.providerMessageId ?? null, stepId: step.id };
    case "skipped":
      // Provider disabled → safely queued (nothing lost); suppression → blocked.
      return /suppress/i.test(res.reason ?? "")
        ? { outcome: "blocked", reason: res.reason, stepId: step.id }
        : { outcome: "queued", reason: res.reason ?? "Queued — will send when the provider is available.", stepId: step.id };
    case "retry":
      return { outcome: "queued", reason: res.reason ?? "Temporarily deferred; it will retry automatically.", stepId: step.id };
    case "failed":
    default:
      return { outcome: "failed", reason: res.reason ?? "The provider rejected the message.", stepId: step.id };
  }
}
