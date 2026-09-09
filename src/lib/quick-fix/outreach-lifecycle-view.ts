// ─────────────────────────────────────────────────────────────────────────────
// OUTREACH LIFECYCLE VIEW — the READ-ONLY projection the operator UI consumes.
//
// It answers one question honestly: "for this offer, what is the outreach artifact's
// subject, what state is the send workflow in, and what may the operator do next?"
// It NEVER mutates and NEVER dispatches. The can* flags encode the SAME safety rules
// the routes enforce (single source of truth for "what's allowed"), so the UI cannot
// offer an action the backend would reject.
// ─────────────────────────────────────────────────────────────────────────────
import { getOffer, effectiveOutreachState, type OutreachState } from "./store";

export interface OutreachLifecycleView {
  offerId: string;
  outreachState: OutreachState;
  subject: {
    selected: string | null;
    alternatives: string[];
    family: string | null;
    /** True ⇒ the selected subject is approved+frozen and cannot change without
     *  invalidating the approval. */
    frozen: boolean;
  };
  scheduledAt: string | null;
  scheduledTz: string | null;
  sentAt: string | null;
  sentMailbox: string | null;
  sentRecipient: string | null;
  /** May the operator approve now? (has a selected subject AND not already sent). */
  canApprove: boolean;
  /** May the operator SEND now? (approved-not-sent or scheduled; not yet sent). Note
   *  this reflects the LIFECYCLE gate only — the outbound freeze/pause is enforced at
   *  the send route and may still refuse a dispatch. */
  canSend: boolean;
  /** May the operator schedule/reschedule now? (approved-not-sent or scheduled). */
  canSchedule: boolean;
}

/** Build the lifecycle view for an offer, or null when the offer does not exist. */
export async function outreachLifecycleView(offerId: string): Promise<OutreachLifecycleView | null> {
  const o = await getOffer(offerId);
  if (!o) return null;
  const state = effectiveOutreachState(o);
  const frozen = !!o.approvedSubjectFrozen;
  const selected = o.subjectSelected ?? null;

  const alreadySent = state === "SENT" || state === "PURCHASED";
  const approvedNotSent = state === "APPROVED_NOT_SENT";
  const scheduled = state === "SCHEDULED";

  return {
    offerId: o.offerId,
    outreachState: state,
    subject: {
      selected,
      alternatives: o.subjectAlternatives ?? [],
      family: o.subjectFamily ?? null,
      frozen,
    },
    scheduledAt: o.scheduledAt ?? null,
    scheduledTz: o.scheduledTz ?? null,
    sentAt: o.sentAt ?? null,
    sentMailbox: o.sentMailbox ?? null,
    sentRecipient: o.sentRecipient ?? null,
    canApprove: !!selected && !alreadySent,
    canSend: (approvedNotSent || scheduled) && !alreadySent,
    canSchedule: approvedNotSent || scheduled,
  };
}
