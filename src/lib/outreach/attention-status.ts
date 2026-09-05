// Read-side helpers + constants for NEEDS_ATTENTION acknowledgement (mandate 15 Part 3). Kept OUT of the
// "use server" actions module because a "use server" file may export ONLY async functions (not consts/types).
// Presentation only — none of this changes the canonical lifecycle resolver.
import { listAudit } from "../repo";
import { getEditorialState } from "./review-revisions";

export const MANUAL_FOLLOWUP_FLAG_ACTION = "prospect.manual-followup.flagged";

export type AttentionAck = "held" | "flagged" | null;

/** Has the operator already acknowledged this attention item (held or flagged)? Presentation only — it does
 *  NOT affect the canonical resolver; it moves handled items out of the active queue. */
export async function attentionAck(leadId: string, audit?: Array<{ action?: string; targetId?: string }>): Promise<AttentionAck> {
  const est = await getEditorialState(leadId).catch(() => null);
  if (est?.held) return "held";
  const rows = audit ?? (await listAudit(5000));
  if (rows.some((a) => a.action === MANUAL_FOLLOWUP_FLAG_ACTION && a.targetId === leadId)) return "flagged";
  return null;
}
