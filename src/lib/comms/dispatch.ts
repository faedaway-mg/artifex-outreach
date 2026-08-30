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
import { buildColdDispatchFromEmail, submitCompliantDispatch } from "./outreach-transport";
import { renderBody } from "./render";
import { escapeHtml } from "../outreach/email-render";
import { renderQuickReviewPdf } from "../pdf/render";
import { buildQuickReview, resolveLeadBrand, quickReviewFilename } from "../outreach/quick-review";
import { quickReviewApproved } from "../outreach/review-approval";
import { sendGate, verifyArtifact, deliveryReadiness } from "../outreach/review-revisions";
import type { BusinessProfile } from "../business-intelligence/types";
import { isSent, backoffMs, MAX_ATTEMPTS, STUCK_SENDING_MS } from "./state";
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
    status: "sending", provider: "resend", providerMessageId: null,
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
    // M2 version-bound artifact gate. When the operator has EDITED this review, only the exact
    // approved revision's bytes may ship; a stale/unapproved edit fails the whole send (never bare).
    // When the review is UNEDITED, this defers to the legacy attachable gate below (unchanged).
    const gate = await sendGate(lead.id);
    if (gate.edited && !gate.allowed && lead.source !== "internal-test") {
      await updateEmailSend(sendRow.id, { status: "failed", failedAt: nowIso, lastError: `review not delivery-ready: ${gate.reason ?? ""}`, lastErrorCode: "review_not_ready" });
      return { stepId, outcome: "failed", reason: `Quick Review is not delivery-ready: ${gate.reason ?? ""}`, sendId: sendRow.id };
    }
    if (gate.edited && gate.allowed && gate.pdf && gate.manifest) {
      // Re-verify the exact approved bytes at this FINAL dispatch boundary before attaching.
      const rid = (await deliveryReadiness(lead.id))!.revisionId;
      const check = verifyArtifact(gate.manifest, gate.pdf, rid);
      if (!check.ok) {
        if (lead.source !== "internal-test") {
          await updateEmailSend(sendRow.id, { status: "failed", failedAt: nowIso, lastError: `artifact verify failed: ${check.reason}`, lastErrorCode: "artifact_verify_failed" });
          return { stepId, outcome: "failed", reason: `Approved attachment failed verification: ${check.reason}`, sendId: sendRow.id };
        }
      } else {
        attachmentFilename = gate.manifest.filename;
        attachmentSha256 = gate.manifest.pdfSha256; // the exact approved bytes
        attachments = [{ filename: attachmentFilename, content: gate.pdf.toString("base64"), contentType: "application/pdf" }];
      }
    } else if (profile) {
      // Legacy path — UNEDITED review: build fresh from BI + old-style approval (SENDABLE, or
      // NEEDS_REVIEW the operator explicitly approved). Behavior unchanged.
      let review: import("../outreach/quick-review").QuickReview | null = null;
      try {
        const brand = await resolveLeadBrand(lead);
        const approved = await quickReviewApproved(lead.id);
        review = buildQuickReview(lead, profile, brand, { approved, observedAt: bi?.generatedAt ?? null });
      } catch {
        review = null;
      }
      if (review?.ready) {
        try {
          const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
          const pdf = await renderQuickReviewPdf(review, dateStr);
          attachmentFilename = quickReviewFilename(lead.businessName);
          attachmentSha256 = sha256(pdf);
          attachments = [{ filename: attachmentFilename, content: pdf.toString("base64"), contentType: "application/pdf" }];
        } catch {
          if (lead.source !== "internal-test") {
            await updateEmailSend(sendRow.id, { status: "failed", failedAt: nowIso, lastError: "quick review render failed", lastErrorCode: "artifact_render_failed" });
            return { stepId, outcome: "failed", reason: "Could not render the Quick Review attachment.", sendId: sendRow.id };
          }
        }
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
  const pdfAttachment = attachments && attachments[0] ? { base64: attachments[0].content, filename: attachments[0].filename } : null;
  const built = buildColdDispatchFromEmail({
    leadId: lead.id, recipient: lead.publicEmail!, subject, bodyText: text, bodyHtml: htmlBody,
    classification, idempotencyKey: key, pdf: pdfAttachment,
    threading: { messageId: threading["Message-ID"], inReplyTo: threading["In-Reply-To"], references: threading["References"] },
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
