// Server-side data for the operator scheduling surface. Classifies the email candidate pool into
// SENDABLE-and-schedulable, already-scheduled, and not-ready (with a reason) — the same honest
// eligibility used by "Emails to send". Read-only; sends nothing; renders no PDF (filenames/revisions
// only). The exact PDF bytes are bound at schedule time by scheduleBatch.
import type { Lead } from "../types";
import { listLeads, getBusinessIntelligence, allEmailSends, isSuppressed, getSettings } from "../repo";
import { validEmail } from "../acquisition/compliance";
import { buildQuickReview, quickReviewFilename, type QuickReview } from "./quick-review";
import { quickReviewApproved } from "./review-approval";
import { getEditorialState, revisionFingerprint } from "./review-revisions";
import { emailQueueEligibility } from "./email-queue-eligibility";
import { staggeredTimes } from "./scheduled-batch";
import { resolveSendingWindow, nextSendingDateKey } from "./sending-window";

const TERMINAL = new Set(["Won", "Lost", "Disqualified", "Nurture"]);

export interface SchedulableItem { leadId: string; business: string; recipient: string; subject: string; pdfFilename: string; revisionId: string; proposedAt: string; }
export interface ScheduledItem { leadId: string; business: string; recipient: string; scheduledAt: string; batchId: string; pdfSha256: string; }
export interface NotReadyItem { leadId: string; business: string; reason: string; }

export interface SchedulableView {
  eligible: SchedulableItem[];
  scheduled: ScheduledItem[];
  notReady: NotReadyItem[];
  window: { tz: string; startHour: number; endHour: number };
  dateKey: string;
}

export async function schedulableEmails(now: Date = new Date()): Promise<SchedulableView> {
  const [leads, sends, settings] = await Promise.all([listLeads(), allEmailSends(), getSettings()]);
  const activeWindow = resolveSendingWindow(settings);
  const dateKey = nextSendingDateKey(now, activeWindow);
  const stagger = { tz: activeWindow.timezone, startHour: activeWindow.startHour, endHour: activeWindow.endHour };
  const contacted = new Set(sends.map((s) => s.leadId));
  const eligibleRaw: Array<{ lead: Lead; review: QuickReview }> = [];
  const scheduled: ScheduledItem[] = [];
  const notReady: NotReadyItem[] = [];

  for (const lead of leads) {
    if (TERMINAL.has(lead.pipelineStage) || contacted.has(lead.id)) continue;
    if (!validEmail(lead.publicEmail) && !(await getEditorialState(lead.id)).scheduled) continue; // not an email candidate
    const state = await getEditorialState(lead.id);
    if (state.scheduled && state.scheduled.status === "scheduled") {
      scheduled.push({ leadId: lead.id, business: lead.businessName, recipient: state.scheduled.recipient, scheduledAt: state.scheduled.scheduledAt, batchId: state.scheduled.batchId, pdfSha256: state.scheduled.pdfSha256 });
      continue;
    }
    const bi = await getBusinessIntelligence(lead.id);
    const review = buildQuickReview(lead, bi?.profile?.businessProfile ?? null, null, { approved: await quickReviewApproved(lead.id) });
    const elig = emailQueueEligibility({ review, recipientValid: validEmail(lead.publicEmail), suppressed: await isSuppressed({ email: lead.publicEmail, domain: lead.websiteDomain, phone: lead.phone }), held: !!state.held });
    // Schedulable = SENDABLE only (NEEDS_REVIEW is excluded from scheduling by directive).
    if (elig.ready && review.status === "SENDABLE") eligibleRaw.push({ lead, review });
    else notReady.push({ leadId: lead.id, business: lead.businessName, reason: elig.detail ?? (review.status === "NEEDS_REVIEW" ? "One finding — operator review before scheduling." : "Not ready.") });
  }

  const times = staggeredTimes(dateKey, eligibleRaw.length, stagger);
  const eligible: SchedulableItem[] = eligibleRaw.map(({ lead, review }, i) => ({
    leadId: lead.id, business: lead.businessName, recipient: lead.publicEmail!,
    subject: `Quick Review — ${lead.businessName}`, pdfFilename: quickReviewFilename(lead.businessName),
    revisionId: revisionFingerprint(review), proposedAt: times[i],
  }));

  return { eligible, scheduled, notReady, window: stagger, dateKey };
}
