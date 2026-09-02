// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL FUNNEL COUNTS (mandate VI) — the ONE reconciled count model read by Today, Schedule, Content
// Studio, and the batch actions. Replaces the contradictory per-surface numbers (the 9/10/19/3/10 defect)
// where the email card was capacity-capped, "ready today" clamped a different (uncapped) set, and the video
// card (capped 3) disagreed with "videos to create" (uncapped 10).
//
// This is a PURE function over per-lead facts so every category is unit-testable and every surface derives
// the SAME numbers from the SAME inputs. The categories are exactly the ones the operator screen shows:
//   eligibleNow · awaitingVideo · blocked · scheduled · sentToday · remainingCapacity
// plus the actionable buckets (readyToApproveAndSchedule / needsVoiceover / renderingOrFailed).
//
// Rule: a video-REQUIRED lead is NOT eligible until its video package is READY; an email-only lead is
// eligible as soon as it passes the send gates. Counts are by DISTINCT LEAD. Nothing is padded to the cap.
// ─────────────────────────────────────────────────────────────────────────────

export type LeadFunnelStatus =
  | "eligible-now"       // passes all send gates now (email-only, or video-required with a READY video)
  | "awaiting-video"     // video-required, video package not yet READY
  | "rendering"          // a render is queued/in-flight for this lead's video
  | "failed"             // the last render failed and no ready output exists
  | "blocked"            // fails a send gate (suppressed / invalid recipient / no evidence / held / bounced)
  | "scheduled"          // already scheduled for a future send window
  | "sent-today";        // a send already went out today (LA day)

// One lead's decided facts. Kept flat + boolean so the classifier is pure and testable.
export interface LeadFunnelFacts {
  leadId: string;
  videoRequired: boolean;
  videoReady: boolean;        // a frozen/ready package video exists
  rendering: boolean;         // a render job is queued/rendering
  renderFailed: boolean;      // last render failed, no ready output
  sendEligible: boolean;      // passes suppression/recipient/evidence/hold/quota gates (email readiness)
  blockedReason?: string | null;
  scheduled: boolean;         // has a pending scheduled send
  sentToday: boolean;         // a send already went out today
}

export function classifyLead(f: LeadFunnelFacts): LeadFunnelStatus {
  // Terminal-for-today states win first so a lead is counted once, unambiguously.
  if (f.sentToday) return "sent-today";
  if (f.scheduled) return "scheduled";
  // Video-required leads that still need a video are never "eligible" or "blocked-by-send" — they are
  // awaiting-video (or actively rendering / failed), so they stay OUT of the schedulable batch.
  if (f.videoRequired && !f.videoReady) {
    if (f.rendering) return "rendering";
    if (f.renderFailed) return "failed";
    return "awaiting-video";
  }
  if (!f.sendEligible) return "blocked";
  return "eligible-now";
}

export interface FunnelCounts {
  eligibleNow: number;
  awaitingVideo: number;
  rendering: number;
  failed: number;
  blocked: number;
  scheduled: number;
  sentToday: number;
  remainingCapacity: number;   // max(0, dailyCap − sentToday) — cap CAPACITY, not available emails
  // Actionable buckets (distinct leads):
  readyToApproveAndSchedule: string[]; // eligible-now lead ids
  needsVoiceover: string[];            // awaiting-video lead ids
  renderingOrFailed: string[];         // rendering + failed lead ids
  blockedLeads: Array<{ leadId: string; reason: string }>;
  scheduledLeads: string[];
}

export interface FunnelInput {
  leads: LeadFunnelFacts[];
  dailyCap: number;      // absolute LA-day cap (20)
  sentToday: number;     // sends already made today (drives remaining capacity)
}

/** The single canonical reconciliation. Every surface calls this with the same inputs → identical counts. */
export function computeFunnel(input: FunnelInput): FunnelCounts {
  const c: FunnelCounts = {
    eligibleNow: 0, awaitingVideo: 0, rendering: 0, failed: 0, blocked: 0, scheduled: 0, sentToday: 0,
    remainingCapacity: Math.max(0, input.dailyCap - Math.max(0, input.sentToday)),
    readyToApproveAndSchedule: [], needsVoiceover: [], renderingOrFailed: [], blockedLeads: [], scheduledLeads: [],
  };
  const seen = new Set<string>();
  for (const f of input.leads) {
    if (seen.has(f.leadId)) continue; // distinct-lead accounting
    seen.add(f.leadId);
    switch (classifyLead(f)) {
      case "eligible-now": c.eligibleNow++; c.readyToApproveAndSchedule.push(f.leadId); break;
      case "awaiting-video": c.awaitingVideo++; c.needsVoiceover.push(f.leadId); break;
      case "rendering": c.rendering++; c.renderingOrFailed.push(f.leadId); break;
      case "failed": c.failed++; c.renderingOrFailed.push(f.leadId); break;
      case "blocked": c.blocked++; c.blockedLeads.push({ leadId: f.leadId, reason: f.blockedReason || "not ready" }); break;
      case "scheduled": c.scheduled++; c.scheduledLeads.push(f.leadId); break;
      case "sent-today": c.sentToday++; break;
    }
  }
  return c;
}

/** How many of the eligible leads can actually be SENT right now, bounded by remaining daily capacity.
 *  (Scheduling for a future window is NOT capacity-bounded — only sending-now is.) */
export function sendableNowCount(c: FunnelCounts): number {
  return Math.min(c.eligibleNow, c.remainingCapacity);
}
