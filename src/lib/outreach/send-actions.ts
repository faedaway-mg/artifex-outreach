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
import { getLead, updateLead, getBusinessIntelligence, getSettings, contactsForLead, plansForLead, stepsForPlan, getPlan, updateStep, emailSendsForLead, allTasks, insertTask, updateTask, appendAudit } from "../repo";
import { isCallablePhone } from "./contact-strategy";
import type { Lead } from "../types";
import { prepareAcquisitionPlanAction, approvePlanAction } from "../acquisition-actions";
import { dispatchStep } from "../comms/dispatch";
import { buildOutreachKit } from "./kit";
import { buildQuickReview, resolveLeadBrand } from "./quick-review";
import { quickReviewApproved } from "./review-approval";
import { sendGate } from "./review-revisions";
import { renderPersonalEmailHtml, renderPersonalEmailText } from "./email-render";
import type { VeedVideo, IntroSendResult, OutreachEmail } from "./types";

/** Operator edits from the Approve & Send screen — plaintext only. We re-render the
 *  branded HTML from these server-side, so the operator can never inject markup and the
 *  signature/unsubscribe chrome stays intact, while the SUBJECT and BODY that go out are
 *  exactly what they typed (WYSIWYS). */
export interface EmailOverride {
  subject?: string;
  body?: string;
  /** The business id the operator was PREVIEWING when they approved. The server fails closed if
   *  it does not match the lead being sent — proving preview == approve == dispatch belong to the
   *  same business (defense-in-depth even if a client render ever went stale). */
  previewBusinessId?: string;
}

/** Fold operator edits onto the generated email. Blank fields fall back to the draft, so
 *  an untouched send is byte-identical to today's behaviour. */
function applyOverride(email: OutreachEmail, override?: EmailOverride | null): OutreachEmail {
  if (!override) return email;
  const subject = override.subject?.trim();
  const body = override.body?.replace(/\r\n/g, "\n").trim();
  const paragraphs = body ? body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean) : email.paragraphs;
  return { ...email, subject: subject || email.subject, body: body || email.body, paragraphs };
}

/** The same clock time N BUSINESS days ahead (skips Sat/Sun) — the email must land before the call. */
function businessDaysFromNow(n: number): string {
  const d = new Date();
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) added++;
  }
  return d.toISOString();
}

/**
 * The value-first hypothesis in one function: once the personalized review has ACTUALLY been
 * emailed, schedule ONE warm follow-up call a couple business days out for ANY lead we can call
 * (not just gatekeeper practices). The call then follows the email with legitimate context —
 * "I sent over a quick review of the business, wanted to make sure it reached the right person"
 * — instead of a cold pitch. Idempotent (never piles up call tasks), only when there's a
 * callable number, and it leaves a dated note the Call Assistant reads so the opener is warm.
 */
async function scheduleFollowUpCallAfterEmail(leadId: string, lead: Lead, subject: string): Promise<void> {
  if (!isCallablePhone(lead.phone)) return; // no number to warm-follow-up on
  const hasOpenCall = (await allTasks()).some((t) => t.leadId === leadId && t.status === "open" && t.type === "call");
  if (hasOpenCall) return;
  const when = businessDaysFromNow(2);
  await insertTask({ leadId, type: "call", title: `Follow up on the review — ${lead.businessName}`, dueAt: when, status: "open", priority: 58, snoozedUntil: null });
  const stamp = new Date().toISOString().slice(0, 10);
  const line = `[${stamp}] Emailed the Quick Review${lead.publicEmail ? ` to ${lead.publicEmail}` : ""} ("${subject}"). Follow-up call: make sure it reached the right person.`;
  const fresh = await getLead(leadId);
  await updateLead(leadId, { note: fresh?.note?.trim() ? `${line}\n${fresh.note.trim()}` : line, nextFollowUpAt: when });
}

async function sendNext(leadId: string, mode: "intro" | "followup", veed?: VeedVideo | null, override?: EmailOverride | null): Promise<IntroSendResult> {
  const lead = await getLead(leadId);
  if (!lead) return { outcome: "blocked", reason: "Lead not found." };
  if (!lead.publicEmail) return { outcome: "blocked", reason: "No email address on file — use the phone guide to find a route first." };

  // HARD PRE-SEND BUSINESS ISOLATION (fail closed). If the client tells us which business it was
  // previewing and it disagrees with the lead being sent, refuse — never dispatch a possibly
  // cross-business payload. Audited, no send. (When the client omits it, server-derived recipient
  // and Review attachment are still bound to leadId; this closes the operator-edited-body gap.)
  if (override?.previewBusinessId && override.previewBusinessId !== leadId) {
    await appendAudit({ action: "email.send.blocked", actor: "operator", targetType: "lead", targetId: leadId, meta: { reason: "preview-business-mismatch", previewBusinessId: override.previewBusinessId, mode }, ip: null });
    return { outcome: "blocked", reason: "This email was prepared for a different business — refresh the page and review it again before sending." };
  }

  // Deliberate safety gate: live sending stays off until the operator enables it
  // (after the controlled internal delivery test). Review, preview, and workflow
  // state all work regardless; only the actual dispatch is gated.
  if (process.env.OUTREACH_SENDING_ENABLED !== "1") {
    return { outcome: "blocked", reason: "Live sending is off by policy. Run the controlled internal test, then set OUTREACH_SENDING_ENABLED=1 to enable." };
  }

  const stored = await getBusinessIntelligence(leadId);
  const profile = stored?.profile?.businessProfile ?? null;
  if (!profile) return { outcome: "blocked", reason: "No Business Technology Review yet — generate it before sending." };

  // SEND-READY INVARIANT: an INITIAL email carries the one-page Quick Review as an attachment.
  // If there are no credible findings yet, the review isn't ready — block the send with a clear
  // reason rather than let an email go out claiming an attachment it doesn't have. (The internal
  // test lead is exempt so transport can always be verified.)
  if (mode === "intro" && lead.source !== "internal-test") {
    // M2: when the operator has EDITED the review, it must be delivery-ready (its current content
    // approved) before the send can proceed — the same gate dispatch re-checks at the final boundary.
    const gate = await sendGate(leadId);
    if (gate.edited && !gate.allowed) {
      return { outcome: "blocked", reason: `Quick Review isn't delivery-ready: ${gate.reason ?? "resolve the open items and approve the current version."}` };
    }
    const brand = await resolveLeadBrand(lead); // resolves + caches the logo once (dispatch reuses it)
    const approved = await quickReviewApproved(leadId);
    const review = buildQuickReview(lead, profile, brand, { approved });
    if (!review.ready) {
      // NEEDS_REVIEW is a real state: it must be explicitly approved, never silently sent.
      return review.status === "NEEDS_REVIEW"
        ? { outcome: "blocked", reason: "Quick Review needs your approval — it has one evidence-backed finding; review and approve it before sending." }
        : { outcome: "blocked", reason: "Quick Review needs attention — no credible findings yet, so there's nothing to attach." };
    }
  }

  // Workflow guards keyed off provider-accepted sends (the ledger is the truth).
  const priorSent = (await emailSendsForLead(leadId)).filter((s) => !!s.sentAt).length;
  if (mode === "intro" && priorSent >= 1) return { outcome: "blocked", reason: "An introduction was already sent — this lead is in Waiting." };
  if (mode === "followup" && priorSent < 1) return { outcome: "blocked", reason: "Send the introduction first — there's nothing to follow up on yet." };
  if (mode === "followup" && priorSent >= 2) return { outcome: "blocked", reason: "A follow-up was already sent — let it rest or move to a call." };

  const [settings, contacts] = await Promise.all([getSettings(), contactsForLead(leadId)]);
  const kit = buildOutreachKit({ lead, profile, settings, contacts });
  // The generated draft, with any operator edits folded in. What we render, store, and
  // send from here on is the EDITED email — the exact copy the operator reviewed.
  const email = applyOverride(mode === "intro" ? kit.email : kit.followUp, override);

  // The {{unsubscribe}} token is replaced by dispatch, keeping compliance intact. The booking CTA
  // offers the SAME canonical destination as the attached Quick Review's button (email/PDF aligned);
  // reply stays available via reply-to. One destination only — no conflicting links.
  const bookingCta = settings.calendarLink ? { label: "Book a conversation", url: settings.calendarLink } : null;
  const renderInput = { email, settings, veed: mode === "intro" ? veed ?? null : null, unsubscribeUrl: "{{unsubscribe}}" as string | null, cta: bookingCta };
  const html = renderPersonalEmailHtml(renderInput);
  const text = renderPersonalEmailText(renderInput);

  // A lead can legitimately become ready-to-send via the CALL → email-capture path
  // (asked-to-send: permission + email captured on a call) WITHOUT ever being scored into an
  // acquisitionStrategy. The plan/step pipeline — which owns dispatch idempotency, threading,
  // and follow-up sequencing — still needs a strategy to materialize the initial email step;
  // without one, prepareAcquisitionPlanAction returns early and the send fails with the generic
  // "Could not prepare an outreach plan." Default a sensible strategy so the ALREADY-PREPARED
  // operator email can send. Idempotent: only fills a MISSING strategy, never overwrites one,
  // and prepareAcquisitionPlanAction still refuses to create a second plan.
  if (!lead.acquisitionStrategy) {
    await updateLead(leadId, { acquisitionStrategy: "Assisted" });
  }

  // Reuse the real plan/step pipeline. prepareAcquisitionPlanAction is idempotent.
  await prepareAcquisitionPlanAction(leadId);
  const plans = await plansForLead(leadId);
  const plan = plans.find((p) => p.status === "prepared" || p.status === "active") ?? plans[0];
  if (!plan) return { outcome: "blocked", reason: "This lead isn't set up for outreach (its strategy may be Do Not Contact)." };

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

  // This is the OPERATOR path (Approve & Send / "Try send again"). A prior CONFIG/TRANSIENT failure
  // (e.g. a missing footer postal address, sending temporarily off) may be re-claimed and retried here;
  // a genuine hard-stop stays terminal with its specific reason. The automatic scheduler never sets this.
  const res = await dispatchStep(step.id, { operatorRetry: true });
  switch (res.outcome) {
    case "sent":
    case "deduped":
      // Value-first: once the review has actually gone out, the phone call FOLLOWS it with
      // context for every callable lead — schedule one warm follow-up call a couple business
      // days later ("I sent over a quick review…"), never a cold pitch.
      if (mode === "intro") {
        await scheduleFollowUpCallAfterEmail(leadId, lead, email.subject);
        // The Review has been sent — complete the open review_and_send task so the business leaves
        // "Emails to send" immediately (no waiting for the next reconcile tick). Idempotent.
        for (const t of (await allTasks()).filter((t) => t.leadId === leadId && t.status === "open" && t.type === "review_and_send")) {
          await updateTask(t.id, { status: "done" });
        }
      }
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

export async function sendIntroductionAction(leadId: string, veed?: VeedVideo | null, override?: EmailOverride | null): Promise<IntroSendResult> {
  return sendNext(leadId, "intro", veed, override);
}

export async function sendFollowUpAction(leadId: string, override?: EmailOverride | null): Promise<IntroSendResult> {
  return sendNext(leadId, "followup", null, override);
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

// ── Explicit operator approval of a NEEDS_REVIEW Quick Review ──────────────────
// A deliberate, auditable action: it records an append-only approval event so a one-finding review
// can proceed to attachment. It NEVER sends anything and refuses INSUFFICIENT_EVIDENCE. Wired to a
// visible button that only appears for a NEEDS_REVIEW review, so it cannot be triggered by accident.
export async function approveQuickReviewAction(formData: FormData): Promise<void> {
  const { revalidatePath } = await import("next/cache");
  const { approveQuickReview } = await import("./review-approval");
  const leadId = String(formData.get("leadId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!leadId) return;
  await approveQuickReview(leadId, status);
  revalidatePath("/work/email");
  revalidatePath(`/leads/${leadId}`);
}
