// ─────────────────────────────────────────────────────────────────────────────
// TODAY command-center data gatherer (mandate IV/VI-UI). Turns the already-loaded Today snapshot into the
// canonical FunnelInput (for computeFunnel) PLUS the compact display rows each section renders. The
// per-lead fact derivation is PURE + testable; the async gatherer just supplies the inputs. This is the
// ONE place Today builds its facts, so Today and Schedule read identical counts from computeFunnel().
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead } from "../types";
import type { LeadFunnelFacts } from "./funnel-counts";

export interface LeadInputs {
  lead: Lead;
  hasOpenVideoTask: boolean;   // an open prepare_video task → this package requires a video
  videoReady: boolean;         // a ready render (or frozen package video) exists for client-<leadId>
  videoRendering: boolean;     // a queued/rendering CS job exists
  videoFailed: boolean;        // last CS job failed and no ready output
  sendEligible: boolean;       // passes email send gates (review sendable/approved, recipient, suppression, hold)
  blockedReason: string | null;
  scheduled: boolean;          // has a pending scheduled batch entry
  sentToday: boolean;          // an email_send went out today (LA day)
  finding: string | null;      // the concrete evidence finding headline (for display)
  recipient: string | null;    // recipient email (display only)
}

export interface TodayRow {
  leadId: string;
  business: string;
  recipient: string | null;
  finding: string | null;
  videoRequired: boolean;
}

/** Pure: one lead's inputs → its canonical funnel facts. A video-REQUIRED lead is never send-eligible
 *  until its video is ready (so it can't be scheduled early); email-only leads ignore video entirely. */
export function deriveLeadFacts(i: LeadInputs): LeadFunnelFacts {
  const videoRequired = i.hasOpenVideoTask;
  return {
    leadId: i.lead.id,
    videoRequired,
    videoReady: i.videoReady,
    rendering: i.videoRendering,
    renderFailed: i.videoFailed,
    sendEligible: i.sendEligible,
    blockedReason: i.blockedReason,
    scheduled: i.scheduled,
    sentToday: i.sentToday,
  };
}

/** Build a display row alongside the facts (business/recipient/finding/videoRequired). */
export function toRow(i: LeadInputs): { leadId: string; business: string; recipient: string | null; finding: string | null; videoRequired: boolean } {
  return {
    leadId: i.lead.id,
    business: i.lead.businessName,
    recipient: i.recipient,
    finding: i.finding,
    videoRequired: i.hasOpenVideoTask,
  };
}
