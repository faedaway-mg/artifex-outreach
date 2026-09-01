// ─────────────────────────────────────────────────────────────────────────────
// Canonical client-video work source (section C).
//
// A client video is ONE persisted project keyed by lead id (`client-<leadId>`). The
// "videos to create" number MUST read identically on Today and in Content Studio, so
// both surfaces derive it from THIS single function instead of two independent queries
// (Today used prepare_video tasks; Content Studio listed eligible candidates — they
// could never be guaranteed to match). The canonical pending set is:
//
//     leads with an OPEN prepare_video task, whose client video is NOT yet posted.
//
// Posting the client video in Content Studio completes the Today task (reconcile below),
// so a finished video leaves the pending set on BOTH surfaces at once.
// ─────────────────────────────────────────────────────────────────────────────

import { clientVideoPieceId, leadIdFromClientPiece } from "./client-video-routing";

export interface TaskLike {
  leadId: string;
  type: string;
  status: string;
}

/**
 * The canonical set of lead ids that still need a client video created — distinct leads
 * with an open `prepare_video` task, excluding any whose client video is already posted.
 * `postedPieceIds` is the set of Content Studio piece ids marked posted (Object.keys of
 * the posted map); a `client-<leadId>` posted marker retires that lead from the set.
 */
export function pendingClientVideoLeadIds(tasks: TaskLike[], postedPieceIds: Iterable<string> = []): Set<string> {
  const postedLeads = new Set<string>();
  for (const pid of postedPieceIds) {
    const leadId = leadIdFromClientPiece(pid);
    if (leadId) postedLeads.add(leadId);
  }
  const out = new Set<string>();
  for (const t of tasks) {
    if (t.type !== "prepare_video" || t.status !== "open") continue;
    if (postedLeads.has(t.leadId)) continue;
    out.add(t.leadId);
  }
  return out;
}

/** Count form of {@link pendingClientVideoLeadIds} — the number both surfaces display. */
export function pendingClientVideoCount(tasks: TaskLike[], postedPieceIds: Iterable<string> = []): number {
  return pendingClientVideoLeadIds(tasks, postedPieceIds).size;
}

/** The stable Content Studio project id a Today prepare_video task maps to. */
export { clientVideoPieceId };
