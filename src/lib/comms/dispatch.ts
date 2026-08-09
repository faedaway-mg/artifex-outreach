// ─────────────────────────────────────────────────────────────────────────────
// Send dispatcher — the send-once core.
//
// dispatchStep() turns ONE approved communication step into AT MOST ONE successful
// provider send, no matter how many times it is called (browser refresh, retry,
// duplicate scheduler run, Railway restart mid-flight). The guarantee comes from
// the durable send ledger (email_sends) keyed by a unique idempotencyKey plus
// compare-and-set status transitions — never from in-memory locks.
//
// Fully provider-agnostic: it calls getEmailProvider() and never knows about
// Resend. The acquisition engine never imports this file.
// ─────────────────────────────────────────────────────────────────────────────
import {
  getStep, getPlan, getLead, getSettings, updateStep, updatePlan, stepsForPlan, isSuppressed,
  insertEmailSendIfAbsent, casEmailSendStatus, updateEmailSend,
} from "../repo";
import { validEmail } from "../acquisition/compliance";
import { stopPlansForLead } from "../acquisition/stop";
import { getEmailProvider } from "./provider";
import { renderBody } from "./render";
import { isSent, backoffMs, MAX_ATTEMPTS, STUCK_SENDING_MS } from "./state";
import { unsubscribeUrlFor, listUnsubscribeHeaders } from "./unsubscribe";
import { threadingHeaders, priorEmailSteps, reSubject, domainFromAddress } from "./threading";
import type { EmailMessage } from "./provider";
import type { AcquisitionPlan, AcquisitionStep, EmailSend } from "../types";

export type DispatchOutcome = "sent" | "deduped" | "skipped" | "retry" | "failed";
export interface DispatchResult {
  stepId: string;
  outcome: DispatchOutcome;
  reason?: string;
  providerMessageId?: string | null;
  sendId?: string;
}

const iso = (d: Date) => d.toISOString();
const keyFor = (stepId: string) => `step:${stepId}`;

/** The verified From address. Prefers the provider's configured sender. */
function senderFrom(settingsEmail: string): string {
  return process.env.RESEND_FROM || settingsEmail;
}

/** The bare email out of a From header, e.g. `Artifex Labs <hello@x.tech>` → `hello@x.tech`. */
export function addressOnly(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim();
}

// Advance plan progress after a successful send: point at the next unsent step, or
// complete the plan when the sequence is exhausted. Never resurrects a stopped plan.
async function advancePlan(plan: AcquisitionPlan, sentStep: AcquisitionStep): Promise<void> {
  const steps = await stepsForPlan(plan.id);
  const remaining = steps
    .filter((s) => s.id !== sentStep.id && !s.sentAt && !s.stoppedAt)
    .sort((a, b) => a.stepNumber - b.stepNumber);
  const next = remaining[0];
  if (next) {
    await updatePlan(plan.id, { currentStep: sentStep.stepNumber, nextScheduledAt: next.scheduledAt ?? null });
  } else {
    await updatePlan(plan.id, { currentStep: sentStep.stepNumber, nextScheduledAt: null, status: "completed", completedAt: iso(new Date()) });
  }
}

export async function dispatchStep(stepId: string, opts: { now?: Date } = {}): Promise<DispatchResult> {
  const now = opts.now ?? new Date();
  const nowIso = iso(now);

  // ── Preconditions (cheap skips before any claim) ───────────────────────────
  const step = await getStep(stepId);
  if (!step) return { stepId, outcome: "skipped", reason: "step not found" };
  if (step.channel !== "email") return { stepId, outcome: "skipped", reason: `non-email channel (${step.channel})` };
  if (step.sentAt) return { stepId, outcome: "deduped", reason: "step already sent", providerMessageId: step.providerMessageId };
  if (step.stoppedAt) return { stepId, outcome: "skipped", reason: "step stopped" };
  if (step.approvalStatus !== "approved") return { stepId, outcome: "skipped", reason: "step not approved" };

  const plan = await getPlan(step.planId);
  if (!plan) return { stepId, outcome: "skipped", reason: "plan not found" };
  if (plan.approvalStatus !== "approved") return { stepId, outcome: "skipped", reason: "plan not approved" };
  // Skip stopped / paused / completed plans (never send).
  if (plan.status !== "active") return { stepId, outcome: "skipped", reason: `plan not active (${plan.status})` };

  const lead = await getLead(plan.leadId);
  if (!lead) return { stepId, outcome: "skipped", reason: "lead not found" };

  const settings = await getSettings();

  // Authoritative suppression re-check at send time. If newly suppressed, stop the
  // whole sequence (idempotent) and never send.
  if (await isSuppressed({ email: lead.publicEmail, domain: lead.websiteDomain, phone: lead.phone })) {
    await stopPlansForLead(lead.id, "Suppressed at send time");
    return { stepId, outcome: "skipped", reason: "suppressed" };
  }
  if (!validEmail(lead.publicEmail)) return { stepId, outcome: "skipped", reason: "invalid recipient email" };

  const from = senderFrom(settings.contactEmail);
  const key = keyFor(step.id);

  // ── Atomic claim: create the ledger row, or inspect the existing one ────────
  const claim = await insertEmailSendIfAbsent({
    idempotencyKey: key, stepId: step.id, planId: plan.id, leadId: lead.id,
    toAddr: lead.publicEmail!, fromAddr: from, subject: step.subject,
    status: "sending", provider: getEmailProvider().name, providerMessageId: null,
    attempts: 1, lastError: null, lastErrorCode: null, nextAttemptAt: null,
    queuedAt: nowIso, sendingAt: nowIso, sentAt: null, deliveredAt: null, openedAt: null,
    clickedAt: null, bouncedAt: null, complainedAt: null, unsubscribedAt: null, failedAt: null,
  });

  let sendRow: EmailSend = claim.row;
  if (!claim.inserted) {
    // A row already exists — decide by its current state.
    if (isSent(sendRow.status)) return { stepId, outcome: "deduped", reason: `already ${sendRow.status}`, providerMessageId: sendRow.providerMessageId, sendId: sendRow.id };
    if (sendRow.status === "failed") return { stepId, outcome: "failed", reason: "previously failed permanently", sendId: sendRow.id };
    if (sendRow.status === "sending") {
      const age = now.getTime() - (sendRow.sendingAt ? +new Date(sendRow.sendingAt) : 0);
      if (age < STUCK_SENDING_MS) return { stepId, outcome: "skipped", reason: "send in progress", sendId: sendRow.id };
      // Stale (crashed mid-send) → reclaim.
      const reclaimed = await casEmailSendStatus(sendRow.id, "sending", { sendingAt: nowIso, attempts: sendRow.attempts + 1 });
      if (!reclaimed) return { stepId, outcome: "skipped", reason: "send claimed by another worker", sendId: sendRow.id };
      sendRow = reclaimed;
    } else {
      // queued → claim the retry (queued → sending).
      const claimed = await casEmailSendStatus(sendRow.id, "queued", { status: "sending", sendingAt: nowIso, attempts: sendRow.attempts + 1 });
      if (!claimed) return { stepId, outcome: "skipped", reason: "retry claimed by another worker", sendId: sendRow.id };
      sendRow = claimed;
    }
  }

  // ── Send ────────────────────────────────────────────────────────────────────
  const provider = getEmailProvider();
  if (!provider.canSend) {
    // No provider configured — release the claim back to the queue (not a failure)
    // so a later, configured run can pick it up. Nothing is lost.
    await casEmailSendStatus(sendRow.id, "sending", { status: "queued", nextAttemptAt: nowIso, lastError: "provider disabled", lastErrorCode: "disabled" });
    return { stepId, outcome: "skipped", reason: "provider disabled", sendId: sendRow.id };
  }

  const text = renderBody(step.content, { replyEmail: settings.contactEmail, unsubscribeUrl: unsubscribeUrlFor(lead.id) });
  // Optional pre-rendered HTML (e.g. the v2 premium template). The {{unsubscribe}}
  // token is replaced here so the ledger/idempotency path is unchanged.
  const html = step.html ? step.html.split("{{unsubscribe}}").join(unsubscribeUrlFor(lead.id) ?? "") : undefined;
  // Threading: our own Message-ID, plus In-Reply-To/References + "Re:" subject on
  // follow-ups so the whole exchange stays in one conversation (never a new chain).
  const planSteps = await stepsForPlan(plan.id);
  const domain = domainFromAddress(from);
  const isFollowUp = priorEmailSteps(step, planSteps).length > 0;
  const subject = isFollowUp ? reSubject(priorEmailSteps(step, planSteps)[0].subject) : step.subject;
  const headers = { ...listUnsubscribeHeaders(lead.id, settings.contactEmail), ...threadingHeaders(step, planSteps, domain) };
  // Reply-To follows the SENDING identity, not a separate contact knob, so a recipient
  // who hits Reply always reaches the monitored mailbox the mail was sent from
  // (hello@artifexlabs.tech → its Microsoft 365 inbox). Same address as From by design.
  const replyTo = addressOnly(from);
  const msg: EmailMessage = { to: lead.publicEmail!, from, replyTo, subject, text, ...(html ? { html } : {}), headers, idempotencyKey: key };
  const res = await provider.send(msg);

  if (res.sent) {
    await updateEmailSend(sendRow.id, { status: "sent", providerMessageId: res.providerMessageId, sentAt: nowIso, nextAttemptAt: null, lastError: null, lastErrorCode: null });
    await updateStep(step.id, { sentAt: nowIso, providerMessageId: res.providerMessageId, deliveryStatus: "sent" });
    await advancePlan(plan, step);
    return { stepId, outcome: "sent", providerMessageId: res.providerMessageId, sendId: sendRow.id };
  }

  // Not sent → decide recovery. An auth error is ACCOUNT-level (expired/invalid
  // key): it is not the message's fault, so we never permanently fail it — it
  // stays queued and resumes once the key is fixed ("no communication lost").
  // Its backoff is capped so it retries promptly after a fix, and it does not
  // count toward the per-message attempt budget.
  const accountLevel = res.errorCode === "auth";
  const canRetry = accountLevel || (res.retryable === true && sendRow.attempts < MAX_ATTEMPTS);
  if (canRetry) {
    const attemptForBackoff = accountLevel ? Math.min(sendRow.attempts, 6) : sendRow.attempts;
    const next = iso(new Date(now.getTime() + backoffMs(attemptForBackoff)));
    await updateEmailSend(sendRow.id, { status: "queued", nextAttemptAt: next, lastError: res.reason ?? null, lastErrorCode: res.errorCode ?? null });
    return { stepId, outcome: "retry", reason: res.reason, sendId: sendRow.id };
  }
  // Permanent (bad recipient / validation) or transient budget exhausted → fail.
  await updateEmailSend(sendRow.id, { status: "failed", failedAt: nowIso, nextAttemptAt: null, lastError: res.reason ?? null, lastErrorCode: res.errorCode ?? null });
  return { stepId, outcome: "failed", reason: res.reason, sendId: sendRow.id };
}
