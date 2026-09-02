// ─────────────────────────────────────────────────────────────────────────────
// Send dispatcher — the send-once core.
//
// dispatchStep() turns ONE approved communication step into AT MOST ONE successful
// provider send, no matter how many times it is called (browser refresh, retry,
// duplicate scheduler run, Railway restart mid-flight). The guarantee comes from
// the durable send ledger (email_sends) keyed by a unique idempotencyKey plus
// compare-and-set status transitions — never from in-memory locks.
//
// Cold outreach is COMPLIANT-ONLY: this dispatcher classifies the message, then submits it through the
// single canonical compliant transport (submitCompliantDispatch → Resend) which enforces the footer,
// signed unsubscribe, suppression rechecks, recipient gate, and ambiguous protection. It never selects
// an arbitrary provider and cannot bypass compliance. The acquisition engine never imports this file.
// ─────────────────────────────────────────────────────────────────────────────
import {
  getStep, getPlan, getLead, getSettings, updateStep, updatePlan, stepsForPlan, isSuppressed,
  insertEmailSendIfAbsent, casEmailSendStatus, updateEmailSend, getBusinessIntelligence, updateLead, appendAudit,
} from "../repo";
import { sha256, SEND_RECEIPT_ACTION, type SendReceiptMeta } from "./receipt";
import { validEmail } from "../acquisition/compliance";
import { stopPlansForLead } from "../acquisition/stop";
import { unsubscribeUrl as hardenedUnsubUrl } from "./commercial-message";
import { classifyLeadSource, transportRouteFor } from "./transport-policy";
import { buildColdDispatchFromEmail, submitCompliantDispatch, toFrozenAttachment } from "./outreach-transport";
import { renderBody } from "./render";
import { escapeHtml } from "../outreach/email-render";
import { resolveApprovedArtifactForSend } from "../outreach/resolve-approved-artifact";
import type { BusinessProfile } from "../business-intelligence/types";
import { isSent, backoffMs, MAX_ATTEMPTS, STUCK_SENDING_MS } from "./state";
import { retryEligibility, terminalFailureReason } from "./failure-classification";
import { threadingHeaders, priorEmailSteps, reSubject, domainFromAddress } from "./threading";
import { receptivitySignalsFrom, receptivityScore } from "../acquisition/receptivity";
import { marketTierOf } from "../geo-market";
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

/** The verified From address for cold outreach — the configured Resend sender (RESEND_FROM). */
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

export async function dispatchStep(stepId: string, opts: { now?: Date; operatorRetry?: boolean } = {}): Promise<DispatchResult> {
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

  // A follow-up (step 2+) can NEVER precede a provider-accepted initial. Defense-in-depth at the send
  // core so no caller (scheduler, retry, canary) can dispatch a follow-up before its introduction has
  // actually left the system. The intro is the lowest-numbered email step; require it to have sentAt.
  if (step.stepNumber >= 2) {
    const planStepsGuard = await stepsForPlan(plan.id);
    const priorSent = planStepsGuard.some((s) => s.channel === "email" && s.stepNumber < step.stepNumber && !!s.sentAt);
    if (!priorSent) return { stepId, outcome: "skipped", reason: "prior initial message not yet provider-accepted" };
  }

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
    status: "sending", provider: "resend", providerMessageId: null,
    attempts: 1, lastError: null, lastErrorCode: null, nextAttemptAt: null,
    queuedAt: nowIso, sendingAt: nowIso, sentAt: null, deliveredAt: null, openedAt: null,
    clickedAt: null, bouncedAt: null, complainedAt: null, unsubscribedAt: null, failedAt: null,
  });

  let sendRow: EmailSend = claim.row;
  if (!claim.inserted) {
    // A row already exists — decide by its current state.
    if (isSent(sendRow.status)) return { stepId, outcome: "deduped", reason: `already ${sendRow.status}`, providerMessageId: sendRow.providerMessageId, sendId: sendRow.id };
    if (sendRow.status === "failed") {
      // A prior attempt failed. Whether "Try send again" is real depends on WHY it failed:
      //  • a GENUINE hard-stop (suppressed / unsubscribed / invalid recipient / provider rejection),
      //    or a message the provider may already have accepted (ambiguous) → stays terminal, with the
      //    SPECIFIC reason (never the old generic "previously failed permanently").
      //  • a CONFIG / TRANSIENT / INTERNAL failure that never reached the provider (e.g. the footer's
      //    postal address was missing, sending was off, a temporary 5xx) → an OPERATOR retry re-claims
      //    the SAME ledger row (lineage preserved) and re-runs every dispatch-time check below. The
      //    automatic scheduler NEVER does this (no operatorRetry), so a failure is never silently resent.
      const elig = retryEligibility(sendRow);
      if (!opts.operatorRetry || !elig.retryable) {
        return { stepId, outcome: "failed", reason: terminalFailureReason(sendRow), sendId: sendRow.id };
      }
      const priorErrorCode = sendRow.lastErrorCode ?? null;
      const reclaimed = await casEmailSendStatus(sendRow.id, "failed", { status: "sending", sendingAt: nowIso, attempts: sendRow.attempts + 1, failedAt: null, nextAttemptAt: null });
      if (!reclaimed) return { stepId, outcome: "skipped", reason: "retry already claimed by another attempt", sendId: sendRow.id };
      sendRow = reclaimed;
      await appendAudit({ action: "email.send.retry", actor: "operator", targetType: "lead", targetId: lead.id, meta: { sendId: sendRow.id, stepId, priorErrorCode, attempt: sendRow.attempts }, ip: null });
    } else if (sendRow.status === "sending") {
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

  // ── Send (Microsoft Graph ONLY — cold outreach never selects a provider / never Resend) ──────
  // Classification → routing policy. An Acquisition OS plan/step email is cold outreach (or the
  // internal-test rehearsal); both route to the compliant Graph transport. Anything that does not
  // resolve to "graph-compliant" fails closed and is never sent.
  const classification = classifyLeadSource(lead.source);
  if (transportRouteFor(classification) !== "compliant") {
    await updateEmailSend(sendRow.id, { status: "failed", failedAt: nowIso, lastError: `route refused for classification ${classification}`, lastErrorCode: "route_refused" });
    return { stepId, outcome: "failed", reason: "message classification is not permitted on the cold-outreach transport", sendId: sendRow.id };
  }
  if (!process.env.RESEND_API_KEY) {
    // No transport configured — release the claim back to the queue (not a failure) so a later,
    // configured run can pick it up. Nothing is lost.
    await casEmailSendStatus(sendRow.id, "sending", { status: "queued", nextAttemptAt: nowIso, lastError: "resend transport unconfigured", lastErrorCode: "unconfigured" });
    return { stepId, outcome: "skipped", reason: "resend transport unconfigured", sendId: sendRow.id };
  }

  // The hardened, recipient-bound unsubscribe URL (COMMS_UNSUBSCRIBE_SECRET + public base). The
  // in-body {{unsubscribe}} token uses it; the compliant footer (appended by the adapter) repeats it.
  const unsub = hardenedUnsubUrl(lead.id, lead.publicEmail!);
  const text = renderBody(step.content, { replyEmail: settings.contactEmail, unsubscribeUrl: unsub });
  const html = step.html ? step.html.split("{{unsubscribe}}").join(unsub ?? "") : undefined;
  // Threading: our own Message-ID, plus In-Reply-To/References + "Re:" subject on
  // follow-ups so the whole exchange stays in one conversation (never a new chain).
  const planSteps = await stepsForPlan(plan.id);
  const domain = domainFromAddress(from);
  const isFollowUp = priorEmailSteps(step, planSteps).length > 0;
  const subject = isFollowUp ? reSubject(priorEmailSteps(step, planSteps)[0].subject) : step.subject;
  // Threading headers ride the MIME message (Message-ID / In-Reply-To / References); List-Unsubscribe
  // is derived from the hardened URL by the compliant transport, not stitched here.
  const threading = threadingHeaders(step, planSteps, domain);
  // Reply-To follows the SENDING identity, not a separate contact knob, so a recipient
  // who hits Reply always reaches the monitored mailbox the mail was sent from
  // (hello@artifexlabs.tech → its Microsoft 365 inbox). Same address as From by design.
  const replyTo = addressOnly(from);

  // The INITIAL outreach email carries the personalized one-page Artifex Quick Review as a
  // PDF attachment (follow-ups do not re-attach it), rendered deterministically from the SAME
  // stored review the operator previewed (WYSIWYS). The operator send path (sendNext) blocks
  // upstream until the review is ready; AND — as of M2 Gate 7 — this dispatch layer now ALSO fails
  // closed for any review-bearing initial send whose PDF is not attachable (edited OR legacy), so no
  // path can send a bare email in place of the review. internal-test rehearsals remain exempt.
  let attachments: EmailMessage["attachments"] | undefined;
  // Captured for the immutable receipt: exactly which Review PDF (by filename + content hash)
  // was attached to THIS send. Answers "which exact Review did Business X receive?".
  let attachmentFilename: string | null = null;
  let attachmentSha256: string | null = null;
  // Learning-loop context recorded on the receipt (why + observed signals). Cheap: reuses the BI
  // already fetched for the attachment; market tier + fit come straight off the lead.
  let receptivitySignalTypes: string[] = [];
  let receptivityScoreVal = 0;
  if (!isFollowUp) {
    const bi = await getBusinessIntelligence(lead.id);
    const profile = (bi?.profile?.businessProfile as BusinessProfile | undefined) ?? null;
    if (profile) {
      const signals = receptivitySignalsFrom({ opportunities: profile.opportunities, generatedAt: bi?.generatedAt ?? null });
      receptivitySignalTypes = [...new Set(signals.map((s) => s.type))];
      receptivityScoreVal = receptivityScore(signals);
    }
    // ONE canonical resolver for the exact approved Quick Review PDF — EDITED (M2 revision manifest) or
    // UNEDITED (version-keyed approval), behind a single contract. It returns FROZEN bytes (rendered
    // once, reused) and NEVER re-renders; it fails closed on missing / tampered / stale / unapproved. A
    // review-bearing lead that cannot resolve its frozen review is BLOCKED (never bare); an internal-test
    // rehearsal (no live review) is exempt and may proceed without an attachment.
    if (profile) {
      const frozen = await resolveApprovedArtifactForSend(lead.id);
      if (frozen.ok) {
        attachmentFilename = frozen.filename!;
        attachmentSha256 = frozen.sha256!; // the exact frozen bytes (rendered once, reused)
        attachments = [{ filename: frozen.filename!, content: frozen.pdfBase64!, contentType: "application/pdf" }];
      } else if (lead.source !== "internal-test") {
        await updateEmailSend(sendRow.id, { status: "failed", failedAt: nowIso, lastError: `frozen review unavailable: ${frozen.reason}`, lastErrorCode: "review_not_ready" });
        return { stepId, outcome: "failed", reason: `Quick Review is not delivery-ready: ${frozen.reason}`, sendId: sendRow.id };
      }
    }
    // M2 Gate 7 — UNIVERSAL delivery protection. An initial, review-bearing outreach (a lead with a
    // BI profile) must ship its Quick Review PDF or be BLOCKED — never sent bare in place of the
    // review. This closes the legacy bypass: an unedited/legacy review that fails to render or isn't
    // attachable no longer slips through with no attachment merely because it lacks an operator
    // overlay. The version-bound gate above already fails an EDITED-but-unready review; this catches
    // the LEGACY path symmetrically. (internal-test rehearsals are exempt so the controlled test can
    // proceed without a live review.)
    if (profile && !attachments && lead.source !== "internal-test") {
      await updateEmailSend(sendRow.id, { status: "failed", failedAt: nowIso, lastError: "quick review not delivery-ready — refusing to send bare", lastErrorCode: "review_not_ready" });
      return { stepId, outcome: "failed", reason: "The Quick Review for this business is not delivery-ready, so the introduction was blocked (never sent without its review).", sendId: sendRow.id };
    }
  }

  // Build the canonical compliant request (CAN-SPAM footer + hardened one-click unsubscribe) and
  // submit via Microsoft Graph MIME ONLY. The Quick Review PDF (initial sends) rides as a MIME
  // attachment; threading headers keep follow-ups in one conversation. No provider selection, no Resend.
  const htmlBody = html ?? `<div>${escapeHtml(text).replace(/\n/g, "<br>")}</div>`;
  // The attachment can ONLY be a FrozenAttachment minted from the resolved frozen bytes + SHA (runtime
  // integrity re-checked here); the assembler will not accept arbitrary bytes.
  const pdfAttachment = attachmentSha256 && attachments && attachments[0]
    ? toFrozenAttachment({ pdfBase64: attachments[0].content, filename: attachments[0].filename, sha256: attachmentSha256 })
    : null;
  // ATTEMPT-SCOPED provider idempotency key (lineage retained via the `step:<id>` prefix). The durable
  // ledger row keeps its stable key (`step:<id>`) as the duplicate-DELIVERY guard; the PROVIDER key is
  // per-attempt so a prior FAILED attempt can never falsely satisfy the provider's dedup on a genuine
  // retry — while our status CAS still guarantees at most one in-flight submit per step.
  const providerIdempotencyKey = `${key}:a${sendRow.attempts}`;
  const built = buildColdDispatchFromEmail({
    leadId: lead.id, recipient: lead.publicEmail!, subject, bodyText: text, bodyHtml: htmlBody,
    classification, idempotencyKey: providerIdempotencyKey, pdf: pdfAttachment,
    threading: { messageId: threading["Message-ID"], inReplyTo: threading["In-Reply-To"], references: threading["References"] },
    // CAN-SPAM footer postal fallback: operator-configured Settings address when COMMS_POSTAL_ADDRESS is unset.
    postal: settings.businessAddress,
  });
  if (!built.ok) {
    // FAIL CLOSED — no postal address or unsubscribe secret means no compliant message can exist.
    await updateEmailSend(sendRow.id, { status: "failed", failedAt: nowIso, lastError: `compliance assembly failed: ${built.reason}`, lastErrorCode: "compliance_incomplete" });
    return { stepId, outcome: "failed", reason: `Message could not be assembled compliantly (${built.reason}).`, sendId: sendRow.id };
  }
  const toAddr = lead.publicEmail!;
  const sentBodyText = built.req.bodyText; // the exact text (with footer) that leaves Artifex
  const res = await submitCompliantDispatch(built.req, built.unsubscribeUrl);

  if (res.ambiguous) {
    // Uncertain post-submit result — Graph MAY have accepted it. Never blindly resend: mark it
    // terminal-ambiguous (not auto-retried; the ledger row also blocks any operator re-send) and
    // surface it for reconciliation against the mailbox Sent Items.
    await updateEmailSend(sendRow.id, { status: "failed", failedAt: nowIso, nextAttemptAt: null, lastError: res.reason ?? "ambiguous submit", lastErrorCode: "ambiguous_submit" });
    return { stepId, outcome: "failed", reason: res.reason ?? "Uncertain provider response — not resent (reconcile before any retry).", sendId: sendRow.id };
  }

  if (res.sent) {
    await updateEmailSend(sendRow.id, { status: "sent", providerMessageId: res.providerMessageId, sentAt: nowIso, nextAttemptAt: null, lastError: null, lastErrorCode: null });
    await updateStep(step.id, { sentAt: nowIso, providerMessageId: res.providerMessageId, deliveryStatus: "sent" });
    await advancePlan(plan, step);

    // IMMUTABLE RECEIPT — the exact final payload that left Artifex, bound to ONE business.
    // Append-only; hashed so a later draft regeneration can never rewrite what was sent.
    const receipt: SendReceiptMeta = {
      leadId: lead.id, businessName: lead.businessName,
      toAddr, fromAddr: from, replyTo,
      subject, bodyText: sentBodyText, bodySha256: sha256(sentBodyText),
      attachmentFilename, attachmentSha256,
      providerMessageId: res.providerMessageId ?? null, sentAt: nowIso,
      stepId: step.id, planId: plan.id, isFollowUp, sendId: sendRow.id,
      // Learning-loop context: market tier + fit + observed receptivity signals at send time.
      marketTier: marketTierOf(lead), fitScore: lead.leadScore ?? null,
      receptivityScore: receptivityScoreVal, receptivitySignalTypes,
    };
    await appendAudit({ action: SEND_RECEIPT_ACTION, actor: "system", targetType: "lead", targetId: lead.id, meta: receipt as unknown as Record<string, unknown>, ip: null });

    // PIPELINE VISIBILITY — an emailed business must not look untouched. Stamp lastContactAt and
    // advance a pre-contact stage to "Contacted" (never downgrade a further-along lifecycle).
    const PRE_CONTACT = new Set(["Discovered", "Qualified", "Analysis Ready", "Deliverable Ready"]);
    await updateLead(lead.id, { lastContactAt: nowIso, ...(PRE_CONTACT.has(lead.pipelineStage) ? { pipelineStage: "Contacted" as const } : {}) });

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
