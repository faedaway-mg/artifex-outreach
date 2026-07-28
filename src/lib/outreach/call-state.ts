// One lead, one active contact state. A Call First lead is never "everything at
// once" — at any moment it is in exactly one of these states, and the workspace
// renders only the single action that state requires. This is the source of truth
// the page reads to decide what to show; it is derived from the state the call
// outcomes already recorded (stage, follow-up, business status), so there is no
// second system re-interpreting the lead.
import type { Lead } from "@/lib/types";

export type CallLeadState =
  | { kind: "call-required" }
  | { kind: "attempt-scheduled"; at: string; lastResult: string | null }
  | { kind: "closed"; reason: "not-interested" | "invalid"; label: string };

/** The subset of the lead this derivation reads — structurally satisfied by Lead. */
export type CallStateLead = Pick<Lead, "pipelineStage" | "businessStatus" | "nextFollowUpAt" | "note">;

/** The first (newest) line of the running note — the most recent call result. */
function newestNote(note: string | null): string | null {
  const first = (note ?? "").split("\n")[0]?.trim();
  return first ? first : null;
}

/**
 * The lead's current contact state. Note: an email-collected lead is no longer
 * call-first at all (a verified email flips the strategy to email-first), so that
 * transition is handled by the page's strategy branch, not here — this function
 * only distinguishes the states a still-call-first lead can be in.
 */
export function deriveCallLeadState(lead: CallStateLead): CallLeadState {
  const status = (lead.businessStatus ?? "").toUpperCase();

  // Closed — the call happened (or the business is gone) and no outreach should
  // compete for attention. Never show "Call the business" for one of these.
  if (lead.pipelineStage === "Lost") {
    return { kind: "closed", reason: "not-interested", label: "Not interested" };
  }
  if (lead.pipelineStage === "Disqualified" || status.startsWith("CLOSED")) {
    return { kind: "closed", reason: "invalid", label: "Closed or invalid" };
  }

  // An attempt was made and the next one is scheduled (no answer / voicemail /
  // follow-up). The one action is to call again at that time.
  if (lead.nextFollowUpAt) {
    return { kind: "attempt-scheduled", at: lead.nextFollowUpAt, lastResult: newestNote(lead.note) };
  }

  // Fresh: the call still needs to be made.
  return { kind: "call-required" };
}
