"use server";
// ─────────────────────────────────────────────────────────────────────────────
// Real review-and-send for the v2 introduction AND follow-up.
//
// NOT a parallel sender. Reuses the production pipeline:
//   prepareAcquisitionPlanAction → inject the approved v2 email into the step →
//   approvePlanAction (compliance + scheduling) → dispatchStep (real Resend,
//   idempotent via the email_sends ledger, provider-acceptance-gated, suppression
//   re-checked). A step is never marked sent unless the provider accepts it.
//
// Workflow-level guards complement the ledger's step-level idempotency: an intro
// is refused once one has been accepted; a follow-up is refused until the intro
// has been sent (and refused if already sent).
// ─────────────────────────────────────────────────────────────────────────────
import { getLead, getBusinessIntelligence, getSettings, contactsForLead, plansForLead, stepsForPlan, getPlan, updateStep, emailSendsForLead } from "../repo";
import { prepareAcquisitionPlanAction, approvePlanAction } from "../acquisition-actions";
import { dispatchStep } from "../comms/dispatch";
import { buildOutreachKit } from "./kit";
import { renderEmailHtml, renderEmailText } from "./email-render";
import type { VeedVideo, IntroSendResult } from "./types";

async function sendNext(leadId: string, mode: "intro" | "followup", veed?: VeedVideo | null): Promise<IntroSendResult> {
  const lead = await getLead(leadId);
  if (!lead) return { outcome: "blocked", reason: "Lead not found." };
  if (!lead.publicEmail) return { outcome: "blocked", reason: "No email address on file — use the phone guide to find a route first." };

  // Deliberate safety gate: live sending stays off until the operator enables it
  // (after the controlled internal delivery test). Review, preview, and workflow
  // state all work regardless; only the actual dispatch is gated.
  if (process.env.OUTREACH_SENDING_ENABLED !== "1") {
    return { outcome: "blocked", reason: "Live sending is off by policy. Run the controlled internal test, then set OUTREACH_SENDING_ENABLED=1 to enable." };
  }

  const stored = await getBusinessIntelligence(leadId);
  const profile = stored?.profile?.businessProfile ?? null;
  if (!profile) return { outcome: "blocked", reason: "No Business Technology Review yet — generate it before sending." };

  // Workflow guards keyed off provider-accepted sends (the ledger is the truth).
  const priorSent = (await emailSendsForLead(leadId)).filter((s) => !!s.sentAt).length;
  if (mode === "intro" && priorSent >= 1) return { outcome: "blocked", reason: "An introduction was already sent — this lead is in Waiting." };
  if (mode === "followup" && priorSent < 1) return { outcome: "blocked", reason: "Send the introduction first — there's nothing to follow up on yet." };
  if (mode === "followup" && priorSent >= 2) return { outcome: "blocked", reason: "A follow-up was already sent — let it rest or move to a call." };

  const [settings, contacts] = await Promise.all([getSettings(), contactsForLead(leadId)]);
  const kit = buildOutreachKit({ lead, profile, settings, contacts });
  const email = mode === "intro" ? kit.email : kit.followUp;

  // The {{unsubscribe}} token is replaced by dispatch, keeping compliance intact.
  const renderInput = { email, settings, veed: mode === "intro" ? veed ?? null : null, unsubscribeUrl: "{{unsubscribe}}" as string | null };
  const html = renderEmailHtml(renderInput);
  const text = renderEmailText(renderInput);

  // Reuse the real plan/step pipeline. prepareAcquisitionPlanAction is idempotent.
  await prepareAcquisitionPlanAction(leadId);
  const plans = await plansForLead(leadId);
  const plan = plans.find((p) => p.status === "prepared" || p.status === "active") ?? plans[0];
  if (!plan) return { outcome: "failed", reason: "Could not prepare an outreach plan." };

  const steps = await stepsForPlan(plan.id);
  const step = steps.filter((s) => s.channel === "email" && !s.sentAt).sort((a, b) => a.stepNumber - b.stepNumber)[0];
  if (!step) return { outcome: "failed", reason: "No unsent email step available." };

  // Store the exact approved version on the step (subject + plaintext + HTML).
  await updateStep(step.id, { subject: email.subject, content: text, html });

  // Approve through the compliance gate only if not already approved.
  if (plan.approvalStatus !== "approved") {
    await approvePlanAction(plan.id);
    const approved = await getPlan(plan.id);
    if (!approved || approved.approvalStatus !== "approved") {
      return { outcome: "blocked", reason: approved?.pauseReason || approved?.stopReason || "Held by the compliance gate before sending.", stepId: step.id };
    }
  }

  const res = await dispatchStep(step.id);
  switch (res.outcome) {
    case "sent":
    case "deduped":
      return { outcome: "sent", providerMessageId: res.providerMessageId ?? null, stepId: step.id };
    case "skipped":
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

export async function sendIntroductionAction(leadId: string, veed?: VeedVideo | null): Promise<IntroSendResult> {
  return sendNext(leadId, "intro", veed);
}

export async function sendFollowUpAction(leadId: string): Promise<IntroSendResult> {
  return sendNext(leadId, "followup");
}

// Fetch VEED title + thumbnail from a hosted VEED URL so the operator only ever
// pastes one thing. VEED-domain-restricted (SSRF-safe). Never fabricates: on any
// failure it returns nulls and the caller falls back gracefully.
export async function fetchVeedMetadata(url: string): Promise<{ title: string | null; thumbnailUrl: string | null }> {
  const empty = { title: null, thumbnailUrl: null };
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || !/(^|\.)veed\.io$/i.test(u.hostname)) return empty;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(u.toString(), { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (Artifex Labs)" }, redirect: "follow" });
    clearTimeout(t);
    if (!res.ok) return empty;
    const html = (await res.text()).slice(0, 200_000);
    const og = (prop: string) => {
      const m =
        html.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']+)["']`, "i")) ||
        html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${prop}["']`, "i"));
      return m ? m[1].trim() : null;
    };
    let title = og("title");
    if (title) title = title.replace(/\s*[|\-–—]\s*VEED.*$/i, "").trim() || null;
    const thumb = og("image");
    return { title: title || null, thumbnailUrl: thumb && /^https:\/\//i.test(thumb) ? thumb : null };
  } catch {
    return empty;
  }
}
