// ─────────────────────────────────────────────────────────────────────────────
// Review Video pilot measurement (Batch Pilot M1) — the smallest framework to learn whether review
// videos help, WITHOUT fabricating data. Events are recorded on the existing append-only audit log
// (single source of truth); only events the system can actually know are emitted. The finding-reaction
// loop preserves which finding a prospect reacted to (operator-selected). Pilot data is CAPTURED here;
// it never auto-mutates finding ranking (a later milestone may, on real evidence).
// ─────────────────────────────────────────────────────────────────────────────
import { appendAudit, auditForTarget } from "../repo";
import { currentOperatorId } from "../auth";

// Events the system can legitimately record. NOTE: "viewed" is intentionally ABSENT until real view
// tracking exists — we never fabricate a view event.
export const REVIEW_VIDEO_EVENTS = [
  "review-video.prepared", "review-video.visual-rendered", "review-video.voice-added",
  "review-video.final-rendered", "review-video.rendered", "review-video.approved",
  "review-video.delivery-ready", "review-video.failed", "review-video.retried",
  "review-video.sent", "review-video.reply", "review-video.positive-reply", "review-video.conversation",
] as const;
export type ReviewVideoEvent = (typeof REVIEW_VIDEO_EVENTS)[number];

/** Record a pilot event against the JOB (target) with optional cohort/meta. Append-only + auditable. */
export async function recordVideoEvent(jobId: string, event: ReviewVideoEvent, meta: Record<string, unknown> = {}): Promise<void> {
  await appendAudit({ action: event, actor: currentOperatorId() ?? "system", targetType: "review-video-job", targetId: jobId, meta, ip: null });
}

export type ReactionType = "mentioned" | "asked-about" | "positive" | "negative";

/** Preserve which finding a prospect reacted to (operator-selected — no NLP). Enables, later,
 *  "finding type → reaction → conversation effectiveness" analysis. */
export async function recordFindingReaction(jobId: string, findingId: string, reaction: ReactionType): Promise<void> {
  await appendAudit({ action: "review-video.finding-reaction", actor: currentOperatorId() ?? "operator", targetType: "review-video-job", targetId: jobId, meta: { findingId, reaction }, ip: null });
}

/** Read the pilot events recorded for a job (from the audit log). */
export async function jobEvents(jobId: string): Promise<Array<{ action: string; meta: unknown; createdAt: string }>> {
  const rows = await auditForTarget("review-video-job", jobId);
  return rows.map((r) => ({ action: r.action, meta: r.meta, createdAt: r.createdAt }));
}

export interface PilotSummary {
  prepared: number; voiceAdded: number; rendered: number; approved: number; deliveryReady: number;
  sent: number; replies: number; positiveReplies: number; conversations: number;
  /** cohort split when a cohort tag is present on the sent event's meta. */
  byCohort: Record<string, { sent: number; replies: number; positiveReplies: number; conversations: number }>;
}

/** Aggregate a flat list of pilot audit events into a summary. Pure — counts only what was recorded;
 *  rates/significance are the reader's call (we never invent them). */
export function summarizePilot(events: Array<{ action: string; meta?: any }>): PilotSummary {
  const s: PilotSummary = { prepared: 0, voiceAdded: 0, rendered: 0, approved: 0, deliveryReady: 0, sent: 0, replies: 0, positiveReplies: 0, conversations: 0, byCohort: {} };
  const cohort = (m: any): string => (m && typeof m.cohort === "string" ? m.cohort : "unlabeled");
  for (const e of events) {
    switch (e.action) {
      case "review-video.prepared": s.prepared++; break;
      case "review-video.voice-added": s.voiceAdded++; break;
      case "review-video.final-rendered": case "review-video.rendered": s.rendered++; break;
      case "review-video.approved": s.approved++; break;
      case "review-video.delivery-ready": s.deliveryReady++; break;
      case "review-video.sent": { s.sent++; bump(s, cohort(e.meta), "sent"); break; }
      case "review-video.reply": { s.replies++; bump(s, cohort(e.meta), "replies"); break; }
      case "review-video.positive-reply": { s.positiveReplies++; bump(s, cohort(e.meta), "positiveReplies"); break; }
      case "review-video.conversation": { s.conversations++; bump(s, cohort(e.meta), "conversations"); break; }
    }
  }
  return s;
}

function bump(s: PilotSummary, cohort: string, key: "sent" | "replies" | "positiveReplies" | "conversations") {
  s.byCohort[cohort] ??= { sent: 0, replies: 0, positiveReplies: 0, conversations: 0 };
  s.byCohort[cohort][key]++;
}
